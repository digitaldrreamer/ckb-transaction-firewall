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

## `args` layout (v2)

All multi-byte integers are little-endian. Fields are parsed **in order**.

| Offset | Size | Field | Rule |
|---|---:|---|---|
| 0 | 1 | `version` | MUST be `0x02` |
| 1 | 1 | `flags` | bit0: check output `lock_args`; bit1: check output `type_args`; bits 2-7 reserved and MUST be `0`; MUST have at least one bit set |
| 2 | 1 | `registry_count` | Number of registry specs that follow (`0`–`255`) |
| 3 | 66×N | `registry_specs` | N registry specs, each 66 bytes (see below) |
| 3+66N | 32 | `inner_code_hash` | Wrapped inner lock `code_hash` |
| 35+66N | 1 | `inner_hash_type` | `0x00=data`, `0x01=type`, `0x02=data1` |
| 36+66N | 2 | `inner_args_len_le` | LE `u16` byte length `M` of `inner_args` |
| 38+66N | M | `inner_args` | Raw inner lock `args` payload |

**Registry spec (66 bytes each)**

| Offset | Size | Field | Rule |
|---|---:|---|---|
| 0 | 32 | `code_hash` | Registry cell type script `code_hash` (blacklist-registry Type ID) |
| 32 | 1 | `hash_type` | Registry cell type script `hash_type` |
| 33 | 32 | `type_id_value` | Bytes 34..66 of the 66-byte v2 registry type args; stable across governance-lock upgrades |
| 65 | 1 | `required` | `0x00` = optional, any non-zero = required |

**Layout invariants**

- Total `args` length MUST equal `38 + 66×N + M` bytes (minimum 38 when N=0, M=0).
- Any violation is `InvalidArgsLayout`.
- Registry cells are matched by `code_hash + hash_type + type_id_value`; the governance code hash (bytes 1..33 of the registry type args) is NOT part of the match, so wallet cells survive governance-lock upgrades without lock-arg changes.

## Required Dependencies

Transactions spending firewall-protected inputs must include:

- For each required registry spec: **exactly one** live cell dep whose type script matches `(code_hash, hash_type, type_id_value)`.
- `cell_dep` entries required by the wrapped inner lock (code references, etc.).

If required deps are missing, the script returns a hard failure.

## Registry dep selection (normative)

For each registry spec in the lock args:

1. Iterate all transaction `cell_deps` that resolve to a **live cell** carrying a **type script**.
2. A cell is a **registry candidate** for spec S if its type script satisfies:
   - `type.code_hash == S.code_hash`
   - `type.hash_type == S.hash_type`
   - `type.args` is 66 bytes AND `type.args[34..66] == S.type_id_value`
3. Count candidates:
   - **zero** and `S.required` → return `MissingRegistryCellDep`
   - **zero** and not `S.required` → skip this registry
   - **one** → use that cell’s data as a registry payload
   - **more than one** → return `AmbiguousRegistryCellDep`

The effective blacklist is the **union** of all resolved registry payloads. This rule eliminates arbitrary dep choice while allowing multi-registry configurations.

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
- Magic MUST be `BLKL` (4 bytes) for v2 payload parsing.
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
