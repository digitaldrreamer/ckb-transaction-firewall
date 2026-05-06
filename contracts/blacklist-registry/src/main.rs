//! Blacklist Registry Type Script - Governance Gate for Registry Updates
//!
//! This type script protects the canonical blacklist registry cell. It enforces:
//! - Exactly-one input + exactly-one output registry cell per update transaction.
//! - Registry payload format invariants (BLKL v1, sorted entries).
//! - Governance authorization via a configured governance lock script identity.
//! - Governance context binding via a witness payload (GOV1 v1) committed to by tx signatures.
//!
//! The registry cell itself is referenced by the firewall lock script using this type script
//! identity (code_hash, hash_type, args). Therefore, registry updates must preserve the same
//! type script args to avoid per-wallet lock migration.

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
        Err(ckb_std::error::SysError::Unknown(code)) => code as i8,
        Err(_) => -1,
    }
}

use alloc::vec::Vec;
use blake2b_ref::{Blake2b, Blake2bBuilder};
use ckb_std::{
    ckb_constants::Source,
    ckb_types::{
        bytes::Bytes,
        packed::{Script, WitnessArgs},
        prelude::*,
    },
    error::SysError,
    high_level::{load_cell_data, load_cell_lock, load_cell_type, load_script},
    syscalls::load_witness,
};
use k256::ecdsa::{signature::hazmat::PrehashVerifier, Signature, VerifyingKey};

fn blake2b_256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    // * Matches CKB's default personalization for blake2b
    let mut hasher: Blake2b = Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    hasher.update(data);
    hasher.finalize(&mut out);
    out
}

/// * Custom error codes for blacklist-registry type script (frozen v1)
pub mod error {
    use ckb_std::error::SysError;

    pub const INVALID_TYPE_ARGS_LAYOUT: i8 = 20;
    pub const INVALID_REGISTRY_CELL_TOPOLOGY: i8 = 21;
    pub const INVALID_REGISTRY_PAYLOAD: i8 = 22;
    pub const UNSUPPORTED_REGISTRY_VERSION: i8 = 23;
    pub const INVALID_GOVERNANCE_WITNESS: i8 = 24;
    pub const UNAUTHORIZED_GOVERNANCE_LOCK: i8 = 25;
    pub const UNAUTHORIZED_SIGNERS: i8 = 26;

    pub fn to_sys_error(code: i8) -> SysError {
        SysError::Unknown(code as u64)
    }
}

const SIGNER_SET_SIZE: usize = 5;
const SIG_LEN_WITH_RECOVERY_ID: usize = 65;
const SIGNER_ENTRY_LEN: usize = 1 + SIG_LEN_WITH_RECOVERY_ID;

#[cfg(all(not(test), not(feature = "dev-signer-keys")))]
compile_error!(
    "Placeholder governance signer keys are blocked for non-test builds. \
Enable `dev-signer-keys` only for local/dev builds, or replace with production signer pubkeys."
);

