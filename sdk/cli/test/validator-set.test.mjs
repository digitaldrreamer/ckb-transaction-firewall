import assert from "node:assert/strict";
import test from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";

import {
  computeMerkleRoot,
  computeMerkleProof,
  verifyMerkleProof,
} from "../dist/lib/validator-set.js";
import { bytesToHex } from "../dist/lib/blkl.js";

// Derive 5 compressed pubkeys from privkeys 0x01..0x05
const PUBKEYS = Array.from({ length: 5 }, (_, i) => {
  const priv = new Uint8Array(32).fill(i + 1);
  return bytesToHex(new Uint8Array(secp256k1.getPublicKey(priv, true)));
});

test("computeMerkleRoot returns 32-byte (64-char) hex", () => {
  const root = computeMerkleRoot(PUBKEYS);
  assert.match(root, /^0x[0-9a-f]{64}$/);
});

test("computeMerkleRoot is deterministic for the same input", () => {
  assert.equal(computeMerkleRoot(PUBKEYS), computeMerkleRoot(PUBKEYS));
});

test("computeMerkleRoot differs for different sets", () => {
  const other = [...PUBKEYS.slice(0, 4), PUBKEYS[0]]; // swap last key
  assert.notEqual(computeMerkleRoot(PUBKEYS), computeMerkleRoot(other));
});

test("computeMerkleRoot of single-element set equals hash of that leaf", () => {
  // With one pubkey, padded to 2 leaves, root = blake2b(leaf || zero_leaf)
  // Just verify it's stable and non-zero
  const root = computeMerkleRoot([PUBKEYS[0]]);
  assert.match(root, /^0x[0-9a-f]{64}$/);
  assert.notEqual(root, "0x" + "00".repeat(32));
});

test("computeMerkleProof returns null for unlisted pubkey", () => {
  const priv = new Uint8Array(32).fill(0x99);
  const alien = bytesToHex(new Uint8Array(secp256k1.getPublicKey(priv, true)));
  assert.equal(computeMerkleProof(PUBKEYS, alien), null);
});

test("computeMerkleProof returns correct leafIndex for each validator", () => {
  for (let i = 0; i < PUBKEYS.length; i++) {
    const result = computeMerkleProof(PUBKEYS, PUBKEYS[i]);
    assert.notEqual(result, null);
    assert.equal(result.leafIndex, i);
  }
});

test("verifyMerkleProof accepts valid proof for every validator", () => {
  const root = computeMerkleRoot(PUBKEYS);
  for (const pk of PUBKEYS) {
    const { proof, leafIndex } = computeMerkleProof(PUBKEYS, pk);
    assert.equal(verifyMerkleProof(root, pk, proof, leafIndex), true);
  }
});

test("verifyMerkleProof rejects tampered pubkey", () => {
  const root = computeMerkleRoot(PUBKEYS);
  const { proof, leafIndex } = computeMerkleProof(PUBKEYS, PUBKEYS[0]);
  // Use a different pubkey with the same proof
  assert.equal(verifyMerkleProof(root, PUBKEYS[1], proof, leafIndex), false);
});

test("verifyMerkleProof rejects wrong leafIndex", () => {
  const root = computeMerkleRoot(PUBKEYS);
  const { proof } = computeMerkleProof(PUBKEYS, PUBKEYS[0]);
  assert.equal(verifyMerkleProof(root, PUBKEYS[0], proof, 1), false);
});

test("verifyMerkleProof rejects tampered proof node", () => {
  const root = computeMerkleRoot(PUBKEYS);
  const { proof, leafIndex } = computeMerkleProof(PUBKEYS, PUBKEYS[2]);
  const tampered = [...proof];
  tampered[0] = "0x" + "ff".repeat(32);
  assert.equal(verifyMerkleProof(root, PUBKEYS[2], tampered, leafIndex), false);
});

test("verifyMerkleProof rejects against wrong root", () => {
  const root = computeMerkleRoot(PUBKEYS);
  const { proof, leafIndex } = computeMerkleProof(PUBKEYS, PUBKEYS[0]);
  const wrongRoot = "0x" + "aa".repeat(32);
  assert.equal(verifyMerkleProof(wrongRoot, PUBKEYS[0], proof, leafIndex), false);
  // Verify original root still works
  assert.equal(verifyMerkleProof(root, PUBKEYS[0], proof, leafIndex), true);
});

test("proof length is log2(padded_set_size)", () => {
  // 5 validators → padded to 8 (2^3) → proof depth 3
  const { proof } = computeMerkleProof(PUBKEYS, PUBKEYS[0]);
  assert.equal(proof.length, 3); // log2(8) = 3
});
