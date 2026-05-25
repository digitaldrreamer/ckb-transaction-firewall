# ckb-transaction-firewall-sdk

Off-chain pre-flight blacklist check for CKB transactions.

Before broadcasting a CKB transaction, call `check_transaction` to verify that
no output's lock or type args appear in the on-chain BLKL v2 blacklist registry.
The check mirrors what the firewall-lock contract enforces at consensus time,
allowing wallets and dApps to reject blacklisted transactions early without
spending UTXOs.

## Installation

```toml
[dependencies]
ckb-transaction-firewall-sdk = "0.3"
```

With optional features:

```toml
[dependencies]
ckb-transaction-firewall-sdk = { version = "0.3", features = ["serde", "testnet"] }
```

## Quick start

```rust
use ckb_transaction_firewall_sdk::{
    check_transaction, FirewallConfig, RegistrySpec, HashType,
    CellDepLike, ScriptLike, TxOutputLike, UnsignedTxLike,
};

// Identify the registry cell dep by its type_id_value — bytes 34-66 of the
// registry type-script args. This is stable across governance upgrades.
let spec = RegistrySpec {
    code_hash: [/* blacklist_registry code hash */0u8; 32],
    hash_type: HashType::Type,
    type_id_value: [/* bytes 34-66 of the registry type args */0u8; 32],
    required: true,
};

let cfg = FirewallConfig { registries: vec![spec] };

// Build your transaction normally, then call check_transaction before signing.
let tx = UnsignedTxLike {
    cell_deps: vec![/* live registry cell dep */],
    outputs: vec![TxOutputLike {
        lock_args: recipient_lock_args,
        type_args: None,
    }],
};

let now_secs = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap()
    .as_secs();

match check_transaction(&cfg, &tx, now_secs) {
    Ok(()) => { /* safe to sign and broadcast */ }
    Err(e) => eprintln!("blocked: {} (on-chain code {})", e, e.code()),
}
```

## Multi-registry example

The firewall lock args can reference multiple registry cells. The preflight
check enforces all of them.

```rust
use ckb_transaction_firewall_sdk::{FirewallConfig, RegistrySpec, HashType};

let cfg = FirewallConfig {
    registries: vec![
        RegistrySpec {
            code_hash: [0u8; 32], // registry A code hash
            hash_type: HashType::Type,
            type_id_value: [0x01u8; 32], // registry A type id
            required: true,
        },
        RegistrySpec {
            code_hash: [0u8; 32], // registry B code hash
            hash_type: HashType::Type,
            type_id_value: [0x02u8; 32], // registry B type id
            required: false, // optional — skipped if not present in tx
        },
    ],
};
```

## Building firewall lock scripts

Use `build_firewall_lock_args` and `build_firewall_lock_script` to construct
the lock args for a new firewall-protected cell:

```rust
use ckb_transaction_firewall_sdk::{
    build_firewall_lock_script, FirewallLockConfig, HashType, RegistrySpec,
};

let config = FirewallLockConfig {
    firewall_code_hash: [0u8; 32], // deployed firewall-lock code hash
    firewall_hash_type: HashType::Type,
    flags: 0x01, // bit 0 = check lock_args
    registries: vec![RegistrySpec {
        code_hash: [0u8; 32],
        hash_type: HashType::Type,
        type_id_value: [0u8; 32],
        required: true,
    }],
    inner_code_hash: [0u8; 32], // e.g. spawn-aware-secp256k1
    inner_hash_type: HashType::Type,
    inner_args: vec![/* inner lock args */],
};

let lock_script = build_firewall_lock_script(&config).unwrap();
```

## Error codes

Each `FirewallError` variant maps to an on-chain error code. Codes 8–12 and 17
can be surfaced by SDK preflight; codes 5–7 and 13–16 are enforced by the
on-chain contract only.

| Code | Variant | Description |
|------|---------|-------------|
| 5 | — | Inner lock rejected the spend (on-chain only) |
| 6 | — | Flags byte invalid — no check bits or reserved bits set (on-chain only) |
| 7 | — | Lock args too short (on-chain only) |
| 8 | `MissingRegistryCellDep` | Required registry cell dep not found |
| 9 | `InvalidRegistryData` | Registry data malformed or unsupported version |
| 10 | `RegistryNotSorted` | Registry entries not in ascending order |
| 11 | `BlacklistedLockArgs` | Output lock args found in active blacklist |
| 12 | `BlacklistedTypeArgs` | Output type args found in active blacklist |
| 13 | — | Governance threshold not met (on-chain only) |
| 14 | — | Invalid governance signature (on-chain only) |
| 15 | — | Invalid Merkle proof (on-chain only) |
| 16 | — | Review window still active (on-chain only, via CKB `since`) |
| 17 | `AmbiguousRegistryCellDep` | Multiple cell deps match the same registry spec |

## Features

### `serde`

Enables `Serialize` / `Deserialize` on all public types.

```toml
ckb-transaction-firewall-sdk = { version = "0.3", features = ["serde"] }
```

### `testnet`

Exposes the `testnet` module with testnet RPC URL, governance constants, and
deployed contract outpoints.

```rust
#[cfg(feature = "testnet")]
use ckb_transaction_firewall_sdk::testnet;

let rpc = testnet::RPC_URL;
let registry = testnet::registry_spec();
```

## Architecture note

This crate is **purely in-process** — no RPC calls, no async, no network I/O.
It operates on `CellDepLike` / `UnsignedTxLike` values you construct from your
own RPC results or transaction builder. The on-chain firewall-lock contract
additionally enforces governance signatures and the 72-hour review window via
CKB `since`; this SDK covers only the blacklist preflight (codes 8–12, 17).
