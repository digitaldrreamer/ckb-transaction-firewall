---
title: GOV1 Witness
description: Governance witness layout for registry update transactions - v4 format with on-chain proposal timing.
---

`GOV1` is the governance witness payload that binds a registry update transaction to a specific proposal, vote digest, BLKL state transition, and on-chain proposal cell. Version `0x04` splits the transaction evidence across:

- `WitnessArgs.input_type`: the GOV1 v4 binding
- `WitnessArgs.lock`: validator yes-vote entries with signatures and Merkle proofs
- A live `PBLK` proposal input cell: the on-chain anchor whose relative `since` enforces the review delay

## Quick start

```ts
import {
  buildGov1WitnessV4,
  buildValidatorVoteWitness,
  buildWitnessArgs,
  encodeRelativeTimestampSince,
} from "../lib/witness.js";

const gov1 = buildGov1WitnessV4({
  proposalIdHash,    // Uint8Array(32)
  voteDigestHash,    // Uint8Array(32)
  oldRoot,           // Uint8Array(32), blake2b(input registry data)
  newRoot,           // Uint8Array(32), blake2b(output registry data)
  proposalDataHash,  // Uint8Array(32), blake2b(PBLK proposal cell data)
  reviewDelayMs,     // bigint, default 72h in milliseconds
});

const voteWitness = buildValidatorVoteWitness([
  {
    pubkey,
    vote: "yes",
    timestamp,
    signature,
    merkleLeafIndex,
    merkleProof,
  },
]);

const witness = buildWitnessArgs({ lock: voteWitness, inputType: gov1 });

// Set this on the PBLK proposal input, not the registry input.
const since = encodeRelativeTimestampSince(reviewDelayMs);
```

## WitnessArgs.input_type - GOV1 binding

The registry type script reads `WitnessArgs.input_type`. This field is exactly 173 bytes:

| Field | Offset | Size | Value |
|-------|--------|------|-------|
| `magic` | 0 | 4 bytes | ASCII `GOV1` (`0x47 0x4f 0x56 0x31`) |
| `version` | 4 | 1 byte | `0x04` |
| `proposal_id_hash` | 5 | 32 bytes | blake2b hash of the canonical proposal fields |
| `vote_digest_hash` | 37 | 32 bytes | blake2b hash of the sorted signed vote records |
| `old_root` | 69 | 32 bytes | blake2b of the input registry cell data |
| `new_root` | 101 | 32 bytes | blake2b of the output registry cell data |
| `proposal_data_hash` | 133 | 32 bytes | blake2b of the `PBLK` proposal cell data |
| `review_delay_ms` | 165 | 8 bytes | LE u64 review delay in milliseconds |

**Total: 173 bytes** (raw payload; molecule `BytesOpt` adds a 4-byte length prefix on the wire).

Neither `proposal_id_hash` nor `vote_digest_hash` may be the zero hash (`[0u8; 32]`).

## PBLK proposal cell

Every registry update must include a live input cell whose data hashes to `proposal_data_hash`. The `blacklist-registry` type script parses that cell data and requires the registry transition to exactly match the proposal.

`PBLK` v1 cell data layout for blacklist entry updates:

| Field | Offset | Size | Value |
|-------|--------|------|-------|
| `magic` | 0 | 4 bytes | ASCII `PBLK` (`0x50 0x42 0x4c 0x4b`) |
| `version` | 4 | 1 byte | `0x01` |
| `registry_type_id_value` | 5 | 32 bytes | Registry Type ID value this proposal targets |
| `action` | 37 | 1 byte | `0x01` add, `0x02` remove |
| `identifier_len` | 38 | 1 byte | length of the lock-args identifier |
| `identifier` | 39 | variable | lock args to add or remove |
| `expires_at` | after identifier | 8 bytes | LE u64 Unix timestamp in seconds, or `0` for permanent |
| `evidence_hash` | final 32 bytes | 32 bytes | blake2b hash of the evidence text |

`PBLK` v2 cell data layout for registry treasury metadata:

| Field | Offset | Size | Value |
|-------|--------|------|-------|
| `magic` | 0 | 4 bytes | ASCII `PBLK` (`0x50 0x42 0x4c 0x4b`) |
| `version` | 4 | 1 byte | `0x02` |
| `registry_type_id_value` | 5 | 32 bytes | Registry Type ID value this proposal targets |
| `action` | 37 | 1 byte | `0x03` set treasury |
| `treasury_lock_hash` | 38 | 32 bytes | blake2b hash of the treasury lock script |
| `evidence_hash` | 70 | 32 bytes | blake2b hash of the evidence text |

The registry script rejects the transaction if:

- The proposal cell is missing
- More than one input cell has the same `proposal_data_hash`
- The proposal targets a different registry Type ID
- The BLKL output contains any change beyond the proposed add/remove transition, or for `set-treasury`, changes blacklist entries or sets a treasury lock hash that does not match the proposal

## CellInput.since - review delay

