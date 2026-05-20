---
title: Governance
description: The proposal, vote, sign, and execute lifecycle for blacklist updates.
---

Every change to the blacklist goes through governance. The flow is auditable and reviewable by design — not fast.

## Lifecycle

```text
propose → export → [share] → import → vote → sign → execute
```

Each step produces an artifact that the next step consumes. The proposal file is the single source of truth that travels between participants.

## Steps

**1. Propose**  
One participant creates a proposal with the lock args, threat classification, evidence, and rationale. A `proposalIdHash` is computed from all fields together — no field can be changed afterward without invalidating the hash. The 72-hour review window starts immediately.

**2. Export and share**  
The proposer exports the proposal JSON and sends it to the rest of the governance committee out-of-band (email, Signal, IPFS CID, etc.).

**3. Import**  
Each participant imports the file. If a proposal already exists locally, votes and signatures are merged rather than overwritten. This is how vote state accumulates across multiple parties without a shared server.

**4. Vote**  
Each validator votes using their secp256k1 private key. The vote payload is cryptographically signed — the signature and a Merkle membership proof against the on-chain validator set are stored with the vote. The `vote` command rejects keys that are not in the authorized validator set.

**5. Sign**  
After the 72-hour review window passes and the vote threshold is met (3-of-5 yes votes by default), governance signers add their secp256k1 signatures. Signatures cover the `proposalIdHash` and `voteDigestHash` — if either has been tampered with, the signature will fail on-chain.

**6. Execute**  
The `execute` command:
- Recomputes the `voteDigestHash` from stored votes and checks it matches
- Verifies every vote signature against the voter's public key
- Verifies every vote pubkey is in the on-chain validator Merkle set
- Verifies every governance signer signature against the on-chain committee pubkeys from the BLKL governance header
- Builds the GOV1 v2 witness and fetches the live registry cell
- Produces a signed transaction ready for `ckb-cli` submission

## On-chain validation

The registry type script (`blacklist-registry`) validates:
- BLKL v2 payload structure and entry sort order
- GOV1 v2 witness binding (old\_root, new\_root, proposal and vote hashes non-zero)
- Governance-lock identity on the output registry cell

The governance-lock script validates:
- Signer count meets the threshold
- Each signer's recovered pubkey matches the committee pubkey at that index (read from the BLKL governance header)

Vote signature verification is off-chain — the `execute` command performs it before submitting.

## Timing constraints

The minimum realistic timeline is approximately **120 hours**:
- 72 hours review window (mandatory, enforced on-chain via the GOV1 timestamp)
- Time for validators to vote (varies)
- Time for signers to sign (varies)

Temporary blacklist entries (`expiresAt` set) should be given at least this much runway. The CLI warns at proposal creation time if the expiry window is shorter than the governance timeline.
