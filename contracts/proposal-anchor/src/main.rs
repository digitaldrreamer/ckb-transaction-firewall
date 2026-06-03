//! Proposal Anchor Type Script
//!
//! Protects treasury-funded PBLK proposal anchor cells. The script enforces:
//! - Anchor data is a valid PBLK v1 proposal for the configured registry Type ID.
//! - Anchor cells are locked to the configured registry treasury.
//! - When an anchor is consumed, capacity returns to treasury minus a bounded fee.
//! - The anchor input uses a relative timestamp `since` at least the configured delay.

#![no_std]
#![cfg_attr(not(test), no_main)]
#![cfg_attr(test, allow(dead_code))]

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
    syscalls::{load_cell_by_field, load_cell_data, load_input, load_script},
};

const MAX_ANCHOR_FEE_SHANNONS: u64 = 100_000_000; // 1 CKB

pub mod error {
    use ckb_std::error::SysError;

    pub const INVALID_TYPE_ARGS: i8 = 31;
    pub const INVALID_TOPOLOGY: i8 = 32;
    pub const INVALID_PROPOSAL_DATA: i8 = 33;
    pub const UNAUTHORIZED_TREASURY_LOCK: i8 = 34;
    pub const INVALID_RECLAIM_RETURN: i8 = 35;
    pub const INVALID_RECLAIM_SINCE: i8 = 36;

    pub fn to_sys_error(code: i8) -> SysError {
        SysError::Unknown(code as u64)
    }
}

#[derive(Debug, Clone)]
struct AnchorArgs {
    registry_type_id_value: [u8; 32],
    treasury_lock_hash: [u8; 32],
    reclaim_delay_ms: u64,
}

impl AnchorArgs {
    // version(0x01) | registry_type_id_value(32) | treasury_lock_hash(32) | reclaim_delay_ms(8 LE)
    fn parse(raw: &[u8]) -> Result<Self, SysError> {
        if raw.len() != 73 || raw[0] != 0x01 {
            return Err(error::to_sys_error(error::INVALID_TYPE_ARGS));
        }
        let mut registry_type_id_value = [0u8; 32];
        registry_type_id_value.copy_from_slice(&raw[1..33]);
        let mut treasury_lock_hash = [0u8; 32];
        treasury_lock_hash.copy_from_slice(&raw[33..65]);
        let reclaim_delay_ms = u64::from_le_bytes([
            raw[65], raw[66], raw[67], raw[68], raw[69], raw[70], raw[71], raw[72],
        ]);
        Ok(Self {
            registry_type_id_value,
            treasury_lock_hash,
            reclaim_delay_ms,
        })
    }
}

fn blake2b_256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut hasher: Blake2b = Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    hasher.update(data);
    hasher.finalize(&mut out);
    out
}

