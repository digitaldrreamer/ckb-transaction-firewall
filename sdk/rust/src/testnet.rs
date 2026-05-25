//! Testnet constants for the CKB Transaction Firewall.
//!
//! Enable with `features = ["testnet"]`.
//!
//! **These are placeholder values.** The actual deployed contract outpoints,
//! code hashes, and governance public keys will be populated here once the
//! testnet deployment is finalised. Until then every function returns zeroed
//! bytes and should not be used in production code.
//!
//! Not suitable for mainnet use.

use crate::types::{DepType, HashType, OutPointLike, RegistrySpec, TransactionCellDep};

/// Testnet CKB RPC endpoint.
pub const RPC_URL: &str = "https://testnet.ckb.dev";

/// Governance threshold — number of signatures required for a governance update.
/// Placeholder; will reflect the actual deployed multisig configuration.
pub const GOVERNANCE_THRESHOLD: u8 = 3;

/// Number of validator entries in the testnet Merkle tree.
/// Placeholder; will reflect the actual deployed validator set.
pub const GOVERNANCE_VALIDATOR_COUNT: u16 = 5;

/// The 5 secp256k1 compressed public keys that govern the testnet firewall.
/// Threshold is 3-of-5.
///
/// **Placeholder — all zeroes until the testnet deployment is finalised.**
pub const GOVERNANCE_PUBKEYS: [[u8; 33]; 5] = [
    [0u8; 33],
    [0u8; 33],
    [0u8; 33],
    [0u8; 33],
    [0u8; 33],
];

/// Deployed contract cells on testnet.
///
/// All outpoints are placeholders (zeroed tx hash) until the contracts are deployed.
pub mod contracts {
    use super::*;

    /// Returns the testnet firewall-lock code cell.
    /// **Placeholder — outpoint is zeroed until deployment.**
    pub fn firewall_lock() -> TransactionCellDep {
        TransactionCellDep {
            out_point: OutPointLike { tx_hash: [0u8; 32], index: 0 },
            dep_type: DepType::Code,
        }
    }

    /// Returns the testnet blacklist-registry code cell.
    /// **Placeholder — outpoint is zeroed until deployment.**
    pub fn blacklist_registry() -> TransactionCellDep {
        TransactionCellDep {
            out_point: OutPointLike { tx_hash: [0u8; 32], index: 1 },
            dep_type: DepType::Code,
        }
    }

    /// Returns the testnet governance-lock code cell.
    /// **Placeholder — outpoint is zeroed until deployment.**
    pub fn governance_lock() -> TransactionCellDep {
        TransactionCellDep {
            out_point: OutPointLike { tx_hash: [0u8; 32], index: 2 },
            dep_type: DepType::Code,
        }
    }

    /// Returns the testnet spawn-aware-secp256k1 code cell (inner lock).
    /// **Placeholder — outpoint is zeroed until deployment.**
    pub fn spawn_aware_secp256k1() -> TransactionCellDep {
        TransactionCellDep {
            out_point: OutPointLike { tx_hash: [0u8; 32], index: 3 },
            dep_type: DepType::Code,
        }
    }
}

/// Returns the [`RegistrySpec`] for the current testnet registry cell.
///
/// **Placeholder — code_hash and type_id_value are zeroed until deployment.**
pub fn registry_spec() -> RegistrySpec {
    RegistrySpec {
        code_hash: [0u8; 32],
        hash_type: HashType::Type,
        type_id_value: [0u8; 32],
        required: true,
    }
}

/// Returns the live outpoint of the testnet registry data cell.
///
/// **Placeholder — moves after every governance update; always fetch fresh
/// values from the RPC before building transactions.**
pub fn registry_cell() -> OutPointLike {
    OutPointLike { tx_hash: [0u8; 32], index: 0 }
}
