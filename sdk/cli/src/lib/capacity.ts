import { hexToBytes } from "./blkl.js";

const SHANNONS_PER_CKB = 100_000_000n;

export function parseCapacity(capacity: string): bigint {
  return capacity.startsWith("0x") ? BigInt(capacity) : BigInt(capacity);
}

export function hexCapacity(value: bigint): string {
  return `0x${value.toString(16)}`;
}

// CKB occupied capacity: 8 (capacity field) + data + (32 code_hash + 1 hash_type + args) per script.
// This matches the CKB consensus formula — no molecule headers or table prefixes.
export function occupiedCapacityShannons(cell: {
  lock: { args: string };
  type: { args: string } | null;
  data: string | Uint8Array;
}): bigint {
  const lockArgsLen = hexToBytes(cell.lock.args).length;
  const typeArgsLen = cell.type ? hexToBytes(cell.type.args).length : 0;
  const dataBytes = typeof cell.data === "string" ? hexToBytes(cell.data) : cell.data;
  const occupiedBytes = 8 + dataBytes.length + (33 + lockArgsLen) + (cell.type ? 33 + typeArgsLen : 0);
  return BigInt(occupiedBytes) * SHANNONS_PER_CKB;
}
