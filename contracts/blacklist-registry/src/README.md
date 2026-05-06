# Blacklist Registry Source

This folder holds the `blacklist-registry` type script implementation.

It enforces:

- registry cell replacement topology (exactly one input + one output registry cell per update),
- registry payload invariants (`BLKL` v1 parsing + sorted entries),
- governance authorization by requiring the registry cells use the configured governance lock script identity (encoded in type args),
- governance context binding via a `GOV1` witness payload committed by sighash-all lock scripts.

Emergency mode alignment remains policy-driven:

- emergency actions are expected to be **temporary-add-only** (via `expires_at` fields in registry entries),
- the firewall lock enforces expiry at consensus using median chain time per `docs/lock-script-spec.md`.
