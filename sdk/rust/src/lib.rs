//! # ckb-transaction-firewall-sdk
//!
//! Off-chain pre-flight blacklist check for CKB transactions.
//!
//! Before broadcasting a transaction, call [`check_transaction`] to verify
//! that no output's lock or type args appear in the on-chain BLKL v2 blacklist
//! registry. The check mirrors what the on-chain firewall-lock contract enforces
//! at execution time, letting wallets and dApps reject blacklisted transactions
//! early without spending UTXOs.
//!
//! ## Quick start
//!
//! ```rust
//! use ckb_transaction_firewall_sdk::{
//!     check_transaction, FirewallConfig, RegistrySpec, HashType,
//!     CellDepLike, ScriptLike, TxOutputLike, UnsignedTxLike,
//! };
//!
//! // Identify the registry cell dep by its type_id_value (bytes 34-66 of
//! // the registry type-script args). This is stable across governance upgrades.
//! let spec = RegistrySpec {
//!     code_hash: [0u8; 32],   // replace with actual code hash
//!     hash_type: HashType::Type,
//!     type_id_value: [0u8; 32], // replace with actual type id value
//!     required: true,
//! };
//!
//! let cfg = FirewallConfig { registries: vec![spec] };
//!
//! // Build the transaction (with the live registry cell as a cell dep)
//! let tx = UnsignedTxLike {
//!     cell_deps: vec![/* ... live registry cell dep ... */],
//!     outputs: vec![TxOutputLike {
//!         lock_args: vec![0xde, 0xad],
//!         type_args: None,
//!     }],
//! };
//!
//! let now_secs = std::time::SystemTime::now()
//!     .duration_since(std::time::UNIX_EPOCH)
//!     .unwrap()
//!     .as_secs();
//!
//! match check_transaction(&cfg, &tx, now_secs) {
//!     Ok(()) => println!("transaction is clean"),
//!     Err(e) => println!("blocked: {} (code {})", e, e.code()),
//! }
//! ```
//!
//! ## Feature flags
//!
//! - **`serde`** — derives `Serialize` / `Deserialize` on all public types.
//! - **`testnet`** — exposes the [`testnet`] module with testnet RPC URL,
//!   governance constants, and deployed contract outpoints.

pub mod builder;
pub mod errors;
pub mod firewall;
pub mod registry;
pub mod types;

#[cfg(feature = "testnet")]
pub mod testnet;

// ── flat re-exports for ergonomic `use ckb_transaction_firewall_sdk::*` ──────

pub use builder::{
    build_firewall_lock_args, build_firewall_lock_script, build_firewall_spend_cell_deps,
};
pub use errors::{error_codes, FirewallError};
pub use firewall::{check_transaction, is_blacklisted, preflight_check};
pub use registry::{encode_governance_header, encode_registry_payload, parse_registry_payload};
pub use types::{
    CellDepLike, DepType, FirewallConfig, FirewallLockConfig, FirewallSpendDepsConfig,
    GovernanceHeader, HashType, OutPointLike, RegistryEntry, RegistryPayload, RegistrySpec,
    ScriptLike, TransactionCellDep, TxOutputLike, UnsignedTxLike,
};

#[cfg(test)]
mod tests {
    use super::*;

    // ── test helpers ─────────────────────────────────────────────────────────

    fn spec(tag: u8) -> RegistrySpec {
        let mut type_id = [0u8; 32];
        type_id[0] = tag;
        let mut code_hash = [0u8; 32];
        code_hash[0] = tag;
        RegistrySpec {
            code_hash,
            hash_type: HashType::Type,
            type_id_value: type_id,
            required: true,
        }
    }

    fn dep_for_spec(s: &RegistrySpec, data: Vec<u8>) -> CellDepLike {
        // Registry type args are exactly 66 bytes; type_id_value at [34..66].
        let mut args = vec![0u8; 66];
        args[34..66].copy_from_slice(&s.type_id_value);
        CellDepLike {
            type_script: Some(ScriptLike {
                code_hash: s.code_hash,
                hash_type: s.hash_type.clone(),
                args,
            }),
            data,
        }
    }

