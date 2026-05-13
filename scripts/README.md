# Scripts

Operational scripts for builds, verification, deployment, and governance evidence.

## Common Commands

```bash
# Reproducible contract build manifest
./scripts/phase3_repro_build.sh

# Contract tests, cycle probes, and compatibility checks
./scripts/phase3_verify.sh

# Deploy contracts to CKB testnet
./scripts/deploy.sh --network testnet --rpc-url https://testnet.ckb.dev --from-address <ckt1...>

# Validate committed governance drill evidence
REAL_GOV_EVIDENCE_REQUIRED=1 CKB_RPC_URL=https://testnet.ckb.dev ./scripts/phase3_closeout_check.sh
```

Testnet deployment and SDK registry wiring are documented in [docs/deployments/testnet.md](../docs/deployments/testnet.md).

## Build and Verification

| Script | Purpose |
|---|---|
| `phase3_repro_build.sh` | Builds both contracts twice and writes deterministic artifact manifests under `docs/internal/phase3_artifacts/`. |
| `phase3_verify.sh` | Runs contract tests, cycle probes, registry size gates, and production-guard checks. |
| `phase3_compat_check.sh` | Checks frozen v1 constants and docs/spec alignment. |
| `phase3_closeout_check.sh` | Aggregates release evidence, security docs, governance drill status, and release checklist presence. |
| `phase3_status_report.sh` | Writes a markdown snapshot of closeout status. |

## Deployment

| Script | Purpose |
|---|---|
| `deploy.sh` | Builds and deploys contract artifacts with optional dry-run and strict governance-lock modes. |
| `scripts/ci/install_ckb_cli.sh` | Installs the pinned `ckb-cli` used by CI. |

`deploy.sh --dry-run` still refreshes `deploy/info.json`; existing files are rotated to backups.

## Governance Evidence

| Script | Purpose |
|---|---|
| `phase3_governance_drill_check.sh` | Validates `tests/integration/governance_drill/latest.json`. |
| `phase3_governance_mode2.sh` | Records and validates signer separation policy for drill scenarios. |
| `phase3_governance_drill_update.sh` | Updates drill scenario status and tx hashes. |
| `phase3_governance_prereq_check.sh` | Checks local `ckb-cli`, RPC, and account prerequisites. |
| `phase4_governance_evidence_check.sh` | Requires chain-backed, committed testnet tx hashes. |
| `phase4_governance_tx_status.sh` | Refreshes tx status evidence. |
| `phase4_governance_autorun_live.sh` | Runs live governance drill scenarios from operator tx commands or tx files. |
| `phase4_prepare_tx_files.sh` | Prepares standard governance tx JSON files from `deploy/info.json`. |
| `phase4_submit_tx.sh` | Signs and submits a tx JSON file with retry handling. |

`phase4_prepare_tx_files.sh` supports funded-account top-ups through `FROM_ACCOUNT` / `TOPUP_FROM_ACCOUNT`, non-interactive signing via `TOPUP_PRIVKEY_PATH`, and `SKIP_AUTO_TOPUP=1` for manual cell preparation.

## CI Gate

On `main` and PRs targeting `main`, `.github/workflows/tests.yml` runs:

```bash
REAL_GOV_EVIDENCE_REQUIRED=1 CKB_RPC_URL=https://testnet.ckb.dev ./scripts/phase3_closeout_check.sh
```

Feature branches run the same checker in report-only mode for non-chain evidence.
