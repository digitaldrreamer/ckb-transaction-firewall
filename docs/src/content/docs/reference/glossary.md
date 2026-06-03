---
title: Glossary
description: Definitions for terms, acronyms, and concepts specific to the CKB Transaction Firewall.
---

Terms are grouped by topic. General CKB and blockchain concepts are omitted; this page only covers terminology specific to this project.

---

## Binary formats

### BLKL

The binary payload format stored in the live registry cell. The name is the 4-byte ASCII magic (`0x42 0x4c 0x4b 0x4c`). The current version is **v2**.

Layout:

```
magic           4 bytes  0x42 0x4c 0x4b 0x4c  ("BLKL")
version         1 byte   must be 0x02
gov_header_len  2 bytes  LE u16
gov_header      N bytes  see governance header
entry_count     4 bytes  LE u32
entries         variable sorted ascending; each entry is lock/type args + optional expiry
```

Full spec: [BLKL Format](/reference/blkl-format/)

### GOV1

The governance witness payload that binds a registry update transaction to a specific proposal, vote digest, BLKL state transition, and anchored proposal cell. The current version is **v4**.

Layout (173 bytes total):

```
magic                4 bytes  "GOV1"
version              1 byte   0x04
proposal_id_hash    32 bytes
vote_digest_hash    32 bytes
old_root            32 bytes  blake2b of input registry cell data
new_root            32 bytes  blake2b of output registry cell data
proposal_data_hash  32 bytes  blake2b of PBLK proposal cell data
review_delay_ms      8 bytes  LE u64, relative delay in milliseconds
```

Placed in `WitnessArgs.input_type`. Signer entries go in `WitnessArgs.lock`.

Full spec: [GOV1 Witness](/reference/gov1-witness/)

### FirewallLockArgs

The binary encoding of a firewall lock's configuration stored in the lock script `args` field. The current version is **v2**.

Layout:

```
version          1 byte   0x02
flags            1 byte   bit 0 = check lock_args, bit 1 = check type_args
registry_count   1 byte   0–255
registry_specs   66 bytes × N  (see RegistrySpec)
inner_code_hash 32 bytes
inner_hash_type  1 byte
inner_args_len   2 bytes  LE u16
inner_args       variable
```

Full spec: [Firewall Lock Args](/reference/firewall-lock-args/)

---

## Contracts

### blacklist-registry

The CKB **type script** that validates every registry cell update. Enforces: correct BLKL v2 payload structure, strict ascending entry sort order, governance-lock identity on the output cell, valid GOV1 v4 witness binding, and an exact match to the anchored `PBLK` proposal cell. Its Type ID is the stable registry identity — the `type_id_value` in the registry type args never changes across governance updates.

### firewall-lock

The CKB **lock script** that enforces blacklist checks at consensus. Runs when a firewall-protected cell is consumed. It scans cell deps for registry cells matching the configured specs, parses the BLKL v2 payload, checks each transaction output's lock args and/or type args against the blacklist, and spawns the inner lock if all checks pass. Fail-closed: any validation failure rejects the transaction.

### governance-lock

The CKB **lock script** that secures the registry cell itself. Validates that a registry update carries enough validator yes-votes, that each vote signature matches a validator pubkey committed by the BLKL validator Merkle root, and that the anchored `PBLK` proposal input's `since` field encodes a relative median-time-past delay of at least `review_delay_ms`.

### spawn-aware-secp256k1

The canonical inner lock for standard secp256k1-blake160 wallets. Unlike a regular lock, it receives its arguments via `argv` rather than lock script args (because the firewall lock occupies the `args` field). Receives the 20-byte pubkey hash as `argv[0]` and the 65-byte signature as `argv[1]`, recovers the pubkey, and asserts blake160 matches.

---

## Architecture concepts

### cell dep

A reference to a live cell included in a transaction. The firewall lock reads the registry cell via a cell dep to fetch the live BLKL payload. Transactions also include the deployed firewall-lock and inner-lock code cells as cell deps so CKB can execute them.

### fail-closed

The intentional security posture of the firewall: when in doubt, reject. If a required registry dep is missing, more than one dep matches, the payload is malformed or out of order, or an output matches a blacklisted identifier — the transaction is rejected. There is no fallback to "allow by default."

### firewall-protected cell

A CKB cell whose lock script is the firewall lock. Spending such a cell triggers the blacklist check at consensus on every full node.

### header_deps

Block headers included in a transaction, used to evaluate time-based (expiring) blacklist entries. The firewall lock computes the chain's median block time from `header_deps` to determine whether a temporary blacklist entry has expired. Without `header_deps`, the median time is zero and all temporary entries are treated as permanently active.

### inner lock

The lock script that the firewall lock delegates to after the blacklist check passes, via the `spawn_cell` syscall. The firewall lock itself only enforces the blacklist; the inner lock handles signature verification. For secp256k1-blake160 wallets the canonical inner lock is `spawn-aware-secp256k1`.

### multi-registry

A firewall lock configuration that consults multiple independent registry cells. Each registry spec is encoded in the lock args. The effective blacklist is the **union** of all active entries across all registries. All registries marked `required: true` must be present as cell deps.

### pre-flight check

An off-chain run of the same blacklist logic that the on-chain firewall lock enforces at consensus. The SDK's `check_transaction` / `preflightCheck` function performs this check before signing. Provides fast, actionable error feedback; does not replace the on-chain guarantee.

### registry cell

The single live CKB cell whose data is a BLKL v2 binary payload. Contains the governance header and the sorted blacklist entries. Identified by its type script identity (stable `type_id_value`); the outpoint changes after every governance update because the cell is consumed and re-created.

### spawn

