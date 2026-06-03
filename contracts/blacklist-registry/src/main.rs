//! Blacklist Registry Type Script - Governance Gate for Registry Updates
//!
//! This type script protects the canonical blacklist registry cell. It enforces:
//! - Exactly-one input + exactly-one output registry cell per update transaction.
//! - Registry payload format invariants (BLKL v2, sorted entries).
//! - Governance authorization via a configured governance lock script identity.
//! - Governance context binding via a GOV1 v4 witness payload committed to by tx signatures.
//! - Type ID enforcement to preserve registry identity across updates.
//!
//! Signature verification is delegated entirely to the governance-lock script
//! (WitnessArgs.lock). This type script only verifies the GOV1 binding (WitnessArgs.input_type).

#![no_std]
#![cfg_attr(not(test), no_main)]

// Production build guard: the testnet governance committee uses deterministic
// dev keys. Require an explicit opt-in so no-feature builds fail fast rather
// than silently producing a binary with unknown signer constraints.
// Remove this guard when the mainnet governance committee is finalized.
#[cfg(not(any(feature = "dev-signer-keys", test)))]
compile_error!(
    "blacklist-registry: build requires --features dev-signer-keys for testnet. \
     Remove this guard when the mainnet governance committee is finalized."
);

#[cfg(test)]
extern crate alloc;

#[cfg(not(test))]
use ckb_std::default_alloc;
#[cfg(not(test))]
ckb_std::entry!(main);
#[cfg(not(test))]
default_alloc!();

#[cfg(not(test))]
fn main() -> i8 {
    match program_entry() {
        Ok(()) => 0,
        Err(ckb_std::error::SysError::Unknown(code)) => code as i8,
        Err(_) => -1,
    }
}

use alloc::vec::Vec;
use blake2b_ref::{Blake2b, Blake2bBuilder};
use ckb_std::{
    ckb_constants::{CellField, Source},
    error::SysError,
    syscalls::{load_cell_by_field, load_cell_data, load_input, load_witness},
};

const MAX_PROPOSAL_ANCHOR_FEE_SHANNONS: u64 = 100_000_000; // 1 CKB

fn blake2b_256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut hasher: Blake2b = Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    hasher.update(data);
    hasher.finalize(&mut out);
    out
}

pub mod error {
    use ckb_std::error::SysError;

    pub const INVALID_TYPE_ARGS_LAYOUT: i8 = 20;
    pub const INVALID_REGISTRY_CELL_TOPOLOGY: i8 = 21;
    pub const INVALID_REGISTRY_PAYLOAD: i8 = 22;
    pub const UNSUPPORTED_REGISTRY_VERSION: i8 = 23;
    pub const INVALID_GOVERNANCE_WITNESS: i8 = 24;
    pub const UNAUTHORIZED_GOVERNANCE_LOCK: i8 = 25;
    // 26 reserved (previously UNAUTHORIZED_SIGNERS)
    pub const INVALID_TYPE_ID: i8 = 27;
    pub const INVALID_PROPOSAL_CELL: i8 = 28;

    pub fn to_sys_error(code: i8) -> SysError {
        SysError::Unknown(code as u64)
    }
}

/// Type args structure for the registry type script (v2).
///
/// Layout: version(1) | governance_code_hash(32) | governance_hash_type(1) | type_id_value(32) = 66 bytes.
/// Governance-lock args are always [0x01] (version byte only; keys live in BLKL header).
#[derive(Debug, Clone)]
pub struct RegistryTypeArgs {
    pub version: u8,
    pub governance_code_hash: [u8; 32],
    pub governance_hash_type: u8,
    pub type_id_value: [u8; 32],
}

impl RegistryTypeArgs {
    pub fn parse(args: &[u8]) -> Result<Self, SysError> {
        if args.len() != 66 {
            return Err(error::to_sys_error(error::INVALID_TYPE_ARGS_LAYOUT)); // diagnostic: len != 66
        }
        let version = args[0];
        if version != 0x02 {
            return Err(error::to_sys_error(error::INVALID_TYPE_ARGS_LAYOUT)); // diagnostic: version != 0x02
        }
        let mut governance_code_hash = [0u8; 32];
        governance_code_hash.copy_from_slice(&args[1..33]);
        let governance_hash_type = args[33];
        let mut type_id_value = [0u8; 32];
        type_id_value.copy_from_slice(&args[34..66]);
        Ok(Self {
            version,
            governance_code_hash,
            governance_hash_type,
            type_id_value,
        })
    }
}

fn parse_registry_type_args(raw: &[u8]) -> Result<RegistryTypeArgs, SysError> {
    RegistryTypeArgs::parse(raw)
}

