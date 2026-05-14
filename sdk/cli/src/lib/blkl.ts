import type { RegistryEntry, RegistryPayload } from "@ckb-firewall/sdk";

export function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = strip0x(hex);
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

export function encodeRegistryPayload(payload: RegistryPayload): Uint8Array {
  const encodedEntries = payload.entries.map((e) => {
    const id = hexToBytes(e.identifier);
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

  const totalSize =
    9 + encodedEntries.reduce((acc, e) => acc + e.length, 0);
  const out = new Uint8Array(totalSize);
  let off = 0;

  // Magic "BLKL"
  out[off++] = 0x42;
  out[off++] = 0x4c;
  out[off++] = 0x4b;
  out[off++] = 0x4c;
  out[off++] = payload.version;

  const count = payload.entries.length;
  out[off++] = count & 0xff;
  out[off++] = (count >> 8) & 0xff;
  out[off++] = (count >> 16) & 0xff;
  out[off++] = (count >> 24) & 0xff;

  for (const e of encodedEntries) {
    out.set(e, off);
    off += e.length;
  }

  return out;
}

export function insertSorted(
  entries: RegistryEntry[],
  newEntry: RegistryEntry,
): RegistryEntry[] {
  const result = [...entries];
  let insertAt = result.findIndex((e) => e.identifier >= newEntry.identifier);
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
