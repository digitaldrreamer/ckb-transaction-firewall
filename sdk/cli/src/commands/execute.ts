import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import logSymbols from "log-symbols";
import ora from "ora";
import inquirer from "inquirer";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  isReviewWindowPassed,
  isVoteApproved,
  loadProposal,
  saveProposal,
  voteSigningMessage,
  computeVoteDigestHash,
} from "../lib/proposals.js";
import { bytesToHex, governanceTreasuryLockHash, hexToBytes, scriptToMoleculeBytes } from "../lib/blkl.js";
import { getLiveCell, getLiveCellsByLock } from "../lib/rpc.js";
import { verifyMerkleProof } from "../lib/validator-set.js";
import {
  assertProposalCellMatches,
  assertProposalAnchorTypeMatches,
  loadRegistryStateForProposal,
  proposalV4Fields,
} from "../lib/governance-v4.js";
import {
  buildGov1WitnessV4,
  buildValidatorVoteWitness,
  buildWitnessArgs,
  ckbBlake2b,
  encodeRelativeTimestampSince,
} from "../lib/witness.js";
import {
  SECP256K1_DEP_GROUP,
  TESTNET_CONTRACT_OUTPOINTS,
  TESTNET_GOVERNANCE_PUBKEYS,
  TESTNET_REGISTRY_CELL,
  TESTNET_RPC_URL,
  warnIfTrivialTestKeys,
} from "../lib/defaults.js";
import { printHints } from "../lib/hints.js";
import { hexCapacity, occupiedCapacityShannons, parseCapacity } from "../lib/capacity.js";
import { parseCellDepList, type CellDepJson } from "../lib/tx-deps.js";

const DEFAULT_FEE_SHANNONS = 100_000n;
const MIN_CHANGE_SHANNONS = 61n * 100_000_000n;

export interface ExecuteOptions {
  proposal?: string;
  rpcUrl: string;
  registryTx: string;
  registryIndex: string;
  proposalTx?: string;
  proposalIndex?: string;
  proposalAnchorCodeTx?: string;
  proposalAnchorCodeIndex?: string;
  treasuryCell?: string[];
  treasuryLockDep?: string[];
  txOut: string;
  sign: boolean;
  fromAccount: string;
}

export function executeDefaults(): Partial<ExecuteOptions> {
  return {
    rpcUrl: TESTNET_RPC_URL,
    registryTx: TESTNET_REGISTRY_CELL.txHash,
    registryIndex: String(TESTNET_REGISTRY_CELL.index),
    proposalAnchorCodeTx: TESTNET_CONTRACT_OUTPOINTS.proposalAnchor.txHash,
    proposalAnchorCodeIndex: String(TESTNET_CONTRACT_OUTPOINTS.proposalAnchor.index),
    txOut: "gov_execute_tx.json",
    sign: false,
    fromAccount: "",
  };
}

function parseOutputIndex(value: string, name: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return Number.parseInt(value.trim(), 10);
}