/// Registry payload structure for BLKL v2.
#[derive(Debug)]
pub struct RegistryPayload {
    pub version: u8,
    pub entries: Vec<RegistryEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistryEntry {
    pub identifier: Vec<u8>,
    pub expires_at: u64,
}

impl RegistryPayload {
    pub fn parse(data: &[u8]) -> Result<Self, SysError> {
        // Minimum: BLKL(4) + version(1) + gov_header_len(2) + entry_count(4) = 11 bytes
        if data.len() < 11 {
            return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
        }
        if &data[0..4] != b"BLKL" {
            return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
        }
        let version = data[4];
        if version != 0x02 {
            return Err(error::to_sys_error(error::UNSUPPORTED_REGISTRY_VERSION));
        }
        let gov_header_len = u16::from_le_bytes([data[5], data[6]]) as usize;
        let entries_start = 7 + gov_header_len;
        if entries_start + 4 > data.len() {
            return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
        }
        let entry_count = u32::from_le_bytes([
            data[entries_start],
            data[entries_start + 1],
            data[entries_start + 2],
            data[entries_start + 3],
        ]) as usize;
        let mut offset = entries_start + 4;
        let remaining = data.len().saturating_sub(offset);
        let max_possible_entries = remaining / 9;
        if entry_count > max_possible_entries {
            return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
        }
        let mut entries = Vec::with_capacity(entry_count);
        for _ in 0..entry_count {
            if offset >= data.len() {
                return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
            }
            let id_len = data[offset] as usize;
            offset += 1;
            if offset + id_len + 8 > data.len() {
                return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
            }
            let identifier = data[offset..offset + id_len].to_vec();
            offset += id_len;
            let expires_at = u64::from_le_bytes([
                data[offset],
                data[offset + 1],
                data[offset + 2],
                data[offset + 3],
                data[offset + 4],
                data[offset + 5],
                data[offset + 6],
                data[offset + 7],
            ]);
            offset += 8;
            entries.push(RegistryEntry {
                identifier,
                expires_at,
            });
        }
        for i in 1..entries.len() {
            if entries[i].identifier.as_slice() <= entries[i - 1].identifier.as_slice() {
                return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
            }
        }
        Ok(Self { version, entries })
    }
}

/// Governance witness — GOV1 v4 binding placed in WitnessArgs.input_type.
///
/// Layout (173 bytes): GOV1(4) | version=0x04(1) | proposal_id_hash(32) |
///   vote_digest_hash(32) | old_root(32) | new_root(32) | proposal_data_hash(32) |
///   review_delay_ms(8 LE u64)
///
/// Signer entries live in WitnessArgs.lock for the governance-lock to verify.
/// This type script does NOT touch the lock field.
#[derive(Debug, Clone)]
pub struct GovernanceWitness {
    pub proposal_id_hash: [u8; 32],
    pub vote_digest_hash: [u8; 32],
    pub old_root: [u8; 32],
    pub new_root: [u8; 32],
    pub proposal_data_hash: [u8; 32],
}

impl GovernanceWitness {
    pub fn parse(raw: &[u8]) -> Result<Self, SysError> {
        if raw.len() != 173 {
            return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
        }
        if &raw[0..4] != b"GOV1" {
            return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
        }
        if raw[4] != 0x04 {
            return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
        }
        let mut proposal_id_hash = [0u8; 32];
        proposal_id_hash.copy_from_slice(&raw[5..37]);
        let mut vote_digest_hash = [0u8; 32];
        vote_digest_hash.copy_from_slice(&raw[37..69]);
        let mut old_root = [0u8; 32];
        old_root.copy_from_slice(&raw[69..101]);
        let mut new_root = [0u8; 32];
        new_root.copy_from_slice(&raw[101..133]);
        let mut proposal_data_hash = [0u8; 32];
        proposal_data_hash.copy_from_slice(&raw[133..165]);
        Ok(Self {
            proposal_id_hash,
            vote_digest_hash,
            old_root,
            new_root,
            proposal_data_hash,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ProposalAction {
    Add,
    Remove,
    SetGovernanceHeader,
}

#[derive(Debug, Clone)]
struct ProposalCell {
    registry_type_id_value: [u8; 32],
    action: ProposalAction,
    identifier: Vec<u8>,
    expires_at: u64,
    treasury_lock_hash: Option<[u8; 32]>,
}

impl ProposalCell {
    /// PBLK(4) | version=0x01 | registry_type_id_value(32) | action(1)
    /// | identifier_len(1) | identifier | expires_at(8 LE) | evidence_hash(32)
    ///
    /// PBLK(4) | version=0x02 | registry_type_id_value(32) | action=0x03
    /// | treasury_lock_hash(32) | evidence_hash(32)
    fn parse(data: &[u8]) -> Result<Self, SysError> {
        if data.len() < 4 + 1 + 32 + 1 + 32 {
            return Err(error::to_sys_error(error::INVALID_PROPOSAL_CELL));
        }
        if &data[0..4] != b"PBLK" {
            return Err(error::to_sys_error(error::INVALID_PROPOSAL_CELL));
        }
        let mut registry_type_id_value = [0u8; 32];
        registry_type_id_value.copy_from_slice(&data[5..37]);

        if data[4] == 0x02 {
            if data[37] != 0x03 || data.len() != 4 + 1 + 32 + 1 + 32 + 32 {
                return Err(error::to_sys_error(error::INVALID_PROPOSAL_CELL));
            }
            let mut treasury_lock_hash = [0u8; 32];
            treasury_lock_hash.copy_from_slice(&data[38..70]);
            return Ok(Self {
                registry_type_id_value,
                action: ProposalAction::SetGovernanceHeader,
                identifier: Vec::new(),
                expires_at: 0,
                treasury_lock_hash: Some(treasury_lock_hash),
            });
        }

        if data[4] != 0x01 {
            return Err(error::to_sys_error(error::INVALID_PROPOSAL_CELL));
        }
        let action = match data[37] {
            0x01 => ProposalAction::Add,
            0x02 => ProposalAction::Remove,
            _ => return Err(error::to_sys_error(error::INVALID_PROPOSAL_CELL)),
        };
        let id_len = data[38] as usize;
        let id_start = 39;
        let id_end = id_start + id_len;
        if id_end + 8 + 32 != data.len() {
            return Err(error::to_sys_error(error::INVALID_PROPOSAL_CELL));
        }
        let expires_at = u64::from_le_bytes([
            data[id_end],
            data[id_end + 1],
            data[id_end + 2],
            data[id_end + 3],
            data[id_end + 4],
            data[id_end + 5],
            data[id_end + 6],
            data[id_end + 7],
        ]);
        Ok(Self {
            registry_type_id_value,
            action,
            identifier: data[id_start..id_end].to_vec(),
            expires_at,
            treasury_lock_hash: None,
        })
    }
}

#[derive(Debug, Clone)]
struct Script {
    code_hash: [u8; 32],
    hash_type: u8,
    args: Vec<u8>,
}

fn script_matches_identity(
    script: &Script,
    code_hash: &[u8; 32],
    hash_type: u8,
    args: &[u8],
) -> bool {
    script.code_hash == *code_hash
        && script.hash_type == hash_type
        && script.args.as_slice() == args
}

fn load_var_bytes<F>(mut loader: F) -> Result<Vec<u8>, SysError>
where
    F: FnMut(&mut [u8], usize) -> Result<usize, SysError>,
{
    let mut cap = 512usize;
    loop {
        let mut buf = Vec::new();
        buf.resize(cap, 0u8);
        match loader(&mut buf, 0) {
            Ok(read_len) => {
                if read_len > cap {
                    cap = read_len;
                    continue;
                }
                buf.truncate(read_len);
                return Ok(buf);
            }
            Err(SysError::LengthNotEnough(need)) => {
                cap = need;
                continue;
            }
            Err(e) => return Err(e),
        }
    }
}

fn read_exact_bytes<F>(mut loader: F, index: usize, source: Source) -> Result<Vec<u8>, SysError>
where
    F: FnMut(&mut [u8], usize, usize, Source) -> Result<usize, SysError>,
{
    load_var_bytes(|buf, offset| loader(buf, offset, index, source))
}

fn load_cell_data_bytes(index: usize, source: Source) -> Result<Vec<u8>, SysError> {
    read_exact_bytes(load_cell_data, index, source)
}

fn load_witness_bytes(index: usize, source: Source) -> Result<Vec<u8>, SysError> {
    read_exact_bytes(load_witness, index, source)
}

fn load_input_bytes(index: usize, source: Source) -> Result<Vec<u8>, SysError> {
    read_exact_bytes(load_input, index, source)
}

fn load_script_field(index: usize, source: Source, field: CellField) -> Result<Vec<u8>, SysError> {
    load_var_bytes(|buf, offset| load_cell_by_field(buf, offset, index, source, field))
}

/// Loads the raw 36-byte outpoint (tx_hash(32) + index(4)) for an input.
///
/// CKB CellInput is a molecule STRUCT (no header): since(8) | OutPoint(36) = 44 bytes.
/// OutPoint = tx_hash(32) + index(4) starts at byte 8.
fn load_input_outpoint_raw(index: usize, source: Source) -> Result<[u8; 36], SysError> {
    let raw = load_input_bytes(index, source)?;
    if raw.len() < 44 {
        return Err(error::to_sys_error(error::INVALID_TYPE_ARGS_LAYOUT));
    }
    let mut out = [0u8; 36];
    out.copy_from_slice(&raw[8..44]);
    Ok(out)
}

fn parse_molecule_bytes(field: &[u8]) -> Result<Vec<u8>, SysError> {
    if field.len() < 4 {
        return Err(error::to_sys_error(error::INVALID_TYPE_ARGS_LAYOUT)); // diagnostic: field too short
    }
    let count = u32::from_le_bytes([field[0], field[1], field[2], field[3]]) as usize;
    if field.len() != 4 + count {
        return Err(error::to_sys_error(error::INVALID_TYPE_ARGS_LAYOUT)); // diagnostic: field.len != 4+count
    }
    Ok(field[4..(4 + count)].to_vec())
}

fn parse_script(raw: &[u8]) -> Result<Script, SysError> {
    // Molecule table decoding.
    if raw.len() >= 16 {
        let total = u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]) as usize;
        if total == raw.len() {
            let off_code_hash = u32::from_le_bytes([raw[4], raw[5], raw[6], raw[7]]) as usize;
            let off_hash_type = u32::from_le_bytes([raw[8], raw[9], raw[10], raw[11]]) as usize;
            let off_args = u32::from_le_bytes([raw[12], raw[13], raw[14], raw[15]]) as usize;
            if off_code_hash <= off_hash_type
                && off_hash_type <= off_args
                && off_args <= raw.len()
                && off_hash_type - off_code_hash == 32
                && off_args - off_hash_type == 1
            {
                let mut code_hash = [0u8; 32];
                code_hash.copy_from_slice(&raw[off_code_hash..off_hash_type]);
                let hash_type = raw[off_hash_type];
                let args = parse_molecule_bytes(&raw[off_args..])?;
                return Ok(Script {
                    code_hash,
                    hash_type,
                    args,
                });
            }
        }
    }

    // Fallback: raw script payload code_hash(32) | hash_type(1) | args.
    let payload = if raw.len() >= 34 && raw[0] == 0x00 {
        &raw[1..]
    } else {
        raw
    };
    if payload.len() < 33 {
        return Err(error::to_sys_error(error::INVALID_TYPE_ARGS_LAYOUT));
    }
    let mut code_hash = [0u8; 32];
    code_hash.copy_from_slice(&payload[0..32]);
    let hash_type = payload[32];
    let args = payload[33..].to_vec();
    Ok(Script {
        code_hash,
        hash_type,
        args,
    })
}

fn load_cell_lock_script(index: usize, source: Source) -> Result<Script, SysError> {
    let raw = load_script_field(index, source, CellField::Lock)?;
    parse_script(raw.as_slice())
}

fn load_cell_lock_hash(index: usize, source: Source) -> Result<[u8; 32], SysError> {
    let mut hash = [0u8; 32];
    load_cell_by_field(&mut hash, 0, index, source, CellField::LockHash)?;
    Ok(hash)
}

fn load_cell_capacity(index: usize, source: Source) -> Result<u64, SysError> {
    let mut raw = [0u8; 8];
    load_cell_by_field(&mut raw, 0, index, source, CellField::Capacity)?;
    Ok(u64::from_le_bytes(raw))
}

fn load_cell_type_script_opt(index: usize, source: Source) -> Result<Option<Script>, SysError> {
    match load_script_field(index, source, CellField::Type) {
        Ok(raw) => Ok(Some(parse_script(raw.as_slice())?)),
        Err(SysError::ItemMissing) => Ok(None),
        Err(e) => Err(e),
    }
}

fn load_running_type_script() -> Result<Script, SysError> {
    if let Some(s) = load_cell_type_script_opt(0, Source::GroupOutput)? {
        return Ok(s);
    }
    if let Some(s) = load_cell_type_script_opt(0, Source::GroupInput)? {
        return Ok(s);
    }
    Err(error::to_sys_error(error::INVALID_TYPE_ARGS_LAYOUT))
}

fn find_registry_cells(source: Source, self_script: &Script) -> Result<Vec<usize>, SysError> {
    let self_code_hash = self_script.code_hash;
    let self_hash_type = self_script.hash_type;
    let self_args = self_script.args.as_slice();

    let mut matches = Vec::new();
    let mut i = 0;
    loop {
        match load_cell_type_script_opt(i, source) {
            Ok(type_opt) => {
                if let Some(ts) = type_opt.as_ref() {
                    if script_matches_identity(ts, &self_code_hash, self_hash_type, self_args) {
                        matches.push(i);
                    }
                }
                i += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e),
        }
    }
    Ok(matches)
}

fn find_input_by_data_hash(target_hash: &[u8; 32]) -> Result<usize, SysError> {
    if *target_hash == [0u8; 32] {
        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
    }
    let mut found: Option<usize> = None;
    let mut i = 0;
    loop {
        let mut hash = [0u8; 32];
        match load_cell_by_field(&mut hash, 0, i, Source::Input, CellField::DataHash) {
            Ok(_) => {
                if hash == *target_hash {
                    if found.is_some() {
                        return Err(error::to_sys_error(error::INVALID_PROPOSAL_CELL));
                    }
                    found = Some(i);
                }
                i += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e),
        }
    }
    found.ok_or_else(|| error::to_sys_error(error::INVALID_PROPOSAL_CELL))
}

fn transition_matches_proposal(
    old_entries: &[RegistryEntry],
    new_entries: &[RegistryEntry],
    new_registry_data: &[u8],
    proposal: &ProposalCell,
) -> bool {
    match proposal.action {
        ProposalAction::Add => {
            if new_entries.len() != old_entries.len() + 1 {
                return false;
            }
            let mut used_insert = false;
            let mut old_i = 0usize;
            for new_entry in new_entries {
                if new_entry.identifier == proposal.identifier {
                    if used_insert || new_entry.expires_at != proposal.expires_at {
                        return false;
                    }
                    used_insert = true;
                    continue;
                }
                if old_i >= old_entries.len() {
                    return false;
                }
                let old_entry = &old_entries[old_i];
                if old_entry.identifier != new_entry.identifier
                    || old_entry.expires_at != new_entry.expires_at
                {
                    return false;
                }
                old_i += 1;
            }
            used_insert && old_i == old_entries.len()
        }
        ProposalAction::Remove => {
            if old_entries.len() != new_entries.len() + 1 {
                return false;
            }
            let mut used_remove = false;
            let mut new_i = 0usize;
            for old_entry in old_entries {
                if old_entry.identifier == proposal.identifier {
                    if used_remove {
                        return false;
                    }
                    used_remove = true;
                    continue;
                }
                if new_i >= new_entries.len() {
                    return false;
                }
                let new_entry = &new_entries[new_i];
                if old_entry.identifier != new_entry.identifier
                    || old_entry.expires_at != new_entry.expires_at
                {
                    return false;
                }
                new_i += 1;
            }
            used_remove && new_i == new_entries.len()
        }
        ProposalAction::SetGovernanceHeader => {
            old_entries == new_entries
                && proposal
                    .treasury_lock_hash
                    .map(|expected| match parse_treasury_lock_hash(new_registry_data) {
                        Ok(Some(actual)) => actual == expected,
                        _ => false,
                    })
                    .unwrap_or(false)
        }
    }
}

fn le_u32_at(buf: &[u8], off: usize) -> Result<usize, SysError> {
    if off + 4 > buf.len() {
        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
    }
    Ok(u32::from_le_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]]) as usize)
}

