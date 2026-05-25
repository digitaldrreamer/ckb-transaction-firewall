use std::fmt;

/// Errors returned by the CKB Transaction Firewall SDK.
///
/// Each variant maps to a specific on-chain error code. Codes 8–12 and 17
/// can be surfaced by SDK preflight; codes 5–7 and 13–16 are enforced
/// exclusively by the on-chain contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FirewallError {
    /// No registry cell dep matches the required spec (on-chain code 8).
    MissingRegistryCellDep,
    /// Registry cell data is malformed or has an unsupported version (on-chain code 9).
    InvalidRegistryData,
    /// Registry entries are not in ascending lexicographic order (on-chain code 10).
    RegistryNotSorted,
    /// A transaction output's lock args appear in the active blacklist (on-chain code 11).
    BlacklistedLockArgs,
    /// A transaction output's type args appear in the active blacklist (on-chain code 12).
    BlacklistedTypeArgs,
    /// More than one cell dep matches the same registry spec (on-chain code 17).
    AmbiguousRegistryCellDep,
}

impl FirewallError {
    /// On-chain error code corresponding to this error variant.
    pub fn code(&self) -> i8 {
        match self {
            FirewallError::MissingRegistryCellDep => error_codes::MISSING_REGISTRY_CELL_DEP,
            FirewallError::InvalidRegistryData => error_codes::INVALID_REGISTRY_DATA,
            FirewallError::RegistryNotSorted => error_codes::REGISTRY_NOT_SORTED,
            FirewallError::BlacklistedLockArgs => error_codes::BLACKLISTED_LOCK_ARGS,
            FirewallError::BlacklistedTypeArgs => error_codes::BLACKLISTED_TYPE_ARGS,
            FirewallError::AmbiguousRegistryCellDep => error_codes::AMBIGUOUS_REGISTRY_CELL_DEP,
        }
    }
}

impl fmt::Display for FirewallError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FirewallError::MissingRegistryCellDep =>
                write!(f, "missing registry cell dep (code {})", self.code()),
            FirewallError::InvalidRegistryData =>
                write!(f, "invalid registry data (code {})", self.code()),
            FirewallError::RegistryNotSorted =>
                write!(f, "registry entries not sorted (code {})", self.code()),
            FirewallError::BlacklistedLockArgs =>
                write!(f, "blacklisted lock args (code {})", self.code()),
            FirewallError::BlacklistedTypeArgs =>
                write!(f, "blacklisted type args (code {})", self.code()),
            FirewallError::AmbiguousRegistryCellDep =>
                write!(f, "ambiguous registry cell dep (code {})", self.code()),
        }
    }
}

impl std::error::Error for FirewallError {}

/// On-chain error codes for the CKB Transaction Firewall lock script.
///
/// Codes 8–12 and 17 can be surfaced by SDK preflight.
/// Codes 5–7 and 13–16 are enforced exclusively by the on-chain contract.
pub mod error_codes {
    /// Inner lock script rejected the spend (on-chain only).
    pub const INNER_LOCK_REJECTED: i8 = 5;
    /// Flags byte is invalid — both check bits clear or reserved bits set (on-chain only).
    pub const INVALID_FLAGS: i8 = 6;
    /// Lock args are too short to be a valid firewall lock (on-chain only).
    pub const LOCK_ARGS_TOO_SHORT: i8 = 7;
    /// No registry cell dep matched the required spec.
    pub const MISSING_REGISTRY_CELL_DEP: i8 = 8;
    /// Registry cell data is malformed or uses an unsupported version.
    pub const INVALID_REGISTRY_DATA: i8 = 9;
    /// Registry entries are not in ascending lexicographic order.
    pub const REGISTRY_NOT_SORTED: i8 = 10;
    /// An output's lock args are in the active blacklist.
    pub const BLACKLISTED_LOCK_ARGS: i8 = 11;
    /// An output's type args are in the active blacklist.
    pub const BLACKLISTED_TYPE_ARGS: i8 = 12;
    /// Governance signature count is below threshold (on-chain only).
    pub const GOVERNANCE_THRESHOLD_NOT_MET: i8 = 13;
    /// A governance signature is invalid (on-chain only).
    pub const INVALID_GOVERNANCE_SIGNATURE: i8 = 14;
    /// Governance Merkle proof is invalid (on-chain only).
    pub const INVALID_MERKLE_PROOF: i8 = 15;
    /// Review window has not elapsed yet — enforced via CKB `since` (on-chain only).
    pub const REVIEW_WINDOW_ACTIVE: i8 = 16;
    /// More than one cell dep matched the same registry spec.
    pub const AMBIGUOUS_REGISTRY_CELL_DEP: i8 = 17;
}