    fn registry(ids: &[&[u8]]) -> Vec<u8> {
        registry_with_expiry(&ids.iter().map(|id| (*id, 0u64)).collect::<Vec<_>>())
    }

    fn registry_with_expiry(ids: &[(&[u8], u64)]) -> Vec<u8> {
        encode_registry_payload(&RegistryPayload {
            version: 2,
            governance_header: None,
            entries: ids
                .iter()
                .map(|(id, exp)| RegistryEntry {
                    identifier: id.to_vec(),
                    expires_at: *exp,
                })
                .collect(),
        })
        .unwrap()
    }

    fn cfg1(s: RegistrySpec) -> FirewallConfig {
        FirewallConfig {
            registries: vec![s],
        }
    }

    // ── check_transaction tests ───────────────────────────────────────────────

    #[test]
    fn reject_missing_dep() {
        let s = spec(1);
        let tx = UnsignedTxLike {
            cell_deps: vec![],
            outputs: vec![],
        };
        let err = check_transaction(&cfg1(s), &tx, 0).unwrap_err();
        assert_eq!(err, FirewallError::MissingRegistryCellDep);
        assert_eq!(err.code(), 8);
    }

    #[test]
    fn reject_blacklisted_lock_args() {
        let s = spec(1);
        let dep = dep_for_spec(&s, registry(&[&[0xaa, 0xbb]]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep],
            outputs: vec![TxOutputLike {
                lock_args: vec![0xaa, 0xbb],
                type_args: None,
            }],
        };
        let err = check_transaction(&cfg1(s), &tx, 0).unwrap_err();
        assert_eq!(err, FirewallError::BlacklistedLockArgs);
        assert_eq!(err.code(), 11);
    }

    #[test]
    fn reject_ambiguous_registry_dep() {
        let s = spec(1);
        let dep = dep_for_spec(&s, registry(&[&[0xaa]]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep.clone(), dep],
            outputs: vec![TxOutputLike {
                lock_args: vec![0x00],
                type_args: None,
            }],
        };
        let err = check_transaction(&cfg1(s), &tx, 0).unwrap_err();
        assert_eq!(err, FirewallError::AmbiguousRegistryCellDep);
        assert_eq!(err.code(), 17);
    }

    #[test]
    fn reject_registry_not_sorted() {
        let s = spec(1);
        let dep = dep_for_spec(&s, registry(&[&[0xbb], &[0xaa]]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep],
            outputs: vec![TxOutputLike {
                lock_args: vec![0x00],
                type_args: None,
            }],
        };
        let err = check_transaction(&cfg1(s), &tx, 0).unwrap_err();
        assert_eq!(err, FirewallError::RegistryNotSorted);
        assert_eq!(err.code(), 10);
    }

    #[test]
    fn reject_blacklisted_type_args() {
        let s = spec(1);
        let dep = dep_for_spec(&s, registry(&[&[0x55, 0x66]]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep],
            outputs: vec![TxOutputLike {
                lock_args: vec![0x11, 0x22],
                type_args: Some(vec![0x55, 0x66]),
            }],
        };
        let err = check_transaction(&cfg1(s), &tx, 0).unwrap_err();
        assert_eq!(err, FirewallError::BlacklistedTypeArgs);
        assert_eq!(err.code(), 12);
    }

    #[test]
    fn reject_v1_registry() {
        let mut data = Vec::new();
        data.extend_from_slice(b"BLKL");
        data.push(1);
        data.extend_from_slice(&0u32.to_le_bytes());
        assert_eq!(
            parse_registry_payload(&data).unwrap_err(),
            FirewallError::InvalidRegistryData,
        );
    }

