# Firewall Lock Contract

Rust + `ckb-std` lock script that enforces blacklist checks at consensus.

## Responsibilities

- Load blacklist registry cell as `cell_dep`.
- Parse destination identifiers from transaction outputs.
- Reject transactions targeting blacklisted destinations.
- Delegate ownership verification to configured inner lock behavior.

## Normative Resolution Rule

- Registry selection is identity-based, not outpoint-pinned.
- The lock script scans `cell_deps` for candidates matching configured registry identity.
- Validation proceeds only when exactly one candidate is found.
- Zero matches return `MissingRegistryCellDep`; multiple matches return `AmbiguousRegistryCellDep`.

## Security Properties

- Fail closed when dependencies are missing or malformed.
- Deterministic validation across nodes and miners.
- No dependency on off-chain oracle services.

## Expected layout

- `src/main.rs`: core script entrypoint and validation flow.
- `Cargo.toml`: contract package metadata and dependencies.