fn decode_bytesopt_field(field: &[u8]) -> Result<Option<Vec<u8>>, SysError> {
    if field.is_empty() {
        return Ok(None);
    }
    if field.len() < 4 {
        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
    }
    let count = u32::from_le_bytes([field[0], field[1], field[2], field[3]]) as usize;
    if field.len() != 4 + count {
        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
    }
    Ok(Some(field[4..(4 + count)].to_vec()))
}

/// Extracts the GOV1 v4 binding from WitnessArgs.input_type at the given input index.
fn load_governance_witness_payload(input_index: usize) -> Result<Vec<u8>, SysError> {
    let buf = load_witness_bytes(input_index, Source::Input)?;
    if buf.len() < 16 {
        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
    }
    let full_size = le_u32_at(&buf, 0)?;
    if full_size != buf.len() {
        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
    }
    let off_input_type = le_u32_at(&buf, 8)?;
    let off_output_type = le_u32_at(&buf, 12)?;
    if off_input_type < 16 || off_output_type < off_input_type || off_output_type > buf.len() {
        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
    }
    let input_type_field = &buf[off_input_type..off_output_type];
    match decode_bytesopt_field(input_type_field)? {
        Some(data) if !data.is_empty() => Ok(data),
        _ => Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS)),
    }
}

