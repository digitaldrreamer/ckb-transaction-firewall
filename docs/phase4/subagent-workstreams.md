# Phase 4 Subagent Workstreams Blueprint

## Overview
Phase 4 restores production-grade governance assurance by replacing the current compatibility fallback with CKB-VM-safe, on-chain cryptographic verification and real testnet transaction evidence. Work is decomposed into isolated workstreams with explicit ownership, hard gates, and integration sequencing to avoid cross-agent conflicts.

## Workstream WS1: VM-Safe Crypto Verification Redesign
- Objective
  - Produce a CKB-VM-compatible governance signature verification design that avoids unsupported/fragile instruction paths and preserves security properties.
- Context snapshot needed
  - Current governance witness format (`GOV1` in `WitnessArgs.input_type`), signer threshold semantics, known VM failure pattern (`InvalidInstruction`), existing registry script constraints.
- Inputs
  - Current contract architecture and governance spec.
  - Prior failure traces from testnet execution.
  - Cycle constraints and script size limits.
- Outputs
  - Architecture decision record for verifier approach.
  - Threat model delta and security invariants.
  - Migration/compatibility plan for witness format (if needed).
- Hard requirements
  - No reliance on VM-unsafe instruction behavior.
  - Maintains signer threshold and root-binding invariants.
  - Explicit backward-compatibility policy documented.
- Verification checklist
  - Design reviewed against VM constraints.
  - Adversarial cases enumerated (replay, signer substitution, malformed witness, root mismatch).
  - Cycle budget estimate documented.
- Acceptance gate
  - Signed-off redesign doc with implementable interface and test vectors.
- Dependencies
  - None.
- Suggested role type
  - Explorer.

## Workstream WS2: Contract Implementation (Governance Verification)
- Objective
  - Implement WS1 design in on-chain contract(s) and remove structural-only fallback from production path.
- Context snapshot needed
  - WS1 ADR, current `blacklist-registry` logic, error-code mapping, cycle report expectations.
- Inputs
  - WS1 outputs.
  - Existing unit/integration test harness.
- Outputs
  - Contract code updates for cryptographic verification.
  - Updated error handling and explicit fail modes.
  - Updated cycle report entries.
- Hard requirements
  - On-chain cryptographic verification enforced for governance updates.
  - Deterministic behavior for malformed/invalid signatures.
  - No regression in existing non-governance checks.
- Verification checklist
  - Full unit suite pass.
  - New positive and negative cryptographic tests pass.
  - Cycle probe remains within declared budget or budget update justified.
- Acceptance gate
  - All contract tests green and review confirms production path is cryptographic, not structural fallback.
- Dependencies
  - WS1.
- Suggested role type
  - Worker.

## Workstream WS3: Testnet Real-Tx Drill Restoration
- Objective
  - Replace deterministic evidence-only flow with real testnet governance drill execution and recorded on-chain evidence.
- Context snapshot needed
  - Current drill schema (`latest.json`, mode2 signer evidence), deployment outputs, account/lock setup, RPC reliability assumptions.
- Inputs
  - WS2 deployable contract binaries.
  - Testnet-funded operator and governance signer setup.
- Outputs
  - Real tx-backed drill results for bootstrap/update/negative scenarios.
  - Updated drill artifacts with committed tx hashes and statuses.
- Hard requirements
  - Each scenario result traceable to resolvable on-chain tx hash.
  - Negative scenarios prove expected rejections using real execution paths.
  - No synthetic hash generation in production drill mode.
- Verification checklist
  - `get_transaction` confirms status for recorded hashes.
  - Scenario outcomes match expected pass/fail semantics.
  - Drill validator passes with real evidence mode enabled.
- Acceptance gate
  - Governance drill passes with only real tx-backed evidence.
- Dependencies
  - WS2.
- Suggested role type
  - Worker.

## Workstream WS4: CLI/Automation Hardening
- Objective
  - Harden scripts/automation around deploy, governance tx construction, RPC retries, live-cell checks, and failure diagnostics.
- Context snapshot needed
  - Existing scripts and known failure modes (RPC flakiness, stale outpoints, CLI format mismatches).
- Inputs
  - WS2 and WS3 execution requirements.
  - Existing script suite and CI workflow behavior.
- Outputs
  - Robust script/tooling updates for real governance execution.
  - Clear error taxonomy and actionable messages.
  - Retry/backoff and preflight checks where appropriate.
