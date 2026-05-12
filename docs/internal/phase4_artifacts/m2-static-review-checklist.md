# M2: Static review checklist (blacklist-registry governance)

- [x] GOV1 witness precedence documented (`docs/governance.md`).
- [x] Signer threshold rules: bootstrap 5-of-5; update 3-of-5 (`blacklist_registry_tests.rs`).
- [x] Negative cases: duplicate signer index, out-of-range index, insufficient signers, root mismatch, unauthorized governance lock identity.
- [x] Production build guard: `dev-signer-keys` feature disallowed for production artifact path (`phase3_verify.sh` guard).
- [x] VM preflight script present (`scripts/check_registry_vm_compat.sh`).
- [x] Deployment preflight for governance lock identity (`scripts/phase3_governance_lock_preflight.sh`).

**Reviewer:** Repository maintainers (recorded at Phase 4 closure).  
**Date:** 2026-05-11 (UTC)
