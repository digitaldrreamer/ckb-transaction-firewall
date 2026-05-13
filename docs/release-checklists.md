# Release checklists

Use this file for testnet/mainnet readiness reviews. Link concrete evidence instead of creating new one-off template files.

## Go / No-Go

| Gate | Status | Evidence |
|---|---|---|
| Security findings | pass/fail | `docs/phase3/security/findings-tracker.md`, `docs/phase4/security/findings-tracker.md` |
| Contract + SDK tests | pass/fail | CI run, local logs, or release artifact |
| Governance drill | pass/fail | `tests/integration/governance_drill/latest.json` |
| Artifact manifest | pass/fail | `docs/internal/phase3_artifacts/ARTIFACT_MANIFEST_LATEST.md` |
| Deployment dry run | pass/fail | operator transcript or tx hashes |

Decision: `GO` / `NO-GO`

Conditions or accepted risks:

## Signer custody

- Confirm active signer set and fingerprints.
- Verify pubkey set against the registry contract source.
- Keep production signing keys off shared hosts.
- Require independent tx review before signing GOV1 updates.
- Record signer index usage, proposal reference, and tx hash.

## Rollout

- Verify contract identities and registry cell outpoint.
- Run SDK preflight and on-chain samples for safe and blocked destinations.
- Start with a canary wallet cohort.
- Monitor rejection rates, cycle regressions, RPC failures, and governance tx status.
- Archive tx hashes, logs, and final sign-off.

## Testnet soak

| Metric | Target | Observed | Status |
|---|---|---|---|
| Failure rate | no unexpected failures |  | pass/fail |
| False reject rate | zero known false rejects |  | pass/fail |
| Cycle regression | within budget |  | pass/fail |

Recommendation: `promote` / `hold`

## SDK parity

| Scenario | Expected | TypeScript | Rust | On-chain |
|---|---|---|---|---|
| Missing registry dep | `8` | pass/fail | pass/fail | pass/fail |
| Ambiguous registry dep | `17` | pass/fail | pass/fail | pass/fail |
| Invalid registry payload | `9` | pass/fail | pass/fail | pass/fail |
| Unsorted registry entries | `10` | pass/fail | pass/fail | pass/fail |
| Blacklisted lock args | `11` | pass/fail | pass/fail | pass/fail |
| Blacklisted type args | `12` | pass/fail | pass/fail | pass/fail |

