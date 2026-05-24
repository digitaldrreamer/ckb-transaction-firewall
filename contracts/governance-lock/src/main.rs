//! Governance Lock Script — secp256k1 multisig for registry update authorization.
//!
//! Args: version=0x01 (1 byte only). Static forever; pubkeys live in BLKL governance header.
//!
//! Verification logic (runs on update transactions only):
//! 1. Parse BLKL v2 from the input registry cell data → governance header (pubkeys + threshold).
//! 2. Load WitnessArgs at Source::GroupInput[0]:
//!    - lock field: governance signer witness (signer_count + [signer_index + sig(65)] × N)
//!    - input_type field: GOV1 v3 binding (141 bytes, also read by blacklist-registry)
//! 3. Parse GOV1 v3: signing_message = blake2b(proposal_id_hash || vote_digest_hash || old_root || new_root || review_window_end_ms)
//!    The input's `since` field MUST be an absolute median-time-past timestamp >= review_window_end_ms.
//! 4. For each signer entry: recover pubkey via secp256k1 ECDSA, verify against header pubkeys.
//! 5. Require valid_count >= threshold.

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
use ckb_std::ckb_constants::Source;
use ckb_std::error::SysError;
use ckb_std::syscalls::{load_cell_data, load_input, load_script, load_witness};
use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

const ERR_INVALID_ARGS: i8 = 1;
const ERR_INVALID_BLKL: i8 = 2;
const ERR_INVALID_WITNESS: i8 = 3;
const ERR_SIG_VERIFICATION: i8 = 4;
const ERR_THRESHOLD_NOT_MET: i8 = 5;
const ERR_REVIEW_WINDOW_NOT_MET: i8 = 6;

// CKB `since` field encoding for absolute median-time-past (timestamp) locks.
// Bit 62 set = timestamp metric; bit 63 clear = absolute.
const SINCE_LOCK_TYPE_FLAG: u64    = 1 << 63;
const SINCE_METRIC_TYPE_MASK: u64  = 0x6000_0000_0000_0000;
const SINCE_METRIC_TIMESTAMP: u64  = 0x4000_0000_0000_0000;
const SINCE_VALUE_MASK: u64        = 0x00FF_FFFF_FFFF_FFFF;

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
    pubkeys: Vec<[u8; 33]>,
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

    // gh_version(1) | signer_count(1) | threshold(1) | [pubkey(33)] × N | validator_count(2 LE) | merkle_root(32)
    if gh.len() < 3 {
        return Err(ERR_INVALID_BLKL);
    }
    if gh[0] != 0x01 {
        return Err(ERR_INVALID_BLKL);
    }
    let signer_count = gh[1] as usize;
    let threshold = gh[2];
    if threshold == 0 || threshold as usize > signer_count {
        return Err(ERR_INVALID_BLKL);
    }
    let pubkeys_end = 3 + signer_count * 33;
    // Must have room for pubkeys + validator_count(2) + merkle_root(32)
    if pubkeys_end + 34 > gh.len() {
        return Err(ERR_INVALID_BLKL);
    }
    let mut pubkeys = Vec::with_capacity(signer_count);
    for i in 0..signer_count {
        let start = 3 + i * 33;
        let mut pk = [0u8; 33];
        pk.copy_from_slice(&gh[start..start + 33]);
        pubkeys.push(pk);
    }
    Ok(GovernanceHeader { threshold, pubkeys })
}

struct SignerEntry {
    signer_index: u8,
    sig_bytes: [u8; 65], // r(32) + s(32) + recovery_id(1)
}

struct WitnessFields {
    signers: Vec<SignerEntry>,
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
    if !(16 <= off_lock && off_lock <= off_input_type && off_input_type <= off_output_type && off_output_type <= buf.len()) {
        return Err(ERR_INVALID_WITNESS);
    }

    let lock_field = &buf[off_lock..off_input_type];
    let input_type_field = &buf[off_input_type..off_output_type];

    // Governance signer witness from lock field:
    // signer_count(1) | [signer_index(1) + sig(65)] × N
    let lock_data = decode_bytesopt(lock_field)?.ok_or(ERR_INVALID_WITNESS)?;
    if lock_data.is_empty() {
        return Err(ERR_INVALID_WITNESS);
    }
    let signer_count = lock_data[0] as usize;
    if lock_data.len() != 1 + signer_count * 66 {
        return Err(ERR_INVALID_WITNESS);
    }
    let mut signers = Vec::with_capacity(signer_count);
    let mut off = 1;
    for _ in 0..signer_count {
        let signer_index = lock_data[off];
        off += 1;
        let mut sig_bytes = [0u8; 65];
        sig_bytes.copy_from_slice(&lock_data[off..off + 65]);
        off += 65;
        signers.push(SignerEntry { signer_index, sig_bytes });
    }

