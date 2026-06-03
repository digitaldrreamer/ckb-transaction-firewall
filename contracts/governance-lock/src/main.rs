//! Governance Lock Script — validator vote authorization for registry updates.
//!
//! Args: version=0x01 (1 byte only). Static forever; pubkeys live in BLKL governance header.
//!
//! Verification logic (runs on update transactions only):
//! 1. Parse BLKL v2 from the input registry cell data → governance header (pubkeys + threshold).
//! 2. Load WitnessArgs at Source::GroupInput[0]:
//!    - lock field: validator vote witness
//!    - input_type field: GOV1 v4 binding (also read by blacklist-registry)
//! 3. Parse GOV1 v4 binding and enforce the proposal anchor relative-time delay.
//!    The proposal input's `since` field MUST be a relative median-time-past delay >= review_delay_ms.
//! 4. For each yes vote: recover pubkey via secp256k1 ECDSA and verify Merkle membership
//!    against the validator root in the BLKL governance header.
//! 5. Require yes_count >= threshold.

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
        Err(e) => e,
    }
}

use alloc::vec::Vec;

use blake2b_ref::{Blake2b, Blake2bBuilder};
use ckb_std::ckb_constants::{CellField, Source};
use ckb_std::error::SysError;
use ckb_std::syscalls::{load_cell_by_field, load_cell_data, load_input, load_script, load_witness};
use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

const ERR_INVALID_ARGS: i8 = 1;
const ERR_INVALID_BLKL: i8 = 2;
const ERR_INVALID_WITNESS: i8 = 3;
const ERR_SIG_VERIFICATION: i8 = 4;
const ERR_THRESHOLD_NOT_MET: i8 = 5;
const ERR_REVIEW_WINDOW_NOT_MET: i8 = 6;

// CKB `since` field encoding for median-time-past timestamp locks.
const SINCE_LOCK_TYPE_FLAG: u64 = 1 << 63;
const SINCE_METRIC_TYPE_MASK: u64 = 0x6000_0000_0000_0000;
const SINCE_METRIC_TIMESTAMP: u64 = 0x4000_0000_0000_0000;
const SINCE_VALUE_MASK: u64 = 0x00FF_FFFF_FFFF_FFFF;

fn blake2b_256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut hasher: Blake2b = Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    hasher.update(data);
    hasher.finalize(&mut out);
    out
}

fn load_var_bytes_from<F>(mut loader: F) -> Result<Vec<u8>, i8>
where
    F: FnMut(&mut [u8], usize) -> Result<usize, SysError>,
{
    let mut cap = 512usize;
    loop {
        let mut buf = Vec::new();
        buf.resize(cap, 0u8);
        match loader(&mut buf, 0) {
            Ok(n) => {
                if n > cap {
                    cap = n;
                    continue;
                }
                buf.truncate(n);
                return Ok(buf);
            }
            Err(SysError::LengthNotEnough(need)) => {
                cap = need;
                continue;
            }
            Err(_) => return Err(ERR_INVALID_WITNESS),
        }
    }
}

fn load_cell_data_bytes(index: usize, source: Source) -> Result<Vec<u8>, i8> {
    load_var_bytes_from(|buf, off| load_cell_data(buf, off, index, source))
}

fn load_witness_bytes(index: usize, source: Source) -> Result<Vec<u8>, i8> {
    load_var_bytes_from(|buf, off| load_witness(buf, off, index, source))
}

fn load_script_bytes() -> Result<Vec<u8>, i8> {
    load_var_bytes_from(|buf, off| load_script(buf, off))
}

fn le_u16_at(buf: &[u8], off: usize) -> Result<u16, i8> {
    if off + 2 > buf.len() {
        return Err(ERR_INVALID_BLKL);
    }
    Ok(u16::from_le_bytes([buf[off], buf[off + 1]]))
}

fn le_u32_at(buf: &[u8], off: usize) -> Result<usize, i8> {
    if off + 4 > buf.len() {
        return Err(ERR_INVALID_WITNESS);
    }
    Ok(u32::from_le_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]]) as usize)
}

