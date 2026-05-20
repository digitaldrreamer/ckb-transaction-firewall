//! Spawn-Aware secp256k1-blake160 Lock
//!
//! A CKB lock script invoked via spawn_cell from firewall-lock.
//! Because it is spawned (not directly executed as a lock), it receives
//! its "script args" from argv rather than load_script().args().
//!
//! # Protocol
//!
//! The parent (firewall-lock) passes:
//!   argv[0] = hex-encoded pubkey_hash (blake160 of compressed secp256k1 pubkey)
//!   argv[1] = hex-encoded signature (65 bytes: r[32] || s[32] || recovery_id[1])
//!
//! This script:
//!   1. Decodes argv[0] → pubkey_hash (20 bytes)
//!   2. Decodes argv[1] → sig (65 bytes)
//!   3. Loads tx_hash via syscall
//!   4. signing_message = ckb_blake2b(tx_hash)
//!   5. Recovers compressed pubkey from (signing_message, sig)
//!   6. Asserts blake160(pubkey) == pubkey_hash
//!
//! # Error exits
//!
//!   1 = wrong number of argv
//!   2 = argv[0] not valid 20-byte hex (pubkey_hash)
//!   3 = argv[1] not valid 65-byte hex (signature)
//!   4 = signature parse failed
//!   5 = recovery_id out of range
//!   6 = pubkey recovery failed (bad sig or wrong message)
//!   7 = recovered blake160 does not match pubkey_hash

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
        Err(code) => code,
    }
}

use blake2b_ref::Blake2bBuilder;
use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

const BLAKE2B_PERSONAL: &[u8] = b"ckb-default-hash";

fn blake2b_256(data: &[u8]) -> [u8; 32] {
    let mut h = Blake2bBuilder::new(32).personal(BLAKE2B_PERSONAL).build();
    h.update(data);
    let mut out = [0u8; 32];
    h.finalize(&mut out);
    out
}

fn blake160(data: &[u8]) -> [u8; 20] {
    let hash = blake2b_256(data);
    let mut out = [0u8; 20];
    out.copy_from_slice(&hash[..20]);
    out
}

fn hex_decode(hex: &[u8]) -> Option<alloc::vec::Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    let mut out = alloc::vec::Vec::with_capacity(hex.len() / 2);
    for pair in hex.chunks(2) {
        let hi = from_hex_digit(pair[0])?;
        let lo = from_hex_digit(pair[1])?;
        out.push((hi << 4) | lo);
    }
    Some(out)
}

fn from_hex_digit(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn program_entry() -> Result<(), i8> {
    let argv = ckb_std::env::argv();
    if argv.len() < 2 {
        return Err(1);
    }

    // argv[0]: hex-encoded pubkey_hash (20 bytes = 40 hex chars)
    let pubkey_hash_hex = argv[0].to_bytes();
    let pubkey_hash_bytes = hex_decode(pubkey_hash_hex).ok_or(2i8)?;
    if pubkey_hash_bytes.len() != 20 {
        return Err(2);
    }
    let mut pubkey_hash = [0u8; 20];
    pubkey_hash.copy_from_slice(&pubkey_hash_bytes);

    // argv[1]: hex-encoded signature (65 bytes = 130 hex chars)
    let sig_hex = argv[1].to_bytes();
    let sig_bytes = hex_decode(sig_hex).ok_or(3i8)?;
    if sig_bytes.len() != 65 {
        return Err(3);
    }

    // signing_message = blake2b(tx_hash)
    let tx_hash = ckb_std::high_level::load_tx_hash().map_err(|_| 4i8)?;
    let signing_message = blake2b_256(&tx_hash);

    // Recover pubkey from signature
    let sig = Signature::from_slice(&sig_bytes[..64]).map_err(|_| 4i8)?;
    let recovery_id = RecoveryId::try_from(sig_bytes[64]).map_err(|_| 5i8)?;
    let recovered = VerifyingKey::recover_from_prehash(&signing_message, &sig, recovery_id)
        .map_err(|_| 6i8)?;

    let recovered_pubkey = recovered.to_encoded_point(true);
    let recovered_bytes = recovered_pubkey.as_bytes(); // 33-byte compressed pubkey
    let computed_hash = blake160(recovered_bytes);

    if computed_hash != pubkey_hash {
        return Err(7);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    extern crate std;

    #[test]
    fn test_hex_decode_roundtrip() {
        let bytes = [0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0xabu8];
        let hex: alloc::vec::Vec<u8> = bytes.iter()
            .flat_map(|b| {
                let hi = b"0123456789abcdef"[(b >> 4) as usize];
                let lo = b"0123456789abcdef"[(b & 0xf) as usize];
                [hi, lo]
            })
            .collect();
        assert_eq!(hex_decode(&hex).unwrap(), bytes);
    }

    #[test]
    fn test_hex_decode_rejects_odd_length() {
        assert!(hex_decode(b"abc").is_none());
    }

    #[test]
    fn test_hex_decode_rejects_invalid_chars() {
        assert!(hex_decode(b"GG").is_none());
        assert!(hex_decode(b"0x").is_none());
    }

    #[test]
    fn test_blake160_length() {
        let hash = blake160(b"hello");
        assert_eq!(hash.len(), 20);
    }

    #[test]
    fn test_recover_and_blake160_roundtrip() {
        use k256::ecdsa::{SigningKey, signature::hazmat::PrehashSigner};

        // private key = [0x01; 32]
        let sk = SigningKey::from_bytes(&[0x01u8; 32].into()).unwrap();
        let vk = sk.verifying_key();
        let pubkey_bytes = vk.to_encoded_point(true);
        let expected_hash = blake160(pubkey_bytes.as_bytes());

        let tx_hash = [0x42u8; 32];
        let message = blake2b_256(&tx_hash);

        let (sig, rid) = sk.sign_prehash(&message).unwrap();
        let mut sig_bytes = [0u8; 65];
        sig_bytes[..64].copy_from_slice(&sig.to_bytes());
        sig_bytes[64] = rid.to_byte();

        let recovered_sig = Signature::from_slice(&sig_bytes[..64]).unwrap();
        let recovered_rid = RecoveryId::try_from(sig_bytes[64]).unwrap();
        let recovered_vk =
            VerifyingKey::recover_from_prehash(&message, &recovered_sig, recovered_rid).unwrap();
        let recovered_point = recovered_vk.to_encoded_point(true);
        let computed_hash = blake160(recovered_point.as_bytes());

        assert_eq!(computed_hash, expected_hash);
    }
}