The `spawn_cell` CKB syscall used by the firewall lock to execute the inner lock as a child process, passing inner lock args and the user's signature via `argv`.

### type_id_value

The 32-byte Type ID stored at bytes 34–66 of the 66-byte registry cell type args. Computed once at bootstrap as `blake2b(first_input_outpoint || output_index_u64_le)` and never changes. Used by the SDK and firewall lock args to identify the registry cell in a way that survives governance-lock upgrades and registry cell outpoint changes.

---

## SDK types

### CellDepLike

Minimal cell dependency representation for firewall checking. Fields: `type?: ScriptLike | null`, `data: string` (0x-prefixed hex cell data).

### FirewallConfig

Top-level SDK configuration. Contains `registries: RegistrySpecLike[]` (TypeScript) or `registries: Vec<RegistrySpec>` (Rust). Passed to `check_transaction` / `preflightCheck`.

### FirewallDecision

Discriminated union returned by `checkTransaction` and `preflightCheck` in the TypeScript SDK. Either `{ ok: true }` or `{ ok: false; code: number; reason: string }`.

### FirewallError

Rust SDK error enum. Variants map to the same numeric codes as `FirewallDecision.code` in TypeScript. Codes surfaced at pre-flight: 8 (`MissingRegistryCellDep`), 9 (`InvalidRegistryData`), 10 (`RegistryNotSorted`), 11 (`BlacklistedLockArgs`), 12 (`BlacklistedTypeArgs`), 17 (`AmbiguousRegistryCellDep`).

### FirewallLockConfig

Full configuration for building a v2 firewall lock script via the SDK builder helpers. Fields include the firewall code hash/hash type, flags byte, registry specs, and inner lock code hash/hash type/args.

### FirewallSpendDepsConfig

Everything needed to build the `cell_deps` array for spending a firewall-protected cell. Fields: deployed firewall-lock outpoint, deployed inner-lock outpoint, live registry cell outpoints (these change after each governance update).

### RegistryPayload

Parsed BLKL v2 registry cell contents. Fields: `version: number`, `entries: RegistryEntry[]` (guaranteed in strict ascending byte order), `governanceHeader?: GovernanceHeader`. Returned by `fetchRegistryPayload` and `parseRegistryPayload`.

### RegistrySpec / RegistrySpecLike

Identifies one registry cell by `type_id_value` (bytes 34–66 of the 66-byte v2 type args). Fields: `codeHash` (32 bytes), `hashType`, `typeIdValue` (32 bytes), `required` (boolean). Optional registries (`required: false`) are silently skipped if absent from cell deps.

### TxOutputLike

A transaction output reduced to the two fields the firewall inspects. Fields: `lockArgs: string` (0x-prefixed hex), `typeArgs?: string` (optional).

### UnsignedTxLike

Minimal unsigned transaction view for firewall checking. Fields: `cellDeps: CellDepLike[]`, `outputs: TxOutputLike[]`.

---

## Governance concepts

### governance header

Metadata embedded inside the BLKL v2 payload. Contains a version byte, validator threshold, validator count, validator Merkle root, optional treasury metadata, and legacy signer fields retained in the encoded layout. The `governance-lock` contract reads the threshold and validator commitment from here on every registry update.

### oldRoot / newRoot

Blake2b hashes of the input and output registry cell data, respectively. Stored in the GOV1 v4 witness. The registry type script recomputes both from the actual cell data and rejects if they don't match, which prevents replay of an old valid witness against a different cell state.

### proposalIdHash

Blake2b hash of all canonical proposal fields (lock args, action, evidence, rationale, classification, severity, expiry, proposer). Computed at proposal creation and immutable: any field change produces a different hash and invalidates votes for that proposal. Used in the GOV1 v4 witness and the validator vote signing message.

### review window

A mandatory 72-hour waiting period anchored to the on-chain `PBLK` proposal cell. The final governance transaction spends that proposal cell with a relative median-time-past `since` delay of at least `review_delay_ms`. CKB consensus refuses to include the governance transaction in a block until the proposal input has aged by that delay. Cannot be bypassed by transaction construction.

### proposalDataHash

Blake2b hash of the full `PBLK` proposal cell data. Encoded in the GOV1 v4 witness. The registry type script and governance-lock script use it to bind the final update to the exact on-chain proposal cell being spent.

### reviewDelayMs

The required relative delay in milliseconds, normally 72 hours. Encoded in the GOV1 v4 witness. The proposal input's `since` field must use a relative median-time-past delay greater than or equal to this value.

### validator

Validator votes authorize runtime registry updates.

A validator is a committee member who votes on proposals. Votes are cryptographic signatures stored in the proposal JSON. During execution, yes-vote signatures and Merkle proofs are submitted in `WitnessArgs.lock` and verified on-chain by the `governance-lock` script. A validator's pubkey commits to the `validatorMerkleRoot` in the BLKL governance header.

### validator Merkle root

A 32-byte Merkle root committing to the authorized validator set. Leaves are `blake2b(compressed_pubkey)` for each validator; the tree is padded to the next power of two and built with the CKB default blake2b personalization. Each vote record includes a Merkle proof (sibling hashes from leaf to root). The governance-lock verifies yes-vote proofs on-chain during execution.

### voteDigestHash

Blake2b hash of the full sorted set of vote records. Computed as `blake2b` over the canonically serialized array of `{ pubkey, vote, timestamp, signature }` objects sorted by pubkey. Recomputed by the `execute` CLI command from stored votes before building the governance transaction, and included in the GOV1 v4 witness. Any tampered or missing vote produces a different hash.

All six fields must match the GOV1 v4 witness; on-chain signature verification rejects if any field has been tampered.