    #[test]
    fn reject_unknown_version() {
        let mut data = Vec::new();
        data.extend_from_slice(b"BLKL");
        data.push(3);
        data.extend_from_slice(&[0u8; 4]);
        assert_eq!(
            parse_registry_payload(&data).unwrap_err(),
            FirewallError::InvalidRegistryData,
        );
    }

    #[test]
    fn parse_v2_registry_with_governance_header() {
        let data = registry(&[&[0xaa, 0xbb]]);
        let payload = parse_registry_payload(&data).unwrap();
        assert_eq!(payload.version, 2);
        assert_eq!(payload.entries.len(), 1);
        let gh = payload.governance_header.unwrap();
        assert_eq!(gh.signer_count, 0);
    }

    #[test]
    fn expire_check_active() {
        let s = spec(1);
        let dep = dep_for_spec(&s, registry_with_expiry(&[(&[0xaa], 1000)]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep],
            outputs: vec![TxOutputLike {
                lock_args: vec![0xaa],
                type_args: None,
            }],
        };
        assert_eq!(
            check_transaction(&cfg1(s), &tx, 999).unwrap_err(),
            FirewallError::BlacklistedLockArgs,
        );
    }

    #[test]
    fn expire_check_expired() {
        let s = spec(1);
        let dep = dep_for_spec(&s, registry_with_expiry(&[(&[0xaa], 1000)]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep],
            outputs: vec![TxOutputLike {
                lock_args: vec![0xaa],
                type_args: None,
            }],
        };
        assert!(check_transaction(&cfg1(s), &tx, 1000).is_ok());
    }

    #[test]
    fn permanent_entry_always_blacklisted() {
        let s = spec(1);
        let dep = dep_for_spec(&s, registry_with_expiry(&[(&[0xbb], 0)]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep],
            outputs: vec![TxOutputLike {
                lock_args: vec![0xbb],
                type_args: None,
            }],
        };
        assert_eq!(
            check_transaction(&cfg1(s), &tx, u64::MAX).unwrap_err(),
            FirewallError::BlacklistedLockArgs,
        );
    }

    #[test]
    fn multi_registry_both_checked() {
        let s1 = spec(1);
        let s2 = spec(2);
        let dep1 = dep_for_spec(&s1, registry(&[&[0x11]]));
        let dep2 = dep_for_spec(&s2, registry(&[&[0x22]]));
        let firewall_cfg = FirewallConfig {
            registries: vec![s1, s2],
        };
        let tx = UnsignedTxLike {
            cell_deps: vec![dep1, dep2],
            outputs: vec![TxOutputLike {
                lock_args: vec![0x22],
                type_args: None,
            }],
        };
        assert_eq!(
            check_transaction(&firewall_cfg, &tx, 0).unwrap_err(),
            FirewallError::BlacklistedLockArgs,
        );
    }

    #[test]
    fn multi_registry_missing_required() {
        let s1 = spec(1);
        let s2 = spec(2);
        let dep1 = dep_for_spec(&s1, registry(&[]));
        let firewall_cfg = FirewallConfig {
            registries: vec![s1, s2],
        };
        let tx = UnsignedTxLike {
            cell_deps: vec![dep1],
            outputs: vec![],
        };
        assert_eq!(
            check_transaction(&firewall_cfg, &tx, 0).unwrap_err(),
            FirewallError::MissingRegistryCellDep,
        );
    }

    #[test]
    fn multi_registry_optional_miss_ok() {
        let s1 = spec(1);
        let mut s2 = spec(2);
        s2.required = false;
        let dep1 = dep_for_spec(&s1, registry(&[]));
        let firewall_cfg = FirewallConfig {
            registries: vec![s1, s2],
        };
        let tx = UnsignedTxLike {
            cell_deps: vec![dep1],
            outputs: vec![TxOutputLike {
                lock_args: vec![0x99],
                type_args: None,
            }],
        };
        assert!(check_transaction(&firewall_cfg, &tx, 0).is_ok());
    }

