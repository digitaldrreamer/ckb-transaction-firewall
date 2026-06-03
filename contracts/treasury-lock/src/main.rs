//! Treasury Lock — autonomous treasury for CKB firewall governance.
//!
//! Anyone can spend treasury cells WITHOUT a private key, but ONLY in a transaction
//! that satisfies all three conditions:
//!
//! 1. At least one output is a valid proposal-anchor cell bound to THIS treasury:
//!    - lock  = governance-lock (code_hash = gov_lock_type_id, hash_type = type, args = [0x01])
//!    - type  = proposal-anchor (code_hash = anchor_type_id, hash_type = type)
//!            whose args carry treasury_lock_hash == blake2b(this script)
//!    - data  starts with b"PBLK"
//!    OR: at least one INPUT is a proposal-anchor cell bound to THIS treasury (execute TX).
//!
//! 2. Treasury capacity is not burned beyond MAX_PER_TX_SPEND_SHANNONS:
//!    - sum(outputs locked by this treasury-lock) + MAX_PER_TX_SPEND_SHANNONS >= sum(treasury inputs)
//!
//! Args (64 bytes): governance_lock_type_id(32) | proposal_anchor_type_id(32)
//!
//! Anyone donates by sending CKB to a treasury-lock address. After execution the
//! execute TX returns anchor capacity to the treasury automatically — self-replenishing.

#![no_std]
#![cfg_attr(not(test), no_main)]

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
        Err(e) => e,
    }
}

#[cfg(test)]
extern crate alloc;

use alloc::vec::Vec;
use blake2b_ref::{Blake2b, Blake2bBuilder};
use ckb_std::ckb_constants::{CellField, Source};
use ckb_std::error::SysError;
use ckb_std::syscalls::{load_cell_by_field, load_cell_data, load_script};

const ERR_INVALID_ARGS: i8 = 1;
const ERR_NO_ANCHOR_OUTPUT: i8 = 2;
const ERR_INSUFFICIENT_RETURN: i8 = 3;
const ERR_LOAD: i8 = 4;

// Exact byte size of a governance-lock Script molecule:
//   header(16) + code_hash(32) + hash_type(1) + args_bytes_prefix(4) + args([0x01] = 1 byte) = 54
// The args field is molecule `Bytes` which carries a 4-byte LE length prefix before the data.
const GOV_LOCK_SCRIPT_LEN: usize = 54;

// Minimum byte size of a proposal-anchor type Script molecule to read through treasury_lock_hash.
// Layout: header(16) + code_hash(32) + hash_type(1) + bytes_prefix(4) + args:
//   args = version(1) + registry_type_id_value(32) + treasury_lock_hash(32) + reclaim_delay_ms(8)
// treasury_lock_hash ends at: 16 + 32 + 1 + 4 + 1 + 32 + 32 = 118
const ANCHOR_TYPE_TREASURY_HASH_END: usize = 118;

// Maximum CKB the treasury may spend per TX (anchor cell capacity + TX fee).
// A single blacklist anchor needs ~300 CKB; allow up to 1000 CKB per TX to be generous.
const MAX_PER_TX_SPEND_SHANNONS: u64 = 1_000 * 100_000_000;

fn blake2b_256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut h: Blake2b = Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    h.update(data);
    h.finalize(&mut out);
    out
}

fn load_var<F>(mut f: F) -> Result<Vec<u8>, SysError>
where
    F: FnMut(&mut [u8], usize) -> Result<usize, SysError>,
{
    let mut dummy = [];
    let len = match f(&mut dummy, 0) {
        Ok(n) => n,
        Err(SysError::LengthNotEnough(n)) => n,
        Err(e) => return Err(e),
    };
    let mut buf = Vec::new();
    buf.resize(len, 0u8);
    match f(&mut buf, 0) {
        Ok(_) | Err(SysError::LengthNotEnough(_)) => Ok(buf),
        Err(e) => Err(e),
    }
}

