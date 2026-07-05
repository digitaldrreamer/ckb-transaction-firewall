//! Property-based and fuzz tests for the BLKL v2 registry decoder.
//!
//! The decoder in `registry.rs` parses the same on-chain registry payload
//! format the `blacklist-registry` contract enforces at consensus, and it is
//! what wallets and AI agents run at pre-flight. A panic or mis-parse here is
//! an availability/correctness bug, so this suite fuzzes the parser directly.
//!
//! Coverage follows the mainnet-readiness feedback on the CKBuilder review
//! (issue #19): registry parsing, sorting, malformed data, and expiry.
//!
//! Invariants exercised:
//!   * `parse_registry_payload` never panics on arbitrary bytes.
//!   * Well-formed payloads survive an encode → parse round-trip byte-exact.
//!   * Expiry timestamps (including `0` = permanent and `u64::MAX`) round-trip.
//!   * Entries must be strictly ascending: unsorted or duplicated identifiers
//!     are rejected with `RegistryNotSorted`.
//!   * Any trailing byte past a valid payload is rejected (no silent slack).
//!   * Every strict prefix of a valid payload is rejected (truncation safety).
//!   * An absurd entry count cannot trigger an unbounded allocation.

use ckb_transaction_firewall_sdk::{
    encode_registry_payload, parse_registry_payload, FirewallError, GovernanceHeader,
    RegistryEntry, RegistryPayload,
};
use proptest::prelude::*;

// ── strategies ──────────────────────────────────────────────────────────────

/// A single 33-byte compressed public key. proptest only derives `Arbitrary`
/// for arrays up to length 32, so build the 33-byte key from a vector.
fn arb_pubkey() -> impl Strategy<Value = [u8; 33]> {
    prop::collection::vec(any::<u8>(), 33).prop_map(|v| {
        let mut a = [0u8; 33];
        a.copy_from_slice(&v);
        a
    })
}

/// A governance header whose `signer_count` matches `pubkeys.len()`, so the
/// encoded `gov_header_len` is internally consistent.
fn arb_gov_header() -> impl Strategy<Value = GovernanceHeader> {
    (
        prop::collection::vec(arb_pubkey(), 0..6usize),
        any::<u8>(),
        any::<u16>(),
        any::<[u8; 32]>(),
    )
        .prop_map(
            |(pubkeys, threshold, validator_count, validator_merkle_root)| GovernanceHeader {
                signer_count: pubkeys.len() as u8,
                threshold,
                pubkeys,
                validator_count,
                validator_merkle_root,
            },
        )
}

/// A well-formed BLKL v2 payload: entries strictly ascending and unique by
/// identifier, identifiers within the 255-byte wire limit.
fn arb_payload() -> impl Strategy<Value = RegistryPayload> {
    let entries = prop::collection::vec(
        (prop::collection::vec(any::<u8>(), 0..40usize), any::<u64>()),
        0..12usize,
    );
    (arb_gov_header(), entries).prop_map(|(gh, raw)| {
        let mut sorted = raw;
        sorted.sort_by(|a, b| a.0.cmp(&b.0));
        sorted.dedup_by(|a, b| a.0 == b.0);
        let entries = sorted
            .into_iter()
            .map(|(identifier, expires_at)| RegistryEntry {
                identifier,
                expires_at,
            })
            .collect();
        RegistryPayload {
            version: 2,
            entries,
            governance_header: Some(gh),
        }
    })
}

// ── fuzz: never panic ─────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2048))]

    /// The decoder must return `Ok`/`Err` on any input, never panic. When it
    /// does accept input, the sortedness invariant it promises must hold.
    #[test]
    fn parse_never_panics(data in prop::collection::vec(any::<u8>(), 0..4096usize)) {
        if let Ok(payload) = parse_registry_payload(&data) {
            prop_assert_eq!(payload.version, 2);
            for w in payload.entries.windows(2) {
                prop_assert!(w[0].identifier < w[1].identifier);
            }
        }
    }
}

// ── property tests ────────────────────────────────────────────────────────────

