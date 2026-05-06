# Phase 3 Plan: Deployment and Operational Hardening

This checklist tracks Phase 3 execution from key finalization through mainnet rollout.

## Workstreams

- Protocol/Contracts
- SDK/Integration
- Governance/Ops
- Security

## Checklist

### 1. Signer Key Cutover
- [ ] Generate production 5-signer pubkey set.
- [ ] Replace placeholder keys in `contracts/blacklist-registry/src/main.rs`.
- [ ] Remove/disable `dev-signer-keys` in release workflow.
- [ ] Update test vectors for production key set.
- [ ] Document key custody and signer operational policy.

Owner: Protocol/Contracts  
Acceptance criteria:
- Release build works without dev keys.
- Updated tests pass.
- Custody/process document reviewed.
Evidence links:
- Build log:
- Commit(s):
- Key policy doc:

### 2. Deterministic Build and Artifact Lock
- [ ] Build both contracts reproducibly for `riscv64imac-unknown-none-elf`.
- [ ] Record code hashes and binary sizes.
- [ ] Commit signed artifact manifest (hash, size, command, commit SHA).

Owner: Protocol/Contracts  
Acceptance criteria:
- Reproducible outputs confirmed across two clean runs.
- Artifact manifest committed and reviewed.
Evidence links:
- Artifact manifest:
- Build command record:
- Verification run output:

### 3. Cycle and Stress Validation
- [ ] Profile hot paths in `firewall-lock` and `blacklist-registry`.
- [ ] Run stress tests for large registry sizes and witness extremes.
- [ ] Define and document supported operational bounds.

Owner: Protocol/Contracts  
Acceptance criteria:
- Benchmark report committed.
- Bounds documented in docs/README.
Evidence links:
- Benchmark report:
- Stress test output:
- Bounds doc update:

### 4. Governance End-to-End Drill
- [ ] Bootstrap flow (`0 -> 1`) executed on testnet.
- [ ] Normal update flow (`1 -> 1`) executed on testnet.
- [ ] Invalid signer/update negative cases verified rejected.
- [ ] Record tx hashes and outcomes.

Owner: Governance/Ops  
Acceptance criteria:
- Pass/fail matrix fully green.
- Traceable tx evidence recorded.
Evidence links:
- Testnet tx hashes:
- Pass/fail matrix:
- Drill notes:

### 5. SDK and Contract Integration Gate
- [ ] Confirm SDK preflight logic matches on-chain parsing/hash rules.
- [ ] Add contract-version compatibility checks in SDK.
- [ ] Run integration suite against deployed testnet contracts.

Owner: SDK/Integration  
Acceptance criteria:
- Integration suite passes against deployed contracts.
- Compatibility checks active and tested.
Evidence links:
- Integration run:
- Compatibility check PR:
- SDK release note:

### 6. Security Hardening
- [ ] External review/audit performed.
- [ ] Findings triaged and fixed.
- [ ] Residual risks documented with explicit waivers.

Owner: Security  
Acceptance criteria:
- No open critical/high findings.
- Medium/low findings tracked or waived with rationale.
Evidence links:
- Audit report:
- Findings tracker:
- Waiver doc:

### 7. Operational Runbooks
- [ ] Deployment runbook finalized.
- [ ] Emergency key rotation runbook finalized.
- [ ] Governance incident response playbook finalized.
- [ ] Dry-run performed by non-implementer.

Owner: Governance/Ops  
Acceptance criteria:
- All runbooks reviewed and dry-run validated.
Evidence links:
- Deployment runbook:
- Rotation runbook:
- Incident playbook:
- Dry-run notes:

### 8. Release Candidate Freeze
- [ ] Freeze `BLKL`/`GOV1` formats, error codes, and thresholds.
- [ ] RC branch/tag created.
- [ ] Change policy switched to bugfix-only.

Owner: Protocol/Contracts  
Acceptance criteria:
- RC tag present.
- Freeze notice documented.
Evidence links:
- RC tag:
- Freeze decision record:
- Policy update:

### 9. Testnet Soak
- [ ] Run 7–14 day soak with realistic traffic/update cadence.
- [ ] Monitor failure rate, false rejects, cycle regression.
- [ ] Resolve blockers before go/no-go.

Owner: SDK/Integration  
Acceptance criteria:
- SLOs met for soak window.
- No unresolved blocker defects.
Evidence links:
- Soak dashboard/report:
- Incident log:
- Final soak summary:

### 10. Mainnet Go/No-Go
- [ ] Go/No-Go review held with evidence from all gates.
- [ ] Staged rollout plan approved (canary wallets first).
- [ ] Post-deploy verification report completed.

Owner: Governance/Ops  
Acceptance criteria:
- Signed go/no-go decision.
- Successful staged rollout and verification.
Evidence links:
- Decision record:
- Rollout checklist:
- Post-deploy report:

## Release Gates (Must Pass)

- [ ] G1 Security: No open high/critical findings.
- [ ] G2 Correctness: Governance pass/fail matrix green.
- [ ] G3 Performance: Cycle budgets within defined limits.
- [ ] G4 Operability: Runbooks dry-run validated.
- [ ] G5 Compatibility: SDK and contracts version-locked and tested.

## Status Snapshot

Phase: Phase 3  
Overall status: Not started  
Last updated: 2026-05-06  
Owner of this plan file: TBD

