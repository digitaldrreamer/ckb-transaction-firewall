#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

#[cfg(feature = "serde")]
mod serde_pubkeys_33 {
    use serde::de::{Error, SeqAccess, Visitor};
    use serde::ser::SerializeSeq;
    use serde::{Deserializer, Serializer};
    use std::fmt;

    pub fn serialize<S>(pubkeys: &Vec<[u8; 33]>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut seq = serializer.serialize_seq(Some(pubkeys.len()))?;
        for pubkey in pubkeys {
            seq.serialize_element(&pubkey.as_slice())?;
        }
        seq.end()
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<[u8; 33]>, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct PubkeysVisitor;

        impl<'de> Visitor<'de> for PubkeysVisitor {
            type Value = Vec<[u8; 33]>;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a sequence of 33-byte public keys")
            }

            fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
            where
                A: SeqAccess<'de>,
            {
                let mut pubkeys = Vec::with_capacity(seq.size_hint().unwrap_or(0));
                while let Some(pubkey) = seq.next_element::<Vec<u8>>()? {
                    if pubkey.len() != 33 {
                        return Err(A::Error::custom("public key must be exactly 33 bytes"));
                    }
                    let mut out = [0u8; 33];
                    out.copy_from_slice(&pubkey);
                    pubkeys.push(out);
                }
                Ok(pubkeys)
            }
        }

        deserializer.deserialize_seq(PubkeysVisitor)
    }
}

/// CKB script hash type.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
pub enum HashType {
    Data,
    Type,
    Data1,
}

impl HashType {
    /// Serialises to the single-byte on-chain encoding: data=0, type=1, data1=2.
    pub fn to_byte(&self) -> u8 {
        match self {
            HashType::Data => 0,
            HashType::Type => 1,
            HashType::Data1 => 2,
        }
    }

    /// Deserialises from the single-byte on-chain encoding. Returns `None` for
    /// any byte that is not a known hash type.
    pub fn from_byte(b: u8) -> Option<Self> {
        match b {
            0 => Some(HashType::Data),
            1 => Some(HashType::Type),
            2 => Some(HashType::Data1),
            _ => None,
        }
    }
}

/// A CKB script (lock or type) in its component form.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptLike {
    pub code_hash: [u8; 32],
    pub hash_type: HashType,
    pub args: Vec<u8>,
}

/// Identifies a registry cell dep by the 32-byte Type ID value stored at
/// bytes 34–66 of the v2 registry type-script args.
///
/// Matching on `type_id_value` rather than full type-script equality means the
/// spec survives governance-lock upgrades: the governance code hash at bytes
/// 1–33 can change without invalidating this spec.
///
/// Mirrors `RegistrySpecLike` in the TypeScript SDK.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistrySpec {
    pub code_hash: [u8; 32],
    pub hash_type: HashType,
    /// Bytes 34–66 of the registry cell's type-script args (the Type ID value).
    pub type_id_value: [u8; 32],
    /// When `true`, absence of a matching cell dep is an error.
    /// When `false`, the spec is silently skipped if no dep is found.
    pub required: bool,
}

/// A minimal view of a CKB cell dependency as seen by the preflight checker.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone)]
pub struct CellDepLike {
    pub type_script: Option<ScriptLike>,
    pub data: Vec<u8>,
}

/// A minimal view of a CKB transaction output as seen by the preflight checker.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone)]
pub struct TxOutputLike {
    pub lock_args: Vec<u8>,
    pub type_args: Option<Vec<u8>>,
}

/// A minimal unsigned CKB transaction as required by `check_transaction`.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone)]
pub struct UnsignedTxLike {
    pub cell_deps: Vec<CellDepLike>,
    pub outputs: Vec<TxOutputLike>,
}

/// Configuration for [`check_transaction`](crate::check_transaction).
///
/// Mirrors `FirewallConfig` in the TypeScript SDK.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone)]
pub struct FirewallConfig {
    pub registries: Vec<RegistrySpec>,
}

/// A single blacklist entry: an identifier (arbitrary bytes) and an expiry
/// timestamp in Unix seconds. `expires_at == 0` means the entry never expires.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistryEntry {
    pub identifier: Vec<u8>,
    /// Unix seconds. `0` means the entry is permanent.
    pub expires_at: u64,
}

/// Governance header embedded in every BLKL v2 registry payload.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GovernanceHeader {
    pub signer_count: u8,
    pub threshold: u8,
    #[cfg_attr(feature = "serde", serde(with = "serde_pubkeys_33"))]
    pub pubkeys: Vec<[u8; 33]>,
    pub validator_count: u16,
    pub validator_merkle_root: [u8; 32],
}

/// A parsed BLKL v2 registry payload.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistryPayload {
    pub version: u8,
    pub entries: Vec<RegistryEntry>,
    pub governance_header: Option<GovernanceHeader>,
}

// ── Builder types ─────────────────────────────────────────────────────────────

/// On-chain location of a deployed cell.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutPointLike {
    pub tx_hash: [u8; 32],
    pub index: u32,
}

/// A cell dependency entry for inclusion in a CKB transaction.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone)]
pub struct TransactionCellDep {
    pub out_point: OutPointLike,
    pub dep_type: DepType,
}

/// The dependency type of a cell dep.
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum DepType {
    Code,
    DepGroup,
}

/// Everything needed to assemble the cell deps for spending a firewall-protected
/// cell. Registry outpoints move after each governance update — always fetch
/// fresh values before calling [`build_firewall_spend_cell_deps`](crate::build_firewall_spend_cell_deps).
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone)]
pub struct FirewallSpendDepsConfig {
    /// Deployed firewall-lock code cell (the RISC-V binary).
    pub firewall_lock_out_point: OutPointLike,
    /// Deployed inner lock code cell (e.g. spawn-aware-secp256k1).
    pub inner_lock_out_point: OutPointLike,
    /// Live registry data cells — one per registry spec in the lock args.
    pub registry_out_points: Vec<OutPointLike>,
}

/// Full configuration for building a v2 firewall lock script.
///
/// Encodes to the v2 `FirewallLockArgs` byte layout:
/// `version(1)=0x02 | flags(1) | registry_count(1) |
/// [code_hash(32)|hash_type(1)|type_id_value(32)|required(1)]×N |
/// inner_code_hash(32) | inner_hash_type(1) | inner_args_len(2 LE) | inner_args(M)`
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[derive(Debug, Clone)]
pub struct FirewallLockConfig {
    /// Code hash and hash type of the deployed firewall-lock script.
    pub firewall_code_hash: [u8; 32],
    pub firewall_hash_type: HashType,
    /// Check flags: bit 0 = check lock_args, bit 1 = check type_args.
    /// At least one bit must be set; reserved bits (0xfc) must be clear.
    pub flags: u8,
    /// Registry specs to enforce. Maximum 255 entries.
    pub registries: Vec<RegistrySpec>,
    /// The inner lock to delegate to after blacklist checking passes.
    pub inner_code_hash: [u8; 32],
    pub inner_hash_type: HashType,
    /// Args for the inner lock. Maximum 65535 bytes.
    pub inner_args: Vec<u8>,
}
