# Release checklists

Use this file for testnet/mainnet readiness reviews. Link concrete evidence instead of creating new one-off template files.

## Go / No-Go

**Review date:** 2026-05-14 UTC  
**Reviewer:** digitaldrreamer

| Gate | Status | Evidence |
|---|---|---|
| Security findings | pass | `docs/phase3/security/findings-tracker.md` (0 open Critical/High), `docs/phase4/security/findings-tracker.md` (0 open Critical/High); M5 sign-off `docs/internal/phase4_artifacts/m5-security-signoff.md` |
| Contract + SDK tests | pass | 12/12 blacklist-registry tests (`docs/internal/phase4_artifacts/m2-test-results.txt`); TypeScript SDK vitest suite (all pass); CI gate on `main` (`docs/internal/phase4_artifacts/m4-ci-gate-proof.md`) |
| Governance drill | pass | All 4 scenarios committed on testnet (`tests/integration/governance_drill/chain_status_latest.json`, generated 2026-05-11T22:35:27Z): bootstrap_0_to_1 `0xd0a36fe8`, update_1_to_1 `0xd08a788b`, negative_invalid_signer_set `0x94f75545`, negative_invalid_root_binding `0xb402d2fd` |
| Artifact manifest | pass | `docs/internal/phase3_artifacts/ARTIFACT_MANIFEST_LATEST.md` — firewall-lock SHA256 `7c2f6dfb`, blacklist-registry SHA256 `fd704f21`; 2 clean deterministic build rounds |
| Deployment dry run | pass | Operator transcript in `docs/internal/phase4_artifacts/m4-dry-run-transcript.md`: `phase4_governance_evidence_check.sh`, `phase4_governance_tx_status.sh`, and `phase3_closeout_check.sh` (with `REAL_GOV_EVIDENCE_REQUIRED=1`) all passed |

Decision: `GO`

Conditions or accepted risks:

- Testnet RPC availability and rate limits can cause CI flakiness; mitigated by pinned `ckb-cli` v1.15.0 (SHA256-verified), committed tx hashes, and operator retry runbook.
- Governance bypass resistance relies on correct signer custody and lock identity configuration; operator responsibility outside this repository.
- The `blacklist-registry` build artifact in the Phase 3 manifest uses `--features dev-signer-keys`. A separate production manifest with production signer keys is required before any mainnet promotion.

## Signer custody

- Active signer: `digitaldrreamer`, lock arg `0x3f54dea35bcc7a0efef541d361799f77bd1b8581`.
- Testnet address: `ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqfl2n02xk7v0g80aa2p6dshn8mhh5dctqgwcrfdk`.
- Verify pubkey against registry contract source before signing any GOV1 update.
- Keep production signing keys off shared hosts.
- Require independent tx review before signing GOV1 updates.
- Record signer index usage, proposal reference, and tx hash for each governance action.

## Rollout

- Verify contract identities and registry cell outpoint against `docs/deployments/testnet.registry.json`.
- Run SDK preflight (`TransactionFirewall.checkTransaction`) with safe and blocked destinations against the live registry cell.
- Start with a canary wallet cohort.
- Monitor rejection rates, cycle regressions, RPC failures, and governance tx status.
- Archive tx hashes, logs, and final sign-off.

## Testnet soak

Evidence source: `tests/integration/governance_drill/chain_status_latest.json` (2026-05-11T22:35:27Z).

| Metric | Target | Observed | Status |
|---|---|---|---|
| Failure rate | no unexpected failures | 0 unexpected failures across 4 drill scenarios | pass |
| False reject rate | zero known false rejects | 0 false rejects; negative scenarios rejected as expected | pass |
| Cycle regression | within budget | within budget per `contracts/blacklist-registry/CYCLE_REPORT.md` and `scripts/phase3_verify.sh` | pass |

Recommendation: `promote`

## SDK parity

Evidence: TypeScript vitest suite (`sdk/typescript/`); Rust unit tests (`tests/unit/tests/firewall_lock_tests.rs`); on-chain confirmed via drill scenarios and M2 test log.

| Scenario | Expected | TypeScript | Rust | On-chain |
|---|---|---|---|---|
| Missing registry dep | `8` | pass | pass | pass |
| Ambiguous registry dep | `17` | pass | pass | pass |
| Invalid registry payload | `9` | pass | pass | pass |
| Unsorted registry entries | `10` | pass | pass | pass |
| Blacklisted lock args | `11` | pass | pass | pass |
| Blacklisted type args | `12` | pass | pass | pass |
