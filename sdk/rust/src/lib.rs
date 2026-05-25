#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FirewallError {
    MissingRegistryCellDep,
    InvalidRegistryData,
    RegistryNotSorted,
    BlacklistedLockArgs,
    BlacklistedTypeArgs,
    AmbiguousRegistryCellDep,
}

impl FirewallError {
    pub fn code(&self) -> i8 {
        match self {
            FirewallError::MissingRegistryCellDep => 8,
            FirewallError::InvalidRegistryData => 9,
            FirewallError::RegistryNotSorted => 10,
            FirewallError::BlacklistedLockArgs => 11,
            FirewallError::BlacklistedTypeArgs => 12,
            FirewallError::AmbiguousRegistryCellDep => 17,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HashType {
    Data,
    Type,
    Data1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptLike {
    pub code_hash: [u8; 32],
    pub hash_type: HashType,
    pub args: Vec<u8>,
}

/// Identifies a registry cell dep by its type-script code hash, hash type, and
/// the 32-byte Type ID value stored at bytes 34–66 of the type-script args.
/// Mirrors `RegistrySpecLike` in the TypeScript SDK.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistrySpec {
    pub code_hash: [u8; 32],
    pub hash_type: HashType,
    /// Bytes 34–66 of the registry cell's type-script args (the Type ID value).
    pub type_id_value: [u8; 32],
    /// If true, a missing registry dep is an error; if false it is silently skipped.
    pub required: bool,
}

#[derive(Debug, Clone)]
pub struct CellDepLike {
    pub type_script: Option<ScriptLike>,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct TxOutputLike {
    pub lock_args: Vec<u8>,
    pub type_args: Option<Vec<u8>>,
}

#[derive(Debug, Clone)]
pub struct UnsignedTxLike {
    pub cell_deps: Vec<CellDepLike>,
    pub outputs: Vec<TxOutputLike>,
}

#[derive(Debug, Clone)]
pub struct FirewallConfig {
    pub registries: Vec<RegistrySpec>,
}

#[derive(Debug, Clone)]
pub struct RegistryEntry {
    pub identifier: Vec<u8>,
    /// Unix seconds. 0 means the entry never expires.
    pub expires_at: u64,
}

#[derive(Debug, Clone)]
pub struct GovernanceHeader {
    pub signer_count: u8,
    pub threshold: u8,
    pub pubkeys: Vec<[u8; 33]>,
    pub validator_count: u16,
    pub validator_merkle_root: [u8; 32],
}

#[derive(Debug, Clone)]
pub struct RegistryPayload {
    pub version: u8,
    pub entries: Vec<RegistryEntry>,
    pub governance_header: Option<GovernanceHeader>,
}

fn dep_matches_spec(dep: &CellDepLike, spec: &RegistrySpec) -> bool {
    let ts = match &dep.type_script {
        Some(ts) => ts,
        None => return false,
    };
    ts.code_hash == spec.code_hash
        && ts.hash_type == spec.hash_type
        && ts.args.len() >= 66
        && ts.args[34..66] == spec.type_id_value
}

fn resolve_registry_deps<'a>(
    deps: &'a [CellDepLike],
    specs: &[RegistrySpec],
) -> Result<Vec<Option<&'a CellDepLike>>, FirewallError> {
    let mut resolved = Vec::with_capacity(specs.len());
    for spec in specs {
        let mut matched: Option<&CellDepLike> = None;
        for dep in deps {
            if dep_matches_spec(dep, spec) {
                if matched.is_some() {
                    return Err(FirewallError::AmbiguousRegistryCellDep);
                }
                matched = Some(dep);
            }
        }
        if matched.is_none() && spec.required {
            return Err(FirewallError::MissingRegistryCellDep);
        }
        resolved.push(matched);
    }
    Ok(resolved)
}

fn parse_entries(data: &[u8], offset: usize, count: usize) -> Result<(Vec<RegistryEntry>, usize), FirewallError> {
    let mut off = offset;
    let max_possible = (data.len().saturating_sub(off)) / 9;
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
            data[off], data[off + 1], data[off + 2], data[off + 3],
            data[off + 4], data[off + 5], data[off + 6], data[off + 7],
        ]);
        off += 8;
        entries.push(RegistryEntry { identifier, expires_at });
    }
    for i in 1..entries.len() {
        if entries[i].identifier <= entries[i - 1].identifier {
            return Err(FirewallError::RegistryNotSorted);
        }
    }
    Ok((entries, off))
}

