import type { RegistryPayload } from "@ckb-firewall/sdk";
import { parseRegistryPayload } from "@ckb-firewall/sdk";
import { getLiveCell, type LiveCell } from "./rpc.js";
import { resolveRegistryOutpoint } from "./registry.js";
import {
  bytesToHex,
  encodeGovernanceHeader,
  encodeRegistryPayload,
  extractGovernanceHeaderRaw,
  governanceTreasuryLockHash,
  hexToBytes,
  insertSorted,
  parseGovernanceHeader,
  removeEntry,
  scriptToMoleculeBytes,
  strip0x,
  type GovernanceHeader,
} from "./blkl.js";
import { ckbBlake2b } from "./witness.js";
import { REVIEW_WINDOW_MS, type Proposal } from "./proposals.js";

export interface RegistryStateForProposal {
  cell: LiveCell;
  currentPayload: RegistryPayload;
  newEntryCount: number;
  governanceHeaderRaw: Uint8Array;
  governanceHeader: GovernanceHeader | null;
  oldBlkl: Uint8Array;
  newBlkl: Uint8Array;
  oldRoot: Uint8Array;
  newRoot: Uint8Array;
  registryTypeIdValue: Uint8Array;
}

export function parseRegistryTypeIdValue(typeArgs: string): Uint8Array {
  const raw = hexToBytes(typeArgs);
  if (raw.length !== 66 || raw[0] !== 0x02) {
    throw new Error("Registry type args must be BLKL v2 layout: version(1) + governance code hash(32) + hash type(1) + type id(32).");
  }
  return raw.slice(34, 66);
}

export function encodeProposalCellData(proposal: Proposal, registryTypeIdValue: Uint8Array): Uint8Array {
  if (registryTypeIdValue.length !== 32) {
    throw new Error(`registryTypeIdValue must be 32 bytes, got ${registryTypeIdValue.length}`);
  }
  if (proposal.action === "set-treasury") {
    if (!proposal.treasuryLockScript) {
      throw new Error("set-treasury proposals require treasuryLockScript.");
    }
    const treasuryScriptHash = ckbBlake2b(scriptToMoleculeBytes(proposal.treasuryLockScript));
    const evidenceHash = ckbBlake2b(new TextEncoder().encode(proposal.evidence));
    const out = new Uint8Array(4 + 1 + 32 + 1 + 32 + 32);
    let off = 0;
    out[off++] = 0x50; out[off++] = 0x42; out[off++] = 0x4c; out[off++] = 0x4b; // PBLK
    out[off++] = 0x02;
    out.set(registryTypeIdValue, off); off += 32;
    out[off++] = 0x03;
    out.set(treasuryScriptHash, off); off += 32;
    out.set(evidenceHash, off);
    return out;
  }
  const identifier = hexToBytes(proposal.lockArgs);
  if (identifier.length === 0 || identifier.length > 255) {
    throw new Error(`lockArgs must encode 1..255 bytes, got ${identifier.length}`);
  }
  const expiresAt = BigInt(proposal.expiresAt);
  if (expiresAt < 0n || expiresAt > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`expiresAt must fit in u64, got ${proposal.expiresAt}`);
  }
  const evidenceHash = ckbBlake2b(new TextEncoder().encode(proposal.evidence));
  const out = new Uint8Array(4 + 1 + 32 + 1 + 1 + identifier.length + 8 + 32);
  let off = 0;
  out[off++] = 0x50; out[off++] = 0x42; out[off++] = 0x4c; out[off++] = 0x4b; // PBLK
  out[off++] = 0x01;
  out.set(registryTypeIdValue, off); off += 32;
  out[off++] = proposal.action === "add" ? 0x01 : 0x02;
  out[off++] = identifier.length;
  out.set(identifier, off); off += identifier.length;
  let exp = expiresAt;
  for (let i = 0; i < 8; i++) {
    out[off++] = Number(exp & 0xffn);
    exp >>= 8n;
  }
  out.set(evidenceHash, off);
  return out;
}

export function proposalCellDataHash(proposal: Proposal, registryTypeIdValue: Uint8Array): Uint8Array {
  return ckbBlake2b(encodeProposalCellData(proposal, registryTypeIdValue));
}

export function reviewDelayMs(proposal: Proposal): bigint {
  return BigInt(proposal.reviewDelayMs ?? String(REVIEW_WINDOW_MS));
}

