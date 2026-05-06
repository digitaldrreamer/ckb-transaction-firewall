import type { CellDepLike, RegistryPayload, ScriptLike } from "./types";

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = strip0x(hex);
  if (clean.length % 2 !== 0) {
    throw new Error("InvalidRegistryData");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

function eqScript(a: ScriptLike, b: ScriptLike): boolean {
  return (
    a.codeHash.toLowerCase() === b.codeHash.toLowerCase() &&
    a.hashType === b.hashType &&
    strip0x(a.args).toLowerCase() === strip0x(b.args).toLowerCase()
  );
}

export function resolveRegistryDep(
  deps: CellDepLike[],
  expectedRegistryScript: ScriptLike,
): CellDepLike {
  const matches = deps.filter((d) => d.type && eqScript(d.type, expectedRegistryScript));
  if (matches.length === 0) {
    throw new Error("MissingRegistryCellDep");
  }
  if (matches.length > 1) {
    throw new Error("AmbiguousRegistryCellDep");
  }
  return matches[0];
}

export function parseRegistryPayload(registryDataHex: string): RegistryPayload {
  const data = hexToBytes(registryDataHex);
  if (data.length < 9) {
    throw new Error("InvalidRegistryData");
  }
  if (
    data[0] !== 0x42 || // B
    data[1] !== 0x4c || // L
    data[2] !== 0x4b || // K
    data[3] !== 0x4c // L
  ) {
    throw new Error("InvalidRegistryData");
  }
  const version = data[4];
  if (version !== 0x01) {
    throw new Error("InvalidRegistryData");
  }

  const count =
    data[5] |
    (data[6] << 8) |
    (data[7] << 16) |
    (data[8] << 24);
  let offset = 9;
  const entries: RegistryPayload["entries"] = [];

  for (let i = 0; i < count; i += 1) {
    if (offset >= data.length) {
      throw new Error("InvalidRegistryData");
    }
    const idLen = data[offset];
    offset += 1;
    if (offset + idLen + 8 > data.length) {
      throw new Error("InvalidRegistryData");
    }
    const id = data.slice(offset, offset + idLen);
    offset += idLen;
    let expiresAt = 0n;
    for (let j = 0; j < 8; j += 1) {
      expiresAt |= BigInt(data[offset + j]) << (8n * BigInt(j));
    }
    offset += 8;
    entries.push({ identifier: bytesToHex(id), expiresAt });
  }

  for (let i = 1; i < entries.length; i += 1) {
    if (entries[i].identifier.toLowerCase() <= entries[i - 1].identifier.toLowerCase()) {
      throw new Error("RegistryNotSorted");
    }
  }

  return { version, entries };
}