struct GovernanceHeader {
    threshold: u8,
    validator_count: u16,
    validator_merkle_root: [u8; 32],
}

/// Parses the BLKL v2 governance header from registry cell data.
fn parse_governance_header(data: &[u8]) -> Result<GovernanceHeader, i8> {
    // BLKL(4) | version=0x02(1) | gov_header_len(2 LE) | gov_header | ...
    if data.len() < 11 {
        return Err(ERR_INVALID_BLKL);
    }
    if &data[0..4] != b"BLKL" || data[4] != 0x02 {
        return Err(ERR_INVALID_BLKL);
    }
    let gov_header_len = le_u16_at(data, 5)? as usize;
    if 7 + gov_header_len > data.len() {
        return Err(ERR_INVALID_BLKL);
    }
    let gh = &data[7..7 + gov_header_len];

    // v1: gh_version(1) | signer_count(1) | threshold(1) | [pubkey(33)] × N | validator_count(2 LE) | merkle_root(32)
    // v2: v1 | treasury_lock_hash(32). Governance-lock ignores treasury metadata.
    // v3: v1 | treasury_lock_script_len(2 LE) | treasury_lock_script. Governance-lock ignores treasury metadata.
    if gh.len() < 3 {
        return Err(ERR_INVALID_BLKL);
    }
    if gh[0] != 0x01 && gh[0] != 0x02 && gh[0] != 0x03 {
        return Err(ERR_INVALID_BLKL);
    }
    let signer_count = gh[1] as usize;
    let threshold = gh[2];
    let pubkeys_end = 3 + signer_count * 33;
    // Must have room for pubkeys + validator_count(2) + merkle_root(32)
    if pubkeys_end + 34 > gh.len() {
        return Err(ERR_INVALID_BLKL);
    }
    if gh[0] == 0x02 && pubkeys_end + 34 + 32 > gh.len() {
        return Err(ERR_INVALID_BLKL);
    }
    if gh[0] == 0x03 {
        let script_len_offset = pubkeys_end + 34;
        if script_len_offset + 2 > gh.len() {
            return Err(ERR_INVALID_BLKL);
        }
        let script_len = le_u16_at(gh, script_len_offset)? as usize;
        if script_len_offset + 2 + script_len != gh.len() {
            return Err(ERR_INVALID_BLKL);
        }
    }
    let validator_count = u16::from_le_bytes([gh[pubkeys_end], gh[pubkeys_end + 1]]);
    if threshold == 0 || validator_count == 0 || threshold as u16 > validator_count {
        return Err(ERR_INVALID_BLKL);
    }
    let mut validator_merkle_root = [0u8; 32];
    validator_merkle_root.copy_from_slice(&gh[pubkeys_end + 2..pubkeys_end + 34]);
    Ok(GovernanceHeader {
        threshold,
        validator_count,
        validator_merkle_root,
    })
}

struct VoteEntry {
    pubkey: [u8; 33],
    vote: u8,
    timestamp: Vec<u8>,
    sig_bytes: [u8; 65], // r(32) + s(32) + recovery_id(1)
    merkle_leaf_index: u32,
    merkle_proof: Vec<[u8; 32]>,
}

struct WitnessFields {
    votes: Vec<VoteEntry>,
    gov1_payload: Vec<u8>,
}

fn decode_bytesopt(field: &[u8]) -> Result<Option<Vec<u8>>, i8> {
    if field.is_empty() {
        return Ok(None);
    }
    if field.len() < 4 {
        return Err(ERR_INVALID_WITNESS);
    }
    let count = le_u32_at(field, 0)?;
    if field.len() != 4 + count {
        return Err(ERR_INVALID_WITNESS);
    }
    Ok(Some(field[4..4 + count].to_vec()))
}