proptest! {
    /// Any well-formed payload round-trips through encode → parse unchanged.
    #[test]
    fn roundtrip_wellformed(payload in arb_payload()) {
        let encoded = encode_registry_payload(&payload).expect("well-formed payload encodes");
        let decoded = parse_registry_payload(&encoded).expect("encoded payload parses");
        prop_assert_eq!(decoded, payload);
    }

    /// Expiry timestamps survive a round-trip exactly, including `0` (permanent)
    /// and `u64::MAX`. Identifiers are `0,1,2,...` so they stay strictly ordered.
    #[test]
    fn expiry_preserved(exps in prop::collection::vec(any::<u64>(), 1..8usize)) {
        let entries: Vec<RegistryEntry> = exps
            .iter()
            .enumerate()
            .map(|(i, &e)| RegistryEntry {
                identifier: vec![i as u8],
                expires_at: e,
            })
            .collect();
        let payload = RegistryPayload {
            version: 2,
            entries,
            governance_header: None,
        };
        let encoded = encode_registry_payload(&payload).unwrap();
        let decoded = parse_registry_payload(&encoded).unwrap();
        let got: Vec<u64> = decoded.entries.iter().map(|e| e.expires_at).collect();
        prop_assert_eq!(got, exps);
    }

    /// Entries that are out of order (adjacent swap) are rejected.
    #[test]
    fn unsorted_rejected(payload in arb_payload()) {
        prop_assume!(payload.entries.len() >= 2);
        let mut p = payload;
        p.entries.swap(0, 1);
        let encoded = encode_registry_payload(&p).unwrap();
        prop_assert_eq!(
            parse_registry_payload(&encoded).unwrap_err(),
            FirewallError::RegistryNotSorted
        );
    }

    /// Duplicate identifiers are rejected — the format requires *strictly*
    /// ascending order, not merely sorted, so a fake duplicate cannot slip in.
    #[test]
    fn duplicate_identifier_rejected(payload in arb_payload()) {
        prop_assume!(payload.entries.len() >= 2);
        let mut p = payload;
        p.entries[1].identifier = p.entries[0].identifier.clone();
        let encoded = encode_registry_payload(&p).unwrap();
        prop_assert_eq!(
            parse_registry_payload(&encoded).unwrap_err(),
            FirewallError::RegistryNotSorted
        );
    }

    /// A valid payload with any extra trailing byte is rejected: the parser
    /// requires it to consume the input exactly.
    #[test]
    fn trailing_bytes_rejected(payload in arb_payload(), extra in any::<u8>()) {
        let mut encoded = encode_registry_payload(&payload).unwrap();
        encoded.push(extra);
        prop_assert_eq!(
            parse_registry_payload(&encoded).unwrap_err(),
            FirewallError::InvalidRegistryData
        );
    }

    /// Every strict prefix of a valid payload is rejected without panicking —
    /// a truncated registry dep can never be mistaken for a shorter valid one.
    #[test]
    fn truncation_rejected(payload in arb_payload()) {
        let encoded = encode_registry_payload(&payload).unwrap();
        for len in 0..encoded.len() {
            prop_assert!(parse_registry_payload(&encoded[..len]).is_err());
        }
    }
}

// ── targeted regression ───────────────────────────────────────────────────────

/// A header can claim a huge entry count with no entry bytes behind it. The
/// parser must reject it via its bounds check rather than attempting to
/// allocate a `Vec` for `u32::MAX` entries.
#[test]
fn oversized_entry_count_no_oom() {
    // Minimal valid governance header: gh_version=1, signer_count=0,
    // threshold=0, validator_count=0 (2 LE), merkle_root(32).
    let mut gov = vec![0x01u8, 0x00, 0x00, 0x00, 0x00];
    gov.extend_from_slice(&[0u8; 32]);

    let mut data = Vec::new();
    data.extend_from_slice(b"BLKL");
    data.push(0x02);
    data.extend_from_slice(&(gov.len() as u16).to_le_bytes());
    data.extend_from_slice(&gov);
    data.extend_from_slice(&u32::MAX.to_le_bytes()); // absurd entry count
    // ...with no entry bytes following.

    assert_eq!(
        parse_registry_payload(&data).unwrap_err(),
        FirewallError::InvalidRegistryData
    );
}
