//! Shared parser for the on-chain blacklist-registry payload (BLKL v2).
//!
//! This crate holds the single canonical implementation of the registry
//! payload decoder used by the `blacklist-registry` type script. It is
//! `no_std` (only `alloc`) so it links into the on-chain contract unchanged,
//! and it is free of any `ckb-std` dependency so it can be property-fuzzed on
//! the host without a CKB VM.
//!
//! Keeping the decoder in one place means the consensus contract and its
//! fuzz tests exercise the exact same bytes-to-entries logic — there is no
//! second copy that can silently drift.
//!
//! # Wire format
//!
//! ```text
//! BLKL(4) | version(1)=0x02 | gov_header_len(2 LE) | gov_header(gov_header_len)
//!         | entry_count(4 LE) | [ id_len(1) | id(id_len) | expires_at(8 LE) ] × entry_count
//! ```
//!
//! The governance header is skipped here (it is validated elsewhere in the
//! contract). Entries must be strictly ascending by identifier.

#![no_std]

extern crate alloc;

use alloc::vec::Vec;

/// A single blacklist entry: an identifier (arbitrary bytes) and an expiry
/// timestamp in Unix seconds. `expires_at == 0` means the entry never expires.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistryEntry {
    pub identifier: Vec<u8>,
    pub expires_at: u64,
}

/// A parsed BLKL v2 registry payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistryPayload {
    pub version: u8,
    pub entries: Vec<RegistryEntry>,
}

/// Why a registry payload failed to parse.
///
/// Variants are granular enough for each on-chain script to map them back to
/// its own diagnostic exit codes without loss:
/// * `blacklist-registry`: `UnsupportedVersion` → 23; everything else → 22.
/// * `firewall-lock`: `UnsupportedVersion` → 6; `NotSorted` → 10; everything
///   else → 9.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegistryParseError {
    /// Malformed layout: bad magic, truncation, or an over-long entry count.
    InvalidPayload,
    /// The version byte is not `0x02`.
    UnsupportedVersion,
    /// Entries are not in strictly ascending identifier order (includes
    /// duplicates). Kept distinct because `firewall-lock` reports it separately.
    NotSorted,
    /// Strict parsing only: bytes remain after the declared entries. The
    /// canonical encoding has nothing after the last entry.
    TrailingBytes,
}

impl RegistryPayload {
    /// Parse a raw BLKL v2 registry payload, ignoring any bytes after the
    /// declared entries.
    ///
    /// This is the historical on-chain behaviour. Prefer [`parse_strict`] for
    /// new call sites; this lenient form is retained for reference and is
    /// exercised by the fuzz suite alongside the strict form.
    ///
    /// [`parse_strict`]: RegistryPayload::parse_strict
    pub fn parse(data: &[u8]) -> Result<Self, RegistryParseError> {
        Self::parse_inner(data, false)
    }

    /// Parse a raw BLKL v2 registry payload, rejecting any trailing bytes after
    /// the declared entries ([`RegistryParseError::TrailingBytes`]).
    ///
    /// This enforces canonical encoding: the input must be consumed exactly.
    pub fn parse_strict(data: &[u8]) -> Result<Self, RegistryParseError> {
        Self::parse_inner(data, true)
    }

    fn parse_inner(data: &[u8], strict: bool) -> Result<Self, RegistryParseError> {
        // Minimum: BLKL(4) + version(1) + gov_header_len(2) + entry_count(4) = 11 bytes
        if data.len() < 11 {
            return Err(RegistryParseError::InvalidPayload);
        }
        if &data[0..4] != b"BLKL" {
            return Err(RegistryParseError::InvalidPayload);
        }
        let version = data[4];
        if version != 0x02 {
            return Err(RegistryParseError::UnsupportedVersion);
        }
        let gov_header_len = u16::from_le_bytes([data[5], data[6]]) as usize;
        let entries_start = 7 + gov_header_len;
        if entries_start + 4 > data.len() {
            return Err(RegistryParseError::InvalidPayload);
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
            return Err(RegistryParseError::InvalidPayload);
        }
        let mut entries = Vec::with_capacity(entry_count);
        for _ in 0..entry_count {
            if offset >= data.len() {
                return Err(RegistryParseError::InvalidPayload);
            }
            let id_len = data[offset] as usize;
            offset += 1;
            if offset + id_len + 8 > data.len() {
                return Err(RegistryParseError::InvalidPayload);
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
                return Err(RegistryParseError::NotSorted);
            }
        }
        // Sortedness is checked before trailing bytes so an unsorted payload
        // still reports `NotSorted` regardless of any trailing data.
        if strict && offset != data.len() {
            return Err(RegistryParseError::TrailingBytes);
        }
        Ok(Self { version, entries })
    }

    /// Return whether `identifier` is currently blacklisted at `median_time`
    /// (Unix seconds). Entries with `expires_at == 0` are permanent; otherwise
    /// an entry is active only while `median_time < expires_at`.
    ///
    /// Relies on the strictly-ascending ordering the parser guarantees to
    /// binary-search the entries.
    pub fn is_blacklisted(&self, identifier: &[u8], median_time: u64) -> bool {
        self.entries
            .binary_search_by(|entry| entry.identifier.as_slice().cmp(identifier))
            .map(|idx| {
                let entry = &self.entries[idx];
                entry.expires_at == 0 || median_time < entry.expires_at
            })
            .unwrap_or(false)
    }
}
