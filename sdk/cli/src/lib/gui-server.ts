import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join, dirname as pathDirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const _cliVersion: string = (_require("../../package.json") as { version: string }).version;
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  listProposals, loadProposal, saveProposal, getProposalsDir,
  computeProposalIdHash, computeVoteDigestHash,
  voteSigningMessage,
  isReviewWindowPassed, isVoteApproved, isReadyToExecute,
  countYes, VOTE_THRESHOLD, REVIEW_WINDOW_MS,
  type Proposal, type ProposalAction, type ThreatClass, type Severity, type VoteChoice,
} from "./proposals.js";
import { getLiveCell } from "./rpc.js";
import { resolveRegistryOutpoint } from "./registry.js";
import { parseRegistryPayload } from "@ckb-firewall/sdk";
import {
  hexToBytes, bytesToHex, strip0x,
  encodeRegistryPayload, extractGovernanceHeaderRaw, parseGovernanceHeader,
  governanceTreasuryLockHash, insertSorted, removeEntry, scriptToMoleculeBytes,
} from "./blkl.js";
import { computeMerkleProof, verifyMerkleProof } from "./validator-set.js";
import {
  TESTNET_GOVERNANCE_PUBKEYS, TESTNET_CONTRACT_OUTPOINTS, SECP256K1_DEP_GROUP,
  TESTNET_TREASURY_LOCK_SCRIPT,
} from "./defaults.js";
import {
  ckbBlake2b, buildGov1WitnessV4, buildValidatorVoteWitness,
  buildWitnessArgs, encodeRelativeTimestampSince,
} from "./witness.js";
import {
  assertProposalCellMatches,
  assertProposalAnchorTypeMatches,
  encodeProposalCellData,
  loadRegistryStateForProposal,
  parseRegistryTypeIdValue,
  proposalCellDataHash,
  proposalV4Fields,
} from "./governance-v4.js";
import { hexCapacity, occupiedCapacityShannons, parseCapacity } from "./capacity.js";
import { loadTreasuryStatus } from "./treasury-status.js";

export interface GuiServerOptions {
  rpcUrl: string;
  registryTx: string;
  registryIndex: number;
  port: number;
}

export interface GuiServer {
  port: number;
  close: () => void;
}

const DEFAULT_FEE_SHANNONS = 100_000n;
// Treasury-lock change outputs have 64-byte args — minimum occupied capacity is
// 8 (capacity field) + 117 (lock script molecule) = 125 CKB = 12,500,000,000 shannons.
const MIN_CHANGE_SHANNONS = 125n * 100_000_000n;

// ── /api/data handler ─────────────────────────────────────────────────────────

async function buildApiData(opts: GuiServerOptions): Promise<string> {
  const proposals = listProposals();

  let registry: {
    entries: { identifier: string; expiresAt: string | null }[];
    txHash: string;
    index: number;
    version: number;
    threshold: number | null;
    validatorCount: number | null;
    treasury: Awaited<ReturnType<typeof loadTreasuryStatus>>;
    error: string | null;
  };

  try {
    const { txHash, index } = await resolveRegistryOutpoint(
      opts.rpcUrl,
      opts.registryTx,
      opts.registryIndex,
    );
    const cell = await getLiveCell(opts.rpcUrl, txHash, index);
    const payload = parseRegistryPayload(cell.data);
    const governanceHeaderRaw = extractGovernanceHeaderRaw(cell.data);
    const governanceHeader = governanceHeaderRaw ? parseGovernanceHeader(governanceHeaderRaw) : null;
    registry = {
      txHash,
      index,
      version: payload.version,
      threshold: governanceHeader?.threshold ?? null,
      validatorCount: governanceHeader?.validatorCount ?? null,
      treasury: await loadTreasuryStatus(opts.rpcUrl, cell, governanceHeader),
      error: null,
      entries: payload.entries.map((e) => ({
        identifier: e.identifier,
        expiresAt: e.expiresAt === 0n ? null : String(e.expiresAt),
      })),
    };
  } catch (err) {
    registry = {
      txHash: opts.registryTx,
      index: opts.registryIndex,
      version: 0,
      threshold: null,
      validatorCount: null,
      treasury: null,
      error: err instanceof Error ? err.message : String(err),
      entries: [],
    };
  }

  return JSON.stringify({
    proposals,
    registry,
    meta: {
      rpcUrl: opts.rpcUrl,
      fetchedAt: new Date().toISOString(),
      cliVersion: _cliVersion,
    },
  });
}

// ── request body reader ───────────────────────────────────────────────────────

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 128 * 1024) req.destroy(new Error("Request body too large"));
    });
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { reject(new Error("Invalid JSON body")); } });
    req.on("error", reject);
  });
}

function apiOk(res: ServerResponse, data: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
  res.end(JSON.stringify(data));
}
function apiErr(res: ServerResponse, msg: string, status = 400): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: msg }));
}