fn parse_governance_header(data: &[u8], offset: usize, gov_len: usize) -> Result<GovernanceHeader, FirewallError> {
    let end = offset + gov_len;
    if data.len() < end || gov_len < 3 {
        return Err(FirewallError::InvalidRegistryData);
    }
    // gh_version(1) | signer_count(1) | threshold(1) | pubkeys(33×N) | validator_count(2 LE) | merkle_root(32)
    if data[offset] != 0x01 {
        return Err(FirewallError::InvalidRegistryData);
    }
    let signer_count = data[offset + 1] as usize;
    let threshold = data[offset + 2];
    let pubkeys_end = offset + 3 + signer_count * 33;
    if data.len() < pubkeys_end + 2 + 32 {
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

/// Parse a raw BLKL v2 registry payload.
///
/// Only version 0x02 is accepted, matching the on-chain blacklist-registry contract
/// and the TypeScript SDK. Returns [`FirewallError::InvalidRegistryData`] for any
/// other version, malformed data, or trailing bytes.
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
    // v2: BLKL(4) + version(1) + gov_header_len(2 LE) + gov_header(N) + entry_count(4 LE) + entries
    let gov_len = u16::from_le_bytes([data[5], data[6]]) as usize;
    let gov_start = 7usize;
    if data.len() < gov_start + gov_len + 4 {
        return Err(FirewallError::InvalidRegistryData);
    }
    let governance_header = parse_governance_header(data, gov_start, gov_len)?;
    let entries_start = gov_start + gov_len;
    let count = u32::from_le_bytes([
        data[entries_start], data[entries_start + 1],
        data[entries_start + 2], data[entries_start + 3],
    ]) as usize;
    let (entries, end) = parse_entries(data, entries_start + 4, count)?;
    if end != data.len() {
        return Err(FirewallError::InvalidRegistryData);
    }
    Ok(RegistryPayload { version: 2, entries, governance_header: Some(governance_header) })
}

fn is_blacklisted(entries: &[RegistryEntry], target: &[u8], now_secs: u64) -> bool {
    let mut lo = 0usize;
    let mut hi = entries.len();
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        match entries[mid].identifier.as_slice().cmp(target) {
            std::cmp::Ordering::Equal => {
                return entries[mid].expires_at == 0 || entries[mid].expires_at > now_secs;
            }
            std::cmp::Ordering::Less => lo = mid + 1,
            std::cmp::Ordering::Greater => hi = mid,
        }
    }
    false
}