// * Fixed governance signer set (v1 placeholder keys for strict on-chain verification).
const GOVERNANCE_SIGNER_PUBKEYS: [[u8; 33]; SIGNER_SET_SIZE] = [
    hex33("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
    hex33("02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"),
    hex33("02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"),
    hex33("02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13"),
    hex33("022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4"),
];

const fn hex_nibble(c: u8) -> u8 {
    if c >= b'0' && c <= b'9' {
        c - b'0'
    } else if c >= b'a' && c <= b'f' {
        10 + (c - b'a')
    } else if c >= b'A' && c <= b'F' {
        10 + (c - b'A')
    } else {
        panic!("invalid hex nibble")
    }
}

const fn hex33(s: &str) -> [u8; 33] {
    let bytes = s.as_bytes();
    let mut out = [0u8; 33];
    let mut i = 0;
    while i < 33 {
        out[i] = (hex_nibble(bytes[i * 2]) << 4) | hex_nibble(bytes[i * 2 + 1]);
        i += 1;
    }
    out
}

/// * Type args structure for the registry type script (v1 frozen layout)
///
/// This allows the registry type script to be deployed once, but configured per-registry by args:
/// - Governance lock script identity is provided by args, so the type script can require that
///   registry updates are only possible when the transaction is authorized by that lock.
///
/// Layout (v1):
/// - 1 byte: version (0x01)
/// - 32 bytes: governance lock code_hash
/// - 1 byte: governance lock hash_type
/// - 2 bytes: governance lock args length (LE u16)
/// - N bytes: governance lock args
#[derive(Debug, Clone)]
pub struct RegistryTypeArgs {
    pub version: u8,
    pub governance_code_hash: [u8; 32],
    pub governance_hash_type: u8,
    pub governance_args: Bytes,
}

impl RegistryTypeArgs {
    pub fn parse(args: &[u8]) -> Result<Self, SysError> {
        if args.len() < 36 {
            return Err(error::to_sys_error(error::INVALID_TYPE_ARGS_LAYOUT));
        }

        let version = args[0];

        let mut governance_code_hash = [0u8; 32];
        governance_code_hash.copy_from_slice(&args[1..33]);

        let governance_hash_type = args[33];
        let gov_args_len = u16::from_le_bytes([args[34], args[35]]) as usize;

        if args.len() != 36 + gov_args_len {
            return Err(error::to_sys_error(error::INVALID_TYPE_ARGS_LAYOUT));
        }

        let governance_args = Bytes::from(args[36..].to_vec());

        Ok(Self {
            version,
            governance_code_hash,
            governance_hash_type,
            governance_args,
        })
    }
}

/// * Registry payload structure (same as firewall-lock v1)
#[derive(Debug)]
pub struct RegistryPayload {
    pub version: u8,
    pub entries: Vec<RegistryEntry>,
}

#[derive(Debug, Clone)]
pub struct RegistryEntry {
    pub identifier: Bytes,
    pub expires_at: u64,
}

impl RegistryPayload {
    pub fn parse(data: &[u8]) -> Result<Self, SysError> {
        if data.len() < 9 {
            return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
        }

        if &data[0..4] != b"BLKL" {
            return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
        }

        let version = data[4];
        if version != 0x01 {
            return Err(error::to_sys_error(error::UNSUPPORTED_REGISTRY_VERSION));
        }

        let entry_count = u32::from_le_bytes([data[5], data[6], data[7], data[8]]) as usize;
        let max_possible_entries = (data.len() - 9) / 9;
        if entry_count > max_possible_entries {
            return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
        }

        let mut entries = Vec::with_capacity(entry_count);
        let mut offset = 9;

        for _ in 0..entry_count {
            if offset >= data.len() {
                return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
            }

            let id_len = data[offset] as usize;
            offset += 1;

            if offset + id_len + 8 > data.len() {
                return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
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

        for i in 1..entries.len() {
            if entries[i].identifier.as_ref() <= entries[i - 1].identifier.as_ref() {
                return Err(error::to_sys_error(error::INVALID_REGISTRY_PAYLOAD));
            }
        }

        Ok(Self { version, entries })
    }
}

/// * Governance witness layout (GOV1 v1)
///
/// Placed in the `lock` field of the witness for the registry input cell.
/// This payload is committed to by typical lock scripts that use sighash-all semantics.
///
/// Layout:
/// - 4 bytes: magic "GOV1"
/// - 1 byte: version (0x01)
/// - 32 bytes: proposal_id_hash
/// - 32 bytes: vote_digest_hash
/// - 32 bytes: registry_old_root (blake2b_256 of input registry data)
/// - 32 bytes: registry_new_root (blake2b_256 of output registry data)
#[derive(Debug, Clone)]
pub struct GovernanceWitness {
    pub version: u8,
    pub proposal_id_hash: [u8; 32],
    pub vote_digest_hash: [u8; 32],
    pub old_root: [u8; 32],
    pub new_root: [u8; 32],
    pub signers: Vec<GovernanceSignerEntry>,
}

#[derive(Debug, Clone)]
pub struct GovernanceSignerEntry {
    pub signer_index: u8,
    pub signature: [u8; SIG_LEN_WITH_RECOVERY_ID],
}

impl GovernanceWitness {
    pub fn parse(raw: &[u8]) -> Result<Self, SysError> {
        const FIXED_LEN: usize = 4 + 1 + 32 + 32 + 32 + 32 + 1;
        if raw.len() < FIXED_LEN {
            return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
        }

        if &raw[0..4] != b"GOV1" {
            return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
        }

        let version = raw[4];
        if version != 0x01 {
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

        let signer_count = raw[133] as usize;
        if signer_count < 3 || signer_count > SIGNER_SET_SIZE {
            return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
        }

        let expected_len = FIXED_LEN + signer_count * SIGNER_ENTRY_LEN;
        if raw.len() != expected_len {
            return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
        }

        let mut signers = Vec::with_capacity(signer_count);
        let mut offset = FIXED_LEN;
        for _ in 0..signer_count {
            let signer_index = raw[offset];
            offset += 1;

            let mut signature = [0u8; SIG_LEN_WITH_RECOVERY_ID];
            signature.copy_from_slice(&raw[offset..offset + SIG_LEN_WITH_RECOVERY_ID]);
            offset += SIG_LEN_WITH_RECOVERY_ID;

            signers.push(GovernanceSignerEntry {
                signer_index,
                signature,
            });
        }

        Ok(Self {
            version,
            proposal_id_hash,
            vote_digest_hash,
            old_root,
            new_root,
            signers,
        })
    }
}

fn build_governance_message_digest(gov: &GovernanceWitness) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(128);
    preimage.extend_from_slice(&gov.proposal_id_hash);
    preimage.extend_from_slice(&gov.vote_digest_hash);
    preimage.extend_from_slice(&gov.old_root);
    preimage.extend_from_slice(&gov.new_root);
    blake2b_256(&preimage)
}

fn verify_governance_multisig(gov: &GovernanceWitness, required_signers: usize) -> Result<(), SysError> {
    if required_signers < 3 || required_signers > SIGNER_SET_SIZE {
        return Err(error::to_sys_error(error::UNAUTHORIZED_SIGNERS));
    }
    if gov.signers.len() < required_signers || gov.signers.len() > SIGNER_SET_SIZE {
        return Err(error::to_sys_error(error::UNAUTHORIZED_SIGNERS));
    }

    let message_digest = build_governance_message_digest(gov);
    let mut seen = [false; SIGNER_SET_SIZE];
    let mut valid_count = 0usize;

    for signer in &gov.signers {
        let signer_idx = signer.signer_index as usize;
        if signer_idx >= SIGNER_SET_SIZE {
            return Err(error::to_sys_error(error::UNAUTHORIZED_SIGNERS));
        }
        if seen[signer_idx] {
            return Err(error::to_sys_error(error::UNAUTHORIZED_SIGNERS));
        }
        seen[signer_idx] = true;

        // * Recovery id is included in v1 witness layout and validated for canonical range.
        if signer.signature[64] > 3 {
            return Err(error::to_sys_error(error::UNAUTHORIZED_SIGNERS));
        }

        let signature = Signature::from_slice(&signer.signature[0..64])
            .map_err(|_| error::to_sys_error(error::UNAUTHORIZED_SIGNERS))?;
        let verifying_key = VerifyingKey::from_sec1_bytes(&GOVERNANCE_SIGNER_PUBKEYS[signer_idx])
            .map_err(|_| error::to_sys_error(error::UNAUTHORIZED_SIGNERS))?;
        verifying_key
            .verify_prehash(&message_digest, &signature)
            .map_err(|_| error::to_sys_error(error::UNAUTHORIZED_SIGNERS))?;
        valid_count += 1;
    }

    if valid_count < required_signers {
        return Err(error::to_sys_error(error::UNAUTHORIZED_SIGNERS));
    }

    Ok(())
}

fn script_matches_identity(script: &Script, code_hash: &[u8; 32], hash_type: u8, args: &[u8]) -> bool {
    let s_code_hash: [u8; 32] = script.code_hash().unpack();
    let s_hash_type: u8 = u8::from(script.hash_type());
    let s_args: Bytes = script.args().unpack();

    s_code_hash == *code_hash && s_hash_type == hash_type && s_args.as_ref() == args
}

fn find_registry_cells(source: Source, self_script: &Script) -> Result<Vec<usize>, SysError> {
    let self_code_hash: [u8; 32] = self_script.code_hash().unpack();
    let self_hash_type: u8 = u8::from(self_script.hash_type());
    let self_args: Bytes = self_script.args().unpack();

    let mut matches = Vec::new();
    let mut i = 0;
    loop {
        match load_cell_type(i, source) {
            Ok(type_opt) => {
                if let Some(type_script) = type_opt {
                    if script_matches_identity(
                        &type_script,
                        &self_code_hash,
                        self_hash_type,
                        self_args.as_ref(),
                    ) {
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

fn load_governance_witness_payload(input_index: usize) -> Result<Bytes, SysError> {
    // * Probe witness length, then load exact bytes.
    let mut probe: [u8; 0] = [];
    let actual_len = match load_witness(&mut probe, 0, input_index, Source::Input) {
        Ok(len) => len,
        Err(SysError::LengthNotEnough(len)) => len,
        Err(e) => return Err(e),
    };
    let mut buf = Vec::new();
    buf.resize(actual_len, 0u8);
    let read_len = load_witness(&mut buf, 0, input_index, Source::Input)?;
    if read_len != actual_len {
        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
    }

    let witness = WitnessArgs::from_slice(&buf)
        .map_err(|_| error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS))?;
    // Prefer `input_type` to remain compatible with secp-sighash locks whose
    // `lock` field must be 65-byte signatures. Fallback to `lock` for backwards
    // compatibility with older drill payload placement.
    if let Some(input_type_bytes) = witness.input_type().to_opt() {
        let data = input_type_bytes.raw_data();
        if !data.is_empty() {
            return Ok(data);
        }
    }
    if let Some(lock_bytes) = witness.lock().to_opt() {
        let data = lock_bytes.raw_data();
        if !data.is_empty() {
            return Ok(data);
        }
    }

    Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS))
}

fn verify_governance_lock_identity(
    input_index_opt: Option<usize>,
    output_index: usize,
    registry_type_args: &RegistryTypeArgs,
) -> Result<(), SysError> {
    if let Some(input_index) = input_index_opt {
        let in_lock = load_cell_lock(input_index, Source::Input)?;

        if !script_matches_identity(
            &in_lock,
            &registry_type_args.governance_code_hash,
            registry_type_args.governance_hash_type,
            registry_type_args.governance_args.as_ref(),
        ) {
            return Err(error::to_sys_error(error::UNAUTHORIZED_GOVERNANCE_LOCK));
        }
    }

    let out_lock = load_cell_lock(output_index, Source::Output)?;

    if !script_matches_identity(
        &out_lock,
        &registry_type_args.governance_code_hash,
        registry_type_args.governance_hash_type,
        registry_type_args.governance_args.as_ref(),
    ) {
        return Err(error::to_sys_error(error::UNAUTHORIZED_GOVERNANCE_LOCK));
    }

    Ok(())
}

fn program_entry() -> Result<(), SysError> {
    // * 1) Load self type script and parse its args (governance lock identity).
    let self_script = load_script()?;
    let self_args: Bytes = self_script.args().unpack();
    let registry_type_args = RegistryTypeArgs::parse(self_args.as_ref())?;
    if registry_type_args.version != 0x01 {
        return Err(error::to_sys_error(error::INVALID_TYPE_ARGS_LAYOUT));
    }

    // * 2) Allow two topologies:
    // *    - update flow: exactly 1 input + 1 output registry cell
    // *    - bootstrap flow: exactly 0 input + 1 output registry cell
    let reg_inputs = find_registry_cells(Source::Input, &self_script)?;
    let reg_outputs = find_registry_cells(Source::Output, &self_script)?;
    if reg_outputs.len() != 1 || reg_inputs.len() > 1 {
        return Err(error::to_sys_error(error::INVALID_REGISTRY_CELL_TOPOLOGY));
    }
    let reg_out = reg_outputs[0];
    let is_bootstrap = reg_inputs.is_empty();
    let reg_in_opt = if is_bootstrap { None } else { Some(reg_inputs[0]) };

    // * 3) Enforce governance lock identity on applicable registry cells.
    verify_governance_lock_identity(reg_in_opt, reg_out, &registry_type_args)?;

    // * 4) Load registry payloads and enforce BLKL v1 invariants.
    let out_data = load_cell_data(reg_out, Source::Output)?;
    let _new_registry = RegistryPayload::parse(out_data.as_ref())?;

    let (old_root, witness_index, required_signers) = if let Some(reg_in) = reg_in_opt {
        let in_data = load_cell_data(reg_in, Source::Input)?;
        let _old_registry = RegistryPayload::parse(in_data.as_ref())?;
        (blake2b_256(in_data.as_ref()), reg_in, 3usize)
    } else {
        // * Bootstrap creation has no previous state; bind to zero root and
        // * require full signer participation.
        // * Governance witness placement rule for bootstrap:
        // * `GOV1` must be present in `WitnessArgs.input_type` (preferred) or
        // * `WitnessArgs.lock` for input index 0.
        ([0u8; 32], 0usize, SIGNER_SET_SIZE)
    };
    let new_root = blake2b_256(out_data.as_ref());

    // * 5) Bind a governance decision context to this update via witness payload.
    let gov_payload = load_governance_witness_payload(witness_index)?;
    let gov = GovernanceWitness::parse(gov_payload.as_ref())?;

    if gov.old_root != old_root || gov.new_root != new_root {
        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
    }

    // * Basic non-zero checks to prevent empty placeholders from being accepted.
    if gov.proposal_id_hash == [0u8; 32] || gov.vote_digest_hash == [0u8; 32] {
        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));
    }

    // * Strict plan compliance:
    // * - updates: 3-of-5
    // * - bootstrap: 5-of-5
    verify_governance_multisig(&gov, required_signers)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    extern crate std;
    use std::vec;

    #[test]
    fn test_parse_registry_type_args_valid_empty_gov_args() {
        let mut args = vec![0x01];
        args.extend_from_slice(&[1u8; 32]);
        args.push(0x01);
        args.extend_from_slice(&0u16.to_le_bytes());
        let parsed = RegistryTypeArgs::parse(&args).expect("should parse");
        assert_eq!(parsed.version, 0x01);
        assert_eq!(parsed.governance_hash_type, 0x01);
        assert_eq!(parsed.governance_args.len(), 0);
    }

    #[test]
    fn test_parse_registry_type_args_invalid_len() {
        let args = vec![0x01, 0x02, 0x03];
        assert!(RegistryTypeArgs::parse(&args).is_err());
    }

    #[test]
    fn test_governance_witness_parse_valid() {
        let mut raw = vec![];
        raw.extend_from_slice(b"GOV1");
        raw.push(0x01);
        raw.extend_from_slice(&[1u8; 32]); // proposal
        raw.extend_from_slice(&[2u8; 32]); // vote
        raw.extend_from_slice(&[3u8; 32]); // old root
        raw.extend_from_slice(&[4u8; 32]); // new root
        raw.push(3); // signer_count
        for i in 0..3u8 {
            raw.push(i); // signer_index
            raw.extend_from_slice(&[0x11; 65]); // signature bytes
        }
        let w = GovernanceWitness::parse(&raw).expect("should parse");
        assert_eq!(w.version, 0x01);
        assert_eq!(w.proposal_id_hash, [1u8; 32]);
        assert_eq!(w.vote_digest_hash, [2u8; 32]);
        assert_eq!(w.old_root, [3u8; 32]);
        assert_eq!(w.new_root, [4u8; 32]);
        assert_eq!(w.signers.len(), 3);
    }

    #[test]
    fn test_governance_witness_parse_invalid_magic() {
        let mut raw = vec![0u8; 134];
        raw[0..4].copy_from_slice(b"NOPE");
        raw[4] = 0x01;
        raw[133] = 0;
        assert!(GovernanceWitness::parse(&raw).is_err());
    }

    #[test]
    fn test_governance_witness_rejects_invalid_signer_count() {
        let mut raw = vec![];
        raw.extend_from_slice(b"GOV1");
        raw.push(0x01);
        raw.extend_from_slice(&[1u8; 32]);
        raw.extend_from_slice(&[2u8; 32]);
        raw.extend_from_slice(&[3u8; 32]);
        raw.extend_from_slice(&[4u8; 32]);
        raw.push(2); // too few
        assert!(GovernanceWitness::parse(&raw).is_err());
    }

    #[test]
    fn test_registry_payload_parse_rejects_unsorted() {
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x01);
        data.extend_from_slice(&2u32.to_le_bytes());
        // Entry 1: [0xBB]
        data.push(1);
        data.push(0xBB);
        data.extend_from_slice(&0u64.to_le_bytes());
        // Entry 2: [0xAA] (unsorted)
        data.push(1);
        data.push(0xAA);
        data.extend_from_slice(&0u64.to_le_bytes());

        assert!(RegistryPayload::parse(&data).is_err());
    }
}