/// Loads and decodes WitnessArgs lock and input_type fields for the given input.
fn load_witness_fields(index: usize, source: Source) -> Result<WitnessFields, i8> {
    let buf = load_witness_bytes(index, source)?;
    // WitnessArgs: full_size(4) | off_lock(4) | off_input_type(4) | off_output_type(4) | ...
    if buf.len() < 16 {
        return Err(ERR_INVALID_WITNESS);
    }
    let full_size = le_u32_at(&buf, 0)?;
    if full_size != buf.len() {
        return Err(ERR_INVALID_WITNESS);
    }
    let off_lock = le_u32_at(&buf, 4)?;
    let off_input_type = le_u32_at(&buf, 8)?;
    let off_output_type = le_u32_at(&buf, 12)?;
    if !(16 <= off_lock
        && off_lock <= off_input_type
        && off_input_type <= off_output_type
        && off_output_type <= buf.len())
    {
        return Err(ERR_INVALID_WITNESS);
    }

    let lock_field = &buf[off_lock..off_input_type];
    let input_type_field = &buf[off_input_type..off_output_type];

    // Validator vote witness from lock field:
    // vote_count(1) |
    // [pubkey(33) | vote(1) | timestamp_len(2 LE) | timestamp |
    //  sig(65) | merkle_leaf_index(4 LE) | proof_count(1) | proof_hash(32)*] × N
    let lock_data = decode_bytesopt(lock_field)?.ok_or(ERR_INVALID_WITNESS)?;
    if lock_data.is_empty() {
        return Err(ERR_INVALID_WITNESS);
    }
    let vote_count = lock_data[0] as usize;
    if 1usize.saturating_add(vote_count.saturating_mul(106)) > lock_data.len() {
        return Err(ERR_INVALID_WITNESS);
    }
    let mut votes = Vec::with_capacity(vote_count);
    let mut off = 1;
    for _ in 0..vote_count {
        if off + 33 + 1 + 2 > lock_data.len() {
            return Err(ERR_INVALID_WITNESS);
        }
        let mut pubkey = [0u8; 33];
        pubkey.copy_from_slice(&lock_data[off..off + 33]);
        off += 33;
        let vote = lock_data[off];
        off += 1;
        let timestamp_len = u16::from_le_bytes([lock_data[off], lock_data[off + 1]]) as usize;
        off += 2;
        if off + timestamp_len + 65 + 4 + 1 > lock_data.len() {
            return Err(ERR_INVALID_WITNESS);
        }
        let timestamp = lock_data[off..off + timestamp_len].to_vec();
        off += timestamp_len;
        let mut sig_bytes = [0u8; 65];
        sig_bytes.copy_from_slice(&lock_data[off..off + 65]);
        off += 65;
        let merkle_leaf_index = u32::from_le_bytes([
            lock_data[off],
            lock_data[off + 1],
            lock_data[off + 2],
            lock_data[off + 3],
        ]);
        off += 4;
        let proof_count = lock_data[off] as usize;
        off += 1;
        if off + proof_count * 32 > lock_data.len() {
            return Err(ERR_INVALID_WITNESS);
        }
        let mut merkle_proof = Vec::with_capacity(proof_count);
        for _ in 0..proof_count {
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&lock_data[off..off + 32]);
            off += 32;
            merkle_proof.push(hash);
        }
        votes.push(VoteEntry {
            pubkey,
            vote,
            timestamp,
            sig_bytes,
            merkle_leaf_index,
            merkle_proof,
        });
    }
    if off != lock_data.len() {
        return Err(ERR_INVALID_WITNESS);
    }

    // GOV1 v4 payload from input_type field.
    let gov1_payload = decode_bytesopt(input_type_field)?.ok_or(ERR_INVALID_WITNESS)?;
    if gov1_payload.is_empty() {
        return Err(ERR_INVALID_WITNESS);
    }

    Ok(WitnessFields {
        votes,
        gov1_payload,
    })
}

struct Gov1Binding {
    proposal_id_hash: [u8; 32],
    vote_digest_hash: [u8; 32],
    // old_root and new_root are verified by the blacklist-registry type script; governance-lock
    // parses them to advance past the field offsets but does not recheck them here.
    _old_root: [u8; 32],
    _new_root: [u8; 32],
    proposal_data_hash: [u8; 32],
    review_delay_ms: u64,
}

