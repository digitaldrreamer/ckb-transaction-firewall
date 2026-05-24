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
    pub registry_script: ScriptLike,
}

#[derive(Debug, Clone)]
pub struct RegistryEntry {
    pub identifier: Vec<u8>,
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

fn resolve_registry_dep<'a>(
    deps: &'a [CellDepLike],
    expected: &ScriptLike,
) -> Result<&'a CellDepLike, FirewallError> {
    let mut matched: Option<&CellDepLike> = None;
    for dep in deps {
        if dep.type_script.as_ref() == Some(expected) {
            if matched.is_some() {
                return Err(FirewallError::AmbiguousRegistryCellDep);
            }
            matched = Some(dep);
        }
    }
    matched.ok_or(FirewallError::MissingRegistryCellDep)
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

fn parse_registry_payload(data: &[u8]) -> Result<RegistryPayload, FirewallError> {
    if data.len() < 9 {
        return Err(FirewallError::InvalidRegistryData);
    }
    if &data[0..4] != b"BLKL" {
        return Err(FirewallError::InvalidRegistryData);
    }
    let version = data[4];

    match version {
        0x01 => {
            // v1: BLKL(4) + version(1) + entry_count(4 LE) + entries
            let count = u32::from_le_bytes([data[5], data[6], data[7], data[8]]) as usize;
            let (entries, end) = parse_entries(data, 9, count)?;
            if end != data.len() {
                return Err(FirewallError::InvalidRegistryData);
            }
            Ok(RegistryPayload { version: 1, entries, governance_header: None })
        }
        0x02 => {
            // v2: BLKL(4) + version(1) + gov_header_len(2 LE) + gov_header(N) + entry_count(4 LE) + entries
            if data.len() < 7 {
                return Err(FirewallError::InvalidRegistryData);
            }
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
            let (entries, _) = parse_entries(data, entries_start + 4, count)?;
            Ok(RegistryPayload { version: 2, entries, governance_header: Some(governance_header) })
        }
        _ => Err(FirewallError::InvalidRegistryData),
    }
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

pub fn check_transaction(cfg: &FirewallConfig, tx: &UnsignedTxLike) -> Result<(), FirewallError> {
    let dep = resolve_registry_dep(&tx.cell_deps, &cfg.registry_script)?;
    let payload = parse_registry_payload(&dep.data)?;
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

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

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_script(tag: u8) -> ScriptLike {
        ScriptLike {
            code_hash: [tag; 32],
            hash_type: HashType::Type,
            args: vec![tag],
        }
    }

    fn build_registry_v1(ids: &[&[u8]]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"BLKL");
        out.push(1);
        out.extend_from_slice(&(ids.len() as u32).to_le_bytes());
        for id in ids {
            out.push(id.len() as u8);
            out.extend_from_slice(id);
            out.extend_from_slice(&0u64.to_le_bytes());
        }
        out
    }

    // Minimal v2 registry: no signers, zero validator root.
    fn build_registry_v2(ids: &[&[u8]]) -> Vec<u8> {
        // governance header: gh_version(1)=1 | signer_count(1)=0 | threshold(1)=0 | validator_count(2 LE)=0 | merkle_root(32)=0s
        let gov_header: Vec<u8> = {
            let mut h = vec![0x01u8, 0x00, 0x00, 0x00, 0x00]; // version, signer_count, threshold, validator_count LE
            h.extend_from_slice(&[0u8; 32]); // merkle_root
            h
        };
        let gov_len = gov_header.len() as u16;
        let mut out = Vec::new();
        out.extend_from_slice(b"BLKL");
        out.push(2);
        out.extend_from_slice(&gov_len.to_le_bytes());
        out.extend_from_slice(&gov_header);
        out.extend_from_slice(&(ids.len() as u32).to_le_bytes());
        for id in ids {
            out.push(id.len() as u8);
            out.extend_from_slice(id);
            out.extend_from_slice(&0u64.to_le_bytes());
        }
        out
    }

    fn build_registry(ids: &[&[u8]]) -> Vec<u8> {
        build_registry_v2(ids)
    }

    #[test]
    fn reject_missing_dep() {
        let cfg = FirewallConfig {
            registry_script: test_script(1),
        };
        let tx = UnsignedTxLike {
            cell_deps: vec![],
            outputs: vec![],
        };
        let err = check_transaction(&cfg, &tx).unwrap_err();
        assert_eq!(err, FirewallError::MissingRegistryCellDep);
        assert_eq!(err.code(), 8);
    }

    #[test]
    fn reject_blacklisted_lock_args() {
        let cfg = FirewallConfig {
            registry_script: test_script(1),
        };
        let tx = UnsignedTxLike {
            cell_deps: vec![CellDepLike {
                type_script: Some(test_script(1)),
                data: build_registry(&[&[0xaa, 0xbb]]),
            }],
            outputs: vec![TxOutputLike {
                lock_args: vec![0xaa, 0xbb],
                type_args: None,
            }],
        };
        let err = check_transaction(&cfg, &tx).unwrap_err();
        assert_eq!(err, FirewallError::BlacklistedLockArgs);
        assert_eq!(err.code(), 11);
    }

    #[test]
    fn reject_ambiguous_registry_dep() {
        let cfg = FirewallConfig {
            registry_script: test_script(1),
        };
        let dep = CellDepLike {
            type_script: Some(test_script(1)),
            data: build_registry(&[&[0xaa]]),
        };
        let tx = UnsignedTxLike {
            cell_deps: vec![dep.clone(), dep],
            outputs: vec![TxOutputLike {
                lock_args: vec![0x00],
                type_args: None,
            }],
        };
        let err = check_transaction(&cfg, &tx).unwrap_err();
        assert_eq!(err, FirewallError::AmbiguousRegistryCellDep);
        assert_eq!(err.code(), 17);
    }

    #[test]
    fn reject_registry_not_sorted() {
        let cfg = FirewallConfig {
            registry_script: test_script(1),
        };
        let tx = UnsignedTxLike {
            cell_deps: vec![CellDepLike {
                type_script: Some(test_script(1)),
                data: build_registry(&[&[0xbb], &[0xaa]]),
            }],
            outputs: vec![TxOutputLike {
                lock_args: vec![0x00],
                type_args: None,
            }],
        };
        let err = check_transaction(&cfg, &tx).unwrap_err();
        assert_eq!(err, FirewallError::RegistryNotSorted);
        assert_eq!(err.code(), 10);
    }

    #[test]
    fn reject_blacklisted_type_args() {
        let cfg = FirewallConfig {
            registry_script: test_script(1),
        };
        let tx = UnsignedTxLike {
            cell_deps: vec![CellDepLike {
                type_script: Some(test_script(1)),
                data: build_registry(&[&[0x55, 0x66]]),
            }],
            outputs: vec![TxOutputLike {
                lock_args: vec![0x11, 0x22],
                type_args: Some(vec![0x55, 0x66]),
            }],
        };
        let err = check_transaction(&cfg, &tx).unwrap_err();
        assert_eq!(err, FirewallError::BlacklistedTypeArgs);
        assert_eq!(err.code(), 12);
    }

    #[test]
    fn parse_v1_registry_backward_compat() {
        let data = build_registry_v1(&[&[0x01], &[0x02]]);
        let payload = super::parse_registry_payload(&data).unwrap();
        assert_eq!(payload.version, 1);
        assert_eq!(payload.entries.len(), 2);
        assert!(payload.governance_header.is_none());
    }

    #[test]
    fn parse_v2_registry_with_governance_header() {
        let data = build_registry_v2(&[&[0xaa, 0xbb]]);
        let payload = super::parse_registry_payload(&data).unwrap();
        assert_eq!(payload.version, 2);
        assert_eq!(payload.entries.len(), 1);
        assert!(payload.governance_header.is_some());
        let gh = payload.governance_header.unwrap();
        assert_eq!(gh.signer_count, 0);
    }

    #[test]
    fn reject_unknown_version() {
        let mut data = build_registry_v1(&[]);
        data[4] = 0x03; // unsupported version
        assert_eq!(
            super::parse_registry_payload(&data).unwrap_err(),
            FirewallError::InvalidRegistryData,
        );
    }
}
