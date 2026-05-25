# ckb-transaction-firewall-sdk

Off-chain pre-flight blacklist checker for CKB transactions.

Parses the on-chain BLKL registry payload and checks transaction outputs against the blacklisted address set before broadcasting. Uses binary search (O(log n)) with expiry-aware lookup so expired entries never block valid transactions.

This crate is **off-chain only**. Signature verification and the 72-hour governance review window are enforced at consensus by the on-chain contracts, not here.

## Quick start

```rust
use ckb_transaction_firewall_sdk::{
    check_transaction, CellDepLike, FirewallConfig, HashType, RegistrySpec,
    ScriptLike, TxOutputLike, UnsignedTxLike,
};

// Identify the registry cell dep by the blacklist-registry contract's code hash
// and the 32-byte Type ID value at bytes 34–66 of the type-script args.
let registry_spec = RegistrySpec {
    code_hash: /* blacklist-registry code hash */ [0u8; 32],
    hash_type: HashType::Type,
    type_id_value: /* 32-byte Type ID */ [0u8; 32],
    required: true,
};

let cfg = FirewallConfig {
    registries: vec![registry_spec],
};

// Populate these from your CKB library's transaction representation.
let tx = UnsignedTxLike {
    cell_deps: vec![
        CellDepLike {
            type_script: Some(ScriptLike {
                code_hash: [0u8; 32],
                hash_type: HashType::Type,
                args: /* full type-script args (≥66 bytes) */ vec![0u8; 66],
            }),
            data: /* raw registry cell data bytes */ vec![],
        },
    ],
    outputs: vec![
        TxOutputLike {
            lock_args: /* output lock script args */ vec![],
            type_args: /* output type script args, or None */ None,
        },
    ],
};

// Supply the chain's median time (or system clock for off-chain use).
let now_secs: u64 = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs();

match check_transaction(&cfg, &tx, now_secs) {
    Ok(()) => println!("transaction is safe to broadcast"),
    Err(e) => println!("blocked: {:?} (code {})", e, e.code()),
}
```

## Multiple registries

The v2 firewall-lock supports multiple registry cell deps. Add one `RegistrySpec` per registry:

```rust
let cfg = FirewallConfig {
    registries: vec![
        RegistrySpec { /* primary registry */ required: true, .. },
        RegistrySpec { /* secondary registry */ required: false, .. },
    ],
};
```

Optional registries (`required: false`) are skipped silently when their cell dep is absent. Required registries produce `FirewallError::MissingRegistryCellDep` when missing.

## Inspecting a registry

`parse_registry_payload` is public for callers that need to read registry contents directly:

```rust
use ckb_transaction_firewall_sdk::parse_registry_payload;

let payload = parse_registry_payload(&raw_cell_data)?;
println!("version: {}", payload.version);
println!("entries: {}", payload.entries.len());
if let Some(gh) = &payload.governance_header {
    println!("signers: {}/{}", gh.threshold, gh.signer_count);
}
for entry in &payload.entries {
    let exp = if entry.expires_at == 0 { "permanent".into() }
              else { format!("expires {}", entry.expires_at) };
    println!("  {:?} ({})", entry.identifier, exp);
}
```

## Error codes

| Code | Variant | Meaning |
|------|---------|--------|
| 8  | `MissingRegistryCellDep`  | Required registry dep not found in cell_deps |
| 9  | `InvalidRegistryData`     | Registry cell data failed to parse |
| 10 | `RegistryNotSorted`       | Registry entries are not in strictly sorted order |
| 11 | `BlacklistedLockArgs`     | An output's lock args match an active blacklist entry |
| 12 | `BlacklistedTypeArgs`     | An output's type args match an active blacklist entry |
| 17 | `AmbiguousRegistryCellDep`| More than one cell dep matched a single registry spec |

Error codes match the on-chain firewall-lock contract constants.

## License

MIT
