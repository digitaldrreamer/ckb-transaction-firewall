# Phase 4 Verification Requirements Matrix

| Requirement ID | Requirement statement | Verification method (test/static check/testnet drill/review) | Evidence artifact path | Pass criteria | Blocking severity if fail |
|---|---|---|---|---|---|
| P4-CRYPTO-001 | Registry governance update must enforce threshold signer cryptographic verification on-chain for authorized signer set. | test | tests/unit/tests/blacklist_registry_tests.rs | Positive/negative signer-threshold tests pass with cryptographic checks enabled. | Critical |
| P4-CRYPTO-002 | Bootstrap path must require strict 5-of-5 cryptographic signer verification. | test | tests/unit/tests/blacklist_registry_tests.rs | Bootstrap succeeds only with 5 valid signatures; any fewer fail with expected code. | Critical |
| P4-CRYPTO-003 | Duplicate signer indices in GOV1 payload must be rejected. | test | tests/unit/tests/blacklist_registry_tests.rs | Duplicate index scenario fails deterministically with expected error. | High |
| P4-CRYPTO-004 | Signer indices outside allowed range must be rejected. | test | tests/unit/tests/blacklist_registry_tests.rs | Out-of-range index scenario fails deterministically with expected error. | High |
| P4-WITNESS-001 | GOV1 parsing must accept `WitnessArgs.input_type` as primary governance payload location. | test | tests/unit/tests/blacklist_registry_tests.rs | Valid GOV1 in `input_type` path passes governance checks. | Critical |
| P4-WITNESS-002 | Fallback behavior to `WitnessArgs.lock` must be defined and validated without ambiguity. | test/review | docs/governance.md | Explicit tests and docs show deterministic precedence and no dual-source ambiguity. | High |
| P4-WITNESS-003 | Malformed GOV1 witness layout must fail with stable, documented error code. | test | tests/unit/tests/blacklist_registry_tests.rs | Corrupt/misaligned witness inputs always fail with expected code. | High |
| P4-VM-001 | Contract execution must avoid invalid instructions on target CKB-VM/testnet runtime. | testnet drill | tests/integration/governance_drill/latest.json | All governance scenarios execute without VM `InvalidInstruction` failures. | Critical |
| P4-VM-002 | Cycle usage for governance verification path must remain within agreed budget. | test/static check | contracts/firewall-lock/CYCLE_REPORT.md | Reported cycle probes stay within defined budget thresholds for release profile. | High |
| P4-BWC-001 | Backward compatibility: existing valid registry entries remain readable and enforceable after upgrade. | test | tests/unit/tests/firewall_lock_tests.rs | Historical/legacy-compatible fixtures still pass filtering checks. | High |
| P4-BWC-002 | Backward compatibility: unsupported legacy witness versions fail explicitly (no silent accept). | test | tests/unit/tests/blacklist_registry_tests.rs | Unsupported version tests fail with documented rejection behavior. | High |
| P4-DEPLOY-001 | Deployment script must verify governance lock identity compatibility before signing/apply. | static check/test | scripts/phase3_governance_lock_preflight.sh | Preflight blocks incompatible lock modes and allows compatible paths. | Critical |
| P4-DEPLOY-002 | Deployment flow must prevent stale `deploy/info.json` reuse from producing mismatched outpoints. | test/review | scripts/deploy.sh | Existing info files are rotated/invalidated and regenerated safely each run. | High |
| P4-DRILL-001 | Governance drill evidence must be based on real testnet transaction hashes for all required scenarios. | testnet drill | tests/integration/governance_drill/latest.json | Each required scenario has `status=pass` and a chain-resolvable tx hash. | Critical |
| P4-DRILL-002 | Mode-2 signer separation evidence must prove signer-set policy per scenario. | review/test | tests/integration/governance_drill/mode2_signer_state.json | Signer sets match policy: bootstrap 5-of-5, update 3-of-5, negatives invalid by design. | High |
| P4-CI-001 | CI must fail if governance drill evidence is pending/missing or syntactically invalid. | static check/test | .github/workflows/tests.yml | PR checks fail on pending drill artifacts or schema violations. | Critical |
| P4-CI-002 | CI must enforce phase closeout checks on protected branches. | static check | .github/workflows/tests.yml | Protected-branch runs block merge on any closeout failure. | Critical |
| P4-DOC-001 | Documentation must match implementation behavior for governance verification mode (no stale claims). | review | docs/governance.md | No contradictions between docs and current verifier/runtime behavior. | High |
| P4-DOC-002 | Script/operator docs must reflect whether flows are deterministic evidence mode or real on-chain mode. | review | scripts/README.md | Operator instructions accurately represent execution semantics and limitations. | High |
| P4-SEC-001 | Open Critical/High security findings must be zero at release decision point. | review | docs/phase3/security/findings-tracker.md | No unresolved Critical/High findings; waivers documented and approved if any. | Critical |

## Minimum Release Gate

The following requirements are mandatory to declare Phase 4 production-ready:

- P4-CRYPTO-001
- P4-CRYPTO-002
- P4-WITNESS-001
- P4-VM-001
- P4-DEPLOY-001
- P4-DRILL-001
- P4-CI-001
- P4-CI-002
- P4-SEC-001
- P4-DOC-001

All items above must be in passing state with current evidence artifacts attached in-repo and verifiable in CI/testnet context.