    #[test]
    fn v2_trailing_data_rejected() {
        let mut data = registry(&[&[0xaa]]);
        data.push(0xff);
        assert_eq!(
            parse_registry_payload(&data).unwrap_err(),
            FirewallError::InvalidRegistryData,
        );
    }

    // ── dep matching: exact 66-byte type args ─────────────────────────────────────

    #[test]
    fn dep_with_wrong_args_length_not_matched() {
        let s = spec(1);
        // Build a dep whose type args are 67 bytes (not exactly 66) — should not match.
        let mut args = vec![0u8; 67];
        args[34..66].copy_from_slice(&s.type_id_value);
        let dep = CellDepLike {
            type_script: Some(ScriptLike {
                code_hash: s.code_hash,
                hash_type: s.hash_type.clone(),
                args,
            }),
            data: registry(&[]),
        };
        let tx = UnsignedTxLike {
            cell_deps: vec![dep],
            outputs: vec![],
        };
        assert_eq!(
            check_transaction(&cfg1(s), &tx, 0).unwrap_err(),
            FirewallError::MissingRegistryCellDep,
        );
    }

    // ── builder tests ─────────────────────────────────────────────────────────

    #[test]
    fn build_lock_args_roundtrip() {
        let spec = RegistrySpec {
            code_hash: [0xab; 32],
            hash_type: HashType::Type,
            type_id_value: [0xcd; 32],
            required: true,
        };
        let config = FirewallLockConfig {
            firewall_code_hash: [0x01; 32],
            firewall_hash_type: HashType::Type,
            flags: 0x01,
            registries: vec![spec],
            inner_code_hash: [0x02; 32],
            inner_hash_type: HashType::Data1,
            inner_args: vec![0x11, 0x22, 0x33],
        };
        let args = build_firewall_lock_args(&config).unwrap();
        assert_eq!(args[0], 0x02); // version
        assert_eq!(args[1], 0x01); // flags
        assert_eq!(args[2], 0x01); // registry_count
        assert_eq!(&args[3..35], &[0xab; 32]); // code_hash
        assert_eq!(args[35], 0x01); // hash_type = Type
        assert_eq!(&args[36..68], &[0xcd; 32]); // type_id_value
        assert_eq!(args[68], 0x01); // required
        assert_eq!(&args[69..101], &[0x02; 32]); // inner_code_hash
        assert_eq!(args[101], 0x02); // inner_hash_type = Data1
        assert_eq!(args[102], 0x03);
        assert_eq!(args[103], 0x00); // inner_args_len LE
        assert_eq!(&args[104..107], &[0x11, 0x22, 0x33]); // inner_args
    }

    #[test]
    fn build_lock_args_rejects_no_check_bits() {
        let config = FirewallLockConfig {
            firewall_code_hash: [0u8; 32],
            firewall_hash_type: HashType::Type,
            flags: 0x00,
            registries: vec![],
            inner_code_hash: [0u8; 32],
            inner_hash_type: HashType::Type,
            inner_args: vec![],
        };
        assert_eq!(
            build_firewall_lock_args(&config).unwrap_err(),
            FirewallError::InvalidRegistryData,
        );
    }

    #[test]
    fn build_lock_args_rejects_reserved_bits() {
        let config = FirewallLockConfig {
            firewall_code_hash: [0u8; 32],
            firewall_hash_type: HashType::Type,
            flags: 0x05, // bit 0 + reserved bit 2
            registries: vec![],
            inner_code_hash: [0u8; 32],
            inner_hash_type: HashType::Type,
            inner_args: vec![],
        };
        assert_eq!(
            build_firewall_lock_args(&config).unwrap_err(),
            FirewallError::InvalidRegistryData,
        );
    }

    // ── encode/decode roundtrip ────────────────────────────────────────────────

