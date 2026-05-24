//! Firewall Lock Script - Consensus-Layer Blacklist Enforcement
//!
//! This lock script provides protocol-level protection against transactions
//! targeting blacklisted addresses on Nervos CKB. It is designed for AI agent
//! wallet protection as part of the dual-layer firewall architecture.
//!
//! # Security Model
//!
//! - Fails closed: Missing or invalid dependencies cause validation to fail
//! - Deterministic: Registry selection uses exact type script matching
//! - Composable: Wraps existing lock scripts via delegation pattern
//!
//! # Error Codes (Frozen v1)
//!
//! Custom errors start at code 5:
//! - 5: InvalidArgsLayout
//! - 6: UnsupportedVersion
//! - 7: UnsupportedFlags
//! - 8: MissingRegistryCellDep
//! - 9: InvalidRegistryData
//! - 10: RegistryNotSorted
//! - 11: BlacklistedLockArgs
//! - 12: BlacklistedTypeArgs
//! - 13: MissingInnerLockCellDep
//! - 14: InvalidInnerLockScript
//! - 15: InnerLockRejected
//! - 16: OutputScriptParseFailed
//! - 17: AmbiguousRegistryCellDep

#![no_std]
#![cfg_attr(not(test), no_main)]

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
        Err(SysError::Unknown(code)) => code as i8,
        Err(_) => -1,
    }
}

use ckb_std::{
    ckb_constants::Source,
    ckb_types::{bytes::Bytes, prelude::*},
    error::SysError,
    high_level::{load_script, load_cell_type, load_cell_data, load_witness_args},
};

/// * Custom error codes (frozen v1)
pub mod error {
    use ckb_std::error::SysError;

    pub const INVALID_ARGS_LAYOUT: i8 = 5;
    pub const UNSUPPORTED_VERSION: i8 = 6;
    pub const UNSUPPORTED_FLAGS: i8 = 7;
    pub const MISSING_REGISTRY_CELL_DEP: i8 = 8;
    pub const INVALID_REGISTRY_DATA: i8 = 9;
    pub const REGISTRY_NOT_SORTED: i8 = 10;
    pub const BLACKLISTED_LOCK_ARGS: i8 = 11;
    pub const BLACKLISTED_TYPE_ARGS: i8 = 12;
    pub const MISSING_INNER_LOCK_CELL_DEP: i8 = 13;
    pub const INVALID_INNER_LOCK_SCRIPT: i8 = 14;
    pub const INNER_LOCK_REJECTED: i8 = 15;
    pub const OUTPUT_SCRIPT_PARSE_FAILED: i8 = 16;
    pub const AMBIGUOUS_REGISTRY_CELL_DEP: i8 = 17;

    /// Convert custom error code to SysError
    pub fn to_sys_error(code: i8) -> SysError {
        SysError::Unknown(code as u64)
    }
}

/// One entry in the registry list stored in FirewallLockArgs.
///
/// Each entry identifies a registry cell dep by its type script's code_hash + hash_type
/// and the 32-byte Type ID value (bytes 34..66 of the v2 registry type args).
/// Storing only the Type ID value means this struct does not need updating when
/// governance-lock is upgraded (which changes the gov_code_hash in the type args).
///
/// Layout: code_hash(32) | hash_type(1) | type_id_value(32) | required(1) = 66 bytes
#[derive(Debug, Clone)]
pub struct RegistrySpec {
    pub code_hash: [u8; 32],
    pub hash_type: u8,
    pub type_id_value: [u8; 32],
    /// If true, a missing cell dep fails the transaction. If false, the registry is optional.
    pub required: bool,
}

impl RegistrySpec {
    pub const ENCODED_LEN: usize = 66;

