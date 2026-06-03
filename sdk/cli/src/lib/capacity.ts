import { hexToBytes, scriptToMoleculeBytes } from "./blkl.js";

const SHANNONS_PER_CKB = 100_000_000n;

export function parseCapacity(capacity: string): bigint {
  return capacity.startsWith("0x") ? BigInt(capacity) : BigInt(capacity);
}

export function hexCapacity(value: bigint): string {
  return `0x${value.toString(16)}`;
}

export function occupiedCapacityShannons(cell: {
  lock: { code_hash?: string; codeHash?: string; hash_type?: string; hashType?: string; args: string };
  type: { code_hash?: string; codeHash?: string; hash_type?: string; hashType?: string; args: string } | null;
  data: string | Uint8Array;
}): bigint {
  const lockBytes = scriptToMoleculeBytes(cell.lock);
  const typeBytes = cell.type ? scriptToMoleculeBytes(cell.type) : new Uint8Array();
  const dataBytes = typeof cell.data === "string" ? hexToBytes(cell.data) : cell.data;
  const cellOutputBytes = 16 + 8 + lockBytes.length + typeBytes.length;
  return BigInt(cellOutputBytes + dataBytes.length) * SHANNONS_PER_CKB;
}
