---
title: Rust SDK API
description: Complete reference for all types, functions, and errors exported by ckb-transaction-firewall-sdk.
---

Complete reference for `ckb-transaction-firewall-sdk` (v0.3). For task-oriented usage patterns see [Pre-flight Check (Rust)](/guides/rust-preflight/).

Full Rustdoc is available on [docs.rs](https://docs.rs/ckb-transaction-firewall-sdk).

---

## Types

### `HashType`

```rust
pub enum HashType {
    Data,
    Type,
    Data1,
}
```

CKB script hash type. Serialises to the single-byte on-chain encoding: `Data=0`, `Type=1`, `Data1=2`.

#### Methods

```rust
fn to_byte(&self) -> u8
fn from_byte(b: u8) -> Option<HashType>
```

---

### `ScriptLike`

```rust
pub struct ScriptLike {
    pub code_hash: [u8; 32],
    pub hash_type: HashType,
    pub args: Vec<u8>,
}
```

A CKB script (lock or type) in component form.

---

### `RegistrySpec`

```rust
pub struct RegistrySpec {
    pub code_hash: [u8; 32],
    pub hash_type: HashType,
    pub type_id_value: [u8; 32],
    pub required: bool,
}
```

Identifies a registry cell dep. `type_id_value` is bytes 34–66 of the 66-byte v2 registry type-script args (the Type ID value). Matching on `type_id_value` rather than full type-script equality means the spec survives governance-lock upgrades — the governance code hash at bytes 1–33 can change without invalidating this spec.

When `required` is `true`, the absence of a matching cell dep is a `MissingRegistryCellDep` error. When `false`, the spec is silently skipped if no dep is found.

---

### `CellDepLike`

```rust
pub struct CellDepLike {
    pub type_script: Option<ScriptLike>,
    pub data: Vec<u8>,
}
```

A minimal view of a CKB cell dependency as seen by the preflight checker — the type script and raw data of the dep cell.

---

### `TxOutputLike`

```rust
pub struct TxOutputLike {
    pub lock_args: Vec<u8>,
    pub type_args: Option<Vec<u8>>,
}
```

A transaction output reduced to the two fields the firewall checks.

---

### `UnsignedTxLike`

```rust
pub struct UnsignedTxLike {
    pub cell_deps: Vec<CellDepLike>,
    pub outputs: Vec<TxOutputLike>,
}
```

The subset of an unsigned CKB transaction that `check_transaction` needs.

---

### `FirewallConfig`

```rust
pub struct FirewallConfig {
    pub registries: Vec<RegistrySpec>,
}
```

Configuration for `check_transaction`. `registries` may contain multiple specs; the effective blacklist is the union of all active entries across all resolved deps.

---

### `RegistryEntry`

```rust
pub struct RegistryEntry {
    pub identifier: Vec<u8>,
    pub expires_at: u64,
}
```

A single blacklisted identifier. `expires_at == 0` means the entry never expires. Entries with `expires_at` in the past (compared against `now_secs`) are treated as inactive.

---

### `GovernanceHeader`

```rust
pub struct GovernanceHeader {
    pub signer_count: u8,
    pub threshold: u8,
    pub pubkeys: Vec<[u8; 33]>,      // compressed secp256k1 pubkeys
    pub validator_count: u16,
    pub validator_merkle_root: [u8; 32],
}
```

Governance metadata embedded in every BLKL v2 registry payload. `pubkeys` are the on-chain governance committee; `validator_merkle_root` commits to the authorized validator set.

---

### `RegistryPayload`

```rust
pub struct RegistryPayload {
    pub version: u8,
    pub entries: Vec<RegistryEntry>,
    pub governance_header: Option<GovernanceHeader>,
}
```

A parsed BLKL v2 registry payload. Returned by `parse_registry_payload`. Entries are in strict ascending byte order — a payload that violates sort order returns `RegistryNotSorted` from the checker.

---

### `OutPointLike`

```rust
pub struct OutPointLike {
    pub tx_hash: [u8; 32],
    pub index: u32,
}
```

On-chain location of a deployed cell.

---

### `DepType`

```rust
pub enum DepType {
    Code,
    DepGroup,
}
```

The dependency type of a cell dep.

---

### `TransactionCellDep`

```rust
pub struct TransactionCellDep {
    pub out_point: OutPointLike,
    pub dep_type: DepType,
}
```

A cell dependency entry for inclusion in a CKB transaction's `cell_deps` array.

---

### `FirewallSpendDepsConfig`

```rust
pub struct FirewallSpendDepsConfig {
    pub firewall_lock_out_point: OutPointLike,
    pub inner_lock_out_point: OutPointLike,
    pub registry_out_points: Vec<OutPointLike>,
}
```

Input to `build_firewall_spend_cell_deps`. `registry_out_points` move after every governance update — always provide fresh values.

---

### `FirewallLockConfig`

```rust
pub struct FirewallLockConfig {
    pub firewall_code_hash: [u8; 32],
    pub firewall_hash_type: HashType,
    pub flags: u8,
    pub registries: Vec<RegistrySpec>,
    pub inner_code_hash: [u8; 32],
    pub inner_hash_type: HashType,
    pub inner_args: Vec<u8>,
}
```

Full configuration for `build_firewall_lock_script`. Encodes to the v2 `FirewallLockArgs` binary layout.

`flags`: bit 0 = check lock_args, bit 1 = check type_args. At least one bit must be set; reserved bits (0xfc) must be clear — otherwise `build_firewall_lock_args` returns `InvalidRegistryData`.

`inner_args`: maximum 65535 bytes. `registries`: maximum 255 entries.

---

## Functions

### `check_transaction`

```rust
pub fn check_transaction(
    cfg: &FirewallConfig,
    tx: &UnsignedTxLike,
    now_secs: u64,
) -> Result<(), FirewallError>
```

Cell-dep-aware pre-flight checker. Resolves registry cell deps from `tx.cell_deps` by `type_id_value`, parses their BLKL payloads, and checks every output. Returns `Ok(())` if all outputs are clean, or the first `FirewallError` encountered.

Use this when the transaction is fully assembled and the registry dep is already in `cell_deps` — it confirms the same dep that will be broadcast is what was validated.

`now_secs` is used to evaluate time-based blacklist entries. Pass `SystemTime::now()` in seconds for off-chain pre-flight.

---

### `preflight_check`

```rust
pub fn preflight_check(
    outputs: &[TxOutputLike],
    payloads: &[RegistryPayload],
    now_secs: u64,
) -> Result<(), FirewallError>
```

Checks all outputs against already-parsed registry payloads. Synchronous — no registry dep resolution, no payload parsing. Use this when you have already parsed the registry and want to check outputs without re-resolving deps.

---

### `is_blacklisted`

```rust
pub fn is_blacklisted(
    lock_args: &[u8],
    payloads: &[RegistryPayload],
    now_secs: u64,
) -> bool
```

Returns `true` if `lock_args` matches an active entry in any of the given registries. Entries with `expires_at` in the past are treated as inactive. Accepts multiple registry payloads and checks the union of all entries.

---

### `parse_registry_payload`

```rust
pub fn parse_registry_payload(data: &[u8]) -> Result<RegistryPayload, FirewallError>
```

Parses a BLKL v2 byte slice into a `RegistryPayload`. Returns `InvalidRegistryData` if the magic, version, or structure is invalid. Returns `RegistryNotSorted` if entries are not in strict ascending byte order.

---

### `encode_registry_payload`

```rust
pub fn encode_registry_payload(payload: &RegistryPayload) -> Result<Vec<u8>, FirewallError>
```

Encodes a `RegistryPayload` into a BLKL v2 byte vector. Returns `InvalidRegistryData` if any entry's `identifier` is longer than 255 bytes. Used internally by the governance CLI to construct the new registry payload for each update.

---

### `encode_governance_header`

```rust
pub fn encode_governance_header(header: &GovernanceHeader) -> Result<Vec<u8>, FirewallError>
```

Encodes a `GovernanceHeader` into the binary format expected by BLKL v2.

---

### `build_firewall_lock_args`

```rust
pub fn build_firewall_lock_args(config: &FirewallLockConfig) -> Result<Vec<u8>, FirewallError>
```

Encodes `FirewallLockConfig` into the v2 `FirewallLockArgs` byte layout. Returns `InvalidRegistryData` if `flags` has no check bits set, has reserved bits set, or if `inner_args` exceeds 65535 bytes.

---

### `build_firewall_lock_script`

```rust
pub fn build_firewall_lock_script(config: &FirewallLockConfig) -> Result<ScriptLike, FirewallError>
```

Builds the firewall lock script for a wallet cell. Returns `ScriptLike { code_hash, hash_type, args }` where `args` is the v2 `FirewallLockArgs` encoding. See [Firewall Lock Args](/reference/firewall-lock-args/) for the byte layout.

---

### `build_firewall_spend_cell_deps`

```rust
pub fn build_firewall_spend_cell_deps(config: &FirewallSpendDepsConfig) -> Vec<TransactionCellDep>
```

Returns the cell deps required for a transaction that spends a firewall-protected cell: the firewall-lock code cell, the inner lock code cell, and one `Code` dep per registry outpoint. Registry outpoints move after each governance update — always provide fresh values.

---

## Errors

### `FirewallError`

```rust
pub enum FirewallError {
    MissingRegistryCellDep,
    InvalidRegistryData,
    RegistryNotSorted,
    BlacklistedLockArgs,
    BlacklistedTypeArgs,
    AmbiguousRegistryCellDep,
}
```

All errors returned by `check_transaction`, `preflight_check`, `parse_registry_payload`, and the builder functions. Implements `std::error::Error` and `Display`.

#### Method

```rust
pub fn code(&self) -> i8
```

On-chain error code corresponding to this variant. Stable across SDK versions — these match the contract's frozen error codes.

| Variant | Code |
|---|---|
| `MissingRegistryCellDep` | 8 |
| `InvalidRegistryData` | 9 |
| `RegistryNotSorted` | 10 |
| `BlacklistedLockArgs` | 11 |
| `BlacklistedTypeArgs` | 12 |
| `AmbiguousRegistryCellDep` | 17 |

For the full error code table including on-chain-only codes, see [Error codes](/reference/error-codes/).

---

## `error_codes` module

```rust
pub mod error_codes {
    pub const INVALID_ARGS_LAYOUT: i8 = 5;         // on-chain only
    pub const UNSUPPORTED_VERSION: i8 = 6;         // on-chain only
    pub const UNSUPPORTED_FLAGS: i8 = 7;           // on-chain only
    pub const MISSING_REGISTRY_CELL_DEP: i8 = 8;
    pub const INVALID_REGISTRY_DATA: i8 = 9;
    pub const REGISTRY_NOT_SORTED: i8 = 10;
    pub const BLACKLISTED_LOCK_ARGS: i8 = 11;
    pub const BLACKLISTED_TYPE_ARGS: i8 = 12;
    pub const MISSING_INNER_LOCK_CELL_DEP: i8 = 13; // on-chain only
    pub const INVALID_INNER_LOCK_SCRIPT: i8 = 14;   // on-chain only
    pub const INNER_LOCK_REJECTED: i8 = 15;         // on-chain only
    pub const OUTPUT_SCRIPT_PARSE_FAILED: i8 = 16;  // on-chain only
    pub const AMBIGUOUS_REGISTRY_CELL_DEP: i8 = 17;
}
```

Named constants for all on-chain error codes. "On-chain only" codes are enforced exclusively by the contract and cannot be surfaced by the SDK pre-flight check.

---

## `testnet` module (feature = "testnet")

```rust
#[cfg(feature = "testnet")]
pub mod testnet {
    pub const RPC_URL: &str;
    pub fn registry_spec() -> RegistrySpec;
    // contract outpoints and governance constants
}
```

Exposes the canonical testnet RPC URL, registry spec, and deployed contract outpoints. Only available when compiled with the `testnet` feature. See [Testnet Deployment](/operations/testnet-deployment/) for the current values.

---

## Feature flags

| Feature | Effect |
|---|---|
| `serde` | Derives `Serialize` / `Deserialize` on all public types |
| `testnet` | Exposes the `testnet` module with testnet constants |