fn load_cell_field_bytes(index: usize, source: Source, field: CellField) -> Result<Vec<u8>, SysError> {
    load_var(|buf, off| load_cell_by_field(buf, off, index, source, field))
}

// Load capacity directly into a fixed [u8; 8] — no heap allocation.
fn load_capacity_raw(index: usize, source: Source) -> Result<u64, SysError> {
    let mut raw = [0u8; 8];
    load_cell_by_field(&mut raw, 0, index, source, CellField::Capacity)?;
    Ok(u64::from_le_bytes(raw))
}

fn load_output_type(index: usize) -> Result<Option<Vec<u8>>, SysError> {
    match load_cell_field_bytes(index, Source::Output, CellField::Type) {
        Ok(b) if b.is_empty() => Ok(None),
        Ok(b) => Ok(Some(b)),
        Err(SysError::ItemMissing) => Ok(None),
        Err(e) => Err(e),
    }
}

fn load_output_data_prefix(index: usize) -> Result<[u8; 4], SysError> {
    let mut buf = [0u8; 4];
    match load_cell_data(&mut buf, 0, index, Source::Output) {
        Ok(_) | Err(SysError::LengthNotEnough(_)) => Ok(buf),
        Err(e) => Err(e),
    }
}

// Load lock hash directly via CellField::LockHash — avoids loading the full lock script.
fn load_lock_hash(index: usize, source: Source) -> Result<[u8; 32], SysError> {
    let mut hash = [0u8; 32];
    load_cell_by_field(&mut hash, 0, index, source, CellField::LockHash)?;
    Ok(hash)
}

fn load_group_input_capacity() -> Result<u64, i8> {
    let mut total = 0u64;
    let mut i = 0usize;
    loop {
        match load_capacity_raw(i, Source::GroupInput) {
            Ok(cap) => {
                total = total.saturating_add(cap);
                i += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ERR_LOAD),
        }
    }
    Ok(total)
}

// Check that a type script belongs to the proposal-anchor AND is bound to this treasury.
// Anchor type args layout (after the 4-byte Bytes prefix at offset 49):
//   args[0]      = version byte (0x01)       → type_bytes[53]
//   args[1..33]  = registry_type_id_value    → type_bytes[54..86]
//   args[33..65] = treasury_lock_hash        → type_bytes[86..118]
//   args[65..73] = reclaim_delay_ms          → type_bytes[118..126]
fn is_anchor_type_for_treasury(
    type_bytes: &[u8],
    anchor_type_id: &[u8; 32],
    self_lock_hash: &[u8; 32],
) -> bool {
    type_bytes.len() >= ANCHOR_TYPE_TREASURY_HASH_END
        && &type_bytes[16..48] == anchor_type_id    // code_hash = proposal-anchor type ID
        && type_bytes[48] == 0x01                   // hash_type = type
        && &type_bytes[86..118] == self_lock_hash   // treasury_lock_hash bound to this treasury
}

const PBLK_MAGIC: &[u8; 4] = b"PBLK";

