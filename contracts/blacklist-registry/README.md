# Blacklist Registry Contract

Type script responsible for governance authorization of registry cell updates.

## Responsibilities

- Validate that updates are authorized by governance signers.
- Enforce registry format/version invariants on state transition.
- Bind each update to a verifiable governance decision context.

## Security Properties

- Prevent unilateral blacklist mutation.
- Reject malformed or unauthorized replacements.
- Preserve auditable update history through explicit cell replacement.

## Identity Requirement

Registry updates must preserve the registry cell **type script** identity (`code_hash`, `hash_type`, `args`) expected by firewall lock args, so blacklist updates do not require per-wallet lock migration.

## Script Interface (v1)

### Type script args (configuration)

`blacklist-registry` uses its **type script args** to encode the **governance lock script identity** that must authorize registry updates.

Layout (little-endian lengths):

- `version`: `u8` (MUST be `0x01`)
- `governance_code_hash`: `[u8; 32]`
- `governance_hash_type`: `u8` (`0x00=data`, `0x01=type`, `0x02=data1`)
- `governance_args_len`: `u16` (LE)
- `governance_args`: `[u8; N]`

Every registry update transaction MUST satisfy:

- exactly **one** input cell and **one** output cell using this exact type script identity (same `code_hash/hash_type/args`),
- both the input and output registry cells’ **lock scripts** match the configured governance lock identity above.

### Governance context witness (GOV1)

The registry update transaction MUST include a governance context payload in the **witness lock field** for the registry input cell.

This payload is committed to by typical `sighash-all` lock scripts (including multisig), so it provides an auditable binding between:

- the proposal/vote context, and
- the exact old→new registry state transition.

Binary layout (`GOV1` v1), stored in `WitnessArgs.lock`:

- 4 bytes: magic `"GOV1"`
- 1 byte: version (`0x01`)
- 32 bytes: `proposal_id_hash`
- 32 bytes: `vote_digest_hash`
- 32 bytes: `registry_old_root` (`blake2b_256` over input registry cell data, personalization `ckb-default-hash`)
- 32 bytes: `registry_new_root` (`blake2b_256` over output registry cell data, personalization `ckb-default-hash`)
- 1 byte: `signer_count` (MUST be in `[3,5]`)
- repeated `signer_count` times:
  - 1 byte: `signer_index` (MUST be in `[0,4]`, unique)
  - 65 bytes: `signature` (`r||s||recovery_id`, where recovery_id is currently range-validated)

The message signed by governance signers is:

- `blake2b_256(proposal_id_hash || vote_digest_hash || registry_old_root || registry_new_root)`

The type script verifies signatures against a fixed, compiled 5-signer pubkey set and enforces a strict 3-of-5 threshold.
For bootstrap creation of the very first registry cell (no registry input), the type script requires strict 5-of-5 signatures and binds `old_root` to all-zero bytes.

The type script rejects updates if:

- witness is missing/malformed,
- `proposal_id_hash` or `vote_digest_hash` is all-zero,
- roots do not match the actual input/output registry data,
- signer count/indexes are invalid,
- duplicate signer indexes are present,
- fewer than 3 valid signatures are provided,
- any signature fails secp256k1 verification for its declared signer index.

## Bootstrap and Rotation

- Bootstrap topology is `0 input registry cells -> 1 output registry cell`.
- Update topology is `1 input registry cell -> 1 output registry cell`.
- Bootstrap uses `old_root = 0x00..00` and requires 5-of-5 governance signatures.

### Key rotation / emergency signer compromise

- In v1, signer pubkeys are compiled into the contract binary; rotating keys requires a contract upgrade (new code hash) plus governance migration to the new type script identity.
- Minimum operational process:
  1. Declare compromise and freeze normal update execution.
  2. Prepare and audit new contract binary with rotated signer pubkeys.
  3. Approve upgrade through governance process and execute migration transaction(s).
  4. Publish and verify the new code hash across SDK/indexer/operator configs before resuming updates.

### Dev safety guard

- Placeholder signer keys are blocked in non-test builds unless `dev-signer-keys` feature is explicitly enabled.
- For local/dev builds only:
  - `cargo build --release --target=riscv64imac-unknown-none-elf --features dev-signer-keys`

## Expected layout

- `src/main.rs`: governance signature verification and update constraints.
- `Cargo.toml`: contract package metadata and dependencies.
