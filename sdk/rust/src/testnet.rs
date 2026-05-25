//! Testnet constants for the CKB Transaction Firewall.
//!
//! Enable with `features = ["testnet"]`. All values reflect the current
//! testnet deployment; they will be updated as contracts are upgraded.
//!
//! These constants are **not** suitable for mainnet use.

use crate::types::{DepType, HashType, OutPointLike, RegistrySpec, TransactionCellDep};

/// Testnet CKB RPC endpoint.
pub const RPC_URL: &str = "https://testnet.ckb.dev";

/// Governance threshold — number of signatures required for a governance update.
pub const GOVERNANCE_THRESHOLD: u8 = 3;

/// Number of validator entries in the testnet Merkle tree.
pub const GOVERNANCE_VALIDATOR_COUNT: u16 = 5;

/// The 5 secp256k1 compressed public keys that govern the testnet firewall.
/// Threshold is 3-of-5.
///
/// These are placeholder values; replace with the actual deployed pubkeys once
/// the testnet deployment is finalised.
pub const GOVERNANCE_PUBKEYS: [[u8; 33]; 5] = [
    [0u8; 33],
    [0u8; 33],
    [0u8; 33],
    [0u8; 33],
    [0u8; 33],
];

/// Deployed contract cells on testnet.
pub mod contracts {
    use super::*;

    /// Returns the testnet firewall-lock code cell.
    ///
    /// Replace the placeholder outpoint with the actual deployed cell once
    /// the testnet deployment is finalised.
    pub fn firewall_lock() -> TransactionCellDep {
        TransactionCellDep {
            out_point: OutPointLike { tx_hash: [0u8; 32], index: 0 },
            dep_type: DepType::Code,
        }
    }

    /// Returns the testnet blacklist-registry code cell.
    pub fn blacklist_registry() -> TransactionCellDep {
        TransactionCellDep {
            out_point: OutPointLike { tx_hash: [0u8; 32], index: 1 },
            dep_type: DepType::Code,
        }
    }

    /// Returns the testnet governance-lock code cell.
    pub fn governance_lock() -> TransactionCellDep {
        TransactionCellDep {
            out_point: OutPointLike { tx_hash: [0u8; 32], index: 2 },
            dep_type: DepType::Code,
        }
    }

    /// Returns the testnet spawn-aware-secp256k1 code cell (inner lock).
    pub fn spawn_aware_secp256k1() -> TransactionCellDep {
        TransactionCellDep {
            out_point: OutPointLike { tx_hash: [0u8; 32], index: 3 },
            dep_type: DepType::Code,
        }
    }
}

/// Returns the [`RegistrySpec`] for the current testnet registry cell.
///
/// The `type_id_value` (bytes 34–66 of the registry type-script args) is the
/// stable identifier that survives governance upgrades. Replace with the actual
/// value from the deployment once finalised.
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
/// This moves after every governance update. Fetch fresh values from the
/// RPC before building transactions.
pub fn registry_cell() -> OutPointLike {
    OutPointLike { tx_hash: [0u8; 32], index: 0 }
}
