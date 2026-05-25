use crate::errors::FirewallError;
use crate::registry::parse_registry_payload;
use crate::types::{CellDepLike, FirewallConfig, RegistryEntry, RegistryPayload, RegistrySpec, TxOutputLike, UnsignedTxLike};

// ── private helpers ───────────────────────────────────────────────────────────

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

fn search_entries(entries: &[RegistryEntry], target: &[u8], now_secs: u64) -> bool {
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

// ── public API ────────────────────────────────────────────────────────────────

/// Returns `true` if `target` appears as an active (non-expired) entry in any
/// of the given registry payloads at time `now_secs`.
///
/// Uses binary search; entries must be in ascending lexicographic order (as
/// enforced by [`parse_registry_payload`](crate::parse_registry_payload)).
pub fn is_blacklisted(target: &[u8], registries: &[RegistryPayload], now_secs: u64) -> bool {
    registries.iter().any(|reg| search_entries(&reg.entries, target, now_secs))
}

/// Check a slice of transaction outputs against already-parsed registry payloads.
///
/// Returns the first blacklist error found, or `Ok(())` if all outputs are clean.
/// No registry resolution is performed — call [`check_transaction`] when you
/// have an `UnsignedTxLike`, or use this function when you have already fetched
/// and parsed the registry payloads yourself.
pub fn preflight_check(
    outputs: &[TxOutputLike],
    registries: &[RegistryPayload],
    now_secs: u64,
) -> Result<(), FirewallError> {
    for out in outputs {
        if is_blacklisted(&out.lock_args, registries, now_secs) {
            return Err(FirewallError::BlacklistedLockArgs);
        }
        if let Some(type_args) = &out.type_args {
            if is_blacklisted(type_args, registries, now_secs) {
                return Err(FirewallError::BlacklistedTypeArgs);
            }
        }
    }
    Ok(())
}

/// Pre-flight blacklist check for an unsigned CKB transaction.
///
/// Resolves registry cell deps specified in `cfg`, parses each BLKL v2 payload,
/// and checks every transaction output's lock and type args against active
/// (non-expired) blacklist entries.
///
/// `now_secs` is the current time in Unix seconds. Pass the chain's median time
/// for consensus-accurate expiry evaluation, or `SystemTime::now()` as seconds
/// for off-chain pre-flight use.
///
/// Returns `Ok(())` if the transaction is not blacklisted.
pub fn check_transaction(
    cfg: &FirewallConfig,
    tx: &UnsignedTxLike,
    now_secs: u64,
) -> Result<(), FirewallError> {
    let resolved = resolve_registry_deps(&tx.cell_deps, &cfg.registries)?;
    let mut payloads = Vec::new();
    for slot in resolved.into_iter().flatten() {
        payloads.push(parse_registry_payload(&slot.data)?);
    }
    preflight_check(&tx.outputs, &payloads, now_secs)
}
