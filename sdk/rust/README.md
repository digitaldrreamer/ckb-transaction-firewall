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

- Registry lookup is stable-identity based (`registry_type_hash` + `registry_type_args_hash`).
- Exactly one matching registry dep is required for successful evaluation.
- Zero matches map to `MissingRegistryCellDep`; multiple matches map to `AmbiguousRegistryCellDep`.

## Expected layout

- `src/lib.rs`: public SDK interface and reusable checking logic.
