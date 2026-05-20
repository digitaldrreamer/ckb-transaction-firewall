import { ckbBlake2b } from "./witness.js";
import { hexToBytes, bytesToHex } from "./blkl.js";

// Binary Merkle tree over validator pubkeys using CKB blake2b.
// Leaves = ckbBlake2b(compressed_pubkey_33_bytes) in list order.
// Internal node = ckbBlake2b(left || right) in fixed order.
// Tree is padded to the next power of 2 with zero-filled leaves.

const ZERO_LEAF = new Uint8Array(32);

function nextPow2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function merkleLeaf(pubkeyHex: string): Uint8Array {
  return ckbBlake2b(hexToBytes(pubkeyHex));
}

function merkleNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(64);
  combined.set(left, 0);
  combined.set(right, 32);
  return ckbBlake2b(combined);
}

function buildLayer(pubkeys: string[]): Uint8Array[] {
  const n = nextPow2(pubkeys.length);
  const layer: Uint8Array[] = pubkeys.map(merkleLeaf);
  while (layer.length < n) layer.push(ZERO_LEAF);
  return layer;
}

export function computeMerkleRoot(pubkeys: string[]): string {
  if (pubkeys.length === 0) return bytesToHex(ZERO_LEAF);
  let layer = buildLayer(pubkeys);
  while (layer.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(merkleNode(layer[i]!, layer[i + 1]!));
    }
    layer = next;
  }
  return bytesToHex(layer[0]!);
}

// Returns { proof, leafIndex } if pubkeyHex is in the set, or null if absent.
export function computeMerkleProof(
  pubkeys: string[],
  pubkeyHex: string,
): { proof: string[]; leafIndex: number } | null {
  const leafIndex = pubkeys.findIndex(
    (pk) => pk.toLowerCase() === pubkeyHex.toLowerCase(),
  );
  if (leafIndex === -1) return null;

  let layer = buildLayer(pubkeys);
  const proof: string[] = [];
  let idx = leafIndex;

  while (layer.length > 1) {
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    proof.push(bytesToHex(layer[siblingIdx]!));
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(merkleNode(layer[i]!, layer[i + 1]!));
    }
    layer = next;
    idx = Math.floor(idx / 2);
  }
  return { proof, leafIndex };
}

// Verifies that pubkeyHex at leafIndex is in the tree whose root is rootHex.
export function verifyMerkleProof(
  rootHex: string,
  pubkeyHex: string,
  proof: string[],
  leafIndex: number,
): boolean {
  let current = merkleLeaf(pubkeyHex);
  let idx = leafIndex;
  for (const siblingHex of proof) {
    const sibling = hexToBytes(siblingHex);
    current = idx % 2 === 0
      ? merkleNode(current, sibling)
      : merkleNode(sibling, current);
    idx = Math.floor(idx / 2);
  }
  return bytesToHex(current).toLowerCase() === rootHex.toLowerCase();
}
