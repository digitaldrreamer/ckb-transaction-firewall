import assert from "node:assert/strict";
import test from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";

// Import compiled dist
import {
  voteSigningMessage,
  computeVoteDigestHash,
} from "../dist/lib/proposals.js";
import { bytesToHex, hexToBytes } from "../dist/lib/blkl.js";

// Helpers shared across tests
const FAKE_PROPOSAL_ID_HASH = "0x" + "ab".repeat(32);
const PRIVATE_KEY = new Uint8Array(32).fill(0x07);
const PUBKEY_BYTES = secp256k1.getPublicKey(PRIVATE_KEY, true); // 33 bytes compressed
const PUBKEY = bytesToHex(new Uint8Array(PUBKEY_BYTES));

function signVote(proposalIdHash, vote, timestamp, pubkey, privKey) {
  const msgHash = voteSigningMessage(proposalIdHash, vote, timestamp, pubkey);
  const sigRaw = secp256k1.sign(msgHash, privKey, { lowS: true, format: "recovered" });
  // Store as [r(32), s(32), recovery_id(1)]
  const sigBytes = new Uint8Array(65);
  sigBytes.set(sigRaw.slice(1), 0);
  sigBytes[64] = sigRaw[0] ?? 0;
  return bytesToHex(sigBytes);
}

function recoverVotePubkey(signature, proposalIdHash, vote, timestamp, pubkey) {
  const sigBytes = hexToBytes(signature);
  const msgHash = voteSigningMessage(proposalIdHash, vote, timestamp, pubkey);
  // Rebuild [recovery_id, r, s] from [r, s, recovery_id]
  const sig65 = new Uint8Array(65);
  sig65[0] = sigBytes[64] ?? 0;
  sig65.set(sigBytes.slice(0, 64), 1);
  return bytesToHex(new Uint8Array(secp256k1.recoverPublicKey(sig65, msgHash)));
}

test("vote signing message is deterministic for the same inputs", () => {
  const m1 = voteSigningMessage(FAKE_PROPOSAL_ID_HASH, "yes", "2026-05-19T00:00:00.000Z", PUBKEY);
  const m2 = voteSigningMessage(FAKE_PROPOSAL_ID_HASH, "yes", "2026-05-19T00:00:00.000Z", PUBKEY);
  assert.deepEqual(m1, m2);
  assert.equal(m1.length, 32); // blake2b output
});

test("vote signing message differs across votes, proposals, and pubkeys", () => {
  const base = voteSigningMessage(FAKE_PROPOSAL_ID_HASH, "yes", "2026-05-19T00:00:00.000Z", PUBKEY);
  const diffVote = voteSigningMessage(FAKE_PROPOSAL_ID_HASH, "no", "2026-05-19T00:00:00.000Z", PUBKEY);
  const diffProp = voteSigningMessage("0x" + "cd".repeat(32), "yes", "2026-05-19T00:00:00.000Z", PUBKEY);
  const diffPubkey = voteSigningMessage(FAKE_PROPOSAL_ID_HASH, "yes", "2026-05-19T00:00:00.000Z", "0x" + "02" + "ff".repeat(32));

  assert.notDeepEqual(base, diffVote);
  assert.notDeepEqual(base, diffProp);
  assert.notDeepEqual(base, diffPubkey);
});

test("sign-then-recover round-trip returns the original pubkey", () => {
  const timestamp = "2026-05-19T12:00:00.000Z";
  const signature = signVote(FAKE_PROPOSAL_ID_HASH, "yes", timestamp, PUBKEY, PRIVATE_KEY);
  const recovered = recoverVotePubkey(signature, FAKE_PROPOSAL_ID_HASH, "yes", timestamp, PUBKEY);
  assert.equal(recovered, PUBKEY);
});

test("recovery fails to match when vote field is tampered", () => {
  const timestamp = "2026-05-19T12:00:00.000Z";
  const signature = signVote(FAKE_PROPOSAL_ID_HASH, "yes", timestamp, PUBKEY, PRIVATE_KEY);
  // Tamper: recover with a different vote choice
  const recovered = recoverVotePubkey(signature, FAKE_PROPOSAL_ID_HASH, "no", timestamp, PUBKEY);
  assert.notEqual(recovered, PUBKEY);
});

test("recovery fails to match when proposalIdHash is tampered", () => {
  const timestamp = "2026-05-19T12:00:00.000Z";
  const signature = signVote(FAKE_PROPOSAL_ID_HASH, "yes", timestamp, PUBKEY, PRIVATE_KEY);
  const recovered = recoverVotePubkey(signature, "0x" + "00".repeat(32), "yes", timestamp, PUBKEY);
  assert.notEqual(recovered, PUBKEY);
});

test("computeVoteDigestHash is deterministic and order-independent", () => {
  const ts1 = "2026-05-19T10:00:00.000Z";
  const ts2 = "2026-05-19T11:00:00.000Z";
  const priv2 = new Uint8Array(32).fill(0x08);
  const pub2 = bytesToHex(new Uint8Array(secp256k1.getPublicKey(priv2, true)));

  const sig1 = signVote(FAKE_PROPOSAL_ID_HASH, "yes", ts1, PUBKEY, PRIVATE_KEY);
  const sig2 = signVote(FAKE_PROPOSAL_ID_HASH, "no", ts2, pub2, priv2);

  const votes_a = [
    { pubkey: PUBKEY, vote: "yes", timestamp: ts1, signature: sig1 },
    { pubkey: pub2, vote: "no", timestamp: ts2, signature: sig2 },
  ];
  const votes_b = [
    { pubkey: pub2, vote: "no", timestamp: ts2, signature: sig2 },
    { pubkey: PUBKEY, vote: "yes", timestamp: ts1, signature: sig1 },
  ];

  assert.equal(computeVoteDigestHash(votes_a), computeVoteDigestHash(votes_b));
});

test("computeVoteDigestHash changes when a vote signature is altered", () => {
  const ts = "2026-05-19T10:00:00.000Z";
  const sig = signVote(FAKE_PROPOSAL_ID_HASH, "yes", ts, PUBKEY, PRIVATE_KEY);

  const original = [{ pubkey: PUBKEY, vote: "yes", timestamp: ts, signature: sig }];
  const tampered = [{ pubkey: PUBKEY, vote: "yes", timestamp: ts, signature: "0x" + "ff".repeat(65) }];

  assert.notEqual(computeVoteDigestHash(original), computeVoteDigestHash(tampered));
});