/// Verifies that the registry cell's lock script matches the configured governance-lock.
///
/// Governance-lock args are always [0x01] for v2 (version byte only; keys are in BLKL header).
fn verify_governance_lock_identity(
    input_index_opt: Option<usize>,
    output_index: usize,
    registry_type_args: &RegistryTypeArgs,
) -> Result<(), SysError> {
    let gov_lock_args = [0x01u8];
    if let Some(input_index) = input_index_opt {
        let in_lock = load_cell_lock_script(input_index, Source::Input)?;
        if !script_matches_identity(
            &in_lock,
            &registry_type_args.governance_code_hash,
            registry_type_args.governance_hash_type,
            &gov_lock_args,
        ) {
            return Err(error::to_sys_error(error::UNAUTHORIZED_GOVERNANCE_LOCK));
        }
    }
    let out_lock = load_cell_lock_script(output_index, Source::Output)?;
    if !script_matches_identity(
        &out_lock,
        &registry_type_args.governance_code_hash,
        registry_type_args.governance_hash_type,
        &gov_lock_args,
    ) {
        return Err(error::to_sys_error(error::UNAUTHORIZED_GOVERNANCE_LOCK));
    }
    Ok(())
}

fn parse_treasury_lock_hash(registry_data: &[u8]) -> Result<Option<[u8; 32]>, SysError> {
    if registry_data.len() < 11 || &registry_data[0..4] != b"BLKL" || registry_data[4] != 0x02 {
        return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
    }
    let gov_header_len = u16::from_le_bytes([registry_data[5], registry_data[6]]) as usize;
    let gh_start = 7usize;
    let gh_end = gh_start + gov_header_len;
    if gh_end > registry_data.len() || gov_header_len < 3 {
        return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
    }
    let gh = &registry_data[gh_start..gh_end];
    let version = gh[0];
    if version != 0x01 && version != 0x02 && version != 0x03 {
        return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
    }
    let signer_count = gh[1] as usize;
    let pubkeys_end = 3 + signer_count * 33;
    let base_end = pubkeys_end + 2 + 32;
    if base_end > gh.len() {
        return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
    }
    if version == 0x01 {
        return Ok(None);
    }
    if version == 0x02 {
        if base_end + 32 > gh.len() {
            return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
        }
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&gh[base_end..base_end + 32]);
        return Ok(Some(hash));
    }
    if base_end + 2 > gh.len() {
        return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
    }
    let script_len = u16::from_le_bytes([gh[base_end], gh[base_end + 1]]) as usize;
    let script_start = base_end + 2;
    let script_end = script_start + script_len;
    if script_end != gh.len() || script_len == 0 {
        return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
    }
    Ok(Some(blake2b_256(&gh[script_start..script_end])))
}

