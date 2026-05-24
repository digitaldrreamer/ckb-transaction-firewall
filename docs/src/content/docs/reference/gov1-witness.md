---
title: GOV1 Witness
description: Governance witness layout for registry update transactions — v3 format with on-chain review window enforcement.
---

`GOV1` is the governance witness payload that binds a registry update transaction to a specific proposal, vote digest, and BLKL state transition. Version `0x03` splits the payload across two `WitnessArgs` fields: the GOV1 binding goes in `input_type` and the signer entries go in `lock`. The `since` field on the governance cell input enforces the review window at consensus level.

## Quick start

```ts
import { buildGov1WitnessV3, buildGovernanceSigWitness, buildWitnessArgs, encodeAbsoluteTimestampSince } from "../lib/witness.js";

// Built by the CLI's execute command — illustrative only
const reviewWindowEndMs = BigInt(new Date(proposal.reviewWindowEndsAt).getTime());

const gov1 = buildGov1WitnessV3({
  proposalIdHash,     // Uint8Array(32)
  voteDigestHash,     // Uint8Array(32)
  oldRoot,            // Uint8Array(32) — blake2b of input registry data
  newRoot,            // Uint8Array(32) — blake2b of output registry data
  reviewWindowEndMs,  // bigint — ms since Unix epoch
});

const sigWitness = buildGovernanceSigWitness([
  { index: 0, sig: signature0 }, // Uint8Array(65)
  { index: 1, sig: signature1 },
  { index: 2, sig: signature2 },
]);

const witness = buildWitnessArgs({ lock: sigWitness, inputType: gov1 });

// The governance cell input must set `since` to enforce the review window on-chain.
const since = encodeAbsoluteTimestampSince(reviewWindowEndMs);
// Set this on the CellInput for the registry cell in the transaction.
```

## WitnessArgs.input\_type — GOV1 binding

The registry type script reads `WitnessArgs.input_type`. This field is exactly 141 bytes:

| Field | Offset | Size | Value |
|-------|--------|------|-------|
| `magic` | 0 | 4 bytes | ASCII `GOV1` (`0x47 0x4f 0x56 0x31`) |
| `version` | 4 | 1 byte | `0x03` |
| `proposal_id_hash` | 5 | 32 bytes | blake2b hash of the canonical proposal fields |
| `vote_digest_hash` | 37 | 32 bytes | blake2b hash of the sorted signed vote records |
| `old_root` | 69 | 32 bytes | blake2b of the input registry cell data |
| `new_root` | 101 | 32 bytes | blake2b of the output registry cell data |
| `review_window_end_ms` | 133 | 8 bytes | LE u64 — Unix timestamp in ms when the review window ends |

**Total: 141 bytes** (raw payload; molecule `BytesOpt` adds a 4-byte length prefix on the wire).

Neither `proposal_id_hash` nor `vote_digest_hash` may be the zero hash (`[0u8; 32]`); the type script rejects such witnesses.

### What `old_root` and `new_root` bind

`old_root = blake2b(input_registry_cell_data)` and `new_root = blake2b(output_registry_cell_data)`. The type script independently recomputes both roots from the actual cell data and rejects the transaction if they don't match what the witness claims. This prevents the witness from being replayed against a different registry state.

## CellInput.since — review window enforcement

The governance cell input's `since` field must be set to an **absolute median-time-past timestamp** encoding `review_window_end_ms`:

```text
since = 0x4000_0000_0000_0000 | review_window_end_ms
```

- Bit 63 = 0: absolute (not relative)
- Bit 62 = 1: timestamp metric (median block time)
- Bits 55–0: `review_window_end_ms` value

`governance-lock` reads this field and returns `ERR_REVIEW_WINDOW_NOT_MET (6)` if:
- The since value uses a relative flag (bit 63 = 1)
- The metric is not timestamp (bit 62 ≠ 1)
- The encoded timestamp is less than `review_window_end_ms` from the GOV1 payload

