# Lock Script Specification

This document defines the expected interface and behavior of the Firewall Lock Script.

## Purpose

The lock script enforces blacklist policy during input validation for firewall-protected cells. It provides consensus-level rejection of transactions that target blacklisted destinations.

## Script Configuration

### Terminology (CKB-accurate)

Registry cells are matched by the **type script identity** of the registry cell output, not by a precomputed “type hash” string stored in lock args unless that string is explicitly defined as such.

A type script identity is the triple:

- `code_hash` (32 bytes)
- `hash_type` (`0x00` data, `0x01` type, `0x02` data1)
- `args` (variable-length bytes on-chain)

The Firewall lock args encode this triple so the script can locate the registry `cell_dep` without pinning a mutable outpoint. Wallet cells do not need lock-arg updates when the registry cell is replaced, as long as the registry’s type script identity is unchanged.

## `args` layout (v1 frozen)

All multi-byte integers are little-endian. Fields are parsed **in order**; variable-length segments use explicit length prefixes.

| Offset | Size | Field | Rule |
|---|---:|---|---|
| 0 | 1 | `version` | MUST be `0x01` |
| 1 | 1 | `flags` | bit0: check output `lock_args`; bit1: check output `type_args`; bits 2-7 reserved and MUST be `0` |
| 2 | 32 | `registry_code_hash` | Expected registry cell **type script** `code_hash` |
| 34 | 1 | `registry_hash_type` | Expected registry cell **type script** `hash_type` |
| 35 | 2 | `registry_type_args_len_le` | LE `u16` byte length `N` of `registry_type_args` |
| 37 | N | `registry_type_args` | Expected registry cell **type script** `args` (exact bytes) |
| 37+N | 32 | `inner_code_hash` | Wrapped inner lock `code_hash` |
| 69+N | 1 | `inner_hash_type` | `0x00=data`, `0x01=type`, `0x02=data1` |
| 70+N | 2 | `inner_args_len_le` | LE `u16` byte length `M` of `inner_args` |
| 72+N | M | `inner_args` | Raw inner lock `args` payload |

**Layout invariants**

- Total `args` length MUST equal `72 + N + M` bytes.
- `registry_type_args_len_le` MUST equal `N` and MUST match the following `registry_type_args` length.
- `inner_args_len_le` MUST equal `M` and MUST match the following `inner_args` length.
- Any violation is `InvalidArgsLayout`.

## Required Dependencies

Transactions spending firewall-protected inputs must include:

- `cell_dep` set that contains **exactly one** live cell whose **type script** byte-matches `(registry_code_hash, registry_hash_type, registry_type_args)`.
- `cell_dep` entries required by the wrapped inner lock (code references, etc.).

If required deps are missing, the script returns a hard failure.

## Registry dep selection (normative)

1. Iterate all transaction `cell_deps` that resolve to a **live cell** carrying a **type script**.
2. A cell is a **registry candidate** if its type script satisfies:
   - `type.code_hash == registry_code_hash`
   - `type.hash_type == registry_hash_type`
   - `type.args == registry_type_args` (byte equality)
3. Count candidates:
   - **zero** → return `MissingRegistryCellDep`
   - **one** → use that cell’s data as the registry payload
   - **more than one** → return `AmbiguousRegistryCellDep`

This rule eliminates arbitrary dep choice when multiple cells could otherwise satisfy a looser predicate.

## Validation Algorithm (high level)

1. Parse and validate lock `args` layout.
2. Select the registry cell using the algorithm above.
3. Load and validate registry payload (magic/version/count/schema).
4. Extract output destination identifiers from current transaction outputs.
5. For each destination, perform blacklist membership check (see temporary entries below).
6. If any destination is blacklisted, return `BlacklistedLockArgs` or `BlacklistedTypeArgs`.
7. Delegate ownership/auth checks to the inner lock path if blacklist passes.

## Registry payload: permanent vs temporary (emergency) entries

- Permanent blacklist entries are always active until removed by governance.
- Emergency **temporary** entries MUST carry an **`expires_at`** field per entry (or per emergency batch per registry schema version), encoded as **uint64 LE Unix seconds**.
- During membership evaluation, the lock script MUST load the **median timestamp context** available to the script at validation time (per CKB header/`since` semantics) as `T_median`.
- If an entry is temporary and `T_median >= expires_at`, the entry MUST be treated as **not** on the blacklist (same effect as removal without requiring a follow-up governance tx for correctness).

Governance SHOULD still publish a registry replacement that drops expired temporary entries for auditability and smaller cell data, but **consensus enforcement does not rely** on that housekeeping transaction.

## Registry Payload Expectations

- Deterministic binary format with explicit version byte.
- Sorted entries for stable lookup behavior (when the schema uses a sorted list).
- Integrity guaranteed by registry type script, not by lock script signatures.

## Error Codes (frozen public constants)

Custom firewall errors start at code `5`:

- `5`: `InvalidArgsLayout`
- `6`: `UnsupportedVersion`
- `7`: `UnsupportedFlags`
- `8`: `MissingRegistryCellDep`
- `9`: `InvalidRegistryData`
- `10`: `RegistryNotSorted`
- `11`: `BlacklistedLockArgs`
- `12`: `BlacklistedTypeArgs`
- `13`: `MissingInnerLockCellDep`
- `14`: `InvalidInnerLockScript`
- `15`: `InnerLockRejected`
- `16`: `OutputScriptParseFailed`
- `17`: `AmbiguousRegistryCellDep`

## Delegation and Composability

The firewall lock is designed to compose with existing lock models (for example secp256k1-style or Omnilock-like flows). Blacklist checks run before final delegation success, preserving ownership semantics while adding policy enforcement.

## Security Notes

- Default failure mode is reject, not allow.
- Registry lookup must be exact and deterministic.
- Any ambiguity in output destination extraction should fail closed in v1.
- Reentrancy is not applicable at script level, but deterministic resource usage must be maintained.