fn output_capacity_for_lock_hash(target_hash: &[u8; 32]) -> Result<u64, SysError> {
    let mut total = 0u64;
    let mut i = 0usize;
    loop {
        match load_cell_lock_hash(i, Source::Output) {
            Ok(hash) => {
                if hash == *target_hash {
                    total = total.saturating_add(load_cell_capacity(i, Source::Output)?);
                }
                i += 1;
            }
            Err(SysError::IndexOutOfBound) => return Ok(total),
            Err(e) => return Err(e),
        }
    }
}

fn input_capacity_for_lock_hash(target_hash: &[u8; 32]) -> Result<u64, SysError> {
    let mut total = 0u64;
    let mut i = 0usize;
    loop {
        match load_cell_lock_hash(i, Source::Input) {
            Ok(hash) => {
                if hash == *target_hash {
                    total = total.saturating_add(load_cell_capacity(i, Source::Input)?);
                }
                i += 1;
            }
            Err(SysError::IndexOutOfBound) => return Ok(total),
            Err(e) => return Err(e),
        }
    }
}

fn required_treasury_return(
    treasury_input_capacity: u64,
    registry_input_capacity: u64,
    registry_output_capacity: u64,
) -> u64 {
    let after_registry_delta = if registry_output_capacity >= registry_input_capacity {
        treasury_input_capacity.saturating_sub(registry_output_capacity - registry_input_capacity)
    } else {
        treasury_input_capacity.saturating_add(registry_input_capacity - registry_output_capacity)
    };
    after_registry_delta.saturating_sub(MAX_PROPOSAL_ANCHOR_FEE_SHANNONS)
}