Because `review_window_end_ms` is included in the signing preimage, it cannot be tampered with after governance signers have signed.

## WitnessArgs.lock — Governance signer entries

The governance-lock script reads `WitnessArgs.lock`. This field encodes the multi-signature:

| Field | Size | Value |
|-------|------|-------|
| `signer_count` | 1 byte | number of signing entries |
| `signer_entries` | `signer_count × 66` bytes | see below |

Each signer entry is 66 bytes:

| Field | Size | Value |
|-------|------|-------|
| `signer_index` | 1 byte | index into the governance header's `pubkeys` array (0-based) |
| `signature` | 65 bytes | `r(32) \|\| s(32) \|\| recovery_id(1)` — compact secp256k1 signature |

**Example size** for 3-of-5 multisig: `1 + 3 × 66` = **199 bytes**.

### Signing message

The governance-lock computes the message each signer must have signed as:

```
signing_message = blake2b(proposal_id_hash || vote_digest_hash || old_root || new_root || review_window_end_ms)
```

This is a 136-byte preimage hashed down to 32 bytes. By including `old_root`, `new_root`, and `review_window_end_ms` in the preimage, each signer explicitly commits to the exact registry state transition and the review window end time. It is impossible to reuse signatures from one proposal against a different registry output or a shorter review window.

## Vote digest

`vote_digest_hash` commits to the complete set of validator votes. It is computed as:

```
vote_digest_hash = blake2b(JSON.stringify(votes.sort_by(pubkey).map({ pubkey, vote, timestamp, signature })))
```

Each `ProposalVote` record carries:
- `pubkey` — 33-byte compressed secp256k1 public key of the validator
- `vote` — `"yes"`, `"no"`, or `"abstain"`
- `timestamp` — ISO 8601 string
- `signature` — 65-byte secp256k1 signature over `blake2b(JSON({domain, proposalIdHash, vote, timestamp, pubkey}))`
- `merkleLeafIndex` + `merkleProof` — Merkle membership proof against the on-chain `validator_merkle_root`

The `execute` command recomputes `vote_digest_hash` from the stored votes and aborts if it doesn't match the value stored in the proposal file.

## Validation responsibilities

| Check | Performed by |
|-------|-------------|
| GOV1 magic and version | Registry type script (on-chain) |
| `old_root` / `new_root` match actual cell data | Registry type script (on-chain) |
| `proposal_id_hash` / `vote_digest_hash` non-zero | Registry type script (on-chain) |
| Each signer signature valid against committee pubkey | Governance-lock script (on-chain) |
| Threshold (≥ N-of-M valid signatures) | Governance-lock script (on-chain) |
| `since` encodes absolute timestamp ≥ `review_window_end_ms` | Governance-lock script (on-chain) |
| Each vote signature valid against voter pubkey | CLI `execute` (off-chain, pre-submission) |
| Each vote pubkey in validator Merkle set | CLI `execute` (off-chain, pre-submission) |
| `vote_digest_hash` recomputed from votes matches stored | CLI `execute` (off-chain, pre-submission) |
| Governance signer signatures match on-chain pubkeys | CLI `execute` (off-chain, pre-submission) |

## Reference

- Witness builder: `sdk/cli/src/lib/witness.ts` — `buildGov1WitnessV3`, `buildGovernanceSigWitness`, `buildWitnessArgs`, `encodeAbsoluteTimestampSince`
- Proposal types: `sdk/cli/src/lib/proposals.ts` — `ProposalVote`, `computeVoteDigestHash`, `signingMessage`, `voteSigningMessage`
- On-chain GOV1 parser: `contracts/blacklist-registry/src/main.rs` — `GovernanceWitness::parse`
- On-chain signer verifier + since check: `contracts/governance-lock/src/main.rs` — `program_entry`, `verify_since_timestamp`