    #[test]
    fn encode_decode_roundtrip() {
        let original = RegistryPayload {
            version: 2,
            governance_header: Some(GovernanceHeader {
                signer_count: 2,
                threshold: 2,
                pubkeys: vec![[0x02; 33], [0x03; 33]],
                validator_count: 3,
                validator_merkle_root: [0xee; 32],
            }),
            entries: vec![
                RegistryEntry {
                    identifier: vec![0x01],
                    expires_at: 0,
                },
                RegistryEntry {
                    identifier: vec![0x02],
                    expires_at: 9999,
                },
            ],
        };
        let encoded = encode_registry_payload(&original).unwrap();
        let decoded = parse_registry_payload(&encoded).unwrap();
        assert_eq!(decoded.version, 2);
        assert_eq!(decoded.entries.len(), 2);
        let gh = decoded.governance_header.unwrap();
        assert_eq!(gh.signer_count, 2);
        assert_eq!(gh.threshold, 2);
        assert_eq!(gh.pubkeys.len(), 2);
        assert_eq!(gh.validator_count, 3);
        assert_eq!(gh.validator_merkle_root, [0xee; 32]);
    }

    #[test]
    fn encode_registry_payload_rejects_long_id() {
        let payload = RegistryPayload {
            version: 2,
            governance_header: None,
            entries: vec![RegistryEntry {
                identifier: vec![0u8; 256], // 256 > u8::MAX
                expires_at: 0,
            }],
        };
        assert_eq!(
            encode_registry_payload(&payload).unwrap_err(),
            FirewallError::InvalidRegistryData,
        );
    }

    // ── preflight_check / is_blacklisted ──────────────────────────────────────

    #[test]
    fn is_blacklisted_standalone() {
        let payload = parse_registry_payload(&registry(&[&[0xde, 0xad]])).unwrap();
        assert!(is_blacklisted(&[0xde, 0xad], &[payload.clone()], 0));
        assert!(!is_blacklisted(&[0xbe, 0xef], &[payload], 0));
    }

    #[test]
    fn preflight_check_standalone() {
        let payload = parse_registry_payload(&registry(&[&[0xca, 0xfe]])).unwrap();
        let ok_outputs = vec![TxOutputLike {
            lock_args: vec![0x00],
            type_args: None,
        }];
        assert!(preflight_check(&ok_outputs, &[payload.clone()], 0).is_ok());
        let bad_outputs = vec![TxOutputLike {
            lock_args: vec![0xca, 0xfe],
            type_args: None,
        }];
        assert_eq!(
            preflight_check(&bad_outputs, &[payload], 0).unwrap_err(),
            FirewallError::BlacklistedLockArgs,
        );
    }

    // ── error code constants ──────────────────────────────────────────────────

    #[test]
    fn error_code_values_match_contract() {
        assert_eq!(error_codes::INVALID_ARGS_LAYOUT, 5);
        assert_eq!(error_codes::UNSUPPORTED_VERSION, 6);
        assert_eq!(error_codes::UNSUPPORTED_FLAGS, 7);
        assert_eq!(error_codes::MISSING_REGISTRY_CELL_DEP, 8);
        assert_eq!(error_codes::INVALID_REGISTRY_DATA, 9);
        assert_eq!(error_codes::REGISTRY_NOT_SORTED, 10);
        assert_eq!(error_codes::BLACKLISTED_LOCK_ARGS, 11);
        assert_eq!(error_codes::BLACKLISTED_TYPE_ARGS, 12);
        assert_eq!(error_codes::MISSING_INNER_LOCK_CELL_DEP, 13);
        assert_eq!(error_codes::INVALID_INNER_LOCK_SCRIPT, 14);
        assert_eq!(error_codes::INNER_LOCK_REJECTED, 15);
        assert_eq!(error_codes::OUTPUT_SCRIPT_PARSE_FAILED, 16);
        assert_eq!(error_codes::AMBIGUOUS_REGISTRY_CELL_DEP, 17);
    }
}