    // GOV1 v2 payload from input_type field.
    let gov1_payload = decode_bytesopt(input_type_field)?.ok_or(ERR_INVALID_WITNESS)?;
    if gov1_payload.is_empty() {
        return Err(ERR_INVALID_WITNESS);
    }

    Ok(WitnessFields { signers, gov1_payload })
}

/// Parses a GOV1 v3 payload (141 bytes).
///
/// Layout: GOV1(4) | 0x03(1) | proposal_id_hash(32) | vote_digest_hash(32) | old_root(32) | new_root(32) | review_window_end_ms(8 LE u64)
fn parse_gov1_hashes(
    payload: &[u8],
) -> Result<([u8; 32], [u8; 32], [u8; 32], [u8; 32], u64), i8> {
    if payload.len() != 141 {
        return Err(ERR_INVALID_WITNESS);
    }
    if &payload[0..4] != b"GOV1" {
        return Err(ERR_INVALID_WITNESS);
    }
    if payload[4] != 0x03 {
        return Err(ERR_INVALID_WITNESS);
    }
    let mut proposal_id_hash = [0u8; 32];
    proposal_id_hash.copy_from_slice(&payload[5..37]);
    let mut vote_digest_hash = [0u8; 32];
    vote_digest_hash.copy_from_slice(&payload[37..69]);
    let mut old_root = [0u8; 32];
    old_root.copy_from_slice(&payload[69..101]);
    let mut new_root = [0u8; 32];
    new_root.copy_from_slice(&payload[101..133]);
    let review_window_end_ms = u64::from_le_bytes([
        payload[133], payload[134], payload[135], payload[136],
        payload[137], payload[138], payload[139], payload[140],
    ]);
    Ok((proposal_id_hash, vote_digest_hash, old_root, new_root, review_window_end_ms))
}

/// Loads the `since` field (first 8 bytes of a CellInput) for the given input index.
/// CellInput layout: since(8 LE u64) | previous_output.tx_hash(32) | previous_output.index(4)
fn load_input_since(index: usize, source: Source) -> Result<u64, i8> {
    let raw = load_var_bytes_from(|buf, off| load_input(buf, off, index, source))?;
    if raw.len() < 8 {
        return Err(ERR_INVALID_WITNESS);
    }
    Ok(u64::from_le_bytes([raw[0], raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7]]))
}