    pub fn parse(bytes: &[u8]) -> Result<Self, SysError> {
        if bytes.len() != Self::ENCODED_LEN {
            return Err(error::to_sys_error(error::INVALID_ARGS_LAYOUT));
        }
        let mut code_hash = [0u8; 32];
        code_hash.copy_from_slice(&bytes[0..32]);
        let hash_type = bytes[32];
        let mut type_id_value = [0u8; 32];
        type_id_value.copy_from_slice(&bytes[33..65]);
        let required = bytes[65] != 0;
        Ok(Self { code_hash, hash_type, type_id_value, required })
    }
}

/// Lock args structure (v2 layout — multi-registry).
///
/// Layout:
///   version(1) = 0x02
///   flags(1)   bit0=check lock_args, bit1=check type_args, bits2-7 reserved
///   registry_count(1)
///   [registry_count × 66 bytes]:  code_hash(32) | hash_type(1) | type_id_value(32) | required(1)
///   inner_code_hash(32)
///   inner_hash_type(1)
///   inner_args_len(2 LE)
///   inner_args(M)
///
/// Minimum size (0 registries, 0 inner args): 38 bytes.
/// Each registry entry adds 66 bytes.
#[derive(Debug, Clone)]
pub struct FirewallLockArgs {
    pub version: u8,
    pub flags: u8,
    pub registries: alloc::vec::Vec<RegistrySpec>,
    pub inner_code_hash: [u8; 32],
    pub inner_hash_type: u8,
    pub inner_args: Bytes,
}

impl FirewallLockArgs {
    pub fn parse(args: &[u8]) -> Result<Self, SysError> {
        // Minimum: version(1) + flags(1) + registry_count(1) + inner(32+1+2) = 38 bytes
        if args.len() < 38 {
            return Err(error::to_sys_error(error::INVALID_ARGS_LAYOUT));
        }

        let version = args[0];
        let flags = args[1];
        let registry_count = args[2] as usize;

        let registries_end = 3 + registry_count * RegistrySpec::ENCODED_LEN;
        if args.len() < registries_end + 35 {
            return Err(error::to_sys_error(error::INVALID_ARGS_LAYOUT));
        }

        let mut registries = alloc::vec::Vec::with_capacity(registry_count);
        for i in 0..registry_count {
            let start = 3 + i * RegistrySpec::ENCODED_LEN;
            registries.push(RegistrySpec::parse(&args[start..start + RegistrySpec::ENCODED_LEN])?);
        }

        let inner_start = registries_end;
        let mut inner_code_hash = [0u8; 32];
        inner_code_hash.copy_from_slice(&args[inner_start..inner_start + 32]);
        let inner_hash_type = args[inner_start + 32];
        let inner_args_len =
            u16::from_le_bytes([args[inner_start + 33], args[inner_start + 34]]) as usize;
        let inner_args_start = inner_start + 35;

        if args.len() != inner_args_start + inner_args_len {
            return Err(error::to_sys_error(error::INVALID_ARGS_LAYOUT));
        }

        let inner_args = Bytes::from(args[inner_args_start..].to_vec());

        Ok(Self { version, flags, registries, inner_code_hash, inner_hash_type, inner_args })
    }

    pub fn check_lock_args(&self) -> bool {
        self.flags & 0x01 != 0
    }

    pub fn check_type_args(&self) -> bool {
        self.flags & 0x02 != 0
    }
}

/// * Registry payload structure
///
/// Format (v2):
/// - 4 bytes: magic number (0x424C4B4C "BLKL")
/// - 1 byte: version (0x02)
/// - 2 bytes: gov_header_len (LE u16)
/// - gov_header_len bytes: governance header (pubkeys, threshold, validator merkle root)
/// - 4 bytes: entry count (LE u32)
/// - N bytes: entry data (sorted by identifier)
///
/// Each entry:
/// - 1 byte: identifier length
/// - N bytes: identifier (lock_args or type_args)
/// - 8 bytes: expires_at (LE u64, 0 = permanent)
#[derive(Debug)]
pub struct RegistryPayload {
    pub version: u8,
    pub entries: alloc::vec::Vec<RegistryEntry>,
}