function parseOutputIndex(value: unknown, name: string): number {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer.`);
  return Number.parseInt(raw, 10);
}

function parseOptionalTxHash(value: unknown, name: string): string | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error(`${name} must be a 0x-prefixed 32-byte transaction hash.`);
  return raw;
}

function extractProposalOutpoint(proposal: Proposal, body: Record<string, unknown>): { txHash: string; index: number } {
  const txHash = parseOptionalTxHash(body.proposalTx, "proposalTx") || proposal.proposalCellTxHash?.trim();
  const indexRaw = body.proposalIndex ?? (
    proposal.proposalCellIndex === undefined ? undefined : String(proposal.proposalCellIndex)
  );
  if (!txHash || indexRaw === undefined) {
    throw new Error("Proposal cell outpoint is missing. Anchor the proposal cell first, then record its tx hash and output index.");
  }
  return { txHash, index: parseOutputIndex(indexRaw, "proposalIndex") };
}

// ── /api/propose ──────────────────────────────────────────────────────────────

function isValidHex(v: string): boolean {
  const c = strip0x(v);
  return c.length > 0 && /^[0-9a-fA-F]+$/.test(c) && c.length % 2 === 0;
}

async function handlePropose(body: unknown): Promise<object> {
  if (typeof body !== "object" || body === null) throw new Error("Invalid body");
  const b = body as Record<string, unknown>;

  const action = String(b.action ?? "");
  if (action !== "add" && action !== "remove") throw new Error('action must be "add" or "remove"');

  const rawArgs = String(b.lockArgs ?? "").trim();
  if (!rawArgs || !isValidHex(rawArgs)) throw new Error("lockArgs must be valid even-length hex");
  const lockArgs = `0x${strip0x(rawArgs).toLowerCase()}`;

  const evidence = String(b.evidence ?? "").trim();
  if (evidence.length < 10) throw new Error("evidence must be at least 10 characters");

  const classification = String(b.classification ?? "");
  if (!["theft","scam","hack","sanctions","other"].includes(classification))
    throw new Error("Invalid classification");

  const severity = String(b.severity ?? "");
  if (!["critical","high","medium","low"].includes(severity))
    throw new Error("Invalid severity");

  const rationale = String(b.rationale ?? "").trim();
  if (rationale.length < 20) throw new Error("rationale must be at least 20 characters");

  const proposer = String(b.proposer ?? "").trim();
  if (!proposer) throw new Error("proposer is required");

  let expiresAt = "0";
  if (action === "add" && b.expiresAt && b.expiresAt !== "0") {
    const n = Number(b.expiresAt);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) throw new Error("Invalid expiresAt timestamp");
    if (n <= Math.floor(Date.now() / 1000)) throw new Error("expiresAt must be in the future");
    expiresAt = String(n);
  }

  const submittedAt = new Date().toISOString();
  const reviewWindowEndsAt = new Date(Date.now() + REVIEW_WINDOW_MS).toISOString();
  const proposalIdHash = computeProposalIdHash({
    action: action as ProposalAction, lockArgs, expiresAt, evidence,
    classification: classification as ThreatClass, severity: severity as Severity,
    rationale, proposer, submittedAt,
  });

  const proposal: Proposal = {
    id: proposalIdHash.slice(2, 14),
    proposalIdHash, action: action as ProposalAction,
    lockArgs, expiresAt, evidence,
    classification: classification as ThreatClass,
    severity: severity as Severity,
    rationale, proposer, submittedAt, reviewWindowEndsAt,
    status: "pending-review",
    votes: [], voteDigestHash: computeVoteDigestHash([]), signatures: [],
  };
  saveProposal(proposal);
  return { ok: true, id: proposal.id, proposal };
}

// ── /api/vote ─────────────────────────────────────────────────────────────────

async function handleVote(body: unknown, opts: GuiServerOptions): Promise<object> {
  if (typeof body !== "object" || body === null) throw new Error("Invalid body");
  const b = body as Record<string, unknown>;

  const proposalId = String(b.proposalId ?? "").trim();
  if (!proposalId) throw new Error("proposalId required");

  const choice = String(b.vote ?? "");
  if (choice !== "yes" && choice !== "no" && choice !== "abstain")
    throw new Error("vote must be yes, no, or abstain");

  const pkHex = String(b.privateKey ?? "").trim();
  if (!pkHex) throw new Error("privateKey required");

  let pkBytes: Uint8Array;
  try {
    pkBytes = hexToBytes(pkHex);
    if (pkBytes.length !== 32) throw new Error("must be 32 bytes");
    secp256k1.getPublicKey(pkBytes);
  } catch (e) { throw new Error("Invalid private key: " + (e instanceof Error ? e.message : String(e))); }

  const proposal = loadProposal(proposalId);
  if (proposal.status === "executed") throw new Error("Proposal already executed");
  if (proposal.status === "rejected") throw new Error("Proposal was rejected");

  const pubkeyBytes = secp256k1.getPublicKey(pkBytes, true);
  const pubkey = bytesToHex(new Uint8Array(pubkeyBytes));

  const validatorSet = TESTNET_GOVERNANCE_PUBKEYS.map((k) => bytesToHex(k));
  const merkleResult = computeMerkleProof(validatorSet, pubkey);
  if (!merkleResult) { pkBytes.fill(0); throw new Error(`Key is not an authorized governance voter (pubkey: ${pubkey.slice(0, 20)}…)`); }
  const { proof: merkleProof, leafIndex: merkleLeafIndex } = merkleResult;

  if (proposal.votes.some((v) => v.pubkey.toLowerCase() === pubkey.toLowerCase())) {
    pkBytes.fill(0); throw new Error("This governance voter already voted on this proposal");
  }

  const timestamp = new Date().toISOString();
  const msgHash = voteSigningMessage(proposal.proposalIdHash, choice as VoteChoice, timestamp, pubkey);
  const sigRaw = secp256k1.sign(msgHash, pkBytes, { lowS: true, format: "recovered" });
  const sigBytes = new Uint8Array(65);
  sigBytes.set(sigRaw.slice(1), 0);
  sigBytes[64] = sigRaw[0] ?? 0;
  pkBytes.fill(0);

  proposal.votes.push({ pubkey, vote: choice as VoteChoice, timestamp, signature: bytesToHex(sigBytes), merkleLeafIndex, merkleProof });
  proposal.voteDigestHash = computeVoteDigestHash(proposal.votes);
  const yesCount = countYes(proposal.votes);
  const approved = isVoteApproved(proposal);
  if (proposal.status === "pending-review" || proposal.status === "voting")
    proposal.status = approved ? "approved" : "voting";
  saveProposal(proposal);

  return { ok: true, yesCount, approved, status: proposal.status, pubkey };
}

// ── /api/execute ──────────────────────────────────────────────────────────────

async function handleExecute(body: unknown, opts: GuiServerOptions): Promise<object> {
  if (typeof body !== "object" || body === null) throw new Error("Invalid body");
  const b = body as Record<string, unknown>;

  const proposalId = String(b.proposalId ?? "").trim();
  if (!proposalId) throw new Error("proposalId required");
  const proposal = loadProposal(proposalId);
  if (proposal.status === "executed") throw new Error("Proposal already executed");
  if (!isReviewWindowPassed(proposal)) throw new Error("Local review window has not passed");
  if (!isVoteApproved(proposal)) throw new Error("Vote threshold not met");

  const outpoint = extractProposalOutpoint(proposal, b);
  const state = await loadRegistryStateForProposal(opts.rpcUrl, opts.registryTx, opts.registryIndex, proposal);
  const proposalCell = await getLiveCell(opts.rpcUrl, outpoint.txHash, outpoint.index);
  const proposalDataHash = assertProposalCellMatches(proposal, proposalCell.data, state.registryTypeIdValue);
  const fields = proposalV4Fields(proposal, state.registryTypeIdValue);
  if (bytesToHex(fields.proposalDataHash) !== bytesToHex(proposalDataHash)) {
    throw new Error("Internal proposal hash mismatch");
  }
  proposal.proposalDataHash = bytesToHex(proposalDataHash);
  proposal.reviewDelayMs = fields.reviewDelayMs.toString();
  proposal.proposalCellTxHash = outpoint.txHash;
  proposal.proposalCellIndex = outpoint.index;

  for (const v of proposal.votes) {
    const sigBytes = hexToBytes(v.signature);
    if (sigBytes.length !== 65) throw new Error(`Vote from ${v.pubkey.slice(0, 14)}... has invalid signature length`);
    const msgHash = voteSigningMessage(proposal.proposalIdHash, v.vote, v.timestamp, v.pubkey);
    const sig65 = new Uint8Array(65);
    sig65[0] = sigBytes[64] as number;
    sig65.set(sigBytes.subarray(0, 64), 1);
    const recoveredPubkey = bytesToHex(new Uint8Array(secp256k1.recoverPublicKey(sig65, msgHash)));
    if (recoveredPubkey !== v.pubkey) throw new Error(`Vote signature does not match pubkey ${v.pubkey.slice(0, 14)}...`);
  }

  if (state.governanceHeader?.validatorCount) {
    const rootHex = bytesToHex(state.governanceHeader.validatorMerkleRoot);
    for (const v of proposal.votes) {
      if (!verifyMerkleProof(rootHex, v.pubkey, v.merkleProof, v.merkleLeafIndex)) {
        throw new Error(`Vote from ${v.pubkey.slice(0, 14)}... is not in the on-chain governance voter set`);
      }
    }
  }

  const proposalCapacity = parseCapacity(proposalCell.capacity);
  const proposalChangeCapacity = proposalCapacity - DEFAULT_FEE_SHANNONS;
  if (proposalChangeCapacity < MIN_CHANGE_SHANNONS) {
    throw new Error(`Proposal cell capacity ${proposalCapacity} shannons is too small to return change after fee`);
  }
  let registryOutputCapacity = parseCapacity(state.cell.capacity);
  let extraTreasuryOutputCapacity = 0n;
  const treasuryLockHash = governanceTreasuryLockHash(state.governanceHeader);
  let treasuryLockScript: { code_hash: string; hash_type: string; args: string } | undefined;
  if (treasuryLockHash) {
    treasuryLockScript = state.governanceHeader?.treasuryLockScript;
    if (!treasuryLockScript) {
      throw new Error(
        "Registry treasury lock script is missing from the governance header. " +
        "A full treasury lock script (v3 header) is required to safely route change capacity."
      );
    }
    assertProposalAnchorTypeMatches({
      proposalCellType: proposalCell.type,
      registryTypeIdValue: state.registryTypeIdValue,
      governanceHeader: state.governanceHeader,
      reclaimDelayMs: fields.reviewDelayMs,
    });
    const proposalLockHash = ckbBlake2b(scriptToMoleculeBytes(proposalCell.lock));
    if (bytesToHex(proposalLockHash) !== bytesToHex(treasuryLockHash)) {
      throw new Error("This registry uses treasury-funded anchors, but the proposal cell is not locked to the registry treasury");
    }
    const registryInputCapacity = parseCapacity(state.cell.capacity);
    const minRegistryCapacity = occupiedCapacityShannons({
      lock: state.cell.lock,
      type: state.cell.type,
      data: state.newBlkl,
    });
    registryOutputCapacity = minRegistryCapacity;
    if (registryOutputCapacity > registryInputCapacity) {
      throw new Error(
        `Registry update needs ${registryOutputCapacity - registryInputCapacity} shannons of treasury capacity for growth. ` +
        "Use the CLI execute command with --treasury-cell inputs.",
      );
    }
    extraTreasuryOutputCapacity = registryInputCapacity - registryOutputCapacity;
  }

  const yesVotes = proposal.votes
    .filter((v) => v.vote === "yes")
    .sort((a, b) => a.pubkey.localeCompare(b.pubkey));
  const gov1 = buildGov1WitnessV4({
    proposalIdHash: hexToBytes(proposal.proposalIdHash),
    voteDigestHash: hexToBytes(proposal.voteDigestHash),
    oldRoot: state.oldRoot,
    newRoot: state.newRoot,
    proposalDataHash,
    reviewDelayMs: fields.reviewDelayMs,
  });
  const voteWitness = buildValidatorVoteWitness(yesVotes.map((v) => ({
    pubkey: hexToBytes(v.pubkey),
    vote: v.vote,
    timestamp: v.timestamp,
    signature: hexToBytes(v.signature),
    merkleLeafIndex: v.merkleLeafIndex,
    merkleProof: v.merkleProof.map(hexToBytes),
  })));
  const witnessBytes = buildWitnessArgs({ lock: voteWitness, inputType: gov1 });

  const txJson = {
    transaction: {
      version: "0x0",
      cell_deps: [
        { out_point: { tx_hash: SECP256K1_DEP_GROUP.txHash, index: "0x0" }, dep_type: "dep_group" },
        {
          out_point: {
            tx_hash: TESTNET_CONTRACT_OUTPOINTS.blacklistRegistry.txHash,
            index: `0x${TESTNET_CONTRACT_OUTPOINTS.blacklistRegistry.index.toString(16)}`,
          },
          dep_type: "code",
        },
        {
          out_point: {
            tx_hash: TESTNET_CONTRACT_OUTPOINTS.governanceLock.txHash,
            index: `0x${TESTNET_CONTRACT_OUTPOINTS.governanceLock.index.toString(16)}`,
          },
          dep_type: "code",
        },
        ...(treasuryLockHash ? [{
          out_point: {
            tx_hash: TESTNET_CONTRACT_OUTPOINTS.proposalAnchor.txHash,
            index: `0x${TESTNET_CONTRACT_OUTPOINTS.proposalAnchor.index.toString(16)}`,
          },
          dep_type: "code" as const,
        }] : []),
      ],
      header_deps: [],
      inputs: [
        {
          since: "0x0",
          previous_output: { tx_hash: state.cell.txHash, index: `0x${state.cell.index.toString(16)}` },
        },
        {
          since: encodeRelativeTimestampSince(fields.reviewDelayMs),
          previous_output: { tx_hash: outpoint.txHash, index: `0x${outpoint.index.toString(16)}` },
        },
      ],
      outputs: [
        { capacity: hexCapacity(registryOutputCapacity), lock: state.cell.lock, type: state.cell.type },
        // Merge proposal change + extra treasury capacity into one output to avoid
        // creating a cell below the minimum 125 CKB for treasury-lock's 64-byte args.
        { capacity: hexCapacity(proposalChangeCapacity + extraTreasuryOutputCapacity), lock: treasuryLockScript ?? proposalCell.lock, type: null },
      ],
      outputs_data: [
        bytesToHex(state.newBlkl),
        "0x",
      ],
      witnesses: [bytesToHex(witnessBytes), bytesToHex(buildWitnessArgs({}))],
    },
    multisig_configs: {},
    signatures: {},
  };

  saveProposal(proposal);
  return {
    ok: true,
    proposal,
    txJson,
    filename: `gov_execute_tx_${proposal.id}.json`,
    proposalCell: outpoint,
    proposalDataHash: bytesToHex(proposalDataHash),
    since: encodeRelativeTimestampSince(fields.reviewDelayMs),
  };
}

// ── /api/anchor ───────────────────────────────────────────────────────────────

async function handleAnchor(body: unknown, opts: GuiServerOptions): Promise<object> {
  if (typeof body !== "object" || body === null) throw new Error("Invalid body");
  const b = body as Record<string, unknown>;
  const proposalId = String(b.proposalId ?? "").trim();
  if (!proposalId) throw new Error("proposalId required");

  const proposal = loadProposal(proposalId);
  const { txHash, index } = await resolveRegistryOutpoint(opts.rpcUrl, opts.registryTx, opts.registryIndex);
  const registryCell = await getLiveCell(opts.rpcUrl, txHash, index);
  if (!registryCell.type) throw new Error("Registry cell has no type script");
  const registryTypeIdValue = parseRegistryTypeIdValue(registryCell.type.args);
  const governanceHeaderRaw = extractGovernanceHeaderRaw(registryCell.data);
  const governanceHeader = governanceHeaderRaw ? parseGovernanceHeader(governanceHeaderRaw) : null;
  const proposalData = encodeProposalCellData(proposal, registryTypeIdValue);
  const proposalDataHashHex = bytesToHex(proposalCellDataHash(proposal, registryTypeIdValue));
  proposal.proposalDataHash = proposalDataHashHex;
  proposal.reviewDelayMs = proposal.reviewDelayMs ?? String(REVIEW_WINDOW_MS);

  const proposalTx = parseOptionalTxHash(b.proposalTx, "proposalTx");
  let anchorVerified = false;
  if (proposalTx) {
    const proposalIndex = parseOutputIndex(b.proposalIndex, "proposalIndex");
    const proposalCell = await getLiveCell(opts.rpcUrl, proposalTx, proposalIndex);
    const liveHash = assertProposalCellMatches(proposal, proposalCell.data, registryTypeIdValue);
    if (bytesToHex(liveHash) !== proposalDataHashHex) {
      throw new Error("Live proposal-cell hash does not match the expected PBLK data");
    }
    assertProposalAnchorTypeMatches({
      proposalCellType: proposalCell.type,
      registryTypeIdValue,
      governanceHeader,
      reclaimDelayMs: BigInt(proposal.reviewDelayMs),
    });
    const treasuryLockHash = governanceTreasuryLockHash(governanceHeader);
    if (treasuryLockHash) {
      const proposalLockHash = ckbBlake2b(scriptToMoleculeBytes(proposalCell.lock));
      if (bytesToHex(proposalLockHash) !== bytesToHex(treasuryLockHash)) {
        throw new Error("This registry uses treasury-funded anchors, but the proposal cell is not locked to the registry treasury");
      }
    }
    proposal.proposalCellTxHash = proposalTx;
    proposal.proposalCellIndex = proposalIndex;
    anchorVerified = true;
  } else if (b.proposalIndex !== undefined && String(b.proposalIndex).trim()) {
    throw new Error("proposalTx is required when proposalIndex is provided");
  }
  saveProposal(proposal);

  const treasuryLockHash = governanceTreasuryLockHash(governanceHeader);
  const toAddress = String(b.toAddress ?? "").trim();
  const command = treasuryLockHash ? [
    "ckb-firewall",
    "anchor",
    "--proposal", proposal.id,
    "--tx-out", `gov_anchor_tx_${proposal.id}.json`,
  ].join(" ") : toAddress ? [
    "ckb-cli",
    "--url", opts.rpcUrl,
    "wallet", "transfer",
    "--to-address", toAddress,
    "--capacity", "62",
    "--to-data", bytesToHex(proposalData),
    "--fee-rate", "1000",
    "--output-format", "json",
  ].map((p) => (/\s/.test(p) ? JSON.stringify(p) : p)).join(" ") : null;

  return {
    ok: true,
    proposal,
    proposalData: bytesToHex(proposalData),
    proposalDataHash: proposalDataHashHex,
    reviewDelayMs: proposal.reviewDelayMs,
    anchorVerified,
    treasuryBacked: Boolean(treasuryLockHash),
    command,
  };
}

// ── /api/import ───────────────────────────────────────────────────────────────

function handleImport(body: unknown): object {
  if (typeof body !== "object" || body === null) throw new Error("Invalid body");
  const p = body as Record<string, unknown>;

  const requiredStrings = ["id","proposalIdHash","action","lockArgs","expiresAt","evidence","classification","severity","rationale","proposer","submittedAt","reviewWindowEndsAt","status","voteDigestHash"];
  for (const k of requiredStrings)
    if (typeof p[k] !== "string") throw new Error(`Missing field: ${k}`);
  if (!Array.isArray(p.votes))
    throw new Error("votes must be an array");

  const computed = computeProposalIdHash({
    action: p.action as ProposalAction, lockArgs: p.lockArgs as string,
    expiresAt: p.expiresAt as string, evidence: p.evidence as string,
    classification: p.classification as ThreatClass, severity: p.severity as Severity,
    rationale: p.rationale as string, proposer: p.proposer as string, submittedAt: p.submittedAt as string,
  });
  if (computed !== p.proposalIdHash)
    throw new Error("proposalIdHash integrity check failed — file may be tampered");

  const expectedId = computed.slice(2, 14);
  if (!/^[0-9a-f]{12}$/.test(String(p.id)) || String(p.id) !== expectedId)
    throw new Error("id does not match proposalIdHash");

  const recomputedDigest = computeVoteDigestHash(p.votes as Proposal["votes"]);
  if (recomputedDigest !== p.voteDigestHash)
    throw new Error("voteDigestHash integrity check failed — votes may be tampered");

  const incoming = body as Proposal;
  const dir = getProposalsDir();
  const destPath = join(dir, `${incoming.id}.json`);

  if (existsSync(destPath)) {
    let existing: Proposal;
    try { existing = loadProposal(incoming.id); } catch { existing = incoming; }

    if (existing.proposalIdHash === incoming.proposalIdHash) {
      const votesByPk = new Map(existing.votes.map((v) => [v.pubkey.toLowerCase(), v]));
      for (const v of incoming.votes) {
        const prev = votesByPk.get(v.pubkey.toLowerCase());
        if (!prev || v.timestamp > prev.timestamp) {
          votesByPk.set(v.pubkey.toLowerCase(), v);
        }
      }
      const mergedVotes = [...votesByPk.values()];
      const mergedVoteDigest = computeVoteDigestHash(mergedVotes);
      const rankStatus = (st: Proposal["status"]) => ["pending-review","voting","approved","rejected","executed"].indexOf(st);
      const merged: Proposal = {
        ...incoming,
        votes: mergedVotes,
        voteDigestHash: mergedVoteDigest,
        signatures: [],
        status: rankStatus(existing.status) >= rankStatus(incoming.status) ? existing.status : incoming.status,
      };
      const proposalDataHash = existing.proposalDataHash ?? incoming.proposalDataHash;
      const reviewDelayMs = existing.reviewDelayMs ?? incoming.reviewDelayMs;
      const proposalCellTxHash = existing.proposalCellTxHash ?? incoming.proposalCellTxHash;
      const proposalCellIndex = existing.proposalCellIndex ?? incoming.proposalCellIndex;
      if (proposalDataHash !== undefined) merged.proposalDataHash = proposalDataHash;
      if (reviewDelayMs !== undefined) merged.reviewDelayMs = reviewDelayMs;
      if (proposalCellTxHash !== undefined) merged.proposalCellTxHash = proposalCellTxHash;
      if (proposalCellIndex !== undefined) merged.proposalCellIndex = proposalCellIndex;
      saveProposal(merged);
      return { ok: true, merged: true, id: incoming.id, votes: mergedVotes.length };
    }
    throw new Error(`A different proposal with ID ${incoming.id} already exists locally`);
  }

  saveProposal(incoming);
  return { ok: true, merged: false, id: incoming.id };
}

// ── GUI bundle serving ────────────────────────────────────────────────────────
// gui-bundle.html is assembled by scripts/build-gui.js during `npm run build`.
// Source files live in src/lib/gui/ — edit those to change the UI.
//
// Per request: read the bundle once, cache it, then replace the sentinel
// comment with a <script> that sets window.TFW_* globals from live data.

const _GUI_BUNDLE_PATH: string | null = (() => {
  try {
    const __dir = pathDirname(fileURLToPath(import.meta.url));
    const p = join(__dir, "gui-bundle.html");
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
})();

let _guiTemplate: string | null = null;

function _buildGuiHtml(apiDataJson: string): string {
  if (!_guiTemplate) {
    if (!_GUI_BUNDLE_PATH) throw new Error("gui-bundle.html not found — run npm run build first");
    _guiTemplate = readFileSync(_GUI_BUNDLE_PATH, "utf8");
  }

  const d = JSON.parse(apiDataJson) as {
    proposals: unknown[];
    registry: { entries?: unknown[]; txHash?: string; error?: string | null; treasury?: unknown; threshold?: number | null; validatorCount?: number | null };
    meta: Record<string, unknown>;
  };

  const safeJson = (v: unknown) => JSON.stringify(v).replace(/<\/script/gi, "<\\/script");
  const liveScript = `<script>
window.TFW_PROPOSALS = ${safeJson(d.proposals ?? [])};
window.TFW_REGISTRY_ENTRIES = ${safeJson(d.registry?.entries ?? [])};
window.TFW_META = ${safeJson({
    threshold: d.registry?.threshold ?? 3,
    governanceSetSize: d.registry?.validatorCount ?? 5,
    reviewWindowHours: 72,
    registryTxHash: d.registry?.txHash ?? null,
    registryError: d.registry?.error ?? null,
    treasury: d.registry?.treasury ?? null,
    yourPubkey: null,
    ...d.meta,
  })};
</script>`;

  return _guiTemplate.replace("<!-- LIVE_DATA_PLACEHOLDER -->", liveScript);
}

// ── HTML SPA ──────────────────────────────────────────────────────────────────
// Single self-contained page — no external dependencies.

/* eslint-disable max-len */
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CKB Firewall</title>
<style>
:root{
  --bg:#0d1117;--surf:#161b22;--surf2:#1c2128;--surf3:#22272e;
  --border:#30363d;--border2:#21262d;
  --text:#c9d1d9;--dim:#8b949e;--subtle:#6e7681;
  --blue:#58a6ff;--green:#3fb950;--red:#f85149;
  --yellow:#d29922;--cyan:#79c0ff;--purple:#bc8cff;
  --font:'SF Mono','Cascadia Code','Fira Code',ui-monospace,monospace;
  --sans:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:14px;line-height:1.5}
a{color:var(--blue);text-decoration:none}
a:hover{text-decoration:underline}
code,.mono{font-family:var(--font);font-size:12px}
button{font-family:inherit}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:var(--surf)}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}

/* header */
header{
  display:flex;align-items:center;gap:20px;
  padding:0 24px;height:52px;
  background:var(--surf);border-bottom:1px solid var(--border);
  position:sticky;top:0;z-index:100;
}
.logo{display:flex;align-items:center;gap:8px;font-weight:700;white-space:nowrap;color:var(--cyan);letter-spacing:.3px;font-size:15px}
.logo-hex{font-size:18px}
nav{display:flex;gap:2px;flex:1}
.tab-btn{
  padding:6px 14px;border:none;background:none;color:var(--dim);
  cursor:pointer;border-radius:6px;font-size:13px;transition:color .15s,background .15s;
}
.tab-btn:hover{color:var(--text);background:var(--surf2)}
.tab-btn.active{color:var(--text);background:var(--surf3);font-weight:500}
.hdr-status{display:flex;align-items:center;gap:6px;color:var(--dim);font-size:11px;white-space:nowrap}
.dot{width:7px;height:7px;border-radius:50%;background:var(--subtle);flex-shrink:0}
.dot.ok{background:var(--green)}
.dot.err{background:var(--red)}
.dot.spin{background:var(--yellow);animation:pulse 1.2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

/* pages */
.page{display:none;padding:24px;max-width:1120px;margin:0 auto}
.page.active{display:block}

/* stat tiles */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:28px}
.stat{background:var(--surf);border:1px solid var(--border);border-radius:8px;padding:16px 20px}
.stat-val{font-size:30px;font-weight:700;line-height:1;margin-bottom:4px}
.stat-lbl{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.7px}
.stat-sub{color:var(--subtle);font-size:11px;margin-top:3px}

/* section */
.section{margin-bottom:28px}
.sec-hdr{
  display:flex;align-items:center;gap:8px;
  margin-bottom:12px;padding-bottom:8px;
  border-bottom:1px solid var(--border2);
  font-size:11px;font-weight:600;text-transform:uppercase;
  letter-spacing:.7px;color:var(--dim);
}

/* badges */
.badge{
  display:inline-flex;align-items:center;padding:2px 8px;
  border-radius:10px;font-size:11px;font-weight:500;white-space:nowrap;
}
.b-yellow{background:rgba(210,153,34,.15);color:var(--yellow);border:1px solid rgba(210,153,34,.3)}
.b-green {background:rgba(63,185,80,.15) ;color:var(--green) ;border:1px solid rgba(63,185,80,.3) }
.b-red   {background:rgba(248,81,73,.15) ;color:var(--red)   ;border:1px solid rgba(248,81,73,.3)  }
.b-blue  {background:rgba(88,166,255,.15);color:var(--blue)  ;border:1px solid rgba(88,166,255,.3) }
.b-dim   {background:rgba(139,148,158,.1);color:var(--dim)   ;border:1px solid rgba(139,148,158,.2)}
.b-cyan  {background:rgba(121,192,255,.15);color:var(--cyan) ;border:1px solid rgba(121,192,255,.3)}

/* cards */
.card{
  background:var(--surf);border:1px solid var(--border);
  border-radius:8px;padding:14px 18px;margin-bottom:8px;
  cursor:pointer;transition:border-color .15s;
}
.card:hover{border-color:var(--blue)}
.card-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.card-action{font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.6px}
.add-col{color:var(--green)}.rem-col{color:var(--red)}
.card-args{font-family:var(--font);font-size:12px;color:var(--text)}
.card-id{font-family:var(--font);font-size:11px;color:var(--subtle)}
.card-meta{color:var(--dim);font-size:12px;margin-top:6px;line-height:1.7}
.card-foot{display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap}

/* progress */
.prog{display:flex;align-items:center;gap:7px;font-size:11px}
.prog-track{height:4px;background:var(--border);border-radius:2px;width:60px}
.prog-fill{height:100%;border-radius:2px;transition:width .3s}
.prog-g{background:var(--green)}.prog-y{background:var(--yellow)}

/* table */
.tbl-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:8px}
table{width:100%;border-collapse:collapse}
th{
  text-align:left;padding:9px 14px;font-size:11px;
  text-transform:uppercase;letter-spacing:.7px;
  color:var(--dim);font-weight:600;
  background:var(--surf);border-bottom:1px solid var(--border);
}
td{padding:10px 14px;border-bottom:1px solid var(--border2);font-size:13px;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr.click{cursor:pointer}
tr.click:hover td{background:var(--surf2)}
.la{font-family:var(--font);font-size:12px}

/* filter bar */
.fbar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
.inp{
  background:var(--surf);border:1px solid var(--border);
  border-radius:6px;padding:7px 12px;color:var(--text);
  font-size:13px;outline:none;transition:border-color .15s;
}
.inp:focus{border-color:var(--blue)}
.inp.srch{min-width:240px;flex:1;max-width:380px}
.ftabs{display:flex;gap:4px;flex-wrap:wrap}
.ftab{
  padding:5px 12px;border:1px solid var(--border);background:none;
  color:var(--dim);border-radius:6px;cursor:pointer;font-size:12px;transition:all .15s;
}
.ftab:hover{color:var(--text);border-color:var(--dim)}
.ftab.active{background:var(--surf2);color:var(--text);border-color:var(--blue);font-weight:500}
label.ck{display:flex;align-items:center;gap:6px;color:var(--dim);font-size:12px;cursor:pointer;user-select:none}
label.ck input{accent-color:var(--blue)}

/* modal */
.overlay{
  position:fixed;inset:0;background:rgba(0,0,0,.7);
  display:flex;align-items:flex-start;justify-content:center;
  padding:32px 16px;z-index:200;overflow-y:auto;
}
.overlay.hidden{display:none}
.modal{
  background:var(--surf);border:1px solid var(--border);
  border-radius:10px;width:100%;max-width:700px;
  box-shadow:0 24px 80px rgba(0,0,0,.6);
}
.mhdr{
  display:flex;align-items:center;gap:12px;
  padding:16px 22px;border-bottom:1px solid var(--border);
}
.mtitle{font-weight:600;font-size:14px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mclose{
  background:none;border:none;color:var(--dim);cursor:pointer;
  font-size:18px;line-height:1;padding:4px 6px;border-radius:4px;flex-shrink:0;
}
.mclose:hover{color:var(--text);background:var(--surf2)}
.mbody{padding:20px 22px;max-height:calc(90vh - 80px);overflow-y:auto}
.msec{margin-bottom:20px}
.msec-ttl{
  font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.7px;
  color:var(--dim);margin-bottom:10px;padding-bottom:6px;
  border-bottom:1px solid var(--border2);
}
.kv{display:grid;grid-template-columns:130px 1fr;gap:6px 14px;font-size:13px}
.kk{color:var(--dim)}
.kv-val{word-break:break-all}

/* cmd block */
.cmd{
  background:var(--surf2);border:1px solid var(--border2);
  border-radius:6px;padding:10px 14px;margin-bottom:8px;
  display:flex;align-items:center;gap:10px;
}
.cmd-lbl{font-size:11px;color:var(--subtle);margin-bottom:4px}
.cmd-text{font-family:var(--font);font-size:12px;flex:1;color:var(--cyan);overflow-x:auto;white-space:nowrap}
.copy-btn{
  background:var(--surf);border:1px solid var(--border);
  border-radius:5px;padding:4px 10px;color:var(--dim);
  cursor:pointer;font-size:11px;transition:all .15s;white-space:nowrap;flex-shrink:0;
}
.copy-btn:hover{color:var(--text);border-color:var(--blue)}
.copy-btn.ok{color:var(--green);border-color:var(--green)}

/* vote rows */
.vrow{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border2);font-size:12px}
.vrow:last-child{border-bottom:none}
.vch{font-weight:700;width:52px}
.vy{color:var(--green)}.vn{color:var(--red)}.va{color:var(--yellow)}
.vpk{font-family:var(--font);color:var(--dim);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.vts{color:var(--subtle);white-space:nowrap}

/* misc */
.empty{text-align:center;padding:52px 24px;color:var(--dim)}
.empty-ico{font-size:28px;margin-bottom:12px;opacity:.5}
.empty-txt{font-size:14px;margin-bottom:6px}
.empty-sub{font-size:12px;color:var(--subtle)}
.err-bar{
  background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.3);
  border-radius:6px;padding:10px 14px;margin-bottom:16px;
  font-size:12px;color:var(--red);
}
.reg-pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-size:11px}
.tbl-foot{color:var(--subtle);font-size:11px;padding:10px 14px;text-align:right}

/* ── forms & action buttons ── */
.form-row{margin-bottom:14px}
.form-lbl{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--dim);margin-bottom:6px}
.form-lbl small{text-transform:none;letter-spacing:0;font-weight:400;color:var(--subtle)}
.fi{width:100%;background:var(--surf2);border:1px solid var(--border);border-radius:6px;padding:9px 12px;color:var(--text);font-size:13px;outline:none;font-family:inherit;transition:border-color .15s;resize:vertical}
.fi:focus{border-color:var(--blue)}
select.fi option{background:var(--surf2)}
.fi-mono{font-family:var(--font);font-size:12px}
.form-err{color:var(--red);font-size:12px;padding:9px 13px;background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.3);border-radius:5px;margin-top:10px;display:none}
.form-ok{color:var(--green);font-size:12px;padding:9px 13px;background:rgba(63,185,80,.08);border:1px solid rgba(63,185,80,.3);border-radius:5px;margin-top:10px;display:none}
.sec-note{padding:10px 14px;border-radius:6px;font-size:12px;margin-bottom:14px;line-height:1.6}
.sec-note-info{background:rgba(88,166,255,.07);border:1px solid rgba(88,166,255,.25);color:var(--blue)}
.sec-note-warn{background:rgba(248,81,73,.07);border:1px solid rgba(248,81,73,.25);color:var(--red)}
.sec-note-tip{background:rgba(210,153,34,.07);border:1px solid rgba(210,153,34,.25);color:var(--yellow)}
.radio-grp{display:flex;gap:8px;flex-wrap:wrap}
.radio-card{display:flex;align-items:center;gap:8px;padding:9px 14px;border:1px solid var(--border);border-radius:6px;cursor:pointer;transition:all .15s;flex:1;min-width:70px}
.radio-card:has(input:checked){border-color:var(--blue);background:rgba(88,166,255,.07)}
.radio-card input{accent-color:var(--blue)}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;border:none;transition:all .15s;font-family:inherit;text-decoration:none;line-height:1.4;white-space:nowrap}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-p{background:var(--blue);color:#000}.btn-p:hover:not(:disabled){filter:brightness(1.1)}
.btn-g{background:var(--green);color:#000}.btn-g:hover:not(:disabled){filter:brightness(1.1)}
.btn-r{background:rgba(248,81,73,.15);color:var(--red);border:1px solid rgba(248,81,73,.3)}.btn-r:hover:not(:disabled){background:rgba(248,81,73,.25)}
.btn-d{background:var(--surf2);color:var(--text);border:1px solid var(--border)}.btn-d:hover:not(:disabled){border-color:var(--blue)}
.btn-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}
.act-btns{display:flex;gap:8px;flex-wrap:wrap;padding:14px 0 6px}
.hdr-btn{padding:5px 13px;border:1px solid var(--border);background:none;color:var(--dim);border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;transition:all .15s}
.hdr-btn:hover{color:var(--text);border-color:var(--blue)}
.hdr-btn-p{border-color:var(--blue);color:var(--blue);background:rgba(88,166,255,.08)}
.hdr-btn-p:hover{background:rgba(88,166,255,.15)}
</style>
</head>
<body>

<header>
  <div class="logo"><span class="logo-hex">⬡</span> CKB Firewall</div>
  <nav>
    <button class="tab-btn active" data-tab="overview">Overview</button>
    <button class="tab-btn"        data-tab="registry">Registry</button>
    <button class="tab-btn"        data-tab="proposals">Proposals</button>
  </nav>
  <div style="display:flex;gap:6px;align-items:center;margin-left:auto">
    <button class="hdr-btn hdr-btn-p" onclick="openCreate()">+ New Proposal</button>
    <button class="hdr-btn" onclick="openImportForm()">&#8679; Import</button>
  </div>
  <div class="hdr-status" style="margin-left:12px">
    <span class="dot spin" id="dot"></span>
    <span id="status-txt">Connecting&hellip;</span>
  </div>
</header>

<div id="page-overview"  class="page active"></div>
<div id="page-registry"  class="page">
  <div class="fbar">
    <input  id="reg-q"       class="inp srch" placeholder="Search lock-args&hellip;" oninput="renderReg()">
    <label  class="ck"><input type="checkbox" id="reg-exp" onchange="renderReg()"> Show expired</label>
  </div>
  <div id="reg-body"></div>
</div>
<div id="page-proposals" class="page">
  <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
    <button class="btn btn-p" onclick="openCreate()">+ New Proposal</button>
  </div>
  <div class="fbar">
    <div class="ftabs" id="prop-ftabs">
      <button class="ftab active" data-s=""               onclick="setPF('')">All</button>
      <button class="ftab"        data-s="pending-review" onclick="setPF('pending-review')">Pending Review</button>
      <button class="ftab"        data-s="voting"         onclick="setPF('voting')">Voting</button>
      <button class="ftab"        data-s="approved"       onclick="setPF('approved')">Approved</button>
      <button class="ftab"        data-s="executed"       onclick="setPF('executed')">Executed</button>
      <button class="ftab"        data-s="rejected"       onclick="setPF('rejected')">Rejected</button>
    </div>
  </div>
  <div id="prop-body"></div>
</div>

<div class="overlay hidden" id="overlay">
  <div class="modal" id="modal">
    <div class="mhdr">
      <div class="mtitle" id="m-title"></div>
      <button class="mclose" id="m-close">&#x2715;</button>
    </div>
    <div class="mbody" id="m-body"></div>
  </div>
</div>

<div class="overlay hidden" id="act-overlay">
  <div class="modal" id="act-modal" style="max-width:540px">
    <div class="mhdr">
      <div class="mtitle" id="act-title"></div>
      <button class="mclose" id="act-close">&#x2715;</button>
    </div>
    <div class="mbody" id="act-body"></div>
  </div>
</div>

<script>
'use strict';

// ── state ────────────────────────────────────────────────────────────────────
var D = { proposals: [], registry: null, meta: null };
var UI = { tab: 'overview', pf: '', err: null };

// ── utils ────────────────────────────────────────────────────────────────────
function h(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function trunc(s,n){ return (!s||s.length<=n)?s:s.slice(0,Math.floor(n/2))+'&hellip;'+s.slice(-Math.floor(n/2)-1); }
function fmtDate(iso){ if(!iso)return'&mdash;'; var d=new Date(iso); return d.toISOString().slice(0,16).replace('T',' ')+' UTC'; }
function countdown(iso){
  var ms=new Date(iso).getTime()-Date.now();
  if(ms<=0)return '<span style="color:var(--green)">&check; passed</span>';
  var h2=Math.floor(ms/3600000),m=Math.floor((ms%3600000)/60000);
  return '<span style="color:var(--yellow)">'+h2+'h '+m+'m remaining</span>';
}
function countYes(votes){ return (votes||[]).filter(function(v){return v.vote==='yes';}).length; }
function reviewPassed(p){ return Date.now()>=new Date(p.reviewWindowEndsAt).getTime(); }
function isReady(p){ return reviewPassed(p)&&countYes(p.votes)>=3; }
function prog(v,max){
  var pct=Math.min(100,Math.round(v/max*100));
  var cls=v>=max?'prog-g':'prog-y';
  return '<span class="prog"><span class="prog-track"><span class="prog-fill '+cls+'" style="width:'+pct+'%"></span></span>'+v+'/'+max+'</span>';
}
function statusBadge(p){
  if(isReady(p)) return '<span class="badge b-green">ready to execute</span>';
  var m={'pending-review':'<span class="badge b-yellow">pending review</span>','voting':'<span class="badge b-cyan">voting</span>','approved':'<span class="badge b-blue">approved</span>','executed':'<span class="badge b-dim">executed</span>','rejected':'<span class="badge b-red">rejected</span>'};
  return m[p.status]||'<span class="badge b-dim">'+h(p.status)+'</span>';
}
function actionBadge(p){
  var cls=p.action==='add'?'add-col':'rem-col';
  return '<span class="card-action '+cls+'">'+h(p.action)+'</span>';
}
function empty(txt,sub){
  return '<div class="empty"><div class="empty-ico">&#9675;</div><div class="empty-txt">'+h(txt)+'</div><div class="empty-sub">'+h(sub)+'</div></div>';
}
function cmdRow(label,cmd,key){
  return '<div class="cmd-lbl">'+h(label)+'</div>'
        +'<div class="cmd"><span class="cmd-text">'+h(cmd)+'</span>'
        +'<button class="copy-btn" data-copy="'+h(cmd)+'" data-key="'+h(key)+'">Copy</button></div>';
}

// lookup maps
function pByAddr(){
  var m={};
  D.proposals.forEach(function(p){ var k=(p.lockArgs||'').toLowerCase(); if(!m[k])m[k]=[]; m[k].push(p); });
  return m;
}
function regByAddr(){
  var m={};
  if(D.registry&&D.registry.entries) D.registry.entries.forEach(function(e){ m[e.identifier.toLowerCase()]=e; });
  return m;
}

// ── data fetch ────────────────────────────────────────────────────────────────
function load(){
  document.getElementById('dot').className='dot spin';
  return fetch('/api/data')
    .then(function(r){return r.json();})
    .then(function(d){
      D.proposals=d.proposals||[];
      D.registry=d.registry||{entries:[],error:null};
      D.meta=d.meta||{};
      UI.err=null;
      document.getElementById('dot').className=D.registry.error?'dot err':'dot ok';
      document.getElementById('status-txt').textContent='Updated '+new Date().toLocaleTimeString();
      render();
    })
    .catch(function(e){
      UI.err=e.message;
      document.getElementById('dot').className='dot err';
      document.getElementById('status-txt').textContent='Error';
      render();
    });
}
setInterval(load,15000);

// ── tab routing ───────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(function(b){
  b.addEventListener('click',function(){ setTab(b.dataset.tab); });
});
function setTab(name){
  UI.tab=name;
  document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.toggle('active',b.dataset.tab===name); });
  document.querySelectorAll('.page').forEach(function(p){ p.classList.toggle('active',p.id==='page-'+name); });
}
function setPF(s){
  UI.pf=s;
  document.querySelectorAll('.ftab').forEach(function(b){ b.classList.toggle('active',b.dataset.s===s); });
  renderProps();
}

// ── overview ──────────────────────────────────────────────────────────────────
function renderOverview(){
  var ps=D.proposals;
  var entries=(D.registry&&D.registry.entries)||[];
  var now=Date.now()/1000;
  var active=entries.filter(function(e){return !e.expiresAt||Number(e.expiresAt)>now;}).length;
  var expired=entries.filter(function(e){return e.expiresAt&&Number(e.expiresAt)<=now;}).length;
  var open=ps.filter(function(p){return p.status==='pending-review'||p.status==='voting';});
  var ready=ps.filter(isReady);
  var approved=ps.filter(function(p){return p.status==='approved'&&!isReady(p);});
  var executed=ps.filter(function(p){return p.status==='executed';});

  var out='';
  if(UI.err) out+='<div class="err-bar">&#9888; Could not reach server: '+h(UI.err)+'</div>';
  if(D.registry&&D.registry.error) out+='<div class="err-bar">&#9888; Registry unavailable &mdash; '+h(D.registry.error)+' <span style="color:var(--subtle);font-size:11px">(proposals still shown below)</span></div>';

  // stats
  out+='<div class="stats">';
  out+=stat(String(active),'Active Entries',expired?expired+' expired':'','var(--cyan)');
  out+=stat(String(open.length),'Open for Voting',open.length?'need your vote':'','var(--blue)');
  out+=stat(String(ready.length),'Ready to Execute','','var(--green)');
  out+=stat(String(approved.length),'Awaiting Sigs','','var(--yellow)');
  out+=stat(String(executed.length),'Executed','historical','var(--dim)');
  out+='</div>';

  // action required
  var action=ready.concat(open);
  if(action.length){
    out+='<div class="section"><div class="sec-hdr">&#9889; Action Required <span class="badge b-yellow" style="margin-left:4px">'+action.length+'</span></div>';
    action.forEach(function(p){ out+=propCard(p,true); });
    out+='</div>';
  }
  // recent
  var recent=ps.slice().sort(function(a,b){return b.submittedAt.localeCompare(a.submittedAt);}).slice(0,6);
  if(recent.length){
    out+='<div class="section"><div class="sec-hdr">&#128203; Recent Proposals</div>';
    recent.forEach(function(p){ out+=propCard(p,false); });
    out+='</div>';
  } else if(!UI.err){
    out+=empty('No proposals yet','Run: ckb-firewall propose');
  }
  document.getElementById('page-overview').innerHTML=out;
}
function stat(val,lbl,sub,color){
  return '<div class="stat"><div class="stat-val" style="color:'+color+'">'+h(val)+'</div>'
        +'<div class="stat-lbl">'+h(lbl)+'</div>'+(sub?'<div class="stat-sub">'+h(sub)+'</div>':'')+'</div>';
}

// ── registry ──────────────────────────────────────────────────────────────────
function renderReg(){
  var q=((document.getElementById('reg-q')||{}).value||'').toLowerCase().trim();
  var showExp=((document.getElementById('reg-exp')||{}).checked)||false;
  var pa=pByAddr();
  var out='';

  if(!D.registry){out+='<div style="color:var(--dim);padding:40px;text-align:center">Loading registry&hellip;</div>';document.getElementById('reg-body').innerHTML=out;return;}
  if(D.registry.error) out+='<div class="err-bar">'+h(D.registry.error)+'</div>';

  var now=Date.now()/1000;
  var all=D.registry.entries||[];
  var shown=all.filter(function(e){
    var exp=e.expiresAt?Number(e.expiresAt):null;
    var isExp=exp&&exp<=now;
    if(!showExp&&isExp)return false;
    if(q&&!e.identifier.toLowerCase().includes(q))return false;
    return true;
  });

  if(!shown.length){
    document.getElementById('reg-body').innerHTML=empty(q?'No matching entries':'Registry is empty',q?'Try a different search':'');
    return;
  }

  out+='<div class="tbl-wrap"><table><thead><tr>'
      +'<th>Lock Args</th><th>Expires</th><th>Status</th><th>Proposals</th>'
      +'</tr></thead><tbody>';
  shown.forEach(function(e){
    var exp=e.expiresAt?Number(e.expiresAt):null;
    var isExp=exp&&exp<=now;
    var expTxt=!exp?'never':new Date(exp*1000).toISOString().slice(0,10);
    var statusCell=isExp?'<span class="badge b-red">expired</span>':'<span class="badge b-green">active</span>';
    var rel=pa[e.identifier.toLowerCase()]||[];
    var propCell=!rel.length?'<span style="color:var(--subtle)">&mdash;</span>':rel.map(function(p){
      var bc=p.status==='executed'?'b-dim':p.status==='rejected'?'b-red':'b-yellow';
      return '<span class="badge '+bc+' click" style="cursor:pointer;margin-right:4px" data-pid="'+h(p.id)+'">'+h(p.action)+' #'+h(p.id)+'</span>';
    }).join('');
    out+='<tr class="click" data-addr="'+h(e.identifier)+'">'
        +'<td><code class="la">'+h(e.identifier)+'</code></td>'
        +'<td style="color:'+(isExp?'var(--red)':'var(--dim)')+'">'+h(expTxt)+'</td>'
        +'<td>'+statusCell+'</td>'
        +'<td>'+propCell+'</td>'
        +'</tr>';
  });
  out+='</tbody></table>';
  out+='<div class="tbl-foot">'+shown.length+' of '+all.length+' entries'+(D.registry.txHash?' &nbsp;&middot;&nbsp; cell <code style="font-size:11px">'+h(D.registry.txHash.slice(0,18))+'&hellip;</code>':'')+'</div>';
  out+='</div>';
  document.getElementById('reg-body').innerHTML=out;
}

// ── proposals ─────────────────────────────────────────────────────────────────
function renderProps(){
  var ps=D.proposals.filter(function(p){return !UI.pf||p.status===UI.pf;})
                    .slice().sort(function(a,b){return b.submittedAt.localeCompare(a.submittedAt);});
  document.getElementById('prop-body').innerHTML=
    ps.length?ps.map(function(p){return propCard(p,false);}).join(''):empty('No proposals','Run: ckb-firewall propose');
}

// ── proposal card ─────────────────────────────────────────────────────────────
function propCard(p,compact){
  var rb=regByAddr();
  var e=rb[(p.lockArgs||'').toLowerCase()];
  var now=Date.now()/1000;
  var inReg=!!e;
  var isExpReg=inReg&&e.expiresAt&&Number(e.expiresAt)<=now;
  var regHint=!inReg?'<span style="color:var(--subtle);font-size:11px">not in registry</span>'
    :isExpReg?'<span class="badge b-dim">registry: expired</span>'
    :'<span class="badge b-green">registry: active</span>';

  var out='<div class="card" data-pid="'+h(p.id)+'">';
  out+='<div class="card-top">';
  out+=actionBadge(p);
  out+='<code class="card-args">'+trunc(h(p.lockArgs),42)+'</code>';
  out+='<span class="card-id">#'+h(p.id)+'</span>';
  out+='<span style="flex:1"></span>';
  out+=statusBadge(p);
  out+='</div>';
  out+='<div class="card-foot">';
  out+=prog(countYes(p.votes),3);
  out+='<span style="flex:1"></span>';
  out+=regHint;
  // quick action buttons
  if(p.status==='pending-review'||p.status==='voting'){
    out+='<button class="btn btn-p" style="padding:3px 10px;font-size:11px" onclick="event.stopPropagation();openVoteForm(\''+h(p.id)+'\')">Vote &rarr;</button>';
  } else if(isReady(p)){
    out+='<button class="btn btn-p" style="padding:3px 10px;font-size:11px" onclick="event.stopPropagation();openExecuteForm(\''+h(p.id)+'\')">Execute &rarr;</button>';
  }
  out+='<a class="btn btn-d" style="padding:3px 10px;font-size:11px" href="/api/export/'+h(p.id)+'" download="proposal-'+h(p.id)+'.json" onclick="event.stopPropagation()">&#8595; JSON</a>';
  out+='</div>';
  if(!compact){
    out+='<div class="card-meta">';
    out+=h(p.classification)+' / '+h(p.severity)+' &nbsp;&middot;&nbsp; ';
    out+='Review: '+countdown(p.reviewWindowEndsAt)+' &nbsp;&middot;&nbsp; ';
    out+='by '+h(p.proposer);
    if(p.evidence){
      var isUrl=/^https?:\/\//.test(p.evidence);
      out+='<br>Evidence: '+(isUrl?'<a href="'+h(p.evidence)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">'+h(p.evidence)+'</a>':h(p.evidence.slice(0,80))+(p.evidence.length>80?'&hellip;':''));
    }
    out+='</div>';
  }
  out+='</div>';
  return out;
}

// ── proposal modal ────────────────────────────────────────────────────────────
function openProposal(id){
  var p=D.proposals.find(function(x){return x.id===id;});
  if(!p)return;
  var rb=regByAddr();
  var e=rb[(p.lockArgs||'').toLowerCase()];
  var now=Date.now()/1000;
  var inReg=!!e;
  var isExpReg=inReg&&e.expiresAt&&Number(e.expiresAt)<=now;

  var regVal=!inReg?'<span style="color:var(--subtle)">not in registry</span>'
    :isExpReg?'<span class="badge b-dim">expired &mdash; '+new Date(Number(e.expiresAt)*1000).toISOString().slice(0,10)+'</span>'
    :e.expiresAt?'<span class="badge b-green">active &mdash; expires '+new Date(Number(e.expiresAt)*1000).toISOString().slice(0,10)+'</span>'
    :'<span class="badge b-green">active &mdash; permanent</span>';

  var out='';

  // metadata
  out+='<div class="msec"><div class="kv">';
  out+='<span class="kk">Action</span><span class="kv-val">'+actionBadge(p)+'</span>';
  out+='<span class="kk">Lock Args</span><span class="kv-val"><code style="font-size:11px;word-break:break-all">'+h(p.lockArgs)+'</code></span>';
  out+='<span class="kk">Registry</span><span class="kv-val">'+regVal+'</span>';
  out+='<span class="kk">Classification</span><span class="kv-val">'+h(p.classification)+' / '+h(p.severity)+'</span>';
  out+='<span class="kk">Proposer</span><span class="kv-val">'+h(p.proposer)+'</span>';
  out+='<span class="kk">Submitted</span><span class="kv-val">'+fmtDate(p.submittedAt)+'</span>';
  out+='<span class="kk">Review ends</span><span class="kv-val">'+countdown(p.reviewWindowEndsAt)+'</span>';
  if(p.expiresAt&&p.expiresAt!=='0'){
    out+='<span class="kk">Entry expires</span><span class="kv-val">'+fmtDate(new Date(Number(p.expiresAt)*1000).toISOString())+'</span>';
  }
  if(p.txHash){
    out+='<span class="kk">Tx Hash</span><span class="kv-val"><code style="font-size:11px">'+h(p.txHash)+'</code></span>';
  }
  out+='</div>';

  if(p.evidence){
    var isUrl=/^https?:\/\//.test(p.evidence);
    out+='<div style="margin-top:12px"><div style="font-size:11px;color:var(--dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:.6px">Evidence</div>';
    out+=isUrl?'<a href="'+h(p.evidence)+'" target="_blank" rel="noopener" style="font-size:13px">'+h(p.evidence)+'</a>'
              :'<p style="font-size:13px;color:var(--dim)">'+h(p.evidence)+'</p>';
    out+='</div>';
  }
  if(p.rationale){
    out+='<div style="margin-top:12px"><div style="font-size:11px;color:var(--dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:.6px">Rationale</div>';
    out+='<p style="font-size:13px;color:var(--dim);line-height:1.7">'+h(p.rationale)+'</p></div>';
  }
  out+='</div>';

  // votes
  out+='<div class="msec"><div class="msec-ttl">Votes &nbsp;'+prog(countYes(p.votes),3)+'</div>';
  var votes=p.votes||[];
  if(!votes.length){out+='<div style="color:var(--subtle);font-size:12px">No votes yet.</div>';}
  else{votes.forEach(function(v){
    var vc=v.vote==='yes'?'vy':v.vote==='no'?'vn':'va';
    out+='<div class="vrow"><span class="vch '+vc+'">'+v.vote.toUpperCase()+'</span>'
        +'<code class="vpk">'+h(v.pubkey.slice(0,20))+'&hellip;</code>'
        +'<span class="vts">'+fmtDate(v.timestamp)+'</span></div>';
  });}
  out+='</div>';

  // Actions
  out+='<div class="msec"><div class="msec-ttl">Actions</div><div class="act-btns">';
  if(p.status==='pending-review'||p.status==='voting'){
    out+='<button class="btn btn-p" onclick="closeModal();openVoteForm(\''+h(p.id)+'\')">Cast Vote</button>';
  }
  if(isReady(p)){
    out+='<button class="btn btn-p" onclick="closeModal();openExecuteForm(\''+h(p.id)+'\')">Build Execute TX</button>';
  }
  out+='<a class="btn btn-d" href="/api/export/'+h(p.id)+'" download="proposal-'+h(p.id)+'.json">&#8595; Export JSON</a>';
  out+='</div></div>';

  // CLI commands
  out+='<div class="msec"><div class="msec-ttl">CLI Commands</div>';
  if(p.status==='pending-review'||p.status==='voting'){
    out+=cmdRow('Vote on this proposal','ckb-firewall vote --proposal '+p.id,'cmd-v');
  }
  if(isReady(p)){
    out+=cmdRow('Execute on-chain','ckb-firewall execute --proposal '+p.id,'cmd-e');
  }
  out+=cmdRow('Export to JSON file','ckb-firewall export --proposal '+p.id+' --out proposal-'+p.id+'.json','cmd-ex');
  out+=cmdRow('Check address in registry','ckb-firewall check --lock-args '+p.lockArgs,'cmd-ck');
  out+='</div>';

  document.getElementById('m-title').innerHTML=
    actionBadge(p)+'&nbsp;<code style="font-size:12px">'+trunc(h(p.lockArgs),40)+'</code>'
    +'&nbsp;<span style="color:var(--subtle);font-size:12px">#'+h(p.id)+'</span>';
  document.getElementById('m-body').innerHTML=out;
  document.getElementById('overlay').classList.remove('hidden');
}

// ── address modal ─────────────────────────────────────────────────────────────
function openAddr(identifier){
  var rb=regByAddr();
  var e=rb[identifier.toLowerCase()];
  var pa=pByAddr();
  var related=pa[identifier.toLowerCase()]||[];
  var now=Date.now()/1000;
  var exp=e&&e.expiresAt?Number(e.expiresAt):null;
  var isExp=exp&&exp<=now;

  var out='<div class="msec">';
  out+='<div class="msec-ttl">Identifier</div>';
  out+='<div class="cmd"><span class="cmd-text">'+h(identifier)+'</span><button class="copy-btn" data-copy="'+h(identifier)+'" data-key="addr-c">Copy</button></div>';
  out+='<div style="margin-top:10px">';
  if(!e){out+='<span style="color:var(--subtle)">Not currently in registry</span>';}
  else if(isExp){out+='<span class="badge b-red">Expired</span> <span style="color:var(--dim);font-size:12px">since '+new Date(exp*1000).toISOString().slice(0,10)+'</span>';}
  else if(exp){out+='<span class="badge b-green">Active</span> <span style="color:var(--dim);font-size:12px">until '+new Date(exp*1000).toISOString().slice(0,10)+'</span>';}
  else{out+='<span class="badge b-green">Active &mdash; permanent</span>';}
  out+='</div></div>';

  out+='<div class="msec"><div class="msec-ttl">Check Command</div>';
  out+=cmdRow('','ckb-firewall check --lock-args '+identifier,'addr-ck');
  out+='</div>';

  if(related.length){
    out+='<div class="msec"><div class="msec-ttl">Governance Proposals ('+related.length+')</div>';
    related.forEach(function(p){
      out+='<div class="card" data-pid="'+h(p.id)+'" style="margin-bottom:8px">';
      out+='<div class="card-top">'+actionBadge(p)+'<span class="card-id">#'+h(p.id)+'</span><span style="flex:1"></span>'+statusBadge(p)+'</div>';
      out+='<div class="card-meta">'+h(p.classification)+' / '+h(p.severity)+' &middot; '+fmtDate(p.submittedAt)+'</div>';
      out+='<div class="card-foot">'+prog(countYes(p.votes),3)+'</div>';
      out+='</div>';
    });
    out+='</div>';
  }

  document.getElementById('m-title').innerHTML='<code style="font-size:12px">'+trunc(h(identifier),44)+'</code>';
  document.getElementById('m-body').innerHTML=out;
  document.getElementById('overlay').classList.remove('hidden');
}

// ── modal close ───────────────────────────────────────────────────────────────
document.getElementById('m-close').addEventListener('click',function(){ closeModal(); });
document.getElementById('overlay').addEventListener('click',function(ev){ if(ev.target===document.getElementById('overlay'))closeModal(); });
document.getElementById('act-close').addEventListener('click',function(){ closeAct(); });
document.getElementById('act-overlay').addEventListener('click',function(ev){ if(ev.target===document.getElementById('act-overlay'))closeAct(); });
document.addEventListener('keydown',function(ev){ if(ev.key==='Escape'){ closeAct(); closeModal(); } });
function closeModal(){ document.getElementById('overlay').classList.add('hidden'); }
function closeAct(){ document.getElementById('act-overlay').classList.add('hidden'); }
function openAct(title,html){
  document.getElementById('act-title').textContent=title;
  document.getElementById('act-body').innerHTML=html;
  document.getElementById('act-overlay').classList.remove('hidden');
}

// ── form helpers ──────────────────────────────────────────────────────────────
function showErr(id,msg){ var el=document.getElementById(id); if(el){el.textContent=msg;el.style.display='block';} }
function showOk(id,msg){ var el=document.getElementById(id); if(el){el.textContent=msg;el.style.display='block';} }
function hideMsg(id){ var el=document.getElementById(id); if(el)el.style.display='none'; }
function setDisabled(id,v){ var el=document.getElementById(id); if(el)el.disabled=v; }
function fval(id){ var el=document.getElementById(id); return el?el.value:''; }
function fsel(id){ var el=document.getElementById(id); return el?el.value:''; }
function fcheck(id){ var el=document.getElementById(id); return el?el.checked:false; }

// ── create proposal form ──────────────────────────────────────────────────────
function openCreate(){
  var html='';
  html+='<div class="sec-note sec-note-info">&#128274; Your key is never sent to the server. Proposals are stored locally.</div>';
  html+='<div class="form-row"><label class="form-lbl">Action</label>';
  html+='<div class="radio-grp">';
  html+='<label class="radio-card"><input type="radio" name="c-action" value="add" checked onchange="toggleExpiresAt()"> <span>&#10133; Add to blacklist</span></label>';
  html+='<label class="radio-card"><input type="radio" name="c-action" value="remove" onchange="toggleExpiresAt()"> <span>&#10134; Remove from blacklist</span></label>';
  html+='</div></div>';
  html+='<div class="form-row"><label class="form-lbl" for="c-lockargs">Lock Args <small>(0x-prefixed hex)</small></label>';
  html+='<input id="c-lockargs" class="fi fi-mono" placeholder="0xabc123..." autocomplete="off"></div>';
  html+='<div class="form-row" id="c-exprow"><label class="form-lbl" for="c-expires">Expires At <small>(Unix timestamp, 0 = never)</small></label>';
  html+='<input id="c-expires" class="fi" type="number" min="0" value="0" placeholder="0"></div>';
  html+='<div class="form-row"><label class="form-lbl" for="c-cls">Classification</label>';
  html+='<select id="c-cls" class="fi"><option value="theft">theft</option><option value="scam">scam</option><option value="hack">hack</option><option value="sanctions">sanctions</option><option value="other">other</option></select></div>';
  html+='<div class="form-row"><label class="form-lbl" for="c-sev">Severity</label>';
  html+='<select id="c-sev" class="fi"><option value="critical">critical</option><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select></div>';
  html+='<div class="form-row"><label class="form-lbl" for="c-evidence">Evidence <small>(URL or description)</small></label>';
  html+='<textarea id="c-evidence" class="fi" rows="2" placeholder="https://... or describe the evidence"></textarea></div>';
  html+='<div class="form-row"><label class="form-lbl" for="c-rationale">Rationale <small>(min 20 chars)</small></label>';
  html+='<textarea id="c-rationale" class="fi" rows="3" placeholder="Why should this address be added/removed..."></textarea></div>';
  html+='<div class="form-row"><label class="form-lbl" for="c-proposer">Proposer <small>(your name or handle)</small></label>';
  html+='<input id="c-proposer" class="fi" placeholder="e.g. alice"></div>';
  html+='<div id="c-err" class="form-err"></div>';
  html+='<div id="c-ok" class="form-ok"></div>';
  html+='<div class="btn-row"><button class="btn btn-p" id="c-submit" onclick="submitCreate()">Create Proposal</button><button class="btn btn-d" onclick="closeAct()">Cancel</button></div>';
  openAct('New Proposal',html);
}
function toggleExpiresAt(){
  var add=document.querySelector('input[name="c-action"]:checked');
  var row=document.getElementById('c-exprow');
  if(row) row.style.display=(add&&add.value==='add')?'':'none';
}

function submitCreate(){
  hideMsg('c-err'); hideMsg('c-ok'); setDisabled('c-submit',true);
  var action=(document.querySelector('input[name="c-action"]:checked')||{value:'add'}).value;
  var body={action:action,lockArgs:fval('c-lockargs').trim(),evidence:fval('c-evidence').trim(),
    classification:fsel('c-cls'),severity:fsel('c-sev'),rationale:fval('c-rationale').trim(),
    proposer:fval('c-proposer').trim(),expiresAt:action==='add'?fval('c-expires')||'0':'0'};
  fetch('/api/propose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json();})
    .then(function(d){
      setDisabled('c-submit',false);
      if(!d.ok){showErr('c-err',d.error||'Unknown error');return;}
      showOk('c-ok','Proposal #'+d.id+' created!');
      load().then(function(){ setTimeout(closeAct,1200); });
    })
    .catch(function(e){ setDisabled('c-submit',false); showErr('c-err',e.message); });
}

// ── vote form ─────────────────────────────────────────────────────────────────
function openVoteForm(id){
  var p=D.proposals.find(function(x){return x.id===id;});
  if(!p)return;
  var html='';
  html+='<div class="sec-note sec-note-warn">&#128274; Your private key is used only locally (loopback) and zeroed immediately after signing. It is never stored or logged.</div>';
  html+='<div class="form-row"><label class="form-lbl">Vote</label>';
  html+='<div class="radio-grp">';
  html+='<label class="radio-card"><input type="radio" name="v-vote" value="yes" checked> <span style="color:var(--green)">&#10003; Yes</span></label>';
  html+='<label class="radio-card"><input type="radio" name="v-vote" value="no"> <span style="color:var(--red)">&#10007; No</span></label>';
  html+='<label class="radio-card"><input type="radio" name="v-vote" value="abstain"> <span style="color:var(--yellow)">&#8212; Abstain</span></label>';
  html+='</div></div>';
  html+='<div class="form-row"><label class="form-lbl" for="v-pk">Private Key <small>(32 bytes, hex)</small></label>';
  html+='<input id="v-pk" class="fi fi-mono" type="password" placeholder="64 hex chars" autocomplete="off" autocorrect="off" spellcheck="false"></div>';
  html+='<div id="v-err" class="form-err"></div>';
  html+='<div id="v-ok" class="form-ok"></div>';
  html+='<div class="btn-row"><button class="btn btn-p" id="v-submit" onclick="submitVote(\''+h(id)+'\')">Cast Vote</button><button class="btn btn-d" onclick="closeAct()">Cancel</button></div>';
  openAct('Vote — Proposal #'+h(id),html);
}

function submitVote(id){
  hideMsg('v-err'); hideMsg('v-ok'); setDisabled('v-submit',true);
  var choice=(document.querySelector('input[name="v-vote"]:checked')||{value:'yes'}).value;
  var body={proposalId:id,vote:choice,privateKey:fval('v-pk').trim()};
  fetch('/api/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json();})
    .then(function(d){
      setDisabled('v-submit',false);
      document.getElementById('v-pk').value='';
      if(!d.ok){showErr('v-err',d.error||'Unknown error');return;}
      showOk('v-ok','Vote recorded! Yes: '+d.yesCount+'/3 — Status: '+d.status);
      load().then(function(){ setTimeout(closeAct,1500); });
    })
    .catch(function(e){ setDisabled('v-submit',false); showErr('v-err',e.message); });
}

// ── execute form ──────────────────────────────────────────────────────────────
function openExecuteForm(id){
  var html='';
  html+='<div class="sec-note sec-note-tip">&#9888; This verifies validator votes and builds the transaction JSON for download. Submit it via ckb-cli or a CKB wallet.</div>';
  html+='<div id="e-err" class="form-err"></div>';
  html+='<div id="e-ok" class="form-ok"></div>';
  html+='<div class="btn-row"><button class="btn btn-p" id="e-submit" onclick="submitExecute(\''+h(id)+'\')">Build &amp; Download TX</button><button class="btn btn-d" onclick="closeAct()">Cancel</button></div>';
  openAct('Execute — Proposal #'+h(id),html);
}

function submitExecute(id){
  hideMsg('e-err'); hideMsg('e-ok'); setDisabled('e-submit',true);
  fetch('/api/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proposalId:id})})
    .then(function(r){return r.json();})
    .then(function(d){
      setDisabled('e-submit',false);
      if(!d.ok){showErr('e-err',d.error||'Unknown error');return;}
      // trigger browser download
      var blob=new Blob([JSON.stringify(d.txJson,null,2)+'\n'],{type:'application/json'});
      var url=URL.createObjectURL(blob);
      var a=document.createElement('a');
      a.href=url; a.download=d.filename||('gov_execute_tx_'+id+'.json');
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      showOk('e-ok','TX file downloaded: '+d.filename);
    })
    .catch(function(e){ setDisabled('e-submit',false); showErr('e-err',e.message); });
}

// ── import form ───────────────────────────────────────────────────────────────
function openImportForm(){
  var html='';
  html+='<div class="sec-note sec-note-info">Paste or upload a proposal JSON exported from another governance participant.</div>';
  html+='<div class="form-row"><label class="form-lbl">Upload JSON file</label>';
  html+='<input type="file" accept=".json,application/json" class="fi" onchange="onImportFile(this)"></div>';
  html+='<div class="form-row"><label class="form-lbl" for="i-json">Or paste JSON</label>';
  html+='<textarea id="i-json" class="fi fi-mono" rows="10" placeholder=\'{"id":"...","proposalIdHash":"0x...",...}\'></textarea></div>';
  html+='<div id="i-err" class="form-err"></div>';
  html+='<div id="i-ok" class="form-ok"></div>';
  html+='<div class="btn-row"><button class="btn btn-p" id="i-submit" onclick="submitImport()">Import</button><button class="btn btn-d" onclick="closeAct()">Cancel</button></div>';
  openAct('Import Proposal',html);
}
function onImportFile(input){
  var file=input.files&&input.files[0];
  if(!file)return;
  var reader=new FileReader();
  reader.onload=function(e){ var ta=document.getElementById('i-json'); if(ta)ta.value=e.target.result; };
  reader.readAsText(file);
}
function submitImport(){
  hideMsg('i-err'); hideMsg('i-ok'); setDisabled('i-submit',true);
  var raw=fval('i-json').trim();
  if(!raw){setDisabled('i-submit',false);showErr('i-err','Paste or upload a proposal JSON first.');return;}
  var parsed;
  try{ parsed=JSON.parse(raw); } catch(e){ setDisabled('i-submit',false); showErr('i-err','Invalid JSON: '+e.message); return; }
  fetch('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(parsed)})
    .then(function(r){return r.json();})
    .then(function(d){
      setDisabled('i-submit',false);
      if(!d.ok){showErr('i-err',d.error||'Unknown error');return;}
      showOk('i-ok',d.merged?'Merged proposal #'+d.id+' ('+d.votes+' votes)':'Imported proposal #'+d.id);
      load().then(function(){ setTimeout(closeAct,1500); });
    })
    .catch(function(e){ setDisabled('i-submit',false); showErr('i-err',e.message); });
}

// ── event delegation ──────────────────────────────────────────────────────────
document.addEventListener('click',function(ev){
  var t=ev.target;

  // copy button
  if(t.classList&&t.classList.contains('copy-btn')){
    var txt=t.dataset.copy;
    if(!txt)return;
    if(navigator.clipboard){
      navigator.clipboard.writeText(txt).then(function(){
        t.textContent='Copied!';t.classList.add('ok');
        setTimeout(function(){t.textContent='Copy';t.classList.remove('ok');},2000);
      });
    }
    return;
  }

  // proposal badge in registry table
  var pidEl=t.closest('[data-pid]');
  if(pidEl&&!t.closest('.modal')){
    openProposal(pidEl.dataset.pid);
    return;
  }

  // registry row
  var addrEl=t.closest('[data-addr]');
  if(addrEl){
    openAddr(addrEl.dataset.addr);
    return;
  }
});

// ── render ────────────────────────────────────────────────────────────────────
function render(){
  renderOverview();
  renderReg();
  renderProps();
}

// ── init ──────────────────────────────────────────────────────────────────────
load();
</script>
</body>
</html>`;
/* eslint-enable max-len */

// ── HTTP server ───────────────────────────────────────────────────────────────
// createServer's callback must be synchronous — Node's http module does not
// await Promises returned from request handlers.  Any unhandled rejection from
// an async handler silently drops the TCP connection, which the browser sees as
// "Failed to fetch".  We extract the async logic and attach a top-level .catch
// so the connection always gets a response.

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: GuiServerOptions,
): Promise<void> {
  const remoteAddr = req.socket.remoteAddress ?? "";
  if (remoteAddr !== "127.0.0.1" && remoteAddr !== "::1" && remoteAddr !== "::ffff:127.0.0.1") {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  const url = req.url ?? "/";
  const method = (req.method ?? "GET").toUpperCase();

  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    if (_GUI_BUNDLE_PATH) {
      const apiData = await buildApiData(opts);
      res.end(_buildGuiHtml(apiData));
    } else {
      res.end(HTML);
    }
    return;
  }

  if (url === "/api/data" && method === "GET") {
    const body = await buildApiData(opts);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
    res.end(body);
    return;
  }

  // ── write endpoints ───────────────────────────────────────────────────────

  if (url === "/api/propose" && method === "POST") {
    try { apiOk(res, await handlePropose(await readJsonBody(req))); }
    catch (e) { apiErr(res, e instanceof Error ? e.message : String(e)); }
    return;
  }

  if (url === "/api/vote" && method === "POST") {
    try { apiOk(res, await handleVote(await readJsonBody(req), opts)); }
    catch (e) { apiErr(res, e instanceof Error ? e.message : String(e)); }
    return;
  }

  if (url === "/api/anchor" && method === "POST") {
    try { apiOk(res, await handleAnchor(await readJsonBody(req), opts)); }
    catch (e) { apiErr(res, e instanceof Error ? e.message : String(e)); }
    return;
  }

  if (url === "/api/execute" && method === "POST") {
    try { apiOk(res, await handleExecute(await readJsonBody(req), opts)); }
    catch (e) { apiErr(res, e instanceof Error ? e.message : String(e)); }
    return;
  }

  if (url === "/api/import" && method === "POST") {
    try { apiOk(res, handleImport(await readJsonBody(req))); }
    catch (e) { apiErr(res, e instanceof Error ? e.message : String(e)); }
    return;
  }

  // GET /api/export/:id
  const exportMatch = /^\/api\/export\/([a-f0-9]{12})$/i.exec(url);
  if (exportMatch && method === "GET") {
    try {
      const proposal = loadProposal(exportMatch[1]!);
      const json = JSON.stringify(proposal, null, 2) + "\n";
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="proposal-${exportMatch[1]}.json"`,
      });
      res.end(json);
    } catch (e) {
      apiErr(res, e instanceof Error ? e.message : String(e), 404);
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
}

export function startGuiServer(opts: GuiServerOptions): Promise<GuiServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handleRequest(req, res, opts).catch((err) => {
        if (res.headersSent) return;
        try {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        } catch {
          res.destroy();
        }
      });
    });

    server.once("error", reject);

    // Listen on all interfaces (omitting host) so both 127.0.0.1 (IPv4) and ::1
    // (IPv6) work.  On Linux, browsers often resolve "localhost" to ::1; binding
    // only to 127.0.0.1 causes the HTML to load but subsequent fetch() calls to
    // fail with "Failed to fetch".
    const listenPort = opts.port === 0 ? 0 : opts.port;
    server.listen(listenPort, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () => server.close(),
      });
    });
  });
}
