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
pub struct RegistryPayload {
    pub version: u8,
    pub entries: Vec<RegistryEntry>,
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

fn parse_registry_payload(data: &[u8]) -> Result<RegistryPayload, FirewallError> {
    if data.len() < 9 {
        return Err(FirewallError::InvalidRegistryData);
    }
    if &data[0..4] != b"BLKL" {
        return Err(FirewallError::InvalidRegistryData);
    }
    if data[4] != 0x01 {
        return Err(FirewallError::InvalidRegistryData);
    }

    let count = u32::from_le_bytes([data[5], data[6], data[7], data[8]]) as usize;
    let mut offset = 9usize;
    let mut entries = Vec::with_capacity(count);

    for _ in 0..count {
        if offset >= data.len() {
            return Err(FirewallError::InvalidRegistryData);
        }
        let id_len = data[offset] as usize;
        offset += 1;
        if offset + id_len + 8 > data.len() {
            return Err(FirewallError::InvalidRegistryData);
        }
        let identifier = data[offset..offset + id_len].to_vec();
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
        if entries[i].identifier <= entries[i - 1].identifier {
            return Err(FirewallError::RegistryNotSorted);
        }
    }

    Ok(RegistryPayload {
        version: 1,
        entries,
    })
}

pub fn check_transaction(cfg: &FirewallConfig, tx: &UnsignedTxLike) -> Result<(), FirewallError> {
    let dep = resolve_registry_dep(&tx.cell_deps, &cfg.registry_script)?;
    let payload = parse_registry_payload(&dep.data)?;

    for out in &tx.outputs {
        if payload
            .entries
            .iter()
            .any(|entry| entry.identifier == out.lock_args)
        {
            return Err(FirewallError::BlacklistedLockArgs);
        }
        if let Some(type_args) = &out.type_args {
            if payload
                .entries
                .iter()
                .any(|entry| &entry.identifier == type_args)
            {
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

    fn build_registry(ids: &[&[u8]]) -> Vec<u8> {
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
}