function parseOutpointList(values: string[] | undefined, name: string): Array<{ txHash: string; index: number }> {
  return (values ?? []).map((value) => {
    const raw = value.trim();
    const match = /^(0x[0-9a-fA-F]{64})(?::|#)(\d+)$/.exec(raw);
    if (!match) {
      throw new Error(`${name} must be formatted as <tx-hash>:<index>. Got "${value}".`);
    }
    return { txHash: match[1]!, index: Number.parseInt(match[2]!, 10) };
  });
}

export async function executeCommand(opts: ExecuteOptions): Promise<void> {
  const proposalId = opts.proposal?.trim();
  if (!proposalId) {
    console.error(logSymbols.error, chalk.red("--proposal is required for GOV1 v4 execution."));
    process.exit(1);
  }

  const proposal = loadProposal(proposalId);
  const proposalCellTx = opts.proposalTx?.trim() || proposal.proposalCellTxHash?.trim();
  const proposalIndexRaw = opts.proposalIndex ?? (
    proposal.proposalCellIndex === undefined ? undefined : String(proposal.proposalCellIndex)
  );
  if (!proposalCellTx || proposalIndexRaw === undefined) {
    console.error(logSymbols.error, chalk.red("Proposal cell outpoint is required."));
    console.error(chalk.dim(
      `Run ckb-firewall anchor --proposal ${proposal.id} --proposal-tx <tx-hash> --proposal-index <n>, ` +
      "or pass --proposal-tx/--proposal-index directly.",
    ));
    process.exit(1);
  }

  let registryIndex: number;
  let proposalIndex: number;
  let proposalAnchorCodeIndex: number | undefined;
  let treasuryLockDeps: CellDepJson[];
  try {
    registryIndex = parseOutputIndex(opts.registryIndex, "--registry-index");
    proposalIndex = parseOutputIndex(proposalIndexRaw, "--proposal-index");
    proposalAnchorCodeIndex = opts.proposalAnchorCodeIndex === undefined
      ? undefined
      : parseOutputIndex(opts.proposalAnchorCodeIndex, "--proposal-anchor-code-index");
    treasuryLockDeps = parseCellDepList(opts.treasuryLockDep, "--treasury-lock-dep");
  } catch (err) {
    console.error(logSymbols.error, chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  if (proposal.status === "executed") {
    console.log(logSymbols.success, chalk.green(`Already executed: ${proposal.txHash ?? "unknown tx"}`));
    process.exit(0);
  }
  if (!isReviewWindowPassed(proposal)) {
    console.error(logSymbols.error, chalk.red("Local review window has not passed."));
    console.error(chalk.dim(`  Review ends: ${proposal.reviewWindowEndsAt}`));
    process.exit(1);
  }
  if (!isVoteApproved(proposal)) {
    console.error(logSymbols.error, chalk.red("Vote threshold not met."));
    process.exit(1);
  }
  if (proposal.expiresAt !== "0") {
    const expiryMs = BigInt(proposal.expiresAt) * 1000n;
    if (BigInt(Date.now()) >= expiryMs) {
      console.error(logSymbols.error, chalk.red(`Proposal entry has already expired (${new Date(Number(expiryMs)).toISOString()}).`));
      process.exit(1);
    }
  }

  const spinner = ora("Building GOV1 v4 registry update transaction").start();
  let state: Awaited<ReturnType<typeof loadRegistryStateForProposal>>;
  let proposalDataHash: Uint8Array;
  let reviewDelayMs: bigint;
  let proposalCell: Awaited<ReturnType<typeof getLiveCell>>;
  let proposalChangeCapacity: bigint;
  let treasuryCells: Array<Awaited<ReturnType<typeof getLiveCell>>> = [];
  let registryOutputCapacity: bigint;
  let extraTreasuryOutputCapacity = 0n;
  let proposalAnchorCellDep: { out_point: { tx_hash: string; index: string }; dep_type: "code" } | null = null;
  try {
    state = await loadRegistryStateForProposal(opts.rpcUrl, opts.registryTx, registryIndex, proposal);
    warnIfTrivialTestKeys(TESTNET_GOVERNANCE_PUBKEYS);

    proposalCell = await getLiveCell(opts.rpcUrl, proposalCellTx, proposalIndex);
    proposalDataHash = assertProposalCellMatches(proposal, proposalCell.data, state.registryTypeIdValue);
    const fields = proposalV4Fields(proposal, state.registryTypeIdValue);
    reviewDelayMs = fields.reviewDelayMs;
    if (bytesToHex(fields.proposalDataHash) !== bytesToHex(proposalDataHash)) {
      throw new Error("Internal proposal hash mismatch.");
    }

    proposal.proposalDataHash = bytesToHex(proposalDataHash);
    proposal.reviewDelayMs = reviewDelayMs.toString();
    proposal.proposalCellTxHash = proposalCellTx;
    proposal.proposalCellIndex = proposalIndex;
    const proposalCapacity = parseCapacity(proposalCell.capacity);
    proposalChangeCapacity = proposalCapacity - DEFAULT_FEE_SHANNONS;
    if (proposalChangeCapacity < MIN_CHANGE_SHANNONS) {
      throw new Error(
        `Proposal cell capacity ${proposalCapacity} shannons is too small to return change after fee. ` +
        `Need at least ${MIN_CHANGE_SHANNONS + DEFAULT_FEE_SHANNONS} shannons.`,
      );
    }
    const treasuryLockHash = governanceTreasuryLockHash(state.governanceHeader);
    if (treasuryLockHash) {
      assertProposalAnchorTypeMatches({
        proposalCellType: proposalCell.type,
        registryTypeIdValue: state.registryTypeIdValue,
        governanceHeader: state.governanceHeader,
        reclaimDelayMs: reviewDelayMs,
      });
      if (!opts.proposalAnchorCodeTx || proposalAnchorCodeIndex === undefined) {
        throw new Error(
          "Typed proposal anchors require --proposal-anchor-code-tx and --proposal-anchor-code-index so the transaction can include the anchor type script cell_dep.",
        );
      }
      proposalAnchorCellDep = {
        out_point: { tx_hash: opts.proposalAnchorCodeTx, index: `0x${proposalAnchorCodeIndex.toString(16)}` },
        dep_type: "code",
      };
      const proposalLockHash = ckbBlake2b(scriptToMoleculeBytes(proposalCell.lock));
      if (bytesToHex(proposalLockHash) !== bytesToHex(treasuryLockHash)) {
        throw new Error(
          "This registry uses treasury-funded anchors, but the proposal cell is not locked to the registry treasury.",
        );
      }

      const treasuryOutpoints = parseOutpointList(opts.treasuryCell, "--treasury-cell");
      treasuryCells = treasuryOutpoints.length > 0
        ? await Promise.all(treasuryOutpoints.map((outpoint) => getLiveCell(opts.rpcUrl, outpoint.txHash, outpoint.index)))
        : [];
      let treasuryInputCapacity = 0n;
      for (const cell of treasuryCells) {
        const lockHash = ckbBlake2b(scriptToMoleculeBytes(cell.lock));
        if (bytesToHex(lockHash) !== bytesToHex(treasuryLockHash)) {
          throw new Error(`Treasury cell ${cell.txHash}:${cell.index} is not locked to the registry treasury.`);
        }
        if (cell.type) {
          throw new Error(`Treasury cell ${cell.txHash}:${cell.index} has a type script; only plain treasury cells are supported.`);
        }
        if (cell.data !== "0x") {
          throw new Error(`Treasury cell ${cell.txHash}:${cell.index} has data; only empty treasury cells are supported.`);
        }
        treasuryInputCapacity += parseCapacity(cell.capacity);
      }

      const registryInputCapacity = parseCapacity(state.cell.capacity);
      const minRegistryCapacity = occupiedCapacityShannons({
        lock: state.cell.lock,
        type: state.cell.type,
        data: state.newBlkl,
      });
      registryOutputCapacity = minRegistryCapacity;
      const registryGrowth = registryOutputCapacity > registryInputCapacity ? registryOutputCapacity - registryInputCapacity : 0n;
      const registryShrink = registryInputCapacity > registryOutputCapacity ? registryInputCapacity - registryOutputCapacity : 0n;
      if (registryGrowth > treasuryInputCapacity) {
        if (!treasuryOutpoints.length && state.governanceHeader?.treasuryLockScript) {
          const candidates = await getLiveCellsByLock(opts.rpcUrl, state.governanceHeader.treasuryLockScript, 100);
          for (const cell of candidates) {
            if (cell.type || cell.data !== "0x") continue;
            treasuryCells.push(cell);
            treasuryInputCapacity += parseCapacity(cell.capacity);
            if (treasuryInputCapacity >= registryGrowth) break;
          }
        }
        if (registryGrowth > treasuryInputCapacity) {
          throw new Error(
            `Registry update needs ${registryGrowth} shannons of treasury capacity for growth, ` +
            `but selected treasury cells contain ${treasuryInputCapacity} shannons. ` +
            "Pass one or more --treasury-cell <tx-hash>:<index> inputs.",
          );
        }
      }
      extraTreasuryOutputCapacity = treasuryInputCapacity - registryGrowth + registryShrink;
    } else {
      registryOutputCapacity = parseCapacity(state.cell.capacity);
    }
    spinner.succeed("GOV1 v4 transaction inputs verified");
  } catch (err) {
    spinner.fail("Could not build GOV1 v4 transaction");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  // ── ECDSA signature verification ─────────────────────────────────────────
  for (const v of proposal.votes) {
    const sigBytes = hexToBytes(v.signature);
    if (sigBytes.length !== 65) {
      console.error(logSymbols.error, chalk.red(`Vote from ${v.pubkey.slice(0, 14)}... has invalid signature length.`));
      process.exit(1);
    }
    const msgHash = voteSigningMessage(proposal.proposalIdHash, v.vote, v.timestamp, v.pubkey);
    const sig65 = new Uint8Array(65);
    sig65[0] = sigBytes[64] as number;
    sig65.set(sigBytes.subarray(0, 64), 1);
    let recoveredPubkey: string;
    try {
      // prehash:false — msgHash is already blake2b; skip noble/curves' internal sha256 step.
      recoveredPubkey = bytesToHex(new Uint8Array(secp256k1.recoverPublicKey(sig65, msgHash, { prehash: false })));
    } catch {
      console.error(logSymbols.error, chalk.red(`Vote from ${v.pubkey.slice(0, 14)}... has unrecoverable signature.`));
      process.exit(1);
    }
    if (recoveredPubkey !== v.pubkey) {
      console.error(logSymbols.error, chalk.red(`Vote signature does not match pubkey ${v.pubkey.slice(0, 14)}...`));
      process.exit(1);
    }
  }

  // ── voteDigestHash integrity check ───────────────────────────────────────
  // Recompute from the actual vote records in the proposal file. If the file was
  // tampered with (votes added/removed/modified after signing), this catches it
  // client-side before submitting a transaction that would fail on-chain.
  const recomputedDigest = computeVoteDigestHash(proposal.votes);
  if (recomputedDigest.toLowerCase() !== proposal.voteDigestHash.toLowerCase()) {
    console.error(logSymbols.error, chalk.red("Vote digest mismatch — proposal vote data may have been tampered with."));
    console.error(chalk.dim(`  Stored:     ${proposal.voteDigestHash}`));
    console.error(chalk.dim(`  Recomputed: ${recomputedDigest}`));
    process.exit(1);
  }

  // ── on-chain Merkle membership verification ───────────────────────────────
  // Every vote must belong to the current on-chain validator set. These checks
  // mirror what governance-lock runs at consensus — any failure here means the
  // transaction would be rejected on-chain.
  if (!state.governanceHeader) {
    console.error(logSymbols.error, chalk.red("Could not parse governance header from registry cell — cannot verify vote authorization."));
    process.exit(1);
  }
  if (state.governanceHeader.validatorCount === 0) {
    console.error(logSymbols.error, chalk.red("Registry governance header has zero validators — cannot authorize votes."));
    process.exit(1);
  }
  const rootHex = bytesToHex(state.governanceHeader.validatorMerkleRoot);
  for (const v of proposal.votes) {
    if (!Array.isArray(v.merkleProof) || typeof v.merkleLeafIndex !== "number") {
      console.error(logSymbols.error, chalk.red(`Vote from ${v.pubkey.slice(0, 14)}... is missing a Merkle proof — re-cast this vote with the current CLI.`));
      process.exit(1);
    }
    if (!verifyMerkleProof(rootHex, v.pubkey, v.merkleProof, v.merkleLeafIndex)) {
      console.error(logSymbols.error, chalk.red(`Vote from ${v.pubkey.slice(0, 14)}... is not in the on-chain validator set.`));
      process.exit(1);
    }
  }

  const proposalIdBytes = hexToBytes(proposal.proposalIdHash);
  const voteDigestBytes = hexToBytes(proposal.voteDigestHash);
  const yesVotes = proposal.votes
    .filter((v) => v.vote === "yes")
    .sort((a, b) => a.pubkey.localeCompare(b.pubkey));

  const gov1 = buildGov1WitnessV4({
    proposalIdHash: proposalIdBytes,
    voteDigestHash: voteDigestBytes,
    oldRoot: state.oldRoot,
    newRoot: state.newRoot,
    proposalDataHash,
    reviewDelayMs,
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
        ...treasuryLockDeps,
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
        ...(proposalAnchorCellDep ? [proposalAnchorCellDep] : []),
      ],
      header_deps: [],
      inputs: [
        {
          since: "0x0",
          previous_output: { tx_hash: state.cell.txHash, index: `0x${state.cell.index.toString(16)}` },
        },
        {
          since: encodeRelativeTimestampSince(reviewDelayMs),
          previous_output: { tx_hash: proposalCellTx, index: `0x${proposalIndex.toString(16)}` },
        },
        ...treasuryCells.map((cell) => ({
          since: "0x0",
          previous_output: { tx_hash: cell.txHash, index: `0x${cell.index.toString(16)}` },
        })),
      ],
      outputs: [
        { capacity: hexCapacity(registryOutputCapacity), lock: state.cell.lock, type: state.cell.type },
        { capacity: hexCapacity(proposalChangeCapacity), lock: proposalCell.lock, type: null },
        ...(extraTreasuryOutputCapacity > 0n
          ? [{ capacity: hexCapacity(extraTreasuryOutputCapacity), lock: proposalCell.lock, type: null }]
          : []),
      ],
      outputs_data: [
        bytesToHex(state.newBlkl),
        "0x",
        ...(extraTreasuryOutputCapacity > 0n ? ["0x"] : []),
      ],
      witnesses: [
        bytesToHex(witnessBytes),
        bytesToHex(buildWitnessArgs({})),
        ...treasuryCells.map(() => bytesToHex(buildWitnessArgs({}))),
      ],
    },
    multisig_configs: {},
    signatures: {},
  };

  writeFileSync(opts.txOut, JSON.stringify(txJson, null, 2) + "\n");
  saveProposal(proposal);

  console.log();
  console.log(logSymbols.success, chalk.green(`Transaction written to ${opts.txOut}`));
  console.log(`  Proposal:       ${proposal.id}`);
  console.log(`  Proposal cell:  ${proposalCellTx}:${proposalIndex}`);
  console.log(`  Proposal hash:  ${bytesToHex(proposalDataHash)}`);
  console.log(`  Since delay:    ${encodeRelativeTimestampSince(reviewDelayMs)}`);
  console.log(`  Registry:       ${state.currentPayload.entries.length} -> ${state.newEntryCount} entries`);
  console.log();

  if (!opts.sign) {
    console.log("Sign and submit with ckb-cli:");
    console.log(chalk.dim(
      `  ckb-cli wallet sign-txs --tx-file ${opts.txOut} --from-account <address>\n` +
      `  ckb-cli wallet apply-txs --tx-file ${opts.txOut}`,
    ));
    console.log();
    printHints("execute");
    return;
  }

  let fromAccount = opts.fromAccount;
  if (!fromAccount && process.stdin.isTTY) {
    const { account } = await inquirer.prompt<{ account: string }>([
      {
        type: "input",
        name: "account",
        message: "Fee-payer account address for ckb-cli:",
        validate: (v: string) => v.trim().length > 0 || "Required.",
      },
    ]);
    fromAccount = account.trim();
  }
  if (!fromAccount) {
    console.error(logSymbols.error, chalk.red("--from-account is required when using --sign."));
    process.exit(1);
  }

  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    { type: "confirm", name: "proceed", message: "Sign and submit?", default: false },
  ]);
  if (!proceed) {
    console.log("Aborted.");
    return;
  }

  const signSpinner = ora("Signing with ckb-cli").start();
  try {
    execFileSync("ckb-cli", ["wallet", "sign-txs", "--tx-file", opts.txOut, "--from-account", fromAccount], { stdio: "inherit" });
    signSpinner.succeed("Signed");

    const submitSpinner = ora("Submitting").start();
    const output = execFileSync("ckb-cli", ["wallet", "apply-txs", "--tx-file", opts.txOut], { encoding: "utf8" });
    submitSpinner.succeed("Submitted");

    const txHash = output.match(/0x[a-fA-F0-9]{64}/)?.[0];
    if (txHash) {
      proposal.status = "executed";
      proposal.txHash = txHash;
      saveProposal(proposal);
      console.log(logSymbols.success, chalk.green(`Executed: ${txHash}`));
    } else {
      console.log(chalk.yellow("Submitted, but could not parse tx hash from ckb-cli output."));
    }
  } catch (err) {
    signSpinner.fail("ckb-cli signing/submission failed");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
