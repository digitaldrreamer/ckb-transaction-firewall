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
