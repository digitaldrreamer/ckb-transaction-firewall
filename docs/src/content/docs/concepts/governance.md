---
title: Governance
description: The proposal, vote, and execute lifecycle for blacklist updates.
---

Every change to the blacklist goes through governance. The flow is auditable and reviewable by design — not fast.

## Lifecycle

```text
propose → anchor → export → [share] → import → vote → execute
```

Each step produces an artifact that the next step consumes. The proposal file is the single source of truth that travels between participants.

## Steps

**1. Propose**
One participant creates a proposal with the lock args, threat classification, evidence, and rationale. A `proposalIdHash` is computed from all fields together — no field can be changed afterward without invalidating the hash. The 72-hour review window starts immediately.

**2. Anchor**
The proposal is anchored on-chain as a `PBLK` proposal cell. This cell commits to the registry Type ID, action, identifier, expiry, and evidence hash. The final governance transaction spends this cell with a relative median-time-past `since` delay, so the review window is enforced by CKB consensus and by the governance-lock.

In the production model, anchor cells are funded by the registry treasury, not by proposers or validators. See [Registry treasury](/concepts/registry-treasury/).

**3. Export and share**
The proposer exports the proposal JSON and sends it to the rest of the governance committee out-of-band (email, Signal, IPFS CID, etc.).

**4. Import**
Each participant imports the file. If a proposal already exists locally, votes are merged rather than overwritten. This is how vote state accumulates across multiple parties without a shared server.

**5. Vote**
Each validator votes using their secp256k1 private key. The vote payload is cryptographically signed — the signature and a Merkle membership proof against the on-chain validator set are stored with the vote. The `vote` command rejects keys that are not in the authorized validator set.

**6. Execute**
The `execute` command:
- Recomputes the `voteDigestHash` from stored votes and checks it matches
- Verifies every vote signature against the voter's public key
- Verifies every vote pubkey is in the on-chain validator Merkle set
- Fetches the live registry cell and the anchored `PBLK` proposal cell
- Builds the GOV1 v4 witness
- Includes the threshold yes-vote signatures and Merkle proofs for on-chain verification
- Sets relative timestamp `since` on the proposal input to enforce the review delay at consensus level
- Produces a signed transaction ready for `ckb-cli` submission

## On-chain validation

The registry type script (`blacklist-registry`) validates:
- BLKL v2 payload structure and entry sort order
- GOV1 v4 witness binding: `old_root`/`new_root` consistency with actual cell data; `proposal_id_hash` and `vote_digest_hash` non-zero
- The `PBLK` proposal input exists, targets this registry, and matches the single add/remove transition
- Governance-lock identity on the output registry cell

The governance-lock script validates:
- The proposal input's `since` field encodes a relative median-time-past delay >= `review_delay_ms` from the GOV1 payload
- The number of valid yes-votes meets the threshold
- Each yes-vote's ECDSA signature recovers to the claimed public key
- Each voter's public key is a member of the validator Merkle set (from the BLKL governance header)

## Timing constraints

The minimum realistic timeline is approximately **96 hours**:
- 72 hours review window (mandatory, enforced on-chain via the anchored proposal input's relative `CellInput.since` and the GOV1 `review_delay_ms` field)
- Time for validators to cast threshold yes-votes (varies)

Temporary blacklist entries (`expiresAt` set) should be given at least this much runway. The CLI warns at proposal creation time if the expiry window is shorter than the governance timeline.