export async function loadRegistryStateForProposal(
  rpcUrl: string,
  registryTx: string,
  registryIndex: number,
  proposal: Proposal,
): Promise<RegistryStateForProposal> {
  const { txHash, index } = await resolveRegistryOutpoint(rpcUrl, registryTx, registryIndex);
  const cell = await getLiveCell(rpcUrl, txHash, index);
  if (!cell.type) {
    throw new Error("Registry cell has no type script.");
  }

  const currentPayload = parseRegistryPayload(cell.data);
  const governanceHeaderRaw = extractGovernanceHeaderRaw(cell.data);
  if (!governanceHeaderRaw) {
    throw new Error("Registry cell does not contain a BLKL v2 governance header.");
  }
  const governanceHeader = parseGovernanceHeader(governanceHeaderRaw);
  const registryTypeIdValue = parseRegistryTypeIdValue(cell.type.args);

  let newEntries;
  let newGovernanceHeaderRaw = governanceHeaderRaw;
  if (proposal.action === "add") {
    const alreadyPresent = currentPayload.entries.some(
      (e) => strip0x(e.identifier).toLowerCase() === strip0x(proposal.lockArgs).toLowerCase(),
    );
    if (alreadyPresent) {
      throw new Error(`${proposal.lockArgs} is already in the registry.`);
    }
    newEntries = insertSorted(currentPayload.entries, {
      identifier: proposal.lockArgs,
      expiresAt: BigInt(proposal.expiresAt),
    });
  } else {
    if (proposal.action === "set-treasury") {
      if (!governanceHeader) {
        throw new Error("set-treasury requires a parseable governance header.");
      }
      if (!proposal.treasuryLockScript) {
        throw new Error("set-treasury proposals require treasuryLockScript.");
      }
      newEntries = currentPayload.entries;
      newGovernanceHeaderRaw = encodeGovernanceHeader({
        threshold: governanceHeader.threshold,
        validatorCount: governanceHeader.validatorCount,
        validatorMerkleRoot: governanceHeader.validatorMerkleRoot,
        treasuryLockScript: proposal.treasuryLockScript,
      });
    } else {
    newEntries = removeEntry(currentPayload.entries, proposal.lockArgs);
    if (newEntries.length === currentPayload.entries.length) {
      throw new Error(`${proposal.lockArgs} is not in the registry.`);
    }
    }
  }

  const oldBlkl = hexToBytes(cell.data);
  const newBlkl = encodeRegistryPayload({ version: currentPayload.version, entries: newEntries }, newGovernanceHeaderRaw);

  return {
    cell,
    currentPayload,
    governanceHeaderRaw,
    governanceHeader,
    oldBlkl,
    newBlkl,
    newEntryCount: newEntries.length,
    oldRoot: ckbBlake2b(oldBlkl),
    newRoot: ckbBlake2b(newBlkl),
    registryTypeIdValue,
  };
}

export function proposalV4Fields(proposal: Proposal, registryTypeIdValue: Uint8Array): {
  proposalData: Uint8Array;
  proposalDataHash: Uint8Array;
  reviewDelayMs: bigint;
} {
  const proposalData = encodeProposalCellData(proposal, registryTypeIdValue);
  return {
    proposalData,
    proposalDataHash: ckbBlake2b(proposalData),
    reviewDelayMs: reviewDelayMs(proposal),
  };
}

export function assertProposalCellMatches(proposal: Proposal, proposalCellData: string, registryTypeIdValue: Uint8Array): Uint8Array {
  const expected = encodeProposalCellData(proposal, registryTypeIdValue);
  const actual = hexToBytes(proposalCellData);
  if (bytesToHex(actual) !== bytesToHex(expected)) {
    throw new Error(
      "Proposal cell data does not match this proposal. " +
      `Expected ${bytesToHex(expected)}, got ${bytesToHex(actual)}.`,
    );
  }
  return ckbBlake2b(actual);
}

export function encodeProposalAnchorTypeArgs(params: {
  registryTypeIdValue: Uint8Array;
  treasuryLockHash: Uint8Array;
  reclaimDelayMs: bigint;
}): Uint8Array {
  if (params.registryTypeIdValue.length !== 32) {
    throw new Error(`registryTypeIdValue must be 32 bytes, got ${params.registryTypeIdValue.length}`);
  }
  if (params.treasuryLockHash.length !== 32) {
    throw new Error(`treasuryLockHash must be 32 bytes, got ${params.treasuryLockHash.length}`);
  }
  if (params.reclaimDelayMs < 0n || params.reclaimDelayMs > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`reclaimDelayMs must fit in u64, got ${params.reclaimDelayMs}`);
  }
  const out = new Uint8Array(73);
  out[0] = 0x01;
  out.set(params.registryTypeIdValue, 1);
  out.set(params.treasuryLockHash, 33);
  let delay = params.reclaimDelayMs;
  for (let i = 0; i < 8; i++) {
    out[65 + i] = Number(delay & 0xffn);
    delay >>= 8n;
  }
  return out;
}

export function assertProposalAnchorTypeMatches(params: {
  proposalCellType: LiveCell["type"];
  registryTypeIdValue: Uint8Array;
  governanceHeader: GovernanceHeader | null;
  reclaimDelayMs: bigint;
}): void {
  const treasuryLockHash = governanceTreasuryLockHash(params.governanceHeader);
  if (!treasuryLockHash) return;
  if (!params.proposalCellType) {
    throw new Error("Treasury-funded proposal anchors must carry the proposal-anchor type script.");
  }
  const expectedArgs = encodeProposalAnchorTypeArgs({
    registryTypeIdValue: params.registryTypeIdValue,
    treasuryLockHash,
    reclaimDelayMs: params.reclaimDelayMs,
  });
  const actualArgs = hexToBytes(params.proposalCellType.args);
  if (bytesToHex(actualArgs) !== bytesToHex(expectedArgs)) {
    throw new Error(
      "Proposal-anchor type args do not match this registry treasury and reclaim delay. " +
      `Expected ${bytesToHex(expectedArgs)}, got ${params.proposalCellType.args}.`,
    );
  }
}