fn program_entry() -> Result<(), SysError> {
    let self_script = load_running_type_script()?;
    let registry_type_args = parse_registry_type_args(self_script.args.as_slice())?;

    // Topology: exactly 1 output registry cell; 0 (bootstrap) or 1 (update) input.
    let reg_inputs = find_registry_cells(Source::Input, &self_script)?;
    let reg_outputs = find_registry_cells(Source::Output, &self_script)?;
    if reg_outputs.len() != 1 || reg_inputs.len() > 1 {
        return Err(error::to_sys_error(error::INVALID_REGISTRY_CELL_TOPOLOGY));
    }
    let reg_out = reg_outputs[0];
    let is_bootstrap = reg_inputs.is_empty();
    let reg_in_opt = if is_bootstrap {
        None
    } else {
        Some(reg_inputs[0])
    };

    // Type ID enforcement.
    if is_bootstrap {
        // Expected Type ID = blake2b(inputs[0].previous_output(36) | output_index_u64_le(8))
        let first_outpoint = load_input_outpoint_raw(0, Source::Input)?;
        let mut preimage = [0u8; 44];
        preimage[..36].copy_from_slice(&first_outpoint);
        preimage[36..44].copy_from_slice(&(reg_out as u64).to_le_bytes());
        let expected_type_id = blake2b_256(&preimage);
        if expected_type_id != registry_type_args.type_id_value {
            return Err(error::to_sys_error(error::INVALID_TYPE_ID));
        }
    } else {
        // Update: input and output type_id_value must be identical.
        let in_idx = reg_inputs[0];
        let in_type_raw = load_script_field(in_idx, Source::Input, CellField::Type)?;
        let in_script = parse_script(in_type_raw.as_slice())?;
        let in_type_args = RegistryTypeArgs::parse(in_script.args.as_slice())?;
        if in_type_args.type_id_value != registry_type_args.type_id_value {
            return Err(error::to_sys_error(error::INVALID_TYPE_ID));
        }
    }

    // Registry cells must be locked by the configured governance-lock (args = [0x01]).
    verify_governance_lock_identity(reg_in_opt, reg_out, &registry_type_args)?;

    // BLKL v2 payload validation.
    let out_data = load_cell_data_bytes(reg_out, Source::Output)?;
    let new_registry = RegistryPayload::parse(out_data.as_slice())?;
    let treasury_lock_hash = parse_treasury_lock_hash(out_data.as_slice())?;

    let (old_root, old_registry, witness_index) = if let Some(reg_in) = reg_in_opt {
        let in_data = load_cell_data_bytes(reg_in, Source::Input)?;
        let old_registry = RegistryPayload::parse(in_data.as_slice())?;
        (blake2b_256(in_data.as_slice()), Some(old_registry), reg_in)
    } else {
        ([0u8; 32], None, 0usize)
    };
    let new_root = blake2b_256(out_data.as_slice());

    // GOV1 v4 binding from WitnessArgs.input_type.
    let gov_payload = load_governance_witness_payload(witness_index)?;
    let gov = GovernanceWitness::parse(gov_payload.as_slice())?;

    if gov.old_root != old_root || gov.new_root != new_root {
        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
    }
    if gov.proposal_id_hash == [0u8; 32] || gov.vote_digest_hash == [0u8; 32] {
        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
    }

    if !is_bootstrap {
        let proposal_index = find_input_by_data_hash(&gov.proposal_data_hash)?;
        let proposal_data = load_cell_data_bytes(proposal_index, Source::Input)?;
        let proposal = ProposalCell::parse(proposal_data.as_slice())?;
        if proposal.registry_type_id_value != registry_type_args.type_id_value {
            return Err(error::to_sys_error(error::INVALID_PROPOSAL_CELL));
        }
        let old_registry = old_registry
            .as_ref()
            .ok_or_else(|| error::to_sys_error(error::INVALID_PROPOSAL_CELL))?;
        if !transition_matches_proposal(
            &old_registry.entries,
            &new_registry.entries,
            out_data.as_slice(),
            &proposal,
        ) {
            return Err(error::to_sys_error(error::INVALID_PROPOSAL_CELL));
        }
        if let Some(treasury_hash) = treasury_lock_hash {
            if proposal.action == ProposalAction::SetGovernanceHeader {
                return Ok(());
            }
            let proposal_lock_hash = load_cell_lock_hash(proposal_index, Source::Input)?;
            if proposal_lock_hash != treasury_hash {
                return Err(error::to_sys_error(error::INVALID_PROPOSAL_CELL));
            }
            let reg_in =
                reg_in_opt.ok_or_else(|| error::to_sys_error(error::INVALID_PROPOSAL_CELL))?;
            let treasury_input_capacity = input_capacity_for_lock_hash(&treasury_hash)?;
            let registry_input_capacity = load_cell_capacity(reg_in, Source::Input)?;
            let registry_output_capacity = load_cell_capacity(reg_out, Source::Output)?;
            let min_return = required_treasury_return(
                treasury_input_capacity,
                registry_input_capacity,
                registry_output_capacity,
            );
            if output_capacity_for_lock_hash(&treasury_hash)? < min_return {
                return Err(error::to_sys_error(error::INVALID_PROPOSAL_CELL));
            }
        }
    }

    // Signature verification is handled by governance-lock (WitnessArgs.lock).
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    extern crate std;
    use std::vec;

    fn minimal_gov_header() -> Vec<u8> {
        // gh_version(1) | signer_count(1) | threshold(1) | pubkey(33) | validator_count(2 LE) | validator_merkle_root(32) = 70 bytes
        let mut h = vec![0x01u8, 0x01, 0x01];
        h.extend_from_slice(&[
            0x03, 0x1b, 0x84, 0xc5, 0x56, 0x7b, 0x12, 0x64, 0x40, 0x99, 0x5d, 0x3e, 0xd5, 0xaa,
            0xba, 0x05, 0x65, 0xd7, 0x1e, 0x18, 0x34, 0x60, 0x48, 0x19, 0xff, 0x9c, 0x17, 0xf5,
            0xe9, 0xd5, 0xdd, 0x07, 0x8f,
        ]);
        h.extend_from_slice(&[0x00, 0x00]);
        h.extend_from_slice(&[0u8; 32]);
        h
    }

    #[test]
    fn test_parse_treasury_lock_hash_v1_none() {
        let data = make_blkl_v2(&[]);
        assert!(parse_treasury_lock_hash(&data).expect("parse").is_none());
    }

    #[test]
    fn test_parse_treasury_lock_hash_v2() {
        let mut gov_header = minimal_gov_header();
        gov_header[0] = 0x02;
        gov_header.extend_from_slice(&[0x7au8; 32]);
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x02);
        data.extend_from_slice(&(gov_header.len() as u16).to_le_bytes());
        data.extend_from_slice(&gov_header);
        data.extend_from_slice(&0u32.to_le_bytes());

        let hash = parse_treasury_lock_hash(&data)
            .expect("parse")
            .expect("treasury hash");
        assert_eq!(hash, [0x7au8; 32]);
    }

    #[test]
    fn test_parse_treasury_lock_hash_v3_script() {
        let mut gov_header = minimal_gov_header();
        gov_header[0] = 0x03;
        let treasury_script = vec![0x51u8; 53];
        gov_header.extend_from_slice(&(treasury_script.len() as u16).to_le_bytes());
        gov_header.extend_from_slice(&treasury_script);
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x02);
        data.extend_from_slice(&(gov_header.len() as u16).to_le_bytes());
        data.extend_from_slice(&gov_header);
        data.extend_from_slice(&0u32.to_le_bytes());

        let hash = parse_treasury_lock_hash(&data)
            .expect("parse")
            .expect("treasury hash");
        assert_eq!(hash, blake2b_256(&treasury_script));
    }

    #[test]
    fn test_required_treasury_return_allows_registry_growth() {
        assert_eq!(
            required_treasury_return(300_000_000, 1_000_000_000, 1_150_000_000),
            50_000_000
        );
    }

    #[test]
    fn test_required_treasury_return_returns_pruned_capacity() {
        assert_eq!(
            required_treasury_return(300_000_000, 1_000_000_000, 900_000_000),
            300_000_000
        );
    }

    fn make_blkl_v2(entries: &[(&[u8], u64)]) -> Vec<u8> {
        let gov_header = minimal_gov_header();
        let gov_header_len = gov_header.len() as u16;
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x02);
        data.extend_from_slice(&gov_header_len.to_le_bytes());
        data.extend_from_slice(&gov_header);
        data.extend_from_slice(&(entries.len() as u32).to_le_bytes());
        for (id, expires_at) in entries {
            data.push(id.len() as u8);
            data.extend_from_slice(id);
            data.extend_from_slice(&expires_at.to_le_bytes());
        }
        data
    }

    #[test]
    fn test_type_id_blake2b_matches_ckb_cli() {
        // Verify blake2b_256(preimage) matches what ckb-cli util blake2b computes.
        // preimage = 0xdd23d6b3292103354a6a40abc36f1501397668c61157a96467891de383d5e9e2 02000000 0000000000000000
        let preimage: [u8; 44] = [
            0xdd, 0x23, 0xd6, 0xb3, 0x29, 0x21, 0x03, 0x35, 0x4a, 0x6a, 0x40, 0xab, 0xc3, 0x6f,
            0x15, 0x01, 0x39, 0x76, 0x68, 0xc6, 0x11, 0x57, 0xa9, 0x64, 0x67, 0x89, 0x1d, 0xe3,
            0x83, 0xd5, 0xe9, 0xe2, 0x02, 0x00, 0x00, 0x00, // index=2 LE
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reg_out=0 LE u64
        ];
        let expected: [u8; 32] = [
            0x4f, 0x59, 0x64, 0xc6, 0x30, 0x74, 0x35, 0x97, 0xc9, 0x0f, 0xc4, 0x8b, 0x9d, 0x85,
            0x5e, 0x35, 0xd3, 0x8e, 0xea, 0x9f, 0x69, 0x75, 0xb1, 0x0d, 0x88, 0x84, 0x2e, 0xab,
            0x2d, 0x18, 0x14, 0xfe,
        ];
        let actual = blake2b_256(&preimage);
        assert_eq!(
            actual, expected,
            "blake2b_256 does not match ckb-cli output"
        );
    }

    #[test]
    fn test_parse_registry_type_args_valid() {
        let mut args = vec![0x02u8];
        args.extend_from_slice(&[1u8; 32]);
        args.push(0x01);
        args.extend_from_slice(&[2u8; 32]);
        let parsed = RegistryTypeArgs::parse(&args).expect("should parse");
        assert_eq!(parsed.version, 0x02);
        assert_eq!(parsed.governance_hash_type, 0x01);
        assert_eq!(parsed.type_id_value, [2u8; 32]);
    }

    #[test]
    fn test_parse_registry_type_args_invalid_len() {
        let args = vec![0x02, 0x02, 0x03];
        assert!(RegistryTypeArgs::parse(&args).is_err());
    }

    #[test]
    fn test_parse_registry_type_args_wrong_version() {
        let mut args = vec![0x01u8];
        args.extend_from_slice(&[1u8; 32]);
        args.push(0x01);
        args.extend_from_slice(&[2u8; 32]);
        assert!(RegistryTypeArgs::parse(&args).is_err());
    }

    #[test]
    fn test_governance_witness_parse_valid() {
        let mut raw = vec![];
        raw.extend_from_slice(b"GOV1");
        raw.push(0x04);
        raw.extend_from_slice(&[1u8; 32]); // proposal_id_hash
        raw.extend_from_slice(&[2u8; 32]); // vote_digest_hash
        raw.extend_from_slice(&[3u8; 32]); // old_root
        raw.extend_from_slice(&[4u8; 32]); // new_root
        raw.extend_from_slice(&[5u8; 32]); // proposal_data_hash
        raw.extend_from_slice(&259_200_000u64.to_le_bytes()); // review_delay_ms
        assert_eq!(raw.len(), 173);
        let w = GovernanceWitness::parse(&raw).expect("should parse");
        assert_eq!(w.proposal_id_hash, [1u8; 32]);
        assert_eq!(w.vote_digest_hash, [2u8; 32]);
        assert_eq!(w.old_root, [3u8; 32]);
        assert_eq!(w.new_root, [4u8; 32]);
        assert_eq!(w.proposal_data_hash, [5u8; 32]);
    }

    #[test]
    fn test_governance_witness_wrong_length() {
        let mut raw = vec![];
        raw.extend_from_slice(b"GOV1");
        raw.push(0x04);
        raw.extend_from_slice(&[1u8; 32]);
        raw.extend_from_slice(&[2u8; 32]);
        raw.extend_from_slice(&[3u8; 32]);
        // Missing new_root + proposal_data_hash + review_delay_ms
        assert!(GovernanceWitness::parse(&raw).is_err());
    }

    #[test]
    fn test_governance_witness_wrong_version() {
        let mut raw = vec![0u8; 173];
        raw[0..4].copy_from_slice(b"GOV1");
        raw[4] = 0x03; // v3 no longer accepted
        assert!(GovernanceWitness::parse(&raw).is_err());
    }

    #[test]
    fn test_governance_witness_invalid_magic() {
        let mut raw = vec![0u8; 173];
        raw[0..4].copy_from_slice(b"NOPE");
        raw[4] = 0x04;
        assert!(GovernanceWitness::parse(&raw).is_err());
    }

    fn make_proposal_cell(action: u8, identifier: &[u8], expires_at: u64) -> Vec<u8> {
        let mut data = vec![];
        data.extend_from_slice(b"PBLK");
        data.push(0x01);
        data.extend_from_slice(&[0x42u8; 32]);
        data.push(action);
        data.push(identifier.len() as u8);
        data.extend_from_slice(identifier);
        data.extend_from_slice(&expires_at.to_le_bytes());
        data.extend_from_slice(&[0x99u8; 32]);
        data
    }

    #[test]
    fn test_proposal_cell_parse_add() {
        let data = make_proposal_cell(0x01, &[0xaa, 0xbb], 123);
        let proposal = ProposalCell::parse(&data).expect("should parse");
        assert_eq!(proposal.registry_type_id_value, [0x42u8; 32]);
        assert_eq!(proposal.action, ProposalAction::Add);
        assert_eq!(proposal.identifier, vec![0xaa, 0xbb]);
        assert_eq!(proposal.expires_at, 123);
    }

    #[test]
    fn test_proposal_cell_rejects_trailing_bytes() {
        let mut data = make_proposal_cell(0x01, &[0xaa], 123);
        data.push(0);
        assert!(ProposalCell::parse(&data).is_err());
    }

    #[test]
    fn test_transition_matches_add_exactly_one_entry() {
        let old_entries = vec![RegistryEntry {
            identifier: vec![0x10],
            expires_at: 0,
        }];
        let new_entries = vec![
            RegistryEntry {
                identifier: vec![0x10],
                expires_at: 0,
            },
            RegistryEntry {
                identifier: vec![0x20],
                expires_at: 456,
            },
        ];
        let proposal = ProposalCell::parse(&make_proposal_cell(0x01, &[0x20], 456)).expect("parse");
        assert!(transition_matches_proposal(
            &old_entries,
            &new_entries,
            &[],
            &proposal
        ));
    }

    #[test]
    fn test_transition_rejects_extra_mutation() {
        let old_entries = vec![RegistryEntry {
            identifier: vec![0x10],
            expires_at: 0,
        }];
        let new_entries = vec![
            RegistryEntry {
                identifier: vec![0x10],
                expires_at: 1,
            },
            RegistryEntry {
                identifier: vec![0x20],
                expires_at: 456,
            },
        ];
        let proposal = ProposalCell::parse(&make_proposal_cell(0x01, &[0x20], 456)).expect("parse");
        assert!(!transition_matches_proposal(
            &old_entries,
            &new_entries,
            &[],
            &proposal
        ));
    }

    #[test]
    fn test_transition_matches_remove_exactly_one_entry() {
        let old_entries = vec![
            RegistryEntry {
                identifier: vec![0x10],
                expires_at: 0,
            },
            RegistryEntry {
                identifier: vec![0x20],
                expires_at: 456,
            },
        ];
        let new_entries = vec![RegistryEntry {
            identifier: vec![0x10],
            expires_at: 0,
        }];
        let proposal = ProposalCell::parse(&make_proposal_cell(0x02, &[0x20], 456)).expect("parse");
        assert!(transition_matches_proposal(
            &old_entries,
            &new_entries,
            &[],
            &proposal
        ));
    }

    #[test]
    fn test_registry_payload_parse_empty() {
        let data = make_blkl_v2(&[]);
        let payload = RegistryPayload::parse(&data).expect("should parse");
        assert_eq!(payload.version, 0x02);
        assert_eq!(payload.entries.len(), 0);
    }

    #[test]
    fn test_registry_payload_parse_two_entries() {
        let data = make_blkl_v2(&[(&[0xAA], 0), (&[0xBB], 100)]);
        let payload = RegistryPayload::parse(&data).expect("should parse");
        assert_eq!(payload.entries.len(), 2);
        assert_eq!(payload.entries[0].identifier, vec![0xAA]);
        assert_eq!(payload.entries[1].identifier, vec![0xBB]);
        assert_eq!(payload.entries[1].expires_at, 100);
    }

    #[test]
    fn test_registry_payload_rejects_v1() {
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x01);
        data.extend_from_slice(&0u32.to_le_bytes());
        assert!(RegistryPayload::parse(&data).is_err());
    }

    #[test]
    fn test_registry_payload_rejects_unsorted() {
        let data = make_blkl_v2(&[(&[0xBB], 0), (&[0xAA], 0)]);
        assert!(RegistryPayload::parse(&data).is_err());
    }

    #[test]
    fn test_registry_payload_rejects_duplicate() {
        let data = make_blkl_v2(&[(&[0xAA], 0), (&[0xAA], 100)]);
        assert!(RegistryPayload::parse(&data).is_err());
    }

    #[test]
    fn test_registry_payload_rejects_truncated() {
        // Truncate in the middle of an entry
        let mut data = make_blkl_v2(&[(&[0xAA, 0xBB], 0)]);
        data.truncate(data.len() - 4);
        assert!(RegistryPayload::parse(&data).is_err());
    }
}
