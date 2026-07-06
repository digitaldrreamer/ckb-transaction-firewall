//! Property-based and fuzz tests for the shared BLKL v2 registry parser.
//!
//! This is the exact decoder the on-chain `blacklist-registry` type script
//! runs at consensus, so a panic or mis-parse here is a consensus-layer bug.
//! Running the fuzzer against this crate (rather than through the CKB VM) lets
//! us throw thousands of malformed inputs at the real parser in milliseconds.
//!
//! Coverage follows the mainnet-readiness feedback on the CKBuilder review
//! (issue #19): registry parsing, sorting, malformed data, and expiry.
//!
//! Note on behaviour vs. the off-chain SDK decoder (`sdk/rust/src/registry.rs`):
//! the on-chain parser **skips the governance header by length** and **ignores
//! any trailing bytes after the declared entries**, whereas the SDK parser
//! validates the header and rejects trailing bytes. `trailing_bytes_ignored`
//! below pins the on-chain behaviour so the divergence is explicit and any
//! future change is caught.

use proptest::prelude::*;
use registry_format::{RegistryEntry, RegistryParseError, RegistryPayload};

// ── encoder + strategies ──────────────────────────────────────────────────────

/// Encode a canonical BLKL payload. The governance header bytes are opaque to
/// the parser (it skips them by length), so any content is valid there.
fn encode(version: u8, gov: &[u8], entries: &[RegistryEntry]) -> Vec<u8> {
    let mut data = Vec::new();
    data.extend_from_slice(b"BLKL");
    data.push(version);
    data.extend_from_slice(&(gov.len() as u16).to_le_bytes());
    data.extend_from_slice(gov);
    data.extend_from_slice(&(entries.len() as u32).to_le_bytes());
    for e in entries {
        data.push(e.identifier.len() as u8);
        data.extend_from_slice(&e.identifier);
        data.extend_from_slice(&e.expires_at.to_le_bytes());
    }
    data
}

/// Arbitrary governance-header bytes (opaque to the parser).
fn arb_gov() -> impl Strategy<Value = Vec<u8>> {
    prop::collection::vec(any::<u8>(), 0..64usize)
}

/// Entries strictly ascending and unique by identifier, identifiers within the
/// 255-byte wire limit.
fn arb_entries() -> impl Strategy<Value = Vec<RegistryEntry>> {
    prop::collection::vec(
        (prop::collection::vec(any::<u8>(), 0..40usize), any::<u64>()),
        0..12usize,
    )
    .prop_map(|raw| {
        let mut sorted = raw;
        sorted.sort_by(|a, b| a.0.cmp(&b.0));
        sorted.dedup_by(|a, b| a.0 == b.0);
        sorted
            .into_iter()
            .map(|(identifier, expires_at)| RegistryEntry {
                identifier,
                expires_at,
            })
            .collect()
    })
}

// ── fuzz: never panic ─────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2048))]

    /// The parser must return `Ok`/`Err` on any input, never panic. When it
    /// accepts input, its promised invariants (version 0x02, strictly
    /// ascending entries) must hold.
    #[test]
    fn parse_never_panics(data in prop::collection::vec(any::<u8>(), 0..4096usize)) {
        if let Ok(payload) = RegistryPayload::parse(&data) {
            prop_assert_eq!(payload.version, 0x02);
            for w in payload.entries.windows(2) {
                prop_assert!(w[0].identifier < w[1].identifier);
            }
        }
    }
}

// ── property tests ────────────────────────────────────────────────────────────