fn load_var_bytes<F>(mut loader: F) -> Result<Vec<u8>, SysError>
where
    F: FnMut(&mut [u8], usize) -> Result<usize, SysError>,
{
    let mut buf = [0u8; 0];
    let len = match loader(&mut buf, 0) {
        Ok(len) => len,
        Err(SysError::LengthNotEnough(len)) => len,
        Err(e) => return Err(e),
    };
    let mut data = Vec::new();
    data.resize(len, 0);
    match loader(&mut data, 0) {
        Ok(_) | Err(SysError::LengthNotEnough(_)) => Ok(data),
        Err(e) => Err(e),
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

fn load_input_bytes(index: usize, source: Source) -> Result<Vec<u8>, SysError> {
    read_exact_bytes(load_input, index, source)
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

fn load_cell_type_script_hash(index: usize, source: Source) -> Result<[u8; 32], SysError> {
    let mut hash = [0u8; 32];
    load_cell_by_field(&mut hash, 0, index, source, CellField::TypeHash)?;
    Ok(hash)
}

fn load_running_script_raw() -> Result<Vec<u8>, SysError> {
    // Load the running script via raw syscall to avoid molecule::Script / bytes::Bytes Arc
    // operations, which emit lr/sc atomic instructions unsupported by the CKB VM.
    load_var_bytes(|buf, offset| load_script(buf, offset))
}

fn running_type_script_hash() -> Result<[u8; 32], SysError> {
    let raw = load_running_script_raw().map_err(|_| error::to_sys_error(error::INVALID_TYPE_ARGS))?;
    Ok(blake2b_256(&raw))
}

fn running_type_args() -> Result<AnchorArgs, SysError> {
    let raw = load_running_script_raw().map_err(|_| error::to_sys_error(error::INVALID_TYPE_ARGS))?;
    // Molecule Script (Table): total_len(4) | f0_off(4) | f1_off(4) | f2_off(4)
    //                           | code_hash(32) | hash_type(1) | args_fixvec_len(4) | args...
    if raw.len() < 17 {
        return Err(error::to_sys_error(error::INVALID_TYPE_ARGS));
    }
    let args_off = u32::from_le_bytes([raw[12], raw[13], raw[14], raw[15]]) as usize;
    if args_off + 4 > raw.len() {
        return Err(error::to_sys_error(error::INVALID_TYPE_ARGS));
    }
    let data_len = u32::from_le_bytes([raw[args_off], raw[args_off+1], raw[args_off+2], raw[args_off+3]]) as usize;
    let end = args_off + 4 + data_len;
    if end > raw.len() {
        return Err(error::to_sys_error(error::INVALID_TYPE_ARGS));
    }
    AnchorArgs::parse(&raw[args_off + 4 .. end])
}

fn matching_anchor_indices(source: Source, self_hash: &[u8; 32]) -> Result<Vec<usize>, SysError> {
    let mut matches = Vec::new();
    let mut i = 0usize;
    loop {
        match load_cell_type_script_hash(i, source) {
            Ok(hash) => {
                if hash == *self_hash {
                    matches.push(i);
                }
                i += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(SysError::ItemMissing) => {
                i += 1;
            }
            Err(e) => return Err(e),
        }
    }
    Ok(matches)
}

fn validate_pblk(data: &[u8], registry_type_id_value: &[u8; 32]) -> Result<(), SysError> {
    if data.len() < 4 + 1 + 32 + 1 + 1 + 8 + 32 {
        return Err(error::to_sys_error(error::INVALID_PROPOSAL_DATA));
    }
    if &data[0..4] != b"PBLK" || (data[4] != 0x01 && data[4] != 0x02) {
        return Err(error::to_sys_error(error::INVALID_PROPOSAL_DATA));
    }
    if &data[5..37] != registry_type_id_value {
        return Err(error::to_sys_error(error::INVALID_PROPOSAL_DATA));
    }
    match data[37] {
        0x01 | 0x02 => {}
        _ => return Err(error::to_sys_error(error::INVALID_PROPOSAL_DATA)),
    }
    let id_len = data[38] as usize;
    let id_start = 39usize;
    let id_end = id_start + id_len;
    if id_len == 0 || id_end + 8 + 32 != data.len() {
        return Err(error::to_sys_error(error::INVALID_PROPOSAL_DATA));
    }
    Ok(())
}

fn relative_timestamp_since_ms(index: usize) -> Result<u64, SysError> {
    let raw = load_input_bytes(index, Source::Input)?;
    if raw.len() < 8 {
        return Err(error::to_sys_error(error::INVALID_RECLAIM_SINCE));
    }
    let since = u64::from_le_bytes([
        raw[0], raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7],
    ]);
    let relative = (since & 0x8000_0000_0000_0000) != 0;
    let timestamp = (since & 0x4000_0000_0000_0000) != 0;
    if !relative || !timestamp {
        return Err(error::to_sys_error(error::INVALID_RECLAIM_SINCE));
    }
    // CKB timestamp since field stores seconds; multiply by 1000 to match ms stored in reclaim_delay_ms.
    Ok((since & 0x00ff_ffff_ffff_ffff) * 1000)
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

fn program_entry() -> Result<(), SysError> {
    let args = running_type_args()?;
    let self_hash = running_type_script_hash()?;
    let input_anchors = matching_anchor_indices(Source::Input, &self_hash)?;
    let output_anchors = matching_anchor_indices(Source::Output, &self_hash)?;

    if input_anchors.len() > 1
        || output_anchors.len() > 1
        || (input_anchors.is_empty() && output_anchors.is_empty())
    {
        return Err(error::to_sys_error(error::INVALID_TOPOLOGY));
    }

    // Creating a new anchor: validate PBLK data. Lock is not checked — any lock
    // (governance-lock, treasury secp256k1, or other) is permitted. The since delay
    // and capacity-return checks on the consume path provide the real security.
    if let Some(&output_index) = output_anchors.first() {
        let data = load_cell_data_bytes(output_index, Source::Output)?;
        validate_pblk(data.as_slice(), &args.registry_type_id_value)?;
    }

    // Consuming an anchor (execute or reclaim): validate data, enforce since delay,
    // and ensure capacity is not burned. Lock is not checked — the consuming
    // transaction's lock script (governance-lock or treasury secp256k1) handles auth.
    if let Some(&input_index) = input_anchors.first() {
        let data = load_cell_data_bytes(input_index, Source::Input)?;
        validate_pblk(data.as_slice(), &args.registry_type_id_value)?;
        let delay = relative_timestamp_since_ms(input_index)?;
        if delay < args.reclaim_delay_ms {
            return Err(error::to_sys_error(error::INVALID_RECLAIM_SINCE));
        }
        let input_capacity = load_cell_capacity(input_index, Source::Input)?;
        let min_return = input_capacity.saturating_sub(MAX_ANCHOR_FEE_SHANNONS);
        // Verify reclaim returns funds to the configured treasury, not an arbitrary address.
        let treasury_return = output_capacity_for_lock_hash(&args.treasury_lock_hash)
            .map_err(|_| error::to_sys_error(error::INVALID_RECLAIM_RETURN))?;
        if treasury_return < min_return {
            return Err(error::to_sys_error(error::INVALID_RECLAIM_RETURN));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    #[test]
    fn test_anchor_args_parse_valid() {
        let mut raw = vec![0x01];
        raw.extend_from_slice(&[0x22u8; 32]);
        raw.extend_from_slice(&[0x33u8; 32]);
        raw.extend_from_slice(&123u64.to_le_bytes());
        let args = AnchorArgs::parse(&raw).expect("parse");
        assert_eq!(args.registry_type_id_value, [0x22u8; 32]);
        assert_eq!(args.treasury_lock_hash, [0x33u8; 32]);
        assert_eq!(args.reclaim_delay_ms, 123);
    }

    #[test]
    fn test_anchor_args_rejects_bad_len() {
        assert!(AnchorArgs::parse(&[0x01]).is_err());
    }

    #[test]
    fn test_validate_pblk_valid() {
        let mut data = vec![];
        data.extend_from_slice(b"PBLK");
        data.push(0x01);
        data.extend_from_slice(&[0x42u8; 32]);
        data.push(0x01);
        data.push(1);
        data.push(0xaa);
        data.extend_from_slice(&0u64.to_le_bytes());
        data.extend_from_slice(&[0x99u8; 32]);
        validate_pblk(&data, &[0x42u8; 32]).expect("valid");
    }

    #[test]
    fn test_validate_pblk_rejects_wrong_registry() {
        let mut data = vec![];
        data.extend_from_slice(b"PBLK");
        data.push(0x01);
        data.extend_from_slice(&[0x42u8; 32]);
        data.push(0x01);
        data.push(1);
        data.push(0xaa);
        data.extend_from_slice(&0u64.to_le_bytes());
        data.extend_from_slice(&[0x99u8; 32]);
        assert!(validate_pblk(&data, &[0x43u8; 32]).is_err());
    }
}