/// Checks that `since` encodes an absolute median-time-past timestamp >= `min_ms`.
/// Rejects block-number or epoch since values, and relative since values.
fn verify_since_timestamp(since: u64, min_ms: u64) -> Result<(), i8> {
    if since & SINCE_LOCK_TYPE_FLAG != 0 {
        return Err(ERR_REVIEW_WINDOW_NOT_MET); // relative since is not allowed
    }
    if since & SINCE_METRIC_TYPE_MASK != SINCE_METRIC_TIMESTAMP {
        return Err(ERR_REVIEW_WINDOW_NOT_MET); // must be timestamp metric
    }
    let timestamp_ms = since & SINCE_VALUE_MASK;
    if timestamp_ms < min_ms {
        return Err(ERR_REVIEW_WINDOW_NOT_MET);
    }
    Ok(())
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

    // Load witness and extract signer entries + GOV1 v3 payload.
    let witness = load_witness_fields(0, Source::GroupInput)?;

    // Parse GOV1 v3 payload. The input's `since` field must be an absolute timestamp
    // >= review_window_end_ms, enforcing the governance review window at consensus level.
    // Preimage (136 bytes): proposal_id_hash || vote_digest_hash || old_root || new_root || review_window_end_ms
    let (proposal_id_hash, vote_digest_hash, old_root, new_root, review_window_end_ms) =
        parse_gov1_hashes(&witness.gov1_payload)?;
    if proposal_id_hash == [0u8; 32] || vote_digest_hash == [0u8; 32] {
        return Err(ERR_INVALID_WITNESS);
    }

    let since = load_input_since(0, Source::GroupInput)?;
    verify_since_timestamp(since, review_window_end_ms)?;

    let mut preimage = [0u8; 136];
    preimage[..32].copy_from_slice(&proposal_id_hash);
    preimage[32..64].copy_from_slice(&vote_digest_hash);
    preimage[64..96].copy_from_slice(&old_root);
    preimage[96..128].copy_from_slice(&new_root);
    preimage[128..136].copy_from_slice(&review_window_end_ms.to_le_bytes());
    let signing_message = blake2b_256(&preimage);

    // Verify each signer and count unique valid signatures.
    let max_signers = header.pubkeys.len();
    let mut seen = alloc::vec![false; max_signers];
    let mut valid_count = 0usize;

    for entry in &witness.signers {
        let idx = entry.signer_index as usize;
        if idx >= max_signers {
            return Err(ERR_SIG_VERIFICATION);
        }
        if seen[idx] {
            return Err(ERR_SIG_VERIFICATION); // duplicate signer index
        }
        seen[idx] = true;

        let recovered = recover_pubkey(&signing_message, &entry.sig_bytes)?;
        if recovered != header.pubkeys[idx] {
            return Err(ERR_SIG_VERIFICATION);
        }
        valid_count += 1;
    }

    if valid_count < header.threshold as usize {
        return Err(ERR_THRESHOLD_NOT_MET);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    extern crate std;

    fn minimal_blkl_v2(pubkey: &[u8; 33], threshold: u8) -> Vec<u8> {
        // gov_header: gh_version(1) | signer_count(1) | threshold(1) | pubkey(33) | validator_count(2) | merkle_root(32)
        let mut gh: Vec<u8> = Vec::new();
        gh.push(0x01);
        gh.push(1); // signer_count
        gh.push(threshold);
        gh.extend_from_slice(pubkey);
        gh.extend_from_slice(&[0x00, 0x00]); // validator_count
        gh.extend_from_slice(&[0u8; 32]);     // merkle_root
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
            0x03, 0x1b, 0x84, 0xc5, 0x56, 0x7b, 0x12, 0x64, 0x40, 0x99, 0x5d, 0x3e,
            0xd5, 0xaa, 0xba, 0x05, 0x65, 0xd7, 0x1e, 0x18, 0x34, 0x60, 0x48, 0x19,
            0xff, 0x9c, 0x17, 0xf5, 0xe9, 0xd5, 0xdd, 0x07, 0x8f,
        ]
    }

    #[test]
    fn test_parse_governance_header_valid() {
        let pk = dummy_pubkey();
        let data = minimal_blkl_v2(&pk, 1);
        let h = parse_governance_header(&data).expect("should parse");
        assert_eq!(h.threshold, 1);
        assert_eq!(h.pubkeys.len(), 1);
        assert_eq!(h.pubkeys[0], pk);
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
        let mut data = minimal_blkl_v2(&dummy_pubkey(), 0);
        assert!(parse_governance_header(&data).is_err());
    }

    #[test]
    fn test_parse_gov1_hashes_valid() {
        let mut payload = [0u8; 141];
        payload[0..4].copy_from_slice(b"GOV1");
        payload[4] = 0x03;
        payload[5..37].fill(0x11);    // proposal_id_hash
        payload[37..69].fill(0x22);   // vote_digest_hash
        payload[69..101].fill(0x33);  // old_root
        payload[101..133].fill(0x44); // new_root
        payload[133..141].copy_from_slice(&1_000u64.to_le_bytes()); // review_window_end_ms
        let (pid, vdh, _, _, rw) = parse_gov1_hashes(&payload).expect("should parse");
        assert_eq!(pid, [0x11u8; 32]);
        assert_eq!(vdh, [0x22u8; 32]);
        assert_eq!(rw, 1_000u64);
    }

    #[test]
    fn test_parse_gov1_hashes_wrong_length() {
        assert!(parse_gov1_hashes(&[0u8; 133]).is_err()); // v2 length no longer accepted
        assert!(parse_gov1_hashes(&[0u8; 140]).is_err());
        assert!(parse_gov1_hashes(&[0u8; 142]).is_err());
    }

    #[test]
    fn test_parse_gov1_hashes_wrong_magic() {
        let mut payload = [0u8; 141];
        payload[0..4].copy_from_slice(b"NOPE");
        payload[4] = 0x03;
        payload[5..37].fill(0x11);
        payload[37..69].fill(0x22);
        assert!(parse_gov1_hashes(&payload).is_err());
    }

    #[test]
    fn test_parse_gov1_hashes_wrong_version() {
        let mut payload = [0u8; 141];
        payload[0..4].copy_from_slice(b"GOV1");
        payload[4] = 0x02; // v2 no longer accepted
        assert!(parse_gov1_hashes(&payload).is_err());
    }

    #[test]
    fn test_recover_pubkey_roundtrip() {
        use k256::ecdsa::{SigningKey, signature::hazmat::PrehashSigner};
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
}
