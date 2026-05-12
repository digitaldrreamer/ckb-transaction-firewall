# Security findings tracker (Phase 4, governance)

## Summary

- Open critical (governance scope): **0**
- Open high (governance scope): **0**
- Open medium: **0**
- Open low: **0**

## Scope note

This tracker records **Phase 4 governance authorization** findings (GOV1, signer threshold, witness parsing, registry update path). Project-wide Phase 3 findings remain in [docs/phase3/security/findings-tracker.md](../phase3/security/findings-tracker.md).

## Findings

| ID | Severity | Component | Status | Notes |
|----|----------|------------|--------|-------|
| (none) | (none) | (none) | (none) | No open items at Phase 4 closure (2026-05-11 UTC). |

## Gate rule

Phase 4 closure requires:

- Zero open **Critical** or **High** governance findings in this tracker at decision time.
- Chain-backed drill evidence passing `scripts/phase4_governance_evidence_check.sh` on pinned `ckb-cli` (see `docs/internal/phase4_artifacts/m4-ci-gate-proof.md`).