/// Parses GOV1 v4 payloads.
///
/// Layout: GOV1(4) | 0x04(1) | proposal_id_hash(32) | vote_digest_hash(32)
///   | old_root(32) | new_root(32) | proposal_data_hash(32) | review_delay_ms(8 LE u64)
fn parse_gov1_binding(payload: &[u8]) -> Result<Gov1Binding, i8> {
    if payload.len() != 173 {
        return Err(ERR_INVALID_WITNESS);
    }
    if &payload[0..4] != b"GOV1" {
        return Err(ERR_INVALID_WITNESS);
    }
    if payload[4] != 0x04 {
        return Err(ERR_INVALID_WITNESS);
    }
    let mut proposal_id_hash = [0u8; 32];
    proposal_id_hash.copy_from_slice(&payload[5..37]);
    let mut vote_digest_hash = [0u8; 32];
    vote_digest_hash.copy_from_slice(&payload[37..69]);
    let mut _old_root = [0u8; 32];
    _old_root.copy_from_slice(&payload[69..101]);
    let mut _new_root = [0u8; 32];
    _new_root.copy_from_slice(&payload[101..133]);
    let mut proposal_data_hash = [0u8; 32];
    proposal_data_hash.copy_from_slice(&payload[133..165]);
    let review_delay_ms = u64::from_le_bytes([
        payload[165],
        payload[166],
        payload[167],
        payload[168],
        payload[169],
        payload[170],
        payload[171],
        payload[172],
    ]);
    Ok(Gov1Binding {
        proposal_id_hash,
        vote_digest_hash,
        _old_root,
        _new_root,
        proposal_data_hash,
        review_delay_ms,
    })
}

/// Loads the `since` field (first 8 bytes of a CellInput) for the given input index.
/// CellInput layout: since(8 LE u64) | previous_output.tx_hash(32) | previous_output.index(4)
fn load_input_since(index: usize, source: Source) -> Result<u64, i8> {
    let raw = load_var_bytes_from(|buf, off| load_input(buf, off, index, source))?;
    if raw.len() < 8 {
        return Err(ERR_INVALID_WITNESS);
    }
    Ok(u64::from_le_bytes([
        raw[0], raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7],
    ]))
}

/// Checks that `since` encodes a relative median-time-past delay >= `min_ms`.
/// CKB consensus stores timestamp since values in seconds; convert to ms for comparison.
fn verify_relative_since_timestamp(since: u64, min_ms: u64) -> Result<(), i8> {
    if since & SINCE_LOCK_TYPE_FLAG == 0 {
        return Err(ERR_REVIEW_WINDOW_NOT_MET); // must be relative
    }
    if since & SINCE_METRIC_TYPE_MASK != SINCE_METRIC_TIMESTAMP {
        return Err(ERR_REVIEW_WINDOW_NOT_MET); // must be timestamp metric
    }
    // since value is in seconds; review_delay_ms is in milliseconds
    let timestamp_sec = since & SINCE_VALUE_MASK;
    let timestamp_ms = timestamp_sec.saturating_mul(1000);
    if timestamp_ms < min_ms {
        return Err(ERR_REVIEW_WINDOW_NOT_MET);
    }
    Ok(())
}

