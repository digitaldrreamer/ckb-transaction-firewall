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

## Expected layout

- `src/main.rs`: governance signature verification and update constraints.
- `Cargo.toml`: contract package metadata and dependencies.
