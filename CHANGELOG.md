# Changelog

## 2026-04-26

### Phase 1: Firewall Lock Script Implementation

**Core Implementation (Completed)**:
- Implemented complete firewall lock script in Rust using ckb-std
- Lock args parsing with frozen v1 layout (72 + N + M bytes)
- Registry cell dep selection with exactly-one-match rule
- Blacklist membership checking with binary search (O(log n))
- Temporary entry expiry using median time calculation
- Inner lock delegation via spawn syscall
- Comprehensive error handling (codes 5-17)
- 24 unit tests covering all major code paths

**Technical Details**:
- Added `Cargo.toml` with optimized release profile
- Implemented `FirewallLockArgs::parse()` with layout validation
- Implemented `RegistryPayload::parse()` with magic/version checks
- Implemented `find_registry_cell_dep()` for deterministic registry selection
- Implemented `get_median_time()` using header_deps timestamps
- Implemented `delegate_to_inner_lock()` using spawn_cell
- All frozen v1 error codes properly implemented

**Testing**:
- 24 comprehensive unit tests (all passing)
- 10 `ckb-testtool` integration tests run against the real compiled contract binary
- Integration coverage includes invalid args/version/flags, missing/invalid/unsorted/ambiguous registry deps, blacklisted output lock/type args, and a non-blacklisted happy path

**Documentation**:
- Created IMPLEMENTATION.md with architecture and data flow
- Created GAPS_ANALYSIS.md with remaining work and risk assessment
- Documented all public APIs and error codes
- Added inline documentation throughout

**Remaining Work**:
- Binary compilation (needs Rust + capsule environment)
- Complete integration tests with compiled binary
- Cycle profiling and optimization
- Registry type script implementation
- Production deployment testing

### Integration + profiling follow-up

- Extended `ckb-testtool` integration suite to 10 passing tests, adding:
  - `AmbiguousRegistryCellDep` (`17`) rejection case
  - non-blacklisted happy-path pass case
- Added cycle profiling scaffold:
  - `contracts/firewall-lock/CYCLE_REPORT.md`
  - `contracts/firewall-lock/profile-cycles.sh`
- Added automated happy-path cycle probe:
  - `test_cycle_probe_happy_path_lock_only` emits `CYCLE_PROBE_HAPPY_PATH_LOCK_ONLY=<n>`
  - `test_cycle_probe_happy_path_type_only` emits `CYCLE_PROBE_HAPPY_PATH_TYPE_ONLY=<n>`
  - `test_cycle_probe_happy_path_both_checks` emits `CYCLE_PROBE_HAPPY_PATH_BOTH_CHECKS=<n>`
  - `test_cycle_probe_happy_path_large_registry_both_checks` emits `CYCLE_PROBE_HAPPY_PATH_LARGE_REGISTRY_BOTH_CHECKS=<n>`
  - `test_cycle_probe_happy_path_very_large_registry_both_checks` emits `CYCLE_PROBE_HAPPY_PATH_VERY_LARGE_REGISTRY_BOTH_CHECKS=<n>`
  - `profile-cycles.sh` runs all probes and auto-updates report
- Updated phase-status docs to reflect binary build success and integration pass rate.

## 2026-04-20

### Scaffold

- Scaffolded repository structure from `README.md` with core folders and markdown placeholders.

### Docs enrichment

- Expanded architecture, lock script spec, and governance docs with v1-ready detail.
- Expanded tests, integration scope, and scripts documentation including CLI direction.
- Expanded contract and SDK module READMEs with responsibilities and security properties.

### Policy freeze pass

- Frozen governance voting model to 9 active validators with one-validator-one-vote and explicit per-proposal thresholds.
- Added emergency temporary-add-only policy with 6-hour minimum vote window, 72-hour TTL, and ratification requirement.
- Switched lock spec to stable registry identity matching with exact dep uniqueness rule (zero/multiple matches fail).
- Frozen V1 lock args layout and public custom error constants starting at code 5.

### Full consistency pass

- Updated remaining docs to align with stable registry identity + exactly-one dep-selection rule.
- Replaced residual outdated wording and aligned validator lifecycle policy details.
- Synced SDK/contract/script/test docs to canonical error semantics (including `AmbiguousRegistryCellDep`).

### PR review follow-up

- Registry identity: use CKB type script triple in lock args and SDK examples; remove redundant type-hash + args-hash pairing.
- Error codes: drop unused `RegistryIdentityMismatch`; renumber public constants 9–17.
- Emergency TTL: specify `expires_at` + median-time evaluation in lock spec and governance docs.

### CodeRabbit nitpick pass

- README: normative governance tables moved to `governance/voting.md` / `docs/governance.md` only.
- Integration tests: local devnet as default for CI; testnet for periodic smoke.
- Module READMEs: emergency scope + registry dep-selection invariants; pinned public error codes in unit test doc.
- `CHANGELOG` consolidated under one date; scripts README wording tweak.
- `docs/governance.md`: split frozen lifecycle vs v2 refinement items to avoid contradictory “open decisions” list.