fn load_cell_data_bytes_sys(index: usize, source: Source) -> Result<Vec<u8>, SysError> {
    let mut cap = 512usize;
    loop {
        let mut buf = Vec::new();
        buf.resize(cap, 0u8);
        match load_cell_data(&mut buf, 0, index, source) {
            Ok(n) => {
                if n > cap {
                    cap = n;
                    continue;
                }
                buf.truncate(n);
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

fn find_input_by_data_hash(target_hash: &[u8; 32]) -> Result<usize, i8> {
    if *target_hash == [0u8; 32] {
        return Err(ERR_INVALID_WITNESS);
    }
    let mut found: Option<usize> = None;
    let mut i = 0usize;
    loop {
        let mut hash = [0u8; 32];
        match load_cell_by_field(&mut hash, 0, i, Source::Input, CellField::DataHash) {
            Ok(_) => {
                if hash == *target_hash {
                    if found.is_some() {
                        return Err(ERR_INVALID_WITNESS);
                    }
                    found = Some(i);
                }
                i += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ERR_INVALID_WITNESS),
        }
    }
    found.ok_or(ERR_INVALID_WITNESS)
}

fn hex_push(out: &mut Vec<u8>, bytes: &[u8]) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    out.extend_from_slice(b"0x");
    for b in bytes {
        out.push(HEX[(b >> 4) as usize]);
        out.push(HEX[(b & 0x0f) as usize]);
    }
}

fn vote_word(vote: u8) -> Result<&'static [u8], i8> {
    match vote {
        1 => Ok(b"yes"),
        2 => Ok(b"no"),
        3 => Ok(b"abstain"),
        _ => Err(ERR_INVALID_WITNESS),
    }
}

// Computes the Blake2b hash of the canonical JSON vote payload used as the signing message.
fn vote_signing_message(
    proposal_id_hash: &[u8; 32],
    vote: u8,
    timestamp: &[u8],
    pubkey: &[u8; 33],
) -> Result<[u8; 32], i8> {
    let mut canonical = Vec::new();
    canonical.extend_from_slice(b"{\"domain\":\"ckb-firewall:vote\",\"proposalIdHash\":\"");
    hex_push(&mut canonical, proposal_id_hash);
    canonical.extend_from_slice(b"\",\"vote\":\"");
    canonical.extend_from_slice(vote_word(vote)?);
    canonical.extend_from_slice(b"\",\"timestamp\":\"");
    canonical.extend_from_slice(timestamp);
    canonical.extend_from_slice(b"\",\"pubkey\":\"");
    hex_push(&mut canonical, pubkey);
    canonical.extend_from_slice(b"\"}");
    // Sign the blake2b hash directly. JS uses secp256k1.sign(msgHash, priv, { prehash: false })
    // so no additional outer hash is applied.
    Ok(blake2b_256(&canonical))
}

fn merkle_node(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut combined = [0u8; 64];
    combined[..32].copy_from_slice(left);
    combined[32..].copy_from_slice(right);
    blake2b_256(&combined)
}

fn verify_merkle_proof(
    root: &[u8; 32],
    pubkey: &[u8; 33],
    proof: &[[u8; 32]],
    leaf_index: u32,
) -> bool {
    let mut current = blake2b_256(pubkey);
    let mut idx = leaf_index;
    for sibling in proof {
        current = if idx % 2 == 0 {
            merkle_node(&current, sibling)
        } else {
            merkle_node(sibling, &current)
        };
        idx /= 2;
    }
    &current == root
}

/// Recovers the compressed secp256k1 public key from a prehash and 65-byte compact signature.
/// sig_bytes: r(32) + s(32) + recovery_id(1).
fn recover_pubkey(msg_hash: &[u8; 32], sig_bytes: &[u8; 65]) -> Result<[u8; 33], i8> {
    let sig = Signature::from_slice(&sig_bytes[..64]).map_err(|_| ERR_SIG_VERIFICATION)?;
    let recovery_id = RecoveryId::try_from(sig_bytes[64]).map_err(|_| ERR_SIG_VERIFICATION)?;
    let recovered = VerifyingKey::recover_from_prehash(msg_hash, &sig, recovery_id)
        .map_err(|_| ERR_SIG_VERIFICATION)?;
    let point = recovered.to_encoded_point(true);
    let bytes = point.as_bytes();
    if bytes.len() != 33 {
        return Err(ERR_SIG_VERIFICATION);
    }
    let mut out = [0u8; 33];
    out.copy_from_slice(bytes);
    Ok(out)
}

fn program_entry() -> Result<(), i8> {
    // Verify own args = [0x01].
    let script_raw = load_script_bytes().map_err(|_| ERR_INVALID_ARGS)?;
    // Script molecule: full_size(4) | off_code_hash(4) | off_hash_type(4) | off_args(4) | ...
    if script_raw.len() < 16 {
        return Err(ERR_INVALID_ARGS);
    }
    let off_args = le_u32_at(&script_raw, 12).map_err(|_| ERR_INVALID_ARGS)?;
    if off_args + 4 > script_raw.len() {
        return Err(ERR_INVALID_ARGS);
    }
    let args_len = le_u32_at(&script_raw, off_args).map_err(|_| ERR_INVALID_ARGS)?;
    if off_args + 4 + args_len != script_raw.len() {
        return Err(ERR_INVALID_ARGS);
    }
    let args = &script_raw[off_args + 4..off_args + 4 + args_len];
    if args != [0x01u8] {
        return Err(ERR_INVALID_ARGS);
    }

    // Load registry input cell data (BLKL v2) and parse governance header.
    let blkl_data = load_cell_data_bytes(0, Source::GroupInput)?;
    let header = parse_governance_header(&blkl_data)?;

    // Load witness and extract signer entries + GOV1 v4 payload.
    let witness = load_witness_fields(0, Source::GroupInput)?;

    let gov1 = parse_gov1_binding(&witness.gov1_payload)?;
    if gov1.proposal_id_hash == [0u8; 32] || gov1.vote_digest_hash == [0u8; 32] {
        return Err(ERR_INVALID_WITNESS);
    }

    let proposal_input_index = find_input_by_data_hash(&gov1.proposal_data_hash)?;
    let since = load_input_since(proposal_input_index, Source::Input)?;
    verify_relative_since_timestamp(since, gov1.review_delay_ms)?;

    // Verify yes votes and count unique valid validators.
    let mut seen: Vec<[u8; 33]> = Vec::new();
    let mut yes_count = 0usize;

    for entry in &witness.votes {
        if entry.vote != 1 {
            return Err(ERR_INVALID_WITNESS);
        }
        if entry.merkle_leaf_index >= header.validator_count as u32 {
            return Err(ERR_SIG_VERIFICATION);
        }
        if seen.iter().any(|pk| pk == &entry.pubkey) {
            return Err(ERR_SIG_VERIFICATION); // duplicate signer index
        }
        if !verify_merkle_proof(
            &header.validator_merkle_root,
            &entry.pubkey,
            &entry.merkle_proof,
            entry.merkle_leaf_index,
        ) {
            return Err(ERR_SIG_VERIFICATION);
        }
        let signing_message = vote_signing_message(
            &gov1.proposal_id_hash,
            entry.vote,
            &entry.timestamp,
            &entry.pubkey,
        )?;
        let recovered = recover_pubkey(&signing_message, &entry.sig_bytes)?;
        if recovered != entry.pubkey {
            return Err(ERR_SIG_VERIFICATION);
        }
        seen.push(entry.pubkey);
        yes_count += 1;
    }

    if yes_count < header.threshold as usize {
        return Err(ERR_THRESHOLD_NOT_MET);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;
    extern crate std;

    fn minimal_blkl_v2(pubkey: &[u8; 33], threshold: u8) -> Vec<u8> {
        // gov_header: gh_version(1) | signer_count(1) | threshold(1) | pubkey(33) | validator_count(2) | merkle_root(32)
        let mut gh: Vec<u8> = Vec::new();
        gh.push(0x01);
        gh.push(1); // signer_count
        gh.push(threshold);
        gh.extend_from_slice(pubkey);
        gh.extend_from_slice(&1u16.to_le_bytes()); // validator_count
        gh.extend_from_slice(&blake2b_256(pubkey)); // merkle_root for single validator
        let gh_len = gh.len() as u16;

        let mut data: Vec<u8> = Vec::new();
        data.extend_from_slice(b"BLKL");
        data.push(0x02);
        data.extend_from_slice(&gh_len.to_le_bytes());
        data.extend_from_slice(&gh);
        data.extend_from_slice(&0u32.to_le_bytes()); // entry_count = 0
        data
    }

    fn dummy_pubkey() -> [u8; 33] {
        [
            0x03, 0x1b, 0x84, 0xc5, 0x56, 0x7b, 0x12, 0x64, 0x40, 0x99, 0x5d, 0x3e, 0xd5, 0xaa,
            0xba, 0x05, 0x65, 0xd7, 0x1e, 0x18, 0x34, 0x60, 0x48, 0x19, 0xff, 0x9c, 0x17, 0xf5,
            0xe9, 0xd5, 0xdd, 0x07, 0x8f,
        ]
    }

    #[test]
    fn test_parse_governance_header_valid() {
        let pk = dummy_pubkey();
        let data = minimal_blkl_v2(&pk, 1);
        let h = parse_governance_header(&data).expect("should parse");
        assert_eq!(h.threshold, 1);
        assert_eq!(h.validator_count, 1);
        assert_eq!(h.validator_merkle_root, blake2b_256(&pk));
    }

    #[test]
    fn test_parse_governance_header_v3_treasury_script() {
        let pk = dummy_pubkey();
        let mut data = minimal_blkl_v2(&pk, 1);
        let gh_len = u16::from_le_bytes([data[5], data[6]]) as usize;
        let mut gh = data[7..7 + gh_len].to_vec();
        gh[0] = 0x03;
        let treasury_script = vec![0x51u8; 53];
        gh.extend_from_slice(&(treasury_script.len() as u16).to_le_bytes());
        gh.extend_from_slice(&treasury_script);
        data.splice(5..7, (gh.len() as u16).to_le_bytes());
        data.splice(7..7 + gh_len, gh);

        let h = parse_governance_header(&data).expect("should parse");
        assert_eq!(h.threshold, 1);
        assert_eq!(h.validator_count, 1);
        assert_eq!(h.validator_merkle_root, blake2b_256(&pk));
    }

    #[test]
    fn test_parse_governance_header_wrong_magic() {
        let mut data = minimal_blkl_v2(&dummy_pubkey(), 1);
        data[0] = 0xFF;
        assert!(parse_governance_header(&data).is_err());
    }

    #[test]
    fn test_parse_governance_header_wrong_version() {
        let mut data = minimal_blkl_v2(&dummy_pubkey(), 1);
        data[4] = 0x01; // v1 instead of v2
        assert!(parse_governance_header(&data).is_err());
    }

    #[test]
    fn test_parse_governance_header_zero_threshold() {
        // threshold=0 is invalid
        let data = minimal_blkl_v2(&dummy_pubkey(), 0);
        assert!(parse_governance_header(&data).is_err());
    }

    #[test]
    fn test_parse_gov1_v4_valid() {
        let mut payload = [0u8; 173];
        payload[0..4].copy_from_slice(b"GOV1");
        payload[4] = 0x04;
        payload[5..37].fill(0x11);
        payload[37..69].fill(0x22);
        payload[69..101].fill(0x33);
        payload[101..133].fill(0x44);
        payload[133..165].fill(0x55);
        payload[165..173].copy_from_slice(&259_200_000u64.to_le_bytes());
        let binding = parse_gov1_binding(&payload).expect("should parse");
        assert_eq!(binding.proposal_id_hash, [0x11u8; 32]);
        assert_eq!(binding.proposal_data_hash, [0x55u8; 32]);
        assert_eq!(binding.review_delay_ms, 259_200_000u64);
    }

    #[test]
    fn test_parse_gov1_hashes_wrong_length() {
        assert!(parse_gov1_binding(&[0u8; 133]).is_err()); // v2 length no longer accepted
        assert!(parse_gov1_binding(&[0u8; 140]).is_err());
        assert!(parse_gov1_binding(&[0u8; 142]).is_err());
        assert!(parse_gov1_binding(&[0u8; 172]).is_err());
        assert!(parse_gov1_binding(&[0u8; 174]).is_err());
    }

    #[test]
    fn test_parse_gov1_hashes_wrong_magic() {
        let mut payload = [0u8; 173];
        payload[0..4].copy_from_slice(b"NOPE");
        payload[4] = 0x04;
        payload[5..37].fill(0x11);
        payload[37..69].fill(0x22);
        assert!(parse_gov1_binding(&payload).is_err());
    }

    #[test]
    fn test_parse_gov1_hashes_wrong_version() {
        let mut payload = [0u8; 173];
        payload[0..4].copy_from_slice(b"GOV1");
        payload[4] = 0x03; // v3 no longer accepted
        assert!(parse_gov1_binding(&payload).is_err());
    }

    #[test]
    fn test_vote_signing_message_hash() {
        // vote_signing_message returns blake2b(canonical).
        // canonical = JSON with 0x-prefixed proposalIdHash and pubkey, as JS stores/sends them.
        // blake2b(canonical) = 411251fa...
        let proposal_id_hash: [u8; 32] = hex_bytes("7a3ebccd3e7d94380800239be69144590235cbd75f6fdf1118f7414b59c3941b");
        let pubkey: [u8; 33] = hex_bytes("038f5ff1cbbb8e140068f49f67183db95e06baa21ccf06975989350b8d4fa9f2a0");
        let timestamp = b"2026-06-01T18:20:51.445Z";
        let vote: u8 = 1;

        let hash = vote_signing_message(&proposal_id_hash, vote, timestamp, &pubkey).unwrap();
        let expected: [u8; 32] = hex_bytes("411251fa5dbc943421d922ca61139360c1fb2a86cc1752e00cc5b0cb28413162");
        assert_eq!(hash, expected, "vote_signing_message hash mismatch");
    }

    fn hex_bytes<const N: usize>(s: &str) -> [u8; N] {
        let mut out = [0u8; N];
        for i in 0..N {
            out[i] = u8::from_str_radix(&s[i*2..i*2+2], 16).unwrap();
        }
        out
    }

    #[test]
    fn test_recover_pubkey_roundtrip() {
        use k256::ecdsa::{signature::hazmat::PrehashSigner, SigningKey};
        // Private key = [0x01; 32] → signer 0 in testnet set
        let sk = SigningKey::from_bytes((&[0x01u8; 32]).into()).expect("valid key");
        let msg_hash = blake2b_256(b"test signing message");
        let (sig, recovery_id): (Signature, RecoveryId) = sk.sign_prehash(&msg_hash).expect("sign");
        let mut sig_bytes = [0u8; 65];
        sig_bytes[..64].copy_from_slice(&sig.to_bytes());
        sig_bytes[64] = recovery_id.to_byte();

        let recovered = recover_pubkey(&msg_hash, &sig_bytes).expect("recover");
        let expected_pk = dummy_pubkey(); // signer 0 compressed pubkey
        assert_eq!(recovered, expected_pk);
    }

    fn valid_since(ms: u64) -> u64 {
        SINCE_METRIC_TIMESTAMP | (ms & SINCE_VALUE_MASK)
    }

    // Encodes a relative timestamp since value with the given SECONDS value.
    fn relative_since_sec(secs: u64) -> u64 {
        SINCE_LOCK_TYPE_FLAG | SINCE_METRIC_TIMESTAMP | (secs & SINCE_VALUE_MASK)
    }

    #[test]
    fn test_relative_since_valid_exact_delay() {
        // 259_200 seconds = 259_200_000 ms exactly (3 days)
        assert!(verify_relative_since_timestamp(relative_since_sec(259_200), 259_200_000).is_ok());
    }

    #[test]
    fn test_relative_since_reject_absolute_timestamp() {
        // Absolute (non-relative) since must be rejected
        assert_eq!(
            verify_relative_since_timestamp(valid_since(259_200), 259_200_000),
            Err(ERR_REVIEW_WINDOW_NOT_MET),
        );
    }

    #[test]
    fn test_relative_since_reject_short_delay() {
        // 259_199 seconds * 1000 = 259_199_000 ms < 259_200_000 ms → rejected
        assert_eq!(
            verify_relative_since_timestamp(relative_since_sec(259_199), 259_200_000),
            Err(ERR_REVIEW_WINDOW_NOT_MET),
        );
    }
}
