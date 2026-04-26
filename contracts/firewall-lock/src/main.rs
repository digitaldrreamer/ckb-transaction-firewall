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
    high_level::{load_cell_data, load_script},
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

/// * Lock args structure (v1 frozen layout)
///
/// Total size: 72 + N + M bytes
/// All multi-byte integers are little-endian
#[derive(Debug, Clone)]
pub struct FirewallLockArgs {
    /// MUST be 0x01 for v1
    pub version: u8,
    
    /// bit0: check output lock_args
    /// bit1: check output type_args  
    /// bits 2-7: reserved (MUST be 0)
    pub flags: u8,
    
    /// Registry cell type script identity
    pub registry_code_hash: [u8; 32],
    pub registry_hash_type: u8,
    pub registry_type_args: Bytes,
    
    /// Inner (wrapped) lock script
    pub inner_code_hash: [u8; 32],
    pub inner_hash_type: u8,
    pub inner_args: Bytes,
}

impl FirewallLockArgs {
    /// * Parse and validate lock args layout
    ///
    /// Returns InvalidArgsLayout if:
    /// - Total length != 72 + N + M
    /// - Length prefix mismatches actual data
    /// - Any validation invariant fails
    pub fn parse(args: &[u8]) -> Result<Self, SysError> {
        if args.len() < 72 {
            return Err(error::to_sys_error(error::INVALID_ARGS_LAYOUT));
        }

        let version = args[0];
        let flags = args[1];

        // * Extract registry type script identity
        let mut registry_code_hash = [0u8; 32];
        registry_code_hash.copy_from_slice(&args[2..34]);
        
        let registry_hash_type = args[34];
        
        let registry_type_args_len = u16::from_le_bytes([args[35], args[36]]) as usize;
        
        if args.len() < 37 + registry_type_args_len + 35 {
            return Err(error::to_sys_error(error::INVALID_ARGS_LAYOUT));
        }
        
        let registry_type_args = Bytes::from(args[37..37 + registry_type_args_len].to_vec());

        // * Extract inner lock script identity
        let inner_start = 37 + registry_type_args_len;
        
        let mut inner_code_hash = [0u8; 32];
        inner_code_hash.copy_from_slice(&args[inner_start..inner_start + 32]);
        
        let inner_hash_type = args[inner_start + 32];
        
        let inner_args_len = u16::from_le_bytes([
            args[inner_start + 33],
            args[inner_start + 34],
        ]) as usize;

        let inner_args_start = inner_start + 35;
        let expected_total_len = inner_args_start + inner_args_len;
        
        if args.len() != expected_total_len {
            return Err(error::to_sys_error(error::INVALID_ARGS_LAYOUT));
        }

        let inner_args = Bytes::from(args[inner_args_start..inner_args_start + inner_args_len].to_vec());

        Ok(Self {
            version,
            flags,
            registry_code_hash,
            registry_hash_type,
            registry_type_args,
            inner_code_hash,
            inner_hash_type,
            inner_args,
        })
    }

    /// Check if output lock_args checking is enabled
    pub fn check_lock_args(&self) -> bool {
        self.flags & 0x01 != 0
    }

    /// Check if output type_args checking is enabled
    pub fn check_type_args(&self) -> bool {
        self.flags & 0x02 != 0
    }
}

