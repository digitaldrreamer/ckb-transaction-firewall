use crate::errors::FirewallError;
use crate::types::{GovernanceHeader, RegistryEntry, RegistryPayload};

// ── parse helpers ─────────────────────────────────────────────────────────────

pub(crate) fn parse_governance_header(
    data: &[u8],
    offset: usize,
    gov_len: usize,
) -> Result<GovernanceHeader, FirewallError> {
    if data.len() < offset + gov_len || gov_len < 3 {
        return Err(FirewallError::InvalidRegistryData);
    }
    // Wire format:
    //   gh_version(1) | legacy_signer_count(1) | threshold(1) | [pubkey(33)]×N
    //   | validator_count(2 LE) | merkle_root(32)
    //   v2 suffix: treasury_lock_hash(32)
    //   v3 suffix: treasury_lock_script_len(2 LE) | treasury_lock_script bytes
    let gh_version = data[offset];
    if gh_version != 0x01 && gh_version != 0x02 && gh_version != 0x03 {
        return Err(FirewallError::InvalidRegistryData);
    }
    let signer_count = data[offset + 1] as usize;
    let threshold = data[offset + 2];
    let pubkeys_end = offset + 3 + signer_count * 33;
    // Bound all governance-header reads within [offset, offset + gov_len).
    if pubkeys_end + 2 + 32 > offset + gov_len {
        return Err(FirewallError::InvalidRegistryData);
    }
    let mut pubkeys = Vec::with_capacity(signer_count);
    for i in 0..signer_count {
        let start = offset + 3 + i * 33;
        let mut pk = [0u8; 33];
        pk.copy_from_slice(&data[start..start + 33]);
        pubkeys.push(pk);
    }
    let validator_count = u16::from_le_bytes([data[pubkeys_end], data[pubkeys_end + 1]]);
    let mut validator_merkle_root = [0u8; 32];
    validator_merkle_root.copy_from_slice(&data[pubkeys_end + 2..pubkeys_end + 34]);
    Ok(GovernanceHeader {
        signer_count: signer_count as u8,
        threshold,
        pubkeys,
        validator_count,
        validator_merkle_root,
    })
}

pub(crate) fn parse_entries(
    data: &[u8],
    offset: usize,
    count: usize,
) -> Result<(Vec<RegistryEntry>, usize), FirewallError> {
    let mut off = offset;
    // Each entry is at minimum 9 bytes (1-byte id_len + 0-byte id + 8-byte expires_at).
    // Reject impossible counts before allocating to prevent OOM on malicious input.
    let max_possible = data.len().saturating_sub(off) / 9;
    if count > max_possible {
        return Err(FirewallError::InvalidRegistryData);
    }
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        if off >= data.len() {
            return Err(FirewallError::InvalidRegistryData);
        }
        let id_len = data[off] as usize;
        off += 1;
        if off + id_len + 8 > data.len() {
            return Err(FirewallError::InvalidRegistryData);
        }
        let identifier = data[off..off + id_len].to_vec();
        off += id_len;
        let expires_at = u64::from_le_bytes([
            data[off],
            data[off + 1],
            data[off + 2],
            data[off + 3],
            data[off + 4],
            data[off + 5],
            data[off + 6],
            data[off + 7],
        ]);
        off += 8;
        entries.push(RegistryEntry {
            identifier,
            expires_at,
        });
    }
    for i in 1..entries.len() {
        if entries[i].identifier <= entries[i - 1].identifier {
            return Err(FirewallError::RegistryNotSorted);
        }
    }
    Ok((entries, off))
}

// ── public API ────────────────────────────────────────────────────────────────

/// Parse a raw BLKL v2 registry payload.
///
/// Only version 0x02 is accepted, matching the on-chain blacklist-registry
/// contract and the TypeScript SDK. Any other version, malformed data, or
/// trailing bytes return [`FirewallError::InvalidRegistryData`].
pub fn parse_registry_payload(data: &[u8]) -> Result<RegistryPayload, FirewallError> {
    if data.len() < 7 {
        return Err(FirewallError::InvalidRegistryData);
    }
    if &data[0..4] != b"BLKL" {
        return Err(FirewallError::InvalidRegistryData);
    }
    if data[4] != 0x02 {
        return Err(FirewallError::InvalidRegistryData);
    }
    let gov_len = u16::from_le_bytes([data[5], data[6]]) as usize;
    if data.len() < 7 + gov_len + 4 {
        return Err(FirewallError::InvalidRegistryData);
    }
    let governance_header = parse_governance_header(data, 7, gov_len)?;
    let entries_start = 7 + gov_len;
    let count = u32::from_le_bytes([
        data[entries_start],
        data[entries_start + 1],
        data[entries_start + 2],
        data[entries_start + 3],
    ]) as usize;
    let (entries, end) = parse_entries(data, entries_start + 4, count)?;
    if end != data.len() {
        return Err(FirewallError::InvalidRegistryData);
    }
    Ok(RegistryPayload {
        version: 2,
        entries,
        governance_header: Some(governance_header),
    })
}

/// Encode a [`GovernanceHeader`] to bytes.
///
/// Layout: `gh_version(1)=0x01 | signer_count(1) | threshold(1) |
/// pubkeys(33×N) | validator_count(2 LE) | merkle_root(32)`
pub fn encode_governance_header(gh: &GovernanceHeader) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(0x01);
    out.push(gh.signer_count);
    out.push(gh.threshold);
    for pk in &gh.pubkeys {
        out.extend_from_slice(pk);
    }
    out.extend_from_slice(&gh.validator_count.to_le_bytes());
    out.extend_from_slice(&gh.validator_merkle_root);
    out
}

/// Encode a [`RegistryPayload`] to raw bytes.
///
/// Produces a BLKL v2 payload. Entries must already be sorted in ascending
/// lexicographic order; this function does not re-sort them.
///
/// Returns [`FirewallError::InvalidRegistryData`] if any entry identifier
/// exceeds 255 bytes (the wire format stores identifier length as one byte).
///
/// Layout: `BLKL(4) | version(1)=0x02 | gov_header_len(2 LE) | gov_header |
/// entry_count(4 LE) | [id_len(1) | id | expires_at(8 LE)]×N`
pub fn encode_registry_payload(payload: &RegistryPayload) -> Result<Vec<u8>, FirewallError> {
    let gov_bytes = match &payload.governance_header {
        Some(gh) => encode_governance_header(gh),
        None => {
            // Minimal placeholder: gh_version=1, signer_count=0, threshold=0, validator_count=0, merkle_root=0×32
            let mut h = vec![0x01u8, 0x00, 0x00, 0x00, 0x00];
            h.extend_from_slice(&[0u8; 32]);
            h
        }
    };
    let gov_len = gov_bytes.len() as u16;
    let mut out = Vec::new();
    out.extend_from_slice(b"BLKL");
    out.push(0x02);
    out.extend_from_slice(&gov_len.to_le_bytes());
    out.extend_from_slice(&gov_bytes);
    out.extend_from_slice(&(payload.entries.len() as u32).to_le_bytes());
    for entry in &payload.entries {
        if entry.identifier.len() > u8::MAX as usize {
            return Err(FirewallError::InvalidRegistryData);
        }
        out.push(entry.identifier.len() as u8);
        out.extend_from_slice(&entry.identifier);
        out.extend_from_slice(&entry.expires_at.to_le_bytes());
    }
    Ok(out)
}
