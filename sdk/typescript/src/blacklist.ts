import {
  AmbiguousRegistryCellDepError,
  InvalidRegistryDataError,
  MissingRegistryCellDepError,
  RegistryNotSortedError,
} from "./errors.js";
import type { CellDepLike, GovernanceHeader, RegistryPayload, RegistrySpecLike } from "./types.js";

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

function compareIdentifiers(a: string, b: string): number {
  const ab = hexToBytes(a);
  const bb = hexToBytes(b);
  const len = Math.min(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    const diff = (ab[i] as number) - (bb[i] as number);
    if (diff !== 0) return diff;
  }
  return ab.length - bb.length;
}


/// Resolves each RegistrySpecLike to the matching cell dep.
///
/// Matches on: code_hash + hash_type + dep.type.args[34..66] == spec.typeIdValue
/// (v2 registry type args are exactly 66 bytes; type_id_value occupies bytes 34..66).
///
/// Returns the resolved CellDepLike for each spec in order.
/// Required specs with no match → MissingRegistryCellDepError.
/// Specs with multiple matches → AmbiguousRegistryCellDepError.
export function resolveRegistryDeps(
  deps: CellDepLike[],
  specs: RegistrySpecLike[],
): CellDepLike[] {
  const resolved: CellDepLike[] = [];
  for (const spec of specs) {
    const expectedCode = strip0x(spec.codeHash).toLowerCase();
    const expectedTypeId = strip0x(spec.typeIdValue).toLowerCase();
    const matches = deps.filter((d) => {
      if (!d.type) return false;
      if (strip0x(d.type.codeHash).toLowerCase() !== expectedCode) return false;
      if (d.type.hashType !== spec.hashType) return false;
      const args = strip0x(d.type.args).toLowerCase();
      // v2 type args: 66 bytes = 132 hex chars; type_id_value at chars 68..132
      if (args.length !== 132) return false;
      return args.slice(68) === expectedTypeId;
    });
    if (matches.length === 0) {
      if (spec.required) throw new MissingRegistryCellDepError();
    } else if (matches.length > 1) {
      throw new AmbiguousRegistryCellDepError();
    } else {
      const dep = matches[0];
      if (dep !== undefined) resolved.push(dep);
    }
  }
  return resolved;
}

function parseGovernanceHeader(data: Uint8Array, offset: number): GovernanceHeader {
  if (offset + 3 > data.length) throw new InvalidRegistryDataError();
  const ghVersion = readU8(data, offset);
  const signerCount = readU8(data, offset + 1);
  const threshold = readU8(data, offset + 2);
  let pos = offset + 3;
  if (pos + 33 * signerCount + 2 + 32 > data.length) throw new InvalidRegistryDataError();
  const pubkeys: Uint8Array[] = [];
  for (let i = 0; i < signerCount; i++) {
    pubkeys.push(data.slice(pos, pos + 33));
    pos += 33;
  }
  const validatorCount = (readU8(data, pos) | (readU8(data, pos + 1) << 8)) >>> 0;
  pos += 2;
  const validatorMerkleRoot = data.slice(pos, pos + 32);
  return { version: ghVersion, signerCount, threshold, pubkeys, validatorCount, validatorMerkleRoot };
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
  if (version !== 0x02) {
    throw new InvalidRegistryDataError();
  }

  if (data.length < 7) throw new InvalidRegistryDataError();
  const govHeaderLen = (readU8(data, 5) | (readU8(data, 6) << 8)) >>> 0;
  if (data.length < 7 + govHeaderLen + 4) throw new InvalidRegistryDataError();
  const governanceHeader = parseGovernanceHeader(data, 7);
  let offset = 7 + govHeaderLen;

  const count =
    (
      readU8(data, offset) |
      (readU8(data, offset + 1) << 8) |
      (readU8(data, offset + 2) << 16) |
      (readU8(data, offset + 3) << 24)
    ) >>> 0;
  offset += 4;
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
    if (compareIdentifiers(cur.identifier, prev.identifier) <= 0) {
      throw new RegistryNotSortedError();
    }
  }

  return { version, entries, governanceHeader };
}
