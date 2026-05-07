# Rust SDK

Rust SDK for pre-flight transaction checks in native runtimes.

## Responsibilities

- Provide deterministic pre-flight checks before signing.
- Parse registry payloads and evaluate blacklist membership.
- Expose reusable APIs for service backends and native agents.

## API Direction (v1)

- Registry loader and parser module.
- Transaction output inspection module.
- Result model with stable reason codes.

## Registry Resolution Contract

- Registry lookup matches the registry cell **type script** `(code_hash, hash_type, args)` byte-for-byte against configured values.
- Exactly one matching registry dep is required for successful evaluation.
- Zero matches map to `MissingRegistryCellDep` (`8`); multiple matches map to `AmbiguousRegistryCellDep` (`17`).

## Expected layout

- `src/lib.rs`: public SDK interface and reusable checking logic.
- `Cargo.toml`: Rust crate metadata for SDK build/test.

## Implemented API (current)

- `check_transaction(config, tx) -> Result<(), FirewallError>`
- `FirewallError::code()` mapping aligned to on-chain public error codes:
  - `8`: missing registry dep
  - `9`: invalid registry data
  - `10`: registry not sorted
  - `11`: blacklisted lock args
  - `12`: blacklisted type args
- `17`: ambiguous registry dep

Notes:
- The SDK intentionally exposes only public on-chain firewall codes `8-12` and `17`.
- Contract-internal inner-lock validation codes (`13-16`) are not surfaced by this SDK API.