proptest! {
    /// A well-formed payload decodes to exactly its version and entries. The
    /// governance header is skipped, so it does not appear in the result.
    #[test]
    fn roundtrip_wellformed(gov in arb_gov(), entries in arb_entries()) {
        let data = encode(0x02, &gov, &entries);
        let decoded = RegistryPayload::parse(&data).expect("well-formed payload parses");
        prop_assert_eq!(decoded, RegistryPayload { version: 0x02, entries });
    }

    /// Expiry timestamps survive parsing exactly, including `0` (permanent) and
    /// `u64::MAX`. Identifiers `0,1,2,...` keep the entries strictly ordered.
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
        let data = encode(0x02, &[], &entries);
        let decoded = RegistryPayload::parse(&data).unwrap();
        let got: Vec<u64> = decoded.entries.iter().map(|e| e.expires_at).collect();
        prop_assert_eq!(got, exps);
    }

    /// Out-of-order entries (adjacent swap) are rejected as InvalidPayload.
    #[test]
    fn unsorted_rejected(gov in arb_gov(), entries in arb_entries()) {
        prop_assume!(entries.len() >= 2);
        let mut e = entries;
        e.swap(0, 1);
        let data = encode(0x02, &gov, &e);
        prop_assert_eq!(
            RegistryPayload::parse(&data).unwrap_err(),
            RegistryParseError::InvalidPayload
        );
    }

    /// Duplicate identifiers are rejected — strictly ascending is required, so a
    /// duplicate entry cannot be smuggled in.
    #[test]
    fn duplicate_identifier_rejected(gov in arb_gov(), entries in arb_entries()) {
        prop_assume!(entries.len() >= 2);
        let mut e = entries;
        e[1].identifier = e[0].identifier.clone();
        let data = encode(0x02, &gov, &e);
        prop_assert_eq!(
            RegistryPayload::parse(&data).unwrap_err(),
            RegistryParseError::InvalidPayload
        );
    }

    /// Any version byte other than 0x02 is rejected as UnsupportedVersion —
    /// distinct from a generic malformed-payload error.
    #[test]
    fn wrong_version_rejected(
        version in any::<u8>().prop_filter("not v2", |v| *v != 0x02),
        gov in arb_gov(),
        entries in arb_entries(),
    ) {
        let data = encode(version, &gov, &entries);
        prop_assert_eq!(
            RegistryPayload::parse(&data).unwrap_err(),
            RegistryParseError::UnsupportedVersion
        );
    }

    /// Every strict prefix of a canonical payload is rejected without panicking:
    /// a truncated registry cell can never be mistaken for a shorter valid one.
    #[test]
    fn truncation_rejected(gov in arb_gov(), entries in arb_entries()) {
        let data = encode(0x02, &gov, &entries);
        for len in 0..data.len() {
            prop_assert!(RegistryPayload::parse(&data[..len]).is_err());
        }
    }

    /// The on-chain parser ignores bytes after the declared entries. This pins
    /// that behaviour (the SDK decoder, by contrast, rejects trailing bytes).
    #[test]
    fn trailing_bytes_ignored(
        gov in arb_gov(),
        entries in arb_entries(),
        extra in prop::collection::vec(any::<u8>(), 1..16usize),
    ) {
        let mut data = encode(0x02, &gov, &entries);
        data.extend_from_slice(&extra);
        let decoded = RegistryPayload::parse(&data).expect("trailing bytes are ignored, not rejected");
        prop_assert_eq!(decoded.entries, entries);
    }
}

// ── targeted regression ───────────────────────────────────────────────────────

/// A header can claim a huge entry count with no entries behind it. The parser
/// must reject it via its bounds check, never attempt to allocate a `Vec` for
/// `u32::MAX` entries.
#[test]
fn oversized_entry_count_no_oom() {
    let mut data = Vec::new();
    data.extend_from_slice(b"BLKL");
    data.push(0x02);
    data.extend_from_slice(&0u16.to_le_bytes()); // gov_header_len = 0
    data.extend_from_slice(&u32::MAX.to_le_bytes()); // absurd entry count
    // ...with no entry bytes following.
    assert_eq!(
        RegistryPayload::parse(&data).unwrap_err(),
        RegistryParseError::InvalidPayload
    );
}
