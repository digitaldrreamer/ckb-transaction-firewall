use crate::errors::FirewallError;
use crate::types::{
    DepType, FirewallLockConfig, FirewallSpendDepsConfig, ScriptLike, TransactionCellDep,
};

/// Encode the v2 `FirewallLockArgs` byte layout from a [`FirewallLockConfig`].
///
/// Layout:
/// `version(1)=0x02 | flags(1) | registry_count(1) |
/// [code_hash(32) | hash_type(1) | type_id_value(32) | required(1)]×N |
/// inner_code_hash(32) | inner_hash_type(1) | inner_args_len(2 LE) | inner_args(M)`
///
/// # Errors
/// - `InvalidRegistryData` if `flags` has no check bits set or has reserved bits set.
/// - `InvalidRegistryData` if `registries.len() > 255`.
/// - `InvalidRegistryData` if `inner_args.len() > 65535`.
pub fn build_firewall_lock_args(config: &FirewallLockConfig) -> Result<Vec<u8>, FirewallError> {
    if (config.flags & 0x03) == 0 {
        return Err(FirewallError::InvalidRegistryData);
    }
    if config.flags & 0xfc != 0 {
        return Err(FirewallError::InvalidRegistryData);
    }
    if config.registries.len() > 255 {
        return Err(FirewallError::InvalidRegistryData);
    }
    if config.inner_args.len() > 0xffff {
        return Err(FirewallError::InvalidRegistryData);
    }
    let n = config.registries.len();
    let mut out = Vec::with_capacity(3 + n * 66 + 32 + 1 + 2 + config.inner_args.len());
    out.push(0x02);
    out.push(config.flags);
    out.push(n as u8);
    for reg in &config.registries {
        out.extend_from_slice(&reg.code_hash);
        out.push(reg.hash_type.to_byte());
        out.extend_from_slice(&reg.type_id_value);
        out.push(if reg.required { 1 } else { 0 });
    }
    out.extend_from_slice(&config.inner_code_hash);
    out.push(config.inner_hash_type.to_byte());
    let inner_len = config.inner_args.len() as u16;
    out.extend_from_slice(&inner_len.to_le_bytes());
    out.extend_from_slice(&config.inner_args);
    Ok(out)
}

/// Build the complete firewall lock script from a [`FirewallLockConfig`].
///
/// The returned [`ScriptLike`] can be used directly as the lock script of a
/// new CKB output cell.
pub fn build_firewall_lock_script(config: &FirewallLockConfig) -> Result<ScriptLike, FirewallError> {
    Ok(ScriptLike {
        code_hash: config.firewall_code_hash,
        hash_type: config.firewall_hash_type.clone(),
        args: build_firewall_lock_args(config)?,
    })
}

/// Assemble the cell deps required for spending a firewall-protected cell.
///
/// Returns (in order):
/// 1. The firewall-lock code cell.
/// 2. The inner lock code cell.
/// 3. One entry per registry data cell in `config.registry_out_points`.
///
/// Registry outpoints move after each governance update — always fetch fresh
/// values before calling this function.
pub fn build_firewall_spend_cell_deps(config: &FirewallSpendDepsConfig) -> Vec<TransactionCellDep> {
    let mut deps = Vec::with_capacity(2 + config.registry_out_points.len());
    deps.push(TransactionCellDep {
        out_point: config.firewall_lock_out_point.clone(),
        dep_type: DepType::Code,
    });
    deps.push(TransactionCellDep {
        out_point: config.inner_lock_out_point.clone(),
        dep_type: DepType::Code,
    });
    for op in &config.registry_out_points {
        deps.push(TransactionCellDep { out_point: op.clone(), dep_type: DepType::Code });
    }
    deps
}
