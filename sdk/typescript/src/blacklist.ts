import {
  AmbiguousRegistryCellDepError,
  InvalidRegistryDataError,
  MissingRegistryCellDepError,
  RegistryNotSortedError,
} from "./errors.js";
import type { CellDepLike, RegistryPayload, ScriptLike } from "./types.js";

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function readU8(data: Uint8Array, index: number): number {
  const value = data[index];
  if (value === undefined) {
    throw new InvalidRegistryDataError();
  }
  return value;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = strip0x(hex);
  if (clean.length % 2 !== 0) {
    throw new InvalidRegistryDataError();
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    const hi = clean[i];
    const lo = clean[i + 1];
    if (hi === undefined || lo === undefined) {
      throw new InvalidRegistryDataError();
    }
    const pair = `${hi}${lo}`;
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) {
      throw new InvalidRegistryDataError();
    }
    const byte = Number.parseInt(pair, 16);
    if (Number.isNaN(byte)) {
      throw new InvalidRegistryDataError();
    }
    out[i / 2] = byte;
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
    throw new MissingRegistryCellDepError();
  }
  if (matches.length > 1) {
    throw new AmbiguousRegistryCellDepError();
  }
  const dep = matches[0];
  if (dep === undefined) {
    throw new MissingRegistryCellDepError();
  }
  return dep;
}

export function parseRegistryPayload(registryDataHex: string): RegistryPayload {
  const data = hexToBytes(registryDataHex);
  if (data.length < 9) {
    throw new InvalidRegistryDataError();
  }
  if (
    readU8(data, 0) !== 0x42 || // B
    readU8(data, 1) !== 0x4c || // L
    readU8(data, 2) !== 0x4b || // K
    readU8(data, 3) !== 0x4c // L
  ) {
    throw new InvalidRegistryDataError();
  }
  const version = readU8(data, 4);
  if (version !== 0x01) {
    throw new InvalidRegistryDataError();
  }

  const count =
    (
      readU8(data, 5) |
      (readU8(data, 6) << 8) |
      (readU8(data, 7) << 16) |
      (readU8(data, 8) << 24)
    ) >>> 0;
  let offset = 9;
  const entries: RegistryPayload["entries"] = [];

  for (let i = 0; i < count; i += 1) {
    if (offset >= data.length) {
      throw new InvalidRegistryDataError();
    }
    const idLen = readU8(data, offset);
    offset += 1;
    if (offset + idLen + 8 > data.length) {
      throw new InvalidRegistryDataError();
    }
    const id = data.slice(offset, offset + idLen);
    offset += idLen;
    let expiresAt = 0n;
    for (let j = 0; j < 8; j += 1) {
      expiresAt |= BigInt(readU8(data, offset + j)) << (8n * BigInt(j));
    }
    offset += 8;
    entries.push({ identifier: bytesToHex(id), expiresAt });
  }

  for (let i = 1; i < entries.length; i += 1) {
    const cur = entries[i];
    const prev = entries[i - 1];
    if (cur === undefined || prev === undefined) {
      throw new InvalidRegistryDataError();
    }
    if (cur.identifier < prev.identifier) {
      throw new RegistryNotSortedError();
    }
  }

  return { version, entries };
}