#[derive(Debug, Clone)]
pub struct RegistryEntry {
    pub identifier: Bytes,
    pub expires_at: u64, // * 0 = permanent, non-zero = Unix timestamp
}

impl RegistryPayload {
    /// * Parse and validate registry data
    ///
    /// Returns InvalidRegistryData if:
    /// - Magic number mismatch
    /// - Unsupported version
    /// - Malformed entry data
    pub fn parse(data: &[u8]) -> Result<Self, SysError> {
        if data.len() < 9 {
            return Err(error::to_sys_error(error::INVALID_REGISTRY_DATA));
        }

        // * Verify magic number "BLKL"
        if &data[0..4] != b"BLKL" {
            return Err(error::to_sys_error(error::INVALID_REGISTRY_DATA));
        }

        let version = data[4];
        if version != 0x02 {
            return Err(error::to_sys_error(error::UNSUPPORTED_VERSION));
        }

        // * BLKL v2: skip governance header using its length prefix.
        if data.len() < 7 {
            return Err(error::to_sys_error(error::INVALID_REGISTRY_DATA));
        }
        let gov_header_len = u16::from_le_bytes([data[5], data[6]]) as usize;
        let entries_start = 7 + gov_header_len;
        if data.len() < entries_start + 4 {
            return Err(error::to_sys_error(error::INVALID_REGISTRY_DATA));
        }

        let entry_count = u32::from_le_bytes([
            data[entries_start],
            data[entries_start + 1],
            data[entries_start + 2],
            data[entries_start + 3],
        ]) as usize;
        // * Defensive bound: each entry takes at least 9 bytes (len + expires_at),
        // * so reject impossible counts before allocating.
        let remaining = data.len().saturating_sub(entries_start + 4);
        let max_possible_entries = remaining / 9;
        if entry_count > max_possible_entries {
            return Err(error::to_sys_error(error::INVALID_REGISTRY_DATA));
        }

        let mut entries = alloc::vec::Vec::with_capacity(entry_count);
        let mut offset = entries_start + 4;

        for _ in 0..entry_count {
            if offset >= data.len() {
                return Err(error::to_sys_error(error::INVALID_REGISTRY_DATA));
            }

            let id_len = data[offset] as usize;
            offset += 1;

            if offset + id_len + 8 > data.len() {
                return Err(error::to_sys_error(error::INVALID_REGISTRY_DATA));
            }

            let identifier = Bytes::from(data[offset..offset + id_len].to_vec());
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

        // * Verify entries are strictly sorted (no duplicates allowed)
        for i in 1..entries.len() {
            if entries[i].identifier.as_ref() <= entries[i - 1].identifier.as_ref() {
                return Err(error::to_sys_error(error::REGISTRY_NOT_SORTED));
            }
        }

        Ok(Self { version, entries })
    }

    /// * Check if identifier is blacklisted
    ///
    /// Uses median block timestamp for expiry evaluation
    pub fn is_blacklisted(&self, identifier: &[u8], median_time: u64) -> bool {
        // * Binary search for efficiency
        self.entries
            .binary_search_by(|entry| entry.identifier.as_ref().cmp(identifier))
            .map(|idx| {
                let entry = &self.entries[idx];
                // * Permanent entries always active (expires_at == 0)
                // * Temporary entries active only if not expired
                entry.expires_at == 0 || median_time < entry.expires_at
            })
            .unwrap_or(false)
    }
}

/// Resolves each RegistrySpec to the index of the matching cell dep.
///
/// Matches on: code_hash + hash_type + type_args[34..66] == spec.type_id_value
/// (bytes 34..66 are the Type ID value in the 66-byte v2 registry type args).
///
/// Returns pairs of (spec_index, dep_index) for all resolved registries.
/// Required registries with no match → MissingRegistryCellDep.
/// Any registry with more than one match → AmbiguousRegistryCellDep.
fn resolve_registries(
    specs: &[RegistrySpec],
) -> Result<alloc::vec::Vec<(usize, usize)>, SysError> {
    let mut dep_info: alloc::vec::Vec<Option<([u8; 32], u8, Bytes)>> = alloc::vec::Vec::new();
    let mut i = 0usize;
    loop {
        match load_cell_type(i, Source::CellDep) {
            Ok(ts) => {
                dep_info.push(ts.map(|s| {
                    let code_hash: [u8; 32] = s.code_hash().unpack();
                    let hash_type: u8 = s.hash_type().into();
                    let args: Bytes = s.args().unpack();
                    (code_hash, hash_type, args)
                }));
                i += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e),
        }
    }

    let mut resolved = alloc::vec::Vec::with_capacity(specs.len());
    for (spec_idx, spec) in specs.iter().enumerate() {
        let mut matched_dep: Option<usize> = None;
        for (dep_idx, info) in dep_info.iter().enumerate() {
            if let Some((code_hash, hash_type, dep_args)) = info {
                if *code_hash != spec.code_hash || *hash_type != spec.hash_type {
                    continue;
                }
                if dep_args.len() != 66 || &dep_args.as_ref()[34..66] != &spec.type_id_value[..] {
                    continue;
                }
                if matched_dep.is_some() {
                    return Err(error::to_sys_error(error::AMBIGUOUS_REGISTRY_CELL_DEP));
                }
                matched_dep = Some(dep_idx);
            }
        }
        match matched_dep {
            Some(dep_idx) => resolved.push((spec_idx, dep_idx)),
            None if spec.required => {
                return Err(error::to_sys_error(error::MISSING_REGISTRY_CELL_DEP))
            }
            None => {}
        }
    }
    Ok(resolved)
}

/// * Get median block timestamp from transaction
///
/// Calculates the median of timestamps from header_deps.
/// CKB consensus requires: median of previous 37 blocks < timestamp <= local_time + 15s
///
/// For deterministic validation, we use the median timestamp available from header_deps.
/// If no header_deps are available, we conservatively return 0 (all temporary entries active).
fn get_median_time() -> Result<u64, SysError> {
    // * Collect all timestamps from header_deps
    let mut timestamps = alloc::vec::Vec::new();
    
    let mut index = 0;
    loop {
        match ckb_std::high_level::load_header(index, Source::HeaderDep) {
            Ok(header) => {
                let timestamp: u64 = header.raw().timestamp().unpack();
                timestamps.push(timestamp);
                index += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e),
        }
    }
    
    // * If no headers available, fail-safe to 0 (all entries considered active)
    // * This ensures temporary blacklist entries are enforced until expiry
    if timestamps.is_empty() {
        return Ok(0);
    }
    
    // * Calculate median timestamp
    // * Sort timestamps and take middle value (or average of two middle values)
    timestamps.sort_unstable();
    
    let median = if timestamps.len() % 2 == 1 {
        // * Odd number: take middle element
        timestamps[timestamps.len() / 2]
    } else {
        // * Even number: average of two middle elements
        let mid = timestamps.len() / 2;
        (timestamps[mid - 1] + timestamps[mid]) / 2
    };
    
    Ok(median)
}

/// * Main validation entry point
fn program_entry() -> Result<(), SysError> {
    let script = load_script()?;
    let args: Bytes = script.args().unpack();
    let lock_args = FirewallLockArgs::parse(&args)?;

    if lock_args.version != 0x02 {
        return Err(error::to_sys_error(error::UNSUPPORTED_VERSION));
    }

    if lock_args.flags & 0xFC != 0 {
        return Err(error::to_sys_error(error::UNSUPPORTED_FLAGS));
    }

    // flags=0x00 disables all blacklist enforcement — reject this misconfiguration.
    if lock_args.flags & 0x03 == 0 {
        return Err(error::to_sys_error(error::UNSUPPORTED_FLAGS));
    }

    let resolved = resolve_registries(&lock_args.registries)?;

    let mut registries = alloc::vec::Vec::with_capacity(resolved.len());
    for (_spec_idx, dep_idx) in &resolved {
        let data = load_cell_data(*dep_idx, Source::CellDep)?;
        registries.push(RegistryPayload::parse(&data)?);
    }

    let median_time = get_median_time()?;

    let mut output_index = 0;
    loop {
        match ckb_std::high_level::load_cell_lock(output_index, Source::Output) {
            Ok(output_lock) => {
                if lock_args.check_lock_args() {
                    let lock_args_bytes: Bytes = output_lock.args().unpack();
                    for registry in &registries {
                        if registry.is_blacklisted(lock_args_bytes.as_ref(), median_time) {
                            return Err(error::to_sys_error(error::BLACKLISTED_LOCK_ARGS));
                        }
                    }
                }

                if lock_args.check_type_args() {
                    if let Ok(Some(output_type)) =
                        ckb_std::high_level::load_cell_type(output_index, Source::Output)
                    {
                        let type_args_bytes: Bytes = output_type.args().unpack();
                        for registry in &registries {
                            if registry.is_blacklisted(type_args_bytes.as_ref(), median_time) {
                                return Err(error::to_sys_error(error::BLACKLISTED_TYPE_ARGS));
                            }
                        }
                    }
                }

                output_index += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(_e) => return Err(error::to_sys_error(error::OUTPUT_SCRIPT_PARSE_FAILED)),
        }
    }

    delegate_to_inner_lock(&lock_args)
}

/// Hex-encode bytes into an ASCII slice (no 0x prefix). CStr-safe for spawn argv.
fn to_hex(bytes: &[u8], out: &mut alloc::vec::Vec<u8>) {
    const HEX: &[u8] = b"0123456789abcdef";
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize]);
        out.push(HEX[(b & 0xf) as usize]);
    }
}