- Hard requirements
  - No silent fallback to deterministic evidence in production mode.
  - Idempotent/restart-safe execution for partial failures.
  - Script behavior documented and CI-compatible.
- Verification checklist
  - Happy path and at least 3 failure-injection paths tested.
  - Re-run safety validated after interrupted run.
  - Output artifacts consistent and machine-parseable.
- Acceptance gate
  - End-to-end automation succeeds from clean state and from recoverable partial state.
- Dependencies
  - WS2 (for tx semantics), WS3 (for field validation).
- Suggested role type
  - Worker.

## Workstream WS5: Docs and Runbook Alignment
- Objective
  - Align governance/docs/runbooks with final Phase 4 behavior and remove ambiguity around fallback vs production paths.
- Context snapshot needed
  - Final WS2–WS4 behavior, operator steps, failure modes, and recovery playbooks.
- Inputs
  - Updated scripts, contract semantics, and drill evidence process.
- Outputs
  - Updated governance docs.
  - Updated script README/runbooks for production and drill operations.
  - Explicit “non-production fallback” policy section (if retained at all).
- Hard requirements
  - Documentation matches implementation exactly.
  - Operator instructions are executable as-written.
  - Security claims constrained to what code enforces.
- Verification checklist
  - Doc-to-command walkthrough succeeds on fresh operator environment.
  - Terminology consistency across governance, scripts, and closeout docs.
  - Peer review confirms no stale fallback claims.
- Acceptance gate
  - Docs sign-off from implementation owners and ops reviewer.
- Dependencies
  - WS2, WS3, WS4.
- Suggested role type
  - Worker.

## Workstream WS6: Final Closeout Evidence and Release Gate
- Objective
  - Produce final Phase 4 evidence package proving production-readiness criteria are met.
- Context snapshot needed
  - Closeout checker criteria, CI outputs, governance drill evidence, cycle/profiling outputs, security tracker state.
- Inputs
  - WS3 real tx evidence.
  - WS4 hardened automation outputs.
  - WS5 updated docs.
- Outputs
  - Final evidence report.
  - Updated closeout status artifact.
  - Go/No-Go recommendation record.
- Hard requirements
  - Zero synthetic governance evidence in final gate.
  - Security tracker reflects current residual risks and dispositions.
  - Reproducible artifact references included.
- Verification checklist
  - `phase3/phase4` verification scripts pass under release profile.
  - Closeout check passes on branch and CI.
  - Evidence links resolve to committed artifacts.
- Acceptance gate
  - Formal Go decision with all required checks passing.
- Dependencies
  - WS3, WS4, WS5.
- Suggested role type
  - Worker.

## Parallelization Plan
- Can run in parallel
  - WS1 and preparatory inventory for WS4 (failure catalog only, no behavior changes).
  - WS5 outline drafting (structure only) while WS2/WS4 in flight.
- Must run sequentially
  - WS2 after WS1 sign-off.
  - WS3 after WS2 deployable artifacts exist.
  - WS4 behavior-finalization after WS2, and validated alongside WS3.
  - WS5 final content after WS2–WS4 stabilize.
  - WS6 last.

## Integration Order
1. WS1 redesign approval.
2. WS2 implementation merged behind feature branch gate.
3. WS4 hardening merged (with production-mode constraints).
4. WS3 real-tx drill execution and evidence generation.
5. WS5 documentation/runbook synchronization.
6. WS6 closeout package and final Go/No-Go.

## Conflict-Avoidance Rules (Disjoint File Ownership)
- WS1 owner scope
  - `docs/phase4/adr/*`, threat model docs only.
- WS2 owner scope
  - `contracts/blacklist-registry/**` and directly related unit tests.
- WS3 owner scope
  - `tests/integration/governance_drill/**` evidence schema/content, drill-specific test harness.
- WS4 owner scope
  - `scripts/phase*_governance*`, `scripts/deploy.sh`, CI workflow segments tied to automation execution.
- WS5 owner scope
  - `docs/governance.md`, `scripts/README.md`, `docs/phase4/runbooks/**`.
- WS6 owner scope
  - `phase*_artifacts/**`, closeout checker docs/reports.
- Cross-workstream rules
  - No agent edits outside owned paths without explicit handoff note.
  - Shared interface changes require a short contract note (inputs/outputs/error codes) before merge.
  - No force-push/rewrite on shared branch during active parallel execution windows.
