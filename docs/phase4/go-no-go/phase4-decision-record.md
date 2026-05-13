# Phase 4 go / no-go decision record

## Decision

**GO**: Phase 4 governance hardening closure criteria met for the evidence posture defined in [verification-status.md](../verification-status.md) and [verification-requirements-matrix.md](../verification-requirements-matrix.md).

## Preconditions verified

| Check | Evidence |
|-------|----------|
| Live testnet txs for all drill scenarios | [latest.json](../../../tests/integration/governance_drill/latest.json) |
| Signer separation (Mode 2) | [mode2_signer_state.json](../../../tests/integration/governance_drill/mode2_signer_state.json) |
| Chain status all committed | [chain_status_latest.json](../../../tests/integration/governance_drill/chain_status_latest.json) |
| Phase 4 CI gate on `main` | [.github/workflows/tests.yml](../../../.github/workflows/tests.yml) + [m4-ci-gate-proof.md](../../internal/phase4_artifacts/m4-ci-gate-proof.md) |
| Security trackers green | [docs/phase4/security/findings-tracker.md](../security/findings-tracker.md), [docs/phase3/security/findings-tracker.md](../../phase3/security/findings-tracker.md) |
| Milestone artifacts M1–M5 | [phase4 milestone evidence](../../internal/phase4_artifacts/) |

## Risk acceptance

| Risk | Mitigation |
|------|------------|
| Testnet RPC / CI flakiness | Pinned `ckb-cli`; committed hashes; operator rerunbook |
| Non-gate matrix items (BWC, witness-003, drill-002 review) | Tracked in [docs/phase4/verification-status.md](../verification-status.md); waive with staged rollout if needed |

## Approvals

| Role | Name | Signature / Date |
|------|------|------------------|
| Maintainer | Repository maintainers | 2026-05-11 UTC: **GO** |

## References

- ADR: [ADR-Phase4-Governance-Verification.md](../adr/ADR-Phase4-Governance-Verification.md)
- Security sign-off: [m5-security-signoff.md](../../internal/phase4_artifacts/m5-security-signoff.md)