/// Delegate validation to the wrapped inner lock script via spawn_cell.
///
/// Loads the user's secp256k1 signature from WitnessArgs.lock of GroupInput[0],
/// then spawns the inner lock with:
///   argv[0] = hex-encoded inner_args (pubkey_hash for spawn-aware-secp256k1)
///   argv[1] = hex-encoded signature (65 bytes)
///
/// The hex encoding ensures no null bytes in argv (CStr-safe for any binary args).
fn delegate_to_inner_lock(args: &FirewallLockArgs) -> Result<(), SysError> {
    use ckb_std::high_level::spawn_cell;
    use ckb_std::ckb_types::core::ScriptHashType;

    let hash_type = match args.inner_hash_type {
        0x00 => ScriptHashType::Data,
        0x01 => ScriptHashType::Type,
        0x02 => ScriptHashType::Data1,
        _ => return Err(error::to_sys_error(error::INVALID_INNER_LOCK_SCRIPT)),
    };

    // Load the user's signature from WitnessArgs.lock (GroupInput[0]).
    let witness_args = load_witness_args(0, Source::GroupInput)
        .map_err(|_| error::to_sys_error(error::INNER_LOCK_REJECTED))?;
    let sig_opt: Bytes = witness_args
        .lock()
        .to_opt()
        .ok_or(error::to_sys_error(error::INNER_LOCK_REJECTED))?
        .unpack();
    if sig_opt.len() != 65 {
        return Err(error::to_sys_error(error::INNER_LOCK_REJECTED));
    }

    // Append null terminators so we can create CStr slices for spawn_cell.
    let mut hex_inner_args: alloc::vec::Vec<u8> = alloc::vec::Vec::new();
    to_hex(args.inner_args.as_ref(), &mut hex_inner_args);
    hex_inner_args.push(0);

    let mut hex_sig: alloc::vec::Vec<u8> = alloc::vec::Vec::new();
    to_hex(sig_opt.as_ref(), &mut hex_sig);
    hex_sig.push(0);

    use core::ffi::CStr;
    let cstr_inner = CStr::from_bytes_with_nul(&hex_inner_args)
        .map_err(|_| error::to_sys_error(error::INVALID_INNER_LOCK_SCRIPT))?;
    let cstr_sig = CStr::from_bytes_with_nul(&hex_sig)
        .map_err(|_| error::to_sys_error(error::INVALID_INNER_LOCK_SCRIPT))?;

    let inherited_fds = [0u64];

    match spawn_cell(
        &args.inner_code_hash,
        hash_type,
        &[cstr_inner, cstr_sig],
        &inherited_fds,
    ) {
        Ok(child_pid) => match ckb_std::syscalls::wait(child_pid) {
            Ok(0) => Ok(()),
            _ => Err(error::to_sys_error(error::INNER_LOCK_REJECTED)),
        },
        Err(_) => Err(error::to_sys_error(error::MISSING_INNER_LOCK_CELL_DEP)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    extern crate std;
    use std::vec;

    fn make_blkl_v2(entries: &[(&[u8], u64)]) -> vec::Vec<u8> {
        // Minimal gov_header: gh_version(1) | signer_count(1) | threshold(1) | pubkey(33) | validator_count(2) | merkle_root(32) = 70 bytes
        let mut gh: vec::Vec<u8> = vec![];
        gh.push(0x01); // gh_version
        gh.push(0x01); // signer_count
        gh.push(0x01); // threshold
        gh.extend_from_slice(&[
            0x03, 0x1b, 0x84, 0xc5, 0x56, 0x7b, 0x12, 0x64, 0x40, 0x99, 0x5d, 0x3e,
            0xd5, 0xaa, 0xba, 0x05, 0x65, 0xd7, 0x1e, 0x18, 0x34, 0x60, 0x48, 0x19,
            0xff, 0x9c, 0x17, 0xf5, 0xe9, 0xd5, 0xdd, 0x07, 0x8f,
        ]);
        gh.extend_from_slice(&[0x00, 0x00]); // validator_count
        gh.extend_from_slice(&[0u8; 32]);     // validator_merkle_root
        let gh_len = gh.len() as u16;

        let mut data: vec::Vec<u8> = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x02);
        data.extend_from_slice(&gh_len.to_le_bytes());
        data.extend_from_slice(&gh);
        data.extend_from_slice(&(entries.len() as u32).to_le_bytes());
        for (id, expires_at) in entries {
            data.push(id.len() as u8);
            data.extend_from_slice(id);
            data.extend_from_slice(&expires_at.to_le_bytes());
        }
        data
    }

    /// Build v2 FirewallLockArgs bytes.
    /// registries: (code_hash, hash_type, type_id_value, required)
    fn make_v2_args(
        flags: u8,
        registries: &[([u8; 32], u8, [u8; 32], bool)],
        inner_code_hash: [u8; 32],
        inner_hash_type: u8,
        inner_args: &[u8],
    ) -> vec::Vec<u8> {
        let mut v: vec::Vec<u8> = vec![];
        v.push(0x02); // version
        v.push(flags);
        v.push(registries.len() as u8);
        for (code_hash, hash_type, type_id_value, required) in registries {
            v.extend_from_slice(code_hash);
            v.push(*hash_type);
            v.extend_from_slice(type_id_value);
            v.push(if *required { 1 } else { 0 });
        }
        v.extend_from_slice(&inner_code_hash);
        v.push(inner_hash_type);
        v.extend_from_slice(&(inner_args.len() as u16).to_le_bytes());
        v.extend_from_slice(inner_args);
        v
    }

    #[test]
    fn test_parse_valid_lock_args() {
        let type_id = [0xABu8; 32];
        let args = make_v2_args(
            0x03,
            &[([0u8; 32], 0x01, type_id, true)],
            [1u8; 32],
            0x01,
            &[0xAA, 0xBB, 0xCC, 0xDD],
        );
        let parsed = FirewallLockArgs::parse(&args).expect("should parse valid args");
        assert_eq!(parsed.version, 0x02);
        assert_eq!(parsed.flags, 0x03);
        assert_eq!(parsed.registries.len(), 1);
        assert!(parsed.check_lock_args());
        assert!(parsed.check_type_args());
        assert_eq!(parsed.inner_args.len(), 4);
    }

    #[test]
    fn test_parse_minimal_valid_args() {
        let args = make_v2_args(0x00, &[], [1u8; 32], 0x01, &[]);
        let parsed = FirewallLockArgs::parse(&args).expect("should parse minimal args");
        assert_eq!(parsed.version, 0x02);
        assert_eq!(parsed.flags, 0x00);
        assert_eq!(parsed.registries.len(), 0);
        assert_eq!(parsed.inner_args.len(), 0);
    }

    #[test]
    fn test_parse_with_one_registry() {
        let type_id = [0x55u8; 32];
        let args = make_v2_args(
            0x03,
            &[([0xAAu8; 32], 0x01, type_id, false)],
            [1u8; 32],
            0x01,
            &[],
        );
        let parsed = FirewallLockArgs::parse(&args).expect("should parse with one registry");
        assert_eq!(parsed.registries.len(), 1);
        assert_eq!(parsed.registries[0].code_hash, [0xAAu8; 32]);
        assert_eq!(parsed.registries[0].hash_type, 0x01);
        assert_eq!(parsed.registries[0].type_id_value, type_id);
        assert!(!parsed.registries[0].required);
    }

    #[test]
    fn test_parse_invalid_length_too_short() {
        let args = vec![0x02u8; 10]; // < 38 bytes minimum
        assert!(FirewallLockArgs::parse(&args).is_err());
    }

    #[test]
    fn test_parse_invalid_length_mismatch() {
        // Build args claiming inner_args_len = 2, then patch to claim 4.
        // inner_args_len LE bytes are at offset 36 (0-registries layout).
        let mut args = make_v2_args(0x00, &[], [1u8; 32], 0x01, &[0xAA, 0xBB]);
        args[36] = 0x04; // claim 4 inner bytes but only 2 present
        assert!(FirewallLockArgs::parse(&args).is_err());
    }

    #[test]
    fn test_parse_invalid_total_length() {
        let mut args = make_v2_args(0x00, &[], [1u8; 32], 0x01, &[0xAA, 0xBB, 0xCC, 0xDD]);
        args.push(0xFF); // extra byte beyond claimed inner_args_len
        assert!(FirewallLockArgs::parse(&args).is_err());
    }

    #[test]
    fn test_flags_check_lock_only() {
        let args = make_v2_args(0x01, &[], [0u8; 32], 0x01, &[]);
        let parsed = FirewallLockArgs::parse(&args).unwrap();
        assert!(parsed.check_lock_args());
        assert!(!parsed.check_type_args());
    }

    #[test]
    fn test_flags_check_type_only() {
        let args = make_v2_args(0x02, &[], [0u8; 32], 0x01, &[]);
        let parsed = FirewallLockArgs::parse(&args).unwrap();
        assert!(!parsed.check_lock_args());
        assert!(parsed.check_type_args());
    }

    #[test]
    fn test_flags_check_both() {
        let args = make_v2_args(0x03, &[], [0u8; 32], 0x01, &[]);
        let parsed = FirewallLockArgs::parse(&args).unwrap();
        assert!(parsed.check_lock_args());
        assert!(parsed.check_type_args());
    }

    #[test]
    fn test_registry_payload_parsing() {
        let data = make_blkl_v2(&[
            (&[0x11, 0x22, 0x33, 0x44], 0),         // permanent
            (&[0x55, 0x66, 0x77, 0x88], 1_000_000), // temporary
        ]);
        let registry = RegistryPayload::parse(&data).expect("should parse valid registry");
        assert_eq!(registry.version, 0x02);
        assert_eq!(registry.entries.len(), 2);
        assert_eq!(registry.entries[0].expires_at, 0);
        assert_eq!(registry.entries[1].expires_at, 1_000_000);
    }

    #[test]
    fn test_registry_invalid_magic() {
        let mut data = vec![];
        data.extend_from_slice(b"XXXX"); // Wrong magic
        data.push(0x01);
        data.extend_from_slice(&0u32.to_le_bytes());
        
        assert!(RegistryPayload::parse(&data).is_err());
    }

    #[test]
    fn test_registry_invalid_version() {
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x01); // v1 is now unsupported
        data.extend_from_slice(&0u32.to_le_bytes());
        assert!(RegistryPayload::parse(&data).is_err());
    }

    #[test]
    fn test_registry_truncated_data() {
        // Start with a valid v2 payload then truncate it
        let mut data = make_blkl_v2(&[(&[0x11, 0x22, 0x33, 0x44], 0)]);
        data.truncate(data.len() - 4); // truncate mid-entry
        assert!(RegistryPayload::parse(&data).is_err());
    }

    #[test]
    fn test_registry_not_sorted() {
        let data = make_blkl_v2(&[
            (&[0xFF, 0xFF, 0xFF, 0xFF], 0), // higher first
            (&[0x11, 0x22, 0x33, 0x44], 0), // lower second — not sorted
        ]);
        assert!(RegistryPayload::parse(&data).is_err());
    }

    #[test]
    fn test_blacklist_membership_permanent() {
        let data = make_blkl_v2(&[(&[0xAA, 0xBB, 0xCC, 0xDD], 0)]);
        let registry = RegistryPayload::parse(&data).unwrap();
        assert!(registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 0));
        assert!(registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 999_999_999));
        assert!(!registry.is_blacklisted(&[0x11, 0x22, 0x33, 0x44], 0));
    }

    #[test]
    fn test_blacklist_membership_temporary() {
        let data = make_blkl_v2(&[(&[0xAA, 0xBB, 0xCC, 0xDD], 1000)]);
        let registry = RegistryPayload::parse(&data).unwrap();
        assert!(registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 500));
        assert!(registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 999));
        assert!(!registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 1000));
        assert!(!registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 1001));
    }

    #[test]
    fn test_blacklist_membership_boundary() {
        let data = make_blkl_v2(&[(&[0xAA, 0xBB, 0xCC, 0xDD], 1000)]);
        let registry = RegistryPayload::parse(&data).unwrap();
        // expires_at == median_time means expired (exclusive upper bound)
        assert!(!registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 1000));
        assert!(registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 999));
    }

    #[test]
    fn test_blacklist_multiple_entries() {
        let data = make_blkl_v2(&[
            (&[0x11, 0x22], 0),
            (&[0x33, 0x44, 0x55], 5000),
            (&[0xAA, 0xBB, 0xCC, 0xDD], 0),
        ]);
        let registry = RegistryPayload::parse(&data).unwrap();
        assert!(registry.is_blacklisted(&[0x11, 0x22], 1000));
        assert!(registry.is_blacklisted(&[0x33, 0x44, 0x55], 4000));
        assert!(!registry.is_blacklisted(&[0x33, 0x44, 0x55], 5000));
        assert!(registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 999_999));
        assert!(!registry.is_blacklisted(&[0xFF, 0xFF], 0));
    }

    #[test]
    fn test_empty_registry() {
        let data = make_blkl_v2(&[]);
        let registry = RegistryPayload::parse(&data).expect("should parse empty registry");
        assert_eq!(registry.entries.len(), 0);
        assert!(!registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 0));
    }
}
