# Phase 4 Production Hardening Plan

Date context: 2026-05-07
Repository: `ckb-transaction-firewall`

## 1) Problem Statement and Current State
- Phase 3 is complete for verification/process gates, but production governance guarantees are not complete.
- Current governance flow uses deterministic evidence mode for drill execution and structural signer checks in the registry path.
- The original on-chain cryptographic governance verification path failed on testnet with CKB-VM `InvalidInstruction` during live transaction execution.
- Temporary compatibility changes enabled delivery continuity but reduced production security assurances for governance authorization.
- Production launch is blocked until cryptographic governance verification is restored and validated end-to-end on-chain.

## 2) Non-Negotiable Production Requirements
- Governance authorization must be cryptographically verified on-chain for every privileged registry mutation.
- No production workflow may rely on deterministic evidence mode as a substitute for live on-chain governance execution.
- Governance drill scenarios must be executed as real testnet/mainnet-like transactions with chain-verifiable hashes.
- Runtime compatibility must be proven on target CKB VM/runtime used by deployment network.
- All critical governance failure modes must be covered by negative tests with expected error codes and on-chain proof.
- CI closeout gate for production branches must fail if any governance evidence is synthetic/deterministic-only.
- Security review must explicitly sign off on governance bypass resistance and witness parsing correctness.

## 3) Scope Boundaries
### In Scope
- Redesign and implementation of VM-compatible on-chain cryptographic governance verification.
- Witness format and validation hardening for `GOV1` governance payload processing.
- End-to-end strict governance drill execution using live transactions.
- CI and closeout gate updates to enforce real transaction-backed governance evidence.
- Documentation updates for operator runbooks and governance procedures.

### Out of Scope
- New business policy semantics unrelated to governance authorization correctness.
- Wallet UX redesign or account-management UX improvements.
- Non-governance feature additions in firewall or SDK unless required by governance hardening.
- Mainnet release execution itself.

## 4) Milestones and Exit Criteria

## Milestone M1: Root Cause + Design Freeze
- Objective: identify exact VM/runtime incompatibility cause and select approved verification design.
- Exit criteria:
- One accepted design decision record under `docs/phase4/adr/`.
- Repro case proving prior `InvalidInstruction` and explanation of instruction path.
- Approved implementation strategy that avoids unsupported/unsafe instruction patterns.
- Evidence artifacts:
- `docs/phase4/adr/ADR-Phase4-Governance-Verification.md`
- `phase4_artifacts/m1-invalid-instruction-repro.md`
- `phase4_artifacts/m1-design-review-signoff.md`

## Milestone M2: VM-Compatible Cryptographic Verification Implementation
- Objective: implement on-chain cryptographic signer verification compatible with target CKB VM.
- Exit criteria:
- Registry contract enforces cryptographic signer authenticity for bootstrap/update paths.
- Structural-only fallback paths disabled for production mode.
- Unit and integration tests cover signer validity, threshold, duplicate, out-of-range, and root-binding mismatch.
- Evidence artifacts:
- `phase4_artifacts/m2-test-results.txt`
- `contracts/blacklist-registry/CYCLE_REPORT.md` updated with new governance-path cycles.
- `phase4_artifacts/m2-static-review-checklist.md`

## Milestone M3: Live Governance Drill Reinstatement
- Objective: execute all governance scenarios using real chain transactions.
- Exit criteria:
- `bootstrap_0_to_1` executed with required signer threshold and committed tx hash.
- `update_1_to_1` executed with required signer threshold and committed tx hash.
- `negative_invalid_signer_set` rejected on-chain with expected failure evidence.
- `negative_invalid_root_binding` rejected on-chain with expected failure evidence.
- No deterministic placeholders accepted in final evidence file.
- Evidence artifacts:
- `tests/integration/governance_drill/latest.json` with committed tx hashes and final statuses.
- `tests/integration/governance_drill/mode2_signer_state.json` with verified signer separation.
- `phase4_artifacts/m3-chain-verification.log`

## Milestone M4: Production Gate Hardening + Operational Readiness
- Objective: enforce production-only acceptance criteria in CI and runbooks.
- Exit criteria:
- CI blocks merges to production branch when governance evidence is non-chain-backed.
- Closeout checker validates live tx-backed governance evidence and rejects deterministic mode.
- Runbooks updated with exact operator commands, failure handling, and rollback paths.
- Evidence artifacts:
- `phase4_artifacts/m4-ci-gate-proof.md`
- `docs/phase4/runbooks/governance-drill-live-execution.md`
- `phase4_artifacts/m4-dry-run-transcript.md`

## Milestone M5: Security Review and Launch Readiness Decision
- Objective: obtain explicit security acceptance for governance model.
- Exit criteria:
- Security findings tracker has zero open Critical/High for governance enforcement.
- Independent reviewer confirms no practical governance bypass path.
- Go/No-Go decision record signed with risk acceptances documented.
- Evidence artifacts:
- `docs/phase4/security/findings-tracker.md`
- `docs/phase4/go-no-go/phase4-decision-record.md`
- `phase4_artifacts/m5-security-signoff.md`

## 5) Risks and Mitigations
- Risk: VM compatibility regressions reappear under testnet/mainnet runtime differences.
- Mitigation: mandatory live testnet execution checkpoint in every milestone after M2.
- Risk: governance witness parsing ambiguity creates bypass opportunities.
- Mitigation: canonical parser rules, strict bounds checks, fuzz/property tests, and negative-case matrix.
- Risk: cycle growth from cryptographic verification exceeds acceptable limits.
- Mitigation: cycle budget targets, benchmark gates, and optimization pass before M3 close.
- Risk: operator workflow complexity causes mis-signed governance txs.
- Mitigation: scripted command generation, signer checklist, and dry-run rehearsal protocol.
- Risk: CI passes while real chain execution fails.
- Mitigation: CI stage requiring replay/verification against live tx hashes and on-chain status checks.

## 6) Deliverables Mapped to Owners
- Workstream A (Contract Security): VM-compatible on-chain cryptographic governance verification implementation and tests.
- Workstream B (Execution Tooling): governance tx constructor/executor for live chain drills with signer-separation support.
- Workstream C (Verification & CI): production gate updates enforcing real chain evidence and regression checks.
- Workstream D (Operations): runbooks, drill SOPs, rollback procedures, and signer custody operationalization.
- Workstream E (Security Review): threat review, findings closure, and final signoff artifacts.

## 7) Definition of Done
- Governance-critical mutations are cryptographically enforced on-chain in production configuration.
- All required governance drill scenarios are executed with real committed transaction hashes and validated artifacts.
- Deterministic evidence mode is disallowed in production acceptance gates.
- CI and closeout checks enforce production governance evidence requirements on protected branches.
- Security review reports zero open Critical/High governance findings.
- Phase 4 go/no-go record is approved and archived with complete traceable artifacts.

## 8) Closure record (archived)

- Requirement-to-evidence index: [verification-status.md](verification-status.md)
- Decision record: [go-no-go/phase4-decision-record.md](go-no-go/phase4-decision-record.md)
- Milestone artifacts: [../../phase4_artifacts/](../../phase4_artifacts/)
