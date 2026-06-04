import type { RegistryEntry, RegistryPayload } from "@ckb-firewall/sdk";
import { blake2b } from "@noble/hashes/blake2b";

const CKB_PERSONALIZATION = new TextEncoder().encode("ckb-default-hash");

export interface GovernanceHeader {
  /** Minimum number of validator yes-votes required to execute. */
  threshold: number;
  /** Number of validators in the authorized set. */
  validatorCount: number;
  /** Merkle root of the ordered validator public key set. */
  validatorMerkleRoot: Uint8Array; // 32 bytes
  treasuryLockHash?: Uint8Array; // 32 bytes, blake2b(raw lock script)
  treasuryLockScript?: { code_hash: string; hash_type: string; args: string };
}

export function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = strip0x(hex);
  if (clean.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length hex string (${clean.length} chars): "${hex.slice(0, 20)}"`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function scriptToMoleculeBytes(script: { code_hash?: string; codeHash?: string; hash_type?: string; hashType?: string; args: string }): Uint8Array {
  const codeHash = hexToBytes(script.code_hash ?? script.codeHash ?? "");
  if (codeHash.length !== 32) {
    throw new Error(`Script code_hash must be 32 bytes, got ${codeHash.length}`);
  }
  const hashTypeRaw = script.hash_type ?? script.hashType;
  const hashType = hashTypeRaw === "data" ? 0x00
    : hashTypeRaw === "type" ? 0x01
    : hashTypeRaw === "data1" ? 0x02
    : hashTypeRaw?.startsWith("0x") ? Number.parseInt(hashTypeRaw, 16)
    : Number(hashTypeRaw);
  if (!Number.isInteger(hashType) || hashType < 0 || hashType > 0xff) {
    throw new Error(`Invalid script hash_type: ${hashTypeRaw}`);
  }
  const args = hexToBytes(script.args);
  const argsBytesLen = 4 + args.length;
  const total = 16 + 32 + 1 + argsBytesLen;
  const out = new Uint8Array(total);
  const putU32 = (off: number, value: number) => {
    out[off] = value & 0xff;
    out[off + 1] = (value >> 8) & 0xff;
    out[off + 2] = (value >> 16) & 0xff;
    out[off + 3] = (value >> 24) & 0xff;
  };
  putU32(0, total);
  putU32(4, 16);
  putU32(8, 48);
  putU32(12, 49);
  out.set(codeHash, 16);
  out[48] = hashType;
  putU32(49, args.length);
  out.set(args, 53);
  return out;
}

function moleculeBytesToScript(raw: Uint8Array): { code_hash: string; hash_type: string; args: string } | null {
  if (raw.length < 53) return null;
  const u32 = (off: number) =>
    (raw[off] as number) |
    ((raw[off + 1] as number) << 8) |
    ((raw[off + 2] as number) << 16) |
    ((raw[off + 3] as number) << 24);
  if (u32(0) !== raw.length || u32(4) !== 16 || u32(8) !== 48 || u32(12) !== 49) return null;
  const argsLen = u32(49);
  if (53 + argsLen !== raw.length) return null;
  const hashTypeByte = raw[48] as number;
  const hashType = hashTypeByte === 0x00 ? "data"
    : hashTypeByte === 0x01 ? "type"
    : hashTypeByte === 0x02 ? "data1"
    : `0x${hashTypeByte.toString(16)}`;
  return {
    code_hash: bytesToHex(raw.slice(16, 48)),
    hash_type: hashType,
    args: bytesToHex(raw.slice(53)),
  };
}

export function encodeGovernanceHeader(h: GovernanceHeader): Uint8Array {
  const treasuryScriptBytes = h.treasuryLockScript ? scriptToMoleculeBytes(h.treasuryLockScript) : undefined;
  const version = treasuryScriptBytes ? 0x03 : h.treasuryLockHash ? 0x02 : 0x01;
  // Legacy signer_count slot is always 0. On-chain authorization uses validator votes, not
  // a separate multisig signer set. The governance-lock reads this byte only to skip past it.
  const size = 1 + 1 + 1 + 2 + 32
    + (h.treasuryLockHash && !treasuryScriptBytes ? 32 : 0)
    + (treasuryScriptBytes ? 2 + treasuryScriptBytes.length : 0);
  const buf = new Uint8Array(size);
  let off = 0;
  buf[off++] = version;
  buf[off++] = 0; // legacy signer_count — always 0 (no multisig signer set)
  buf[off++] = h.threshold;
  buf[off++] = h.validatorCount & 0xff;
  buf[off++] = (h.validatorCount >> 8) & 0xff;
  buf.set(h.validatorMerkleRoot, off);
  off += 32;
  if (treasuryScriptBytes) {
    buf[off++] = treasuryScriptBytes.length & 0xff;
    buf[off++] = (treasuryScriptBytes.length >> 8) & 0xff;
    buf.set(treasuryScriptBytes, off);
  } else if (h.treasuryLockHash) {
    if (h.treasuryLockHash.length !== 32) {
      throw new Error(`treasuryLockHash must be 32 bytes, got ${h.treasuryLockHash.length}`);
    }
    buf.set(h.treasuryLockHash, off);
  }
  return buf;
}

// Parses a raw governance header byte slice into a GovernanceHeader.
//
// Wire format (all versions):
//   gh_version(1) | legacy_signer_count(1) | threshold(1) | [legacy_pubkey(33)]×N
//   | validator_count(2 LE) | validator_merkle_root(32)
//   v2 suffix: treasury_lock_hash(32)
//   v3 suffix: treasury_lock_script_len(2 LE) | treasury_lock_script(Molecule Script)
//
// The legacy_signer_count/pubkey block is preserved for wire-format compatibility with older
// on-chain cells but is not used for authorization. New cells always write signer_count=0.
export function parseGovernanceHeader(raw: Uint8Array): GovernanceHeader | null {
  if (raw.length < 3) return null;
  const version = raw[0] as number;
  if (version !== 0x01 && version !== 0x02 && version !== 0x03) return null;
  const legacySignerCount = raw[1] as number; // bytes to skip; not used for authorization
  const threshold = raw[2] as number;
  const pubkeysEnd = 3 + legacySignerCount * 33; // skip legacy pubkey block
  const baseEnd = pubkeysEnd + 2 + 32;
  if (raw.length < baseEnd) return null;
  const validatorCount =
    (raw[pubkeysEnd] as number) | ((raw[pubkeysEnd + 1] as number) << 8);
  const validatorMerkleRoot = raw.slice(pubkeysEnd + 2, pubkeysEnd + 2 + 32);
  let treasuryLockHash = version === 0x02 ? raw.slice(baseEnd, baseEnd + 32) : undefined;
  if (version === 0x02 && treasuryLockHash?.length !== 32) return null;
  let treasuryLockScript: { code_hash: string; hash_type: string; args: string } | undefined;
  if (version === 0x03) {
    if (baseEnd + 2 > raw.length) return null;
    const scriptLen = (raw[baseEnd] as number) | ((raw[baseEnd + 1] as number) << 8);
    const scriptStart = baseEnd + 2;
    const scriptEnd = scriptStart + scriptLen;
    if (scriptEnd !== raw.length) return null;
    const scriptBytes = raw.slice(scriptStart, scriptEnd);
    const parsed = moleculeBytesToScript(scriptBytes);
    if (!parsed) return null;
    treasuryLockScript = parsed;
    treasuryLockHash = undefined;
  }
  const header: GovernanceHeader = { threshold, validatorCount, validatorMerkleRoot };
  if (treasuryLockHash) header.treasuryLockHash = treasuryLockHash;
  if (treasuryLockScript) header.treasuryLockScript = treasuryLockScript;
  return header;
}

export function governanceTreasuryLockHash(header: GovernanceHeader | null | undefined): Uint8Array | undefined {
  if (!header) return undefined;
  if (header.treasuryLockHash) return header.treasuryLockHash;
  if (header.treasuryLockScript) {
    return blake2b(scriptToMoleculeBytes(header.treasuryLockScript), {
      personalization: CKB_PERSONALIZATION,
      dkLen: 32,
    });
  }
  return undefined;
}

export function extractGovernanceHeaderRaw(hex: string): Uint8Array | null {
  try {
    const data = hexToBytes(hex);
    if (data.length < 7 || data[4] !== 0x02) return null;
    const govHeaderLen = (data[5] as number) | ((data[6] as number) << 8);
    if (data.length < 7 + govHeaderLen) return null;
    return data.slice(7, 7 + govHeaderLen);
  } catch {
    return null;
  }
}

export function encodeRegistryPayload(payload: RegistryPayload, governanceHeaderRaw?: Uint8Array): Uint8Array {
  const encodedEntries = payload.entries.map((e) => {
    const id = hexToBytes(e.identifier);
    if (id.length > 255) {
      throw new Error(`Identifier too long: ${id.length} bytes (max 255). Entry: ${e.identifier.slice(0, 20)}…`);
    }
    const buf = new Uint8Array(1 + id.length + 8);
    buf[0] = id.length;
    buf.set(id, 1);
    let exp = e.expiresAt;
    for (let i = 0; i < 8; i++) {
      buf[1 + id.length + i] = Number(exp & 0xffn);
      exp >>= 8n;
    }
    return buf;
  });

  const entriesSize = encodedEntries.reduce((acc, e) => acc + e.length, 0);

  if (governanceHeaderRaw) {
    // BLKL v2: BLKL(4) + version(1) + gov_header_len(2) + gov_header(N) + entry_count(4) + entries
    const govLen = governanceHeaderRaw.length;
    const totalSize = 4 + 1 + 2 + govLen + 4 + entriesSize;
    const out = new Uint8Array(totalSize);
    let off = 0;
    out[off++] = 0x42; out[off++] = 0x4c; out[off++] = 0x4b; out[off++] = 0x4c; // BLKL
    out[off++] = 0x02; // version 2
    out[off++] = govLen & 0xff;
    out[off++] = (govLen >> 8) & 0xff;
    out.set(governanceHeaderRaw, off);
    off += govLen;
    const count = payload.entries.length;
    out[off++] = count & 0xff; out[off++] = (count >> 8) & 0xff;
    out[off++] = (count >> 16) & 0xff; out[off++] = (count >> 24) & 0xff;
    for (const e of encodedEntries) { out.set(e, off); off += e.length; }
    return out;
  }

  // BLKL v1: BLKL(4) + version(1) + entry_count(4) + entries
  const totalSize = 9 + entriesSize;
  const out = new Uint8Array(totalSize);
  let off = 0;
  out[off++] = 0x42; out[off++] = 0x4c; out[off++] = 0x4b; out[off++] = 0x4c; // BLKL
  out[off++] = payload.version;
  const count = payload.entries.length;
  out[off++] = count & 0xff; out[off++] = (count >> 8) & 0xff;
  out[off++] = (count >> 16) & 0xff; out[off++] = (count >> 24) & 0xff;
  for (const e of encodedEntries) { out.set(e, off); off += e.length; }
  return out;
}

function compareIdentifierBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] as number) - (b[i] as number);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

export function insertSorted(
  entries: RegistryEntry[],
  newEntry: RegistryEntry,
): RegistryEntry[] {
  const result = [...entries];
  const newBytes = hexToBytes(newEntry.identifier);
  let insertAt = result.findIndex((e) => compareIdentifierBytes(hexToBytes(e.identifier), newBytes) >= 0);
  if (insertAt === -1) insertAt = result.length;
  result.splice(insertAt, 0, newEntry);
  return result;
}

export function removeEntry(
  entries: RegistryEntry[],
  identifier: string,
): RegistryEntry[] {
  const norm = strip0x(identifier).toLowerCase();
  return entries.filter(
    (e) => strip0x(e.identifier).toLowerCase() !== norm,
  );
}