/// Pre-flight blacklist check for an unsigned CKB transaction.
///
/// Resolves all registry cell deps specified in `cfg`, parses each registry
/// payload, and checks every transaction output's lock and type args against
/// the active (non-expired) blacklist entries.
///
/// `now_secs` is the current time in Unix seconds. Pass the chain's median
/// time for consensus-accurate expiry evaluation, or system time for
/// off-chain pre-flight use.
pub fn check_transaction(
    cfg: &FirewallConfig,
    tx: &UnsignedTxLike,
    now_secs: u64,
) -> Result<(), FirewallError> {
    let resolved = resolve_registry_deps(&tx.cell_deps, &cfg.registries)?;

    for slot in resolved.into_iter().flatten() {
        let payload = parse_registry_payload(&slot.data)?;
        for out in &tx.outputs {
            if is_blacklisted(&payload.entries, &out.lock_args, now_secs) {
                return Err(FirewallError::BlacklistedLockArgs);
            }
            if let Some(type_args) = &out.type_args {
                if is_blacklisted(&payload.entries, type_args, now_secs) {
                    return Err(FirewallError::BlacklistedTypeArgs);
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(tag: u8) -> RegistrySpec {
        let mut type_id = [0u8; 32];
        type_id[0] = tag;
        let mut code_hash = [0u8; 32];
        code_hash[0] = tag;
        RegistrySpec {
            code_hash,
            hash_type: HashType::Type,
            type_id_value: type_id,
            required: true,
        }
    }

    fn dep_for_spec(s: &RegistrySpec, data: Vec<u8>) -> CellDepLike {
        let mut args = vec![0u8; 66];
        args[34..66].copy_from_slice(&s.type_id_value);
        CellDepLike {
            type_script: Some(ScriptLike {
                code_hash: s.code_hash,
                hash_type: s.hash_type.clone(),
                args,
            }),
            data,
        }
    }

    fn build_registry(ids: &[&[u8]]) -> Vec<u8> {
        build_registry_with_expiry(&ids.iter().map(|id| (*id, 0u64)).collect::<Vec<_>>())
    }

    fn build_registry_with_expiry(ids: &[(&[u8], u64)]) -> Vec<u8> {
        let gov_header: Vec<u8> = {
            let mut h = vec![0x01u8, 0x00, 0x00, 0x00, 0x00];
            h.extend_from_slice(&[0u8; 32]);
            h
        };
        let gov_len = gov_header.len() as u16;
        let mut out = Vec::new();
        out.extend_from_slice(b"BLKL");
        out.push(2);
        out.extend_from_slice(&gov_len.to_le_bytes());
        out.extend_from_slice(&gov_header);
        out.extend_from_slice(&(ids.len() as u32).to_le_bytes());
        for (id, exp) in ids {
            out.push(id.len() as u8);
            out.extend_from_slice(id);
            out.extend_from_slice(&exp.to_le_bytes());
        }
        out
    }

    fn cfg1(s: RegistrySpec) -> FirewallConfig {
        FirewallConfig { registries: vec![s] }
    }

    #[test]
    fn reject_missing_dep() {
        let s = spec(1);
        let tx = UnsignedTxLike { cell_deps: vec![], outputs: vec![] };
        let err = check_transaction(&cfg1(s), &tx, 0).unwrap_err();
        assert_eq!(err, FirewallError::MissingRegistryCellDep);
        assert_eq!(err.code(), 8);
    }

    #[test]
    fn reject_blacklisted_lock_args() {
        let s = spec(1);
        let dep = dep_for_spec(&s, build_registry(&[&[0xaa, 0xbb]]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep],
            outputs: vec![TxOutputLike { lock_args: vec![0xaa, 0xbb], type_args: None }],
        };
        let err = check_transaction(&cfg1(s), &tx, 0).unwrap_err();
        assert_eq!(err, FirewallError::BlacklistedLockArgs);
        assert_eq!(err.code(), 11);
    }

    #[test]
    fn reject_ambiguous_registry_dep() {
        let s = spec(1);
        let dep = dep_for_spec(&s, build_registry(&[&[0xaa]]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep.clone(), dep],
            outputs: vec![TxOutputLike { lock_args: vec![0x00], type_args: None }],
        };
        let err = check_transaction(&cfg1(s), &tx, 0).unwrap_err();
        assert_eq!(err, FirewallError::AmbiguousRegistryCellDep);
        assert_eq!(err.code(), 17);
    }

    #[test]
    fn reject_registry_not_sorted() {
        let s = spec(1);
        let dep = dep_for_spec(&s, build_registry(&[&[0xbb], &[0xaa]]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep],
            outputs: vec![TxOutputLike { lock_args: vec![0x00], type_args: None }],
        };
        let err = check_transaction(&cfg1(s), &tx, 0).unwrap_err();
        assert_eq!(err, FirewallError::RegistryNotSorted);
        assert_eq!(err.code(), 10);
    }

    #[test]
    fn reject_blacklisted_type_args() {
        let s = spec(1);
        let dep = dep_for_spec(&s, build_registry(&[&[0x55, 0x66]]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep],
            outputs: vec![TxOutputLike {
                lock_args: vec![0x11, 0x22],
                type_args: Some(vec![0x55, 0x66]),
            }],
        };
        let err = check_transaction(&cfg1(s), &tx, 0).unwrap_err();
        assert_eq!(err, FirewallError::BlacklistedTypeArgs);
        assert_eq!(err.code(), 12);
    }

    #[test]
    fn reject_v1_registry() {
        // On-chain contract and TypeScript SDK both reject BLKL v1; so do we.
        let mut data = Vec::new();
        data.extend_from_slice(b"BLKL");
        data.push(1); // version 1
        data.extend_from_slice(&0u32.to_le_bytes()); // entry_count = 0
        assert_eq!(
            parse_registry_payload(&data).unwrap_err(),
            FirewallError::InvalidRegistryData,
        );
    }

    #[test]
    fn reject_unknown_version() {
        let mut data = Vec::new();
        data.extend_from_slice(b"BLKL");
        data.push(3); // no such version
        data.extend_from_slice(&[0u8; 4]);
        assert_eq!(
            parse_registry_payload(&data).unwrap_err(),
            FirewallError::InvalidRegistryData,
        );
    }

    #[test]
    fn parse_v2_registry_with_governance_header() {
        let data = build_registry(&[&[0xaa, 0xbb]]);
        let payload = parse_registry_payload(&data).unwrap();
        assert_eq!(payload.version, 2);
        assert_eq!(payload.entries.len(), 1);
        let gh = payload.governance_header.unwrap();
        assert_eq!(gh.signer_count, 0);
    }

    #[test]
    fn expire_check_active() {
        let s = spec(1);
        // expires_at = 1000, now_secs = 999 → still active → blacklisted
        let dep = dep_for_spec(&s, build_registry_with_expiry(&[(&[0xaa], 1000)]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep],
            outputs: vec![TxOutputLike { lock_args: vec![0xaa], type_args: None }],
        };
        assert_eq!(
            check_transaction(&cfg1(s), &tx, 999).unwrap_err(),
            FirewallError::BlacklistedLockArgs,
        );
    }

    #[test]
    fn expire_check_expired() {
        let s = spec(1);
        // expires_at = 1000, now_secs = 1000 → expired → not blacklisted
        let dep = dep_for_spec(&s, build_registry_with_expiry(&[(&[0xaa], 1000)]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep],
            outputs: vec![TxOutputLike { lock_args: vec![0xaa], type_args: None }],
        };
        assert!(check_transaction(&cfg1(s), &tx, 1000).is_ok());
    }

    #[test]
    fn permanent_entry_always_blacklisted() {
        let s = spec(1);
        // expires_at = 0 → permanent, never expires
        let dep = dep_for_spec(&s, build_registry_with_expiry(&[(&[0xbb], 0)]));
        let tx = UnsignedTxLike {
            cell_deps: vec![dep],
            outputs: vec![TxOutputLike { lock_args: vec![0xbb], type_args: None }],
        };
        assert_eq!(
            check_transaction(&cfg1(s), &tx, u64::MAX).unwrap_err(),
            FirewallError::BlacklistedLockArgs,
        );
    }

    #[test]
    fn multi_registry_both_checked() {
        let s1 = spec(1);
        let s2 = spec(2);
        let dep1 = dep_for_spec(&s1, build_registry(&[&[0x11]]));
        let dep2 = dep_for_spec(&s2, build_registry(&[&[0x22]]));
        let firewall_cfg = FirewallConfig { registries: vec![s1, s2] };
        // output is blacklisted in registry 2
        let tx = UnsignedTxLike {
            cell_deps: vec![dep1, dep2],
            outputs: vec![TxOutputLike { lock_args: vec![0x22], type_args: None }],
        };
        assert_eq!(
            check_transaction(&firewall_cfg, &tx, 0).unwrap_err(),
            FirewallError::BlacklistedLockArgs,
        );
    }

    #[test]
    fn multi_registry_missing_required() {
        let s1 = spec(1);
        let s2 = spec(2); // required, no matching dep provided
        let dep1 = dep_for_spec(&s1, build_registry(&[]));
        let firewall_cfg = FirewallConfig { registries: vec![s1, s2] };
        let tx = UnsignedTxLike { cell_deps: vec![dep1], outputs: vec![] };
        assert_eq!(
            check_transaction(&firewall_cfg, &tx, 0).unwrap_err(),
            FirewallError::MissingRegistryCellDep,
        );
    }

    #[test]
    fn multi_registry_optional_miss_ok() {
        let s1 = spec(1);
        let mut s2 = spec(2);
        s2.required = false; // optional — missing dep is fine
        let dep1 = dep_for_spec(&s1, build_registry(&[]));
        let firewall_cfg = FirewallConfig { registries: vec![s1, s2] };
        let tx = UnsignedTxLike {
            cell_deps: vec![dep1],
            outputs: vec![TxOutputLike { lock_args: vec![0x99], type_args: None }],
        };
        assert!(check_transaction(&firewall_cfg, &tx, 0).is_ok());
    }

    #[test]
    fn v2_trailing_data_rejected() {
        let mut data = build_registry(&[&[0xaa]]);
        data.push(0xff); // trailing garbage byte
        assert_eq!(
            parse_registry_payload(&data).unwrap_err(),
            FirewallError::InvalidRegistryData,
        );
    }
}