/// * Registry payload structure
///
/// Format (v1):
/// - 4 bytes: magic number (0x424C4B4C "BLKL")
/// - 1 byte: version (0x01)
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
        if version != 0x01 {
            return Err(error::to_sys_error(error::UNSUPPORTED_VERSION));
        }

        let entry_count = u32::from_le_bytes([data[5], data[6], data[7], data[8]]) as usize;

        let mut entries = alloc::vec::Vec::with_capacity(entry_count);
        let mut offset = 9;

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

        // * Verify entries are sorted for deterministic lookup
        for i in 1..entries.len() {
            if entries[i].identifier.as_ref() < entries[i - 1].identifier.as_ref() {
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

/// * Find the unique registry cell dep matching type script identity
///
/// Returns:
/// - Ok(index) if exactly one match found
/// - Err(MissingRegistryCellDep) if zero matches
/// - Err(AmbiguousRegistryCellDep) if multiple matches
fn find_registry_cell_dep(args: &FirewallLockArgs) -> Result<usize, SysError> {
    let mut matching_indices = alloc::vec::Vec::new();

    // * Scan all cell_deps for type script matches
    let mut index = 0;
    loop {
        match load_cell_data(index, Source::CellDep) {
            Ok(_) => {
                // * Check if this dep has a type script matching our identity
                if let Ok(type_script) = ckb_std::high_level::load_cell_type(index, Source::CellDep) {
                    if let Some(script) = type_script {
                        let code_hash: [u8; 32] = script.code_hash().unpack();
                        let hash_type: u8 = script.hash_type().into();
                        let type_args: Bytes = script.args().unpack();

                        if code_hash == args.registry_code_hash
                            && hash_type == args.registry_hash_type
                            && type_args.as_ref() == args.registry_type_args.as_ref()
                        {
                            matching_indices.push(index);
                        }
                    }
                }
                index += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e),
        }
    }

    // * Enforce exactly-one-match rule
    match matching_indices.len() {
        0 => Err(error::to_sys_error(error::MISSING_REGISTRY_CELL_DEP)),
        1 => Ok(matching_indices[0]),
        _ => Err(error::to_sys_error(error::AMBIGUOUS_REGISTRY_CELL_DEP)),
    }
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
    // * 1. Load and parse lock args
    let script = load_script()?;
    let args: Bytes = script.args().unpack();
    
    if args.len() < 72 {
        return Err(error::to_sys_error(error::INVALID_ARGS_LAYOUT));
    }

    let lock_args = FirewallLockArgs::parse(&args)?;

    // * 2. Validate version and flags
    if lock_args.version != 0x01 {
        return Err(error::to_sys_error(error::UNSUPPORTED_VERSION));
    }

    // * Reserved flag bits must be zero
    if lock_args.flags & 0xFC != 0 {
        return Err(error::to_sys_error(error::UNSUPPORTED_FLAGS));
    }

    // * 3. Find and load the registry cell
    let registry_index = find_registry_cell_dep(&lock_args)?;
    let registry_data = load_cell_data(registry_index, Source::CellDep)?;
    let registry = RegistryPayload::parse(&registry_data)?;

    // * 4. Get median time for expiry checks
    let median_time = get_median_time()?;

    // * 5. Check all transaction outputs against blacklist
    let mut output_index = 0;
    loop {
        match ckb_std::high_level::load_cell_lock(output_index, Source::Output) {
            Ok(output_lock) => {
                // * Check lock_args if flag enabled
                if lock_args.check_lock_args() {
                    let lock_args_bytes: Bytes = output_lock.args().unpack();
                    if registry.is_blacklisted(lock_args_bytes.as_ref(), median_time) {
                        return Err(error::to_sys_error(error::BLACKLISTED_LOCK_ARGS));
                    }
                }

                // * Check type_args if flag enabled and type script exists
                if lock_args.check_type_args() {
                    if let Ok(Some(output_type)) = ckb_std::high_level::load_cell_type(output_index, Source::Output) {
                        let type_args_bytes: Bytes = output_type.args().unpack();
                        if registry.is_blacklisted(type_args_bytes.as_ref(), median_time) {
                            return Err(error::to_sys_error(error::BLACKLISTED_TYPE_ARGS));
                        }
                    }
                }

                output_index += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(_e) => return Err(error::to_sys_error(error::OUTPUT_SCRIPT_PARSE_FAILED)),
        }
    }

    // * 6. All blacklist checks passed - delegate to inner lock
    // * Use spawn to execute the inner lock script in a separate process
    // * This provides isolation and proper error handling
    delegate_to_inner_lock(&lock_args)
}

/// * Delegate validation to the wrapped inner lock script
///
/// Uses spawn_cell to execute the inner lock in a separate process.
/// The inner lock gets a clean execution environment and proper error isolation.
fn delegate_to_inner_lock(args: &FirewallLockArgs) -> Result<(), SysError> {
    use ckb_std::high_level::spawn_cell;
    use ckb_std::ckb_types::core::ScriptHashType;
    
    // * Convert hash_type byte to ScriptHashType enum
    let hash_type = match args.inner_hash_type {
        0x00 => ScriptHashType::Data,
        0x01 => ScriptHashType::Type,
        0x02 => ScriptHashType::Data1,
        _ => return Err(error::to_sys_error(error::INVALID_INNER_LOCK_SCRIPT)),
    };
    
    // * Spawn the inner lock script as a child process
    // * The inner lock will validate ownership/authorization independently
    // * No file descriptors needed - inner lock just needs to validate and exit
    let inherited_fds = [0u64]; // * Must end with 0 as per spawn_cell API
    
    match spawn_cell(
        &args.inner_code_hash,
        hash_type,
        &[], // * No additional argv needed - inner lock reads from transaction
        &inherited_fds,
    ) {
        Ok(child_pid) => {
            // * Wait for inner lock to complete validation
            match ckb_std::syscalls::wait(child_pid) {
                Ok(exit_code) => {
                    if exit_code == 0 {
                        // * Inner lock validation succeeded
                        Ok(())
                    } else {
                        // * Inner lock rejected the transaction
                        Err(error::to_sys_error(error::INNER_LOCK_REJECTED))
                    }
                }
                Err(_e) => Err(error::to_sys_error(error::INNER_LOCK_REJECTED)),
            }
        }
        Err(_) => {
            // * Failed to spawn inner lock (missing dep, invalid code, etc.)
            Err(error::to_sys_error(error::MISSING_INNER_LOCK_CELL_DEP))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    extern crate std;
    use std::vec;

    #[test]
    fn test_parse_valid_lock_args() {
        let mut args = vec![
            0x01, // version
            0x03, // flags (check both lock and type args)
        ];
        
        // Registry type script identity
        args.extend_from_slice(&[0u8; 32]); // code_hash
        args.push(0x01); // hash_type
        args.extend_from_slice(&[0x00, 0x00]); // args_len = 0 (LE)
        
        // Inner lock script identity
        args.extend_from_slice(&[1u8; 32]); // code_hash
        args.push(0x01); // hash_type
        args.extend_from_slice(&[0x04, 0x00]); // args_len = 4 (LE)
        args.extend_from_slice(&[0xAA, 0xBB, 0xCC, 0xDD]); // inner args

        let parsed = FirewallLockArgs::parse(&args).expect("should parse valid args");
        
        assert_eq!(parsed.version, 0x01);
        assert_eq!(parsed.flags, 0x03);
        assert!(parsed.check_lock_args());
        assert!(parsed.check_type_args());
        assert_eq!(parsed.inner_args.len(), 4);
    }

    #[test]
    fn test_parse_minimal_valid_args() {
        // Minimal valid args: version + flags + registry (no args) + inner (no args)
        let mut args = vec![0x01, 0x00]; // version, flags
        args.extend_from_slice(&[0u8; 32]); // registry code_hash
        args.push(0x01); // registry hash_type
        args.extend_from_slice(&[0x00, 0x00]); // registry args_len = 0
        args.extend_from_slice(&[1u8; 32]); // inner code_hash
        args.push(0x01); // inner hash_type
        args.extend_from_slice(&[0x00, 0x00]); // inner args_len = 0
        
        let parsed = FirewallLockArgs::parse(&args).expect("should parse minimal args");
        assert_eq!(parsed.version, 0x01);
        assert_eq!(parsed.flags, 0x00);
        assert_eq!(parsed.registry_type_args.len(), 0);
        assert_eq!(parsed.inner_args.len(), 0);
    }

    #[test]
    fn test_parse_with_registry_args() {
        let mut args = vec![0x01, 0x03];
        args.extend_from_slice(&[0u8; 32]); // registry code_hash
        args.push(0x01);
        args.extend_from_slice(&[0x08, 0x00]); // registry args_len = 8
        args.extend_from_slice(&[0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]); // registry args
        args.extend_from_slice(&[1u8; 32]); // inner code_hash
        args.push(0x01);
        args.extend_from_slice(&[0x00, 0x00]); // inner args_len = 0
        
        let parsed = FirewallLockArgs::parse(&args).expect("should parse with registry args");
        assert_eq!(parsed.registry_type_args.len(), 8);
        assert_eq!(parsed.registry_type_args.as_ref(), &[0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
    }

    #[test]
    fn test_parse_invalid_length_too_short() {
        let args = vec![0x01; 10]; // Too short (< 72 bytes minimum)
        assert!(FirewallLockArgs::parse(&args).is_err());
    }

    #[test]
    fn test_parse_invalid_length_mismatch() {
        let mut args = vec![0x01, 0x00];
        args.extend_from_slice(&[0u8; 32]);
        args.push(0x01);
        args.extend_from_slice(&[0x04, 0x00]); // claims 4 bytes
        args.extend_from_slice(&[0xAA, 0xBB]); // but only provides 2
        args.extend_from_slice(&[1u8; 32]);
        args.push(0x01);
        args.extend_from_slice(&[0x00, 0x00]);
        
        assert!(FirewallLockArgs::parse(&args).is_err());
    }

    #[test]
    fn test_parse_invalid_total_length() {
        let mut args = vec![0x01, 0x00];
        args.extend_from_slice(&[0u8; 32]);
        args.push(0x01);
        args.extend_from_slice(&[0x00, 0x00]);
        args.extend_from_slice(&[1u8; 32]);
        args.push(0x01);
        args.extend_from_slice(&[0x04, 0x00]);
        args.extend_from_slice(&[0xAA, 0xBB, 0xCC, 0xDD]);
        args.push(0xFF); // Extra byte - should fail
        
        assert!(FirewallLockArgs::parse(&args).is_err());
    }

    #[test]
    fn test_flags_check_lock_only() {
        let args = FirewallLockArgs {
            version: 0x01,
            flags: 0x01, // Only lock_args check
            registry_code_hash: [0u8; 32],
            registry_hash_type: 0x01,
            registry_type_args: Bytes::new(),
            inner_code_hash: [0u8; 32],
            inner_hash_type: 0x01,
            inner_args: Bytes::new(),
        };
        
        assert!(args.check_lock_args());
        assert!(!args.check_type_args());
    }

    #[test]
    fn test_flags_check_type_only() {
        let args = FirewallLockArgs {
            version: 0x01,
            flags: 0x02, // Only type_args check
            registry_code_hash: [0u8; 32],
            registry_hash_type: 0x01,
            registry_type_args: Bytes::new(),
            inner_code_hash: [0u8; 32],
            inner_hash_type: 0x01,
            inner_args: Bytes::new(),
        };
        
        assert!(!args.check_lock_args());
        assert!(args.check_type_args());
    }

    #[test]
    fn test_flags_check_both() {
        let args = FirewallLockArgs {
            version: 0x01,
            flags: 0x03, // Both checks
            registry_code_hash: [0u8; 32],
            registry_hash_type: 0x01,
            registry_type_args: Bytes::new(),
            inner_code_hash: [0u8; 32],
            inner_hash_type: 0x01,
            inner_args: Bytes::new(),
        };
        
        assert!(args.check_lock_args());
        assert!(args.check_type_args());
    }

    #[test]
    fn test_registry_payload_parsing() {
        let mut data = vec![];
        data.extend_from_slice(b"BLKL"); // magic
        data.push(0x01); // version
        data.extend_from_slice(&2u32.to_le_bytes()); // entry count

        // Entry 1: permanent blacklist
        data.push(0x04); // id length
        data.extend_from_slice(&[0x11, 0x22, 0x33, 0x44]); // identifier
        data.extend_from_slice(&0u64.to_le_bytes()); // expires_at = 0 (permanent)

        // Entry 2: temporary blacklist (expires at timestamp 1000000)
        data.push(0x04); // id length
        data.extend_from_slice(&[0x55, 0x66, 0x77, 0x88]); // identifier
        data.extend_from_slice(&1000000u64.to_le_bytes()); // expires_at

        let registry = RegistryPayload::parse(&data).expect("should parse valid registry");
        
        assert_eq!(registry.version, 0x01);
        assert_eq!(registry.entries.len(), 2);
        assert_eq!(registry.entries[0].expires_at, 0);
        assert_eq!(registry.entries[1].expires_at, 1000000);
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
        data.push(0x02); // Unsupported version
        data.extend_from_slice(&0u32.to_le_bytes());
        
        assert!(RegistryPayload::parse(&data).is_err());
    }

    #[test]
    fn test_registry_truncated_data() {
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x01);
        data.extend_from_slice(&2u32.to_le_bytes()); // Claims 2 entries
        data.push(0x04);
        data.extend_from_slice(&[0x11, 0x22]); // But data is truncated
        
        assert!(RegistryPayload::parse(&data).is_err());
    }

    #[test]
    fn test_registry_not_sorted() {
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x01);
        data.extend_from_slice(&2u32.to_le_bytes());
        
        // Entry 1: higher identifier
        data.push(0x04);
        data.extend_from_slice(&[0xFF, 0xFF, 0xFF, 0xFF]);
        data.extend_from_slice(&0u64.to_le_bytes());
        
        // Entry 2: lower identifier (not sorted!)
        data.push(0x04);
        data.extend_from_slice(&[0x11, 0x22, 0x33, 0x44]);
        data.extend_from_slice(&0u64.to_le_bytes());
        
        assert!(RegistryPayload::parse(&data).is_err());
    }

    #[test]
    fn test_blacklist_membership_permanent() {
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x01);
        data.extend_from_slice(&1u32.to_le_bytes());
        
        data.push(0x04);
        data.extend_from_slice(&[0xAA, 0xBB, 0xCC, 0xDD]);
        data.extend_from_slice(&0u64.to_le_bytes()); // permanent

        let registry = RegistryPayload::parse(&data).unwrap();
        
        // Permanent entry should always be blacklisted
        assert!(registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 0));
        assert!(registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 999999999));
        
        // Non-blacklisted identifier
        assert!(!registry.is_blacklisted(&[0x11, 0x22, 0x33, 0x44], 0));
    }

    #[test]
    fn test_blacklist_membership_temporary() {
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x01);
        data.extend_from_slice(&1u32.to_le_bytes());
        
        data.push(0x04);
        data.extend_from_slice(&[0xAA, 0xBB, 0xCC, 0xDD]);
        data.extend_from_slice(&1000u64.to_le_bytes()); // expires at 1000

        let registry = RegistryPayload::parse(&data).unwrap();
        
        // Before expiry: blacklisted
        assert!(registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 500));
        assert!(registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 999));
        
        // At/after expiry: not blacklisted
        assert!(!registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 1000));
        assert!(!registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 1001));
    }

    #[test]
    fn test_blacklist_membership_boundary() {
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x01);
        data.extend_from_slice(&1u32.to_le_bytes());
        
        data.push(0x04);
        data.extend_from_slice(&[0xAA, 0xBB, 0xCC, 0xDD]);
        data.extend_from_slice(&1000u64.to_le_bytes());

        let registry = RegistryPayload::parse(&data).unwrap();
        
        // Exact boundary check: expires_at == median_time means expired
        assert!(!registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 1000));
        assert!(registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 999));
    }

    #[test]
    fn test_blacklist_multiple_entries() {
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x01);
        data.extend_from_slice(&3u32.to_le_bytes());
        
        // Entry 1
        data.push(0x02);
        data.extend_from_slice(&[0x11, 0x22]);
        data.extend_from_slice(&0u64.to_le_bytes());
        
        // Entry 2
        data.push(0x03);
        data.extend_from_slice(&[0x33, 0x44, 0x55]);
        data.extend_from_slice(&5000u64.to_le_bytes());
        
        // Entry 3
        data.push(0x04);
        data.extend_from_slice(&[0xAA, 0xBB, 0xCC, 0xDD]);
        data.extend_from_slice(&0u64.to_le_bytes());

        let registry = RegistryPayload::parse(&data).unwrap();
        
        assert!(registry.is_blacklisted(&[0x11, 0x22], 1000));
        assert!(registry.is_blacklisted(&[0x33, 0x44, 0x55], 4000));
        assert!(!registry.is_blacklisted(&[0x33, 0x44, 0x55], 5000));
        assert!(registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 999999));
        assert!(!registry.is_blacklisted(&[0xFF, 0xFF], 0));
    }

    #[test]
    fn test_empty_registry() {
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x01);
        data.extend_from_slice(&0u32.to_le_bytes()); // Zero entries
        
        let registry = RegistryPayload::parse(&data).expect("should parse empty registry");
        
        assert_eq!(registry.entries.len(), 0);
        assert!(!registry.is_blacklisted(&[0xAA, 0xBB, 0xCC, 0xDD], 0));
    }
}
