# Lock Script Specification

This document defines the expected interface and behavior of the Firewall Lock Script.

## Purpose

The lock script enforces blacklist policy during input validation for firewall-protected cells. It provides consensus-level rejection of transactions that target blacklisted destinations.

## Script Configuration

## `args` layout (v1 frozen)

| Offset | Size | Field | Rule |
|---|---:|---|---|
| 0 | 1 | `version` | MUST be `0x01` |
| 1 | 1 | `flags` | bit0: check output `lock_args`; bit1: check output `type_args`; bits 2-7 reserved and MUST be `0` |
| 2 | 32 | `registry_type_hash` | Stable registry identity hash |
| 34 | 32 | `registry_type_args_hash` | Hash of expected registry type args identity |
| 66 | 32 | `inner_code_hash` | Wrapped inner lock code hash |
| 98 | 1 | `inner_hash_type` | `0x00=data`, `0x01=type`, `0x02=data1` |
| 99 | 2 | `inner_args_len_le` | LE `u16` byte length of `inner_args` |
| 101 | N | `inner_args` | Raw inner lock args payload |

`inner_args_len_le` MUST exactly match the remaining bytes. Mismatch is `InvalidArgsLayout`.

## Required Dependencies

Transactions spending firewall-protected inputs must include:

- `cell_dep` set that contains exactly one registry cell matching stable identity (`registry_type_hash` + `registry_type_args_hash`).
- `cell_dep` for any delegated inner lock code/data requirements.

If required deps are missing, the script returns a hard failure.

## Validation Algorithm (high level)

1. Scan `cell_deps` and collect registry candidates matching configured stable identity.
2. Enforce dep-selection invariants:
   - zero matches -> `MissingRegistryCellDep`,
   - one match -> continue,
   - more than one match -> `AmbiguousRegistryCellDep`.
3. Load and validate registry payload header (magic/version/count/ordering constraints).
4. Extract output destination identifiers from current transaction outputs.
5. For each destination, perform blacklist membership check.
6. If any destination is blacklisted, return rejection code.
7. Delegate ownership/auth checks to inner lock path if blacklist passes.

## Registry Payload Expectations

- Deterministic binary format with explicit version byte.
- Sorted entries for stable lookup behavior.
- Optional future-proof extension fields behind version/flags.
- Integrity guaranteed by registry type script, not by lock script signatures.

## Error Codes (frozen public constants)

Custom firewall errors start at code `5`:

- `5`: `InvalidArgsLayout`
- `6`: `UnsupportedVersion`
- `7`: `UnsupportedFlags`
- `8`: `MissingRegistryCellDep`
- `9`: `RegistryIdentityMismatch`
- `10`: `InvalidRegistryData`
- `11`: `RegistryNotSorted`
- `12`: `BlacklistedLockArgs`
- `13`: `BlacklistedTypeArgs`
- `14`: `MissingInnerLockCellDep`
- `15`: `InvalidInnerLockScript`
- `16`: `InnerLockRejected`
- `17`: `OutputScriptParseFailed`
- `18`: `AmbiguousRegistryCellDep`

## Delegation and Composability

The firewall lock is designed to compose with existing lock models (for example secp256k1-style or Omnilock-like flows). Blacklist checks run before final delegation success, preserving ownership semantics while adding policy enforcement.

## Security Notes

- Default failure mode is reject, not allow.
- Registry lookup must be exact and deterministic.
- Any ambiguity in output destination extraction should fail closed in v1.
- Reentrancy is not applicable at script level, but deterministic resource usage must be maintained.
