---
title: Rust SDK
description: Use the Rust SDK to validate unsigned CKB transactions against a live registry snapshot.
---

The Rust SDK exposes the same pre-flight policy as the TypeScript SDK, but in plain Rust data structures.

## Install

```bash
cargo add ckb-transaction-firewall-sdk
```

## What it provides

- A `check_transaction` helper
- `FirewallConfig` for the registry script identity
- Structured error codes for missing, invalid, or ambiguous registry data

## Basic usage

```rust
use ckb_transaction_firewall_sdk::{
    check_transaction, CellDepLike, FirewallConfig, HashType, ScriptLike, TxOutputLike,
    UnsignedTxLike,
};

let registry_script = ScriptLike {
    code_hash: [0xbb; 32],
    hash_type: HashType::Type,
    args: vec![0x01, 0x02, 0x03],
};

let tx = UnsignedTxLike {
    cell_deps: vec![CellDepLike {
        type_script: Some(registry_script.clone()),
        data: hex::decode("424c4b4c0100000000").unwrap(),
    }],
    outputs: vec![TxOutputLike {
        lock_args: vec![0xaa, 0xbb],
        type_args: None,
    }],
};

let result = check_transaction(
    &FirewallConfig {
        registry_script,
    },
    &tx,
);

assert!(result.is_ok());
```

## What to pass in

The Rust crate works with plain data structures:

- `ScriptLike`
- `CellDepLike`
- `TxOutputLike`
- `UnsignedTxLike`

That keeps the SDK easy to embed in tools or services that already have transaction data in memory.

## Behavior

- The registry dependency must match the configured registry script exactly
- The registry payload must start with `BLKL`
- Blacklisted `lock_args` and `type_args` are rejected
- Missing, invalid, or ambiguous registry dependencies are rejected
- Entries must be strictly sorted if you want the Rust parser to accept them

## When to use it

Use the Rust SDK if your transaction builder, wallet tooling, or service is already Rust-based and you want the same pre-flight check that the TypeScript package provides.

If you need the live registry cell wiring first, start with [How to Use](./how-to-use.mdx).
