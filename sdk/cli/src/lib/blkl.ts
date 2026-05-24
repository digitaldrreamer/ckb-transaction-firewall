import type { RegistryEntry, RegistryPayload } from "@ckb-firewall/sdk";

export interface GovernanceHeader {
  signerCount: number;
  threshold: number;
  pubkeys: Uint8Array[]; // 33 bytes each (compressed secp256k1)
  validatorCount: number;
  validatorMerkleRoot: Uint8Array; // 32 bytes
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

export function encodeGovernanceHeader(h: GovernanceHeader): Uint8Array {
  const size = 1 + 1 + 1 + 33 * h.pubkeys.length + 2 + 32;
  const buf = new Uint8Array(size);
  let off = 0;
  buf[off++] = 0x01; // governance header version
  buf[off++] = h.signerCount;
  buf[off++] = h.threshold;
  for (const pk of h.pubkeys) {
    buf.set(pk, off);
    off += 33;
  }
  buf[off++] = h.validatorCount & 0xff;
  buf[off++] = (h.validatorCount >> 8) & 0xff;
  buf.set(h.validatorMerkleRoot, off);
  return buf;
}

// Parses a raw governance header byte slice into a GovernanceHeader.
// Format: gh_version(1) | signer_count(1) | threshold(1) | [pubkey(33)]×N | validator_count(2 LE) | merkle_root(32)
export function parseGovernanceHeader(raw: Uint8Array): GovernanceHeader | null {
  if (raw.length < 3) return null;
  if ((raw[0] as number) !== 0x01) return null;
  const signerCount = raw[1] as number;
  const threshold = raw[2] as number;
  const pubkeysEnd = 3 + signerCount * 33;
  if (raw.length < pubkeysEnd + 2 + 32) return null;
  const pubkeys: Uint8Array[] = [];
  for (let i = 0; i < signerCount; i++) {
    pubkeys.push(raw.slice(3 + i * 33, 3 + (i + 1) * 33));
  }
  const validatorCount =
    (raw[pubkeysEnd] as number) | ((raw[pubkeysEnd + 1] as number) << 8);
  const validatorMerkleRoot = raw.slice(pubkeysEnd + 2, pubkeysEnd + 2 + 32);
  return { signerCount, threshold, pubkeys, validatorCount, validatorMerkleRoot };
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