The `governance-lock` script finds the proposal input by `proposal_data_hash` and checks that input's `since` field. The value must encode a **relative median-time-past delay** greater than or equal to `review_delay_ms`:

```text
since = 0x8000_0000_0000_0000 | 0x4000_0000_0000_0000 | review_delay_ms
```

- Bit 63 = 1: relative lock
- Bit 62 = 1: timestamp metric (median block time)
- Bits 55-0: delay in milliseconds

CKB consensus enforces that the proposal input is old enough before the transaction can be included in a block. The lock script rejects absolute timestamps, block-number locks, epoch locks, and delay values shorter than `review_delay_ms`.

## WitnessArgs.lock - validator vote entries

The governance-lock script reads `WitnessArgs.lock`:

| Field | Size | Value |
|-------|------|-------|
| `vote_count` | 1 byte | number of yes-vote entries submitted for execution |
| `vote_entries` | variable | repeated validator vote entries |

Each validator vote entry is:

| Field | Size | Value |
|-------|------|-------|
| `pubkey` | 33 bytes | compressed secp256k1 validator public key |
| `vote` | 1 byte | must be `0x01` (`yes`) for execution |
| `timestamp_len` | 2 bytes `u16` | byte length of the timestamp string |
| `timestamp` | variable | UTF-8 timestamp included in the signed vote payload |
| `signature` | 65 bytes | `r(32) || s(32) || recovery_id(1)` compact secp256k1 signature |
| `merkle_leaf_index` | 4 bytes `u32` | validator leaf index in the BLKL validator tree |
| `proof_count` | 1 byte | number of sibling hashes in the Merkle proof |
| `proof` | `proof_count * 32` bytes | sibling hashes from leaf to root |

## Vote signing message

The governance-lock recomputes the canonical JSON message each validator yes-vote must have signed:

```json
{
  "domain": "ckb-firewall:vote",
  "proposalIdHash": "0x...",
  "vote": "yes",
  "timestamp": "2026-06-01T00:00:00.000Z",
  "pubkey": "0x..."
}
```

This JSON string is hashed with CKB blake2b before secp256k1 recovery. The recovered compressed public key must match the vote entry's `pubkey`, and that pubkey must prove membership in the BLKL validator Merkle root.

## Vote digest

`vote_digest_hash` commits to the complete set of validator votes:

```text
vote_digest_hash = blake2b(JSON.stringify(votes.sort_by(pubkey).map({ pubkey, vote, timestamp, signature })))
```

Each vote carries:

- `pubkey`: 33-byte compressed secp256k1 public key
- `vote`: `"yes"`, `"no"`, or `"abstain"`
- `timestamp`: ISO 8601 string
- `signature`: 65-byte secp256k1 signature over the vote payload
- `merkleLeafIndex` and `merkleProof`: membership proof against the on-chain validator Merkle root

The `execute` command recomputes `vote_digest_hash` from stored votes and aborts if it does not match the proposal file.

## Validation responsibilities

| Check | Performed by |
|-------|-------------|
| GOV1 magic, version, and length | Registry type script and governance-lock script |
| `old_root` / `new_root` match actual registry cell data | Registry type script |
| `PBLK` proposal input exists and is unique | Registry type script and governance-lock script |
| Proposed add/remove is the only BLKL transition | Registry type script |
| Proposal input `since` is relative MTP delay >= `review_delay_ms` | Governance-lock script |
| Each yes-vote signature valid for the stated validator pubkey | Governance-lock script |
| Each validator pubkey proves membership in the BLKL validator Merkle root | Governance-lock script |
| Threshold met | Governance-lock script |
| Vote digest integrity | CLI `execute`, before submission |

## Reference

- Witness builder: `sdk/cli/src/lib/witness.ts` - `buildGov1WitnessV4`, `buildValidatorVoteWitness`, `buildWitnessArgs`, `encodeRelativeTimestampSince`
- Proposal-cell helpers: `sdk/cli/src/lib/governance-v4.ts` - `encodeProposalCellData`, `proposalCellDataHash`
- Proposal types: `sdk/cli/src/lib/proposals.ts` - `ProposalVote`, `computeVoteDigestHash`, `voteSigningMessage`
- On-chain GOV1 parser: `contracts/blacklist-registry/src/main.rs` - `GovernanceWitness::parse`
- On-chain validator vote verifier and relative-since check: `contracts/governance-lock/src/main.rs` - `program_entry`, `verify_relative_since_timestamp`

## See also

- [Governance design](/concepts/governance-design/) — why the witness layout is structured this way
- [PBLK Proposal Cell](/reference/pblk-cell/) — the proposal cell that the GOV1 witness references
- [How to execute an approved proposal](/how-to/execute-proposal/) — build and submit the governance transaction
- [How to vote on a proposal](/how-to/vote-on-proposal/) — produce the validator vote entries
- [Fix: vote digest mismatch](/how-to/fix-vote-digest-mismatch/) — recover from an inconsistent voteDigestHash