fn program_entry() -> Result<(), i8> {
    // Load this script's serialized molecule bytes to extract args and compute self lock hash.
    let script_bytes = load_var(|buf, off| load_script(buf, off)).map_err(|_| ERR_LOAD)?;

    // Script molecule header: full_size(4) | offset_code_hash(4) | offset_hash_type(4) | offset_args(4)
    if script_bytes.len() < 16 {
        return Err(ERR_INVALID_ARGS);
    }
    let off_args = u32::from_le_bytes([
        script_bytes[12], script_bytes[13], script_bytes[14], script_bytes[15],
    ]) as usize;
    // The `args` field is molecule `Bytes` — skip the 4-byte LE length prefix.
    let args_with_prefix = script_bytes.get(off_args..).ok_or(ERR_INVALID_ARGS)?;
    if args_with_prefix.len() < 4 {
        return Err(ERR_INVALID_ARGS);
    }
    let args = args_with_prefix.get(4..).ok_or(ERR_INVALID_ARGS)?;
    if args.len() != 64 {
        return Err(ERR_INVALID_ARGS);
    }
    let gov_type_id: [u8; 32] = args[0..32].try_into().map_err(|_| ERR_INVALID_ARGS)?;
    let anchor_type_id: [u8; 32] = args[32..64].try_into().map_err(|_| ERR_INVALID_ARGS)?;

    // Treasury change outputs share our exact lock script molecule → same blake2b hash.
    let self_lock_hash = blake2b_256(&script_bytes);

    let treasury_in_cap = load_group_input_capacity()?;

    // Precompute the expected governance-lock blake2b hash once so we can compare
    // against lock_hash directly without loading the full lock script per output.
    // Governance-lock molecule (54 bytes) is deterministic given gov_type_id.
    let gov_lock_hash = {
        let mut mol = [0u8; GOV_LOCK_SCRIPT_LEN];
        mol[0..4].copy_from_slice(&(GOV_LOCK_SCRIPT_LEN as u32).to_le_bytes()); // full_size
        mol[4..8].copy_from_slice(&16u32.to_le_bytes());  // offset code_hash
        mol[8..12].copy_from_slice(&48u32.to_le_bytes()); // offset hash_type
        mol[12..16].copy_from_slice(&49u32.to_le_bytes()); // offset args
        mol[16..48].copy_from_slice(&gov_type_id);
        mol[48] = 0x01;  // hash_type = type
        mol[49..53].copy_from_slice(&1u32.to_le_bytes()); // args Bytes prefix (len=1)
        mol[53] = 0x01;  // args = [0x01]
        blake2b_256(&mol)
    };

    // Scan outputs: accumulate treasury return capacity and detect an anchor output
    // bound to this treasury.
    let mut found_anchor = false;
    let mut treasury_out_cap = 0u64;
    let mut i = 0usize;
    loop {
        let lock_hash = match load_lock_hash(i, Source::Output) {
            Ok(h) => h,
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ERR_LOAD),
        };
        let cap = load_capacity_raw(i, Source::Output).map_err(|_| ERR_LOAD)?;

        if lock_hash == self_lock_hash {
            treasury_out_cap = treasury_out_cap.saturating_add(cap);
        }

        if !found_anchor && lock_hash == gov_lock_hash {
            if let Ok(Some(type_bytes)) = load_output_type(i) {
                if is_anchor_type_for_treasury(&type_bytes, &anchor_type_id, &self_lock_hash) {
                    if let Ok(prefix) = load_output_data_prefix(i) {
                        if &prefix == PBLK_MAGIC {
                            found_anchor = true;
                        }
                    }
                }
            }
        }

        i += 1;
    }

    // If no anchor output found, check whether this is an execute TX:
    // a TX that consumes a proposal-anchor INPUT bound to this treasury.
    // The proposal-anchor type script enforces governance authorization before
    // it can be spent, so the treasury can trust any TX that consumes one.
    if !found_anchor {
        let mut j = 0usize;
        loop {
            match load_cell_field_bytes(j, Source::Input, CellField::Type) {
                Ok(type_bytes) if is_anchor_type_for_treasury(&type_bytes, &anchor_type_id, &self_lock_hash) => {
                    found_anchor = true;
                    break;
                }
                Ok(_) => j += 1,
                Err(SysError::IndexOutOfBound) => break,
                Err(SysError::ItemMissing) => j += 1,
                Err(_) => return Err(ERR_LOAD),
            }
        }
    }

    if !found_anchor {
        return Err(ERR_NO_ANCHOR_OUTPUT);
    }

    if treasury_out_cap.saturating_add(MAX_PER_TX_SPEND_SHANNONS) < treasury_in_cap {
        return Err(ERR_INSUFFICIENT_RETURN);
    }

    Ok(())
}
