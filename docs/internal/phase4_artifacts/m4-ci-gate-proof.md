# M4: CI gate proof (Phase 4 chain-backed governance)

## What is enforced

On `main` and on pull requests targeting `main`, GitHub Actions job **Tests** (`/.github/workflows/tests.yml`):

1. Installs **pinned** `ckb-cli` via `scripts/ci/install_ckb_cli.sh` (`CKB_CLI_VERSION=v1.15.0`).
2. Runs `./scripts/phase3_closeout_check.sh` with:
   - `REAL_GOV_EVIDENCE_REQUIRED=1`
   - `CKB_RPC_URL=https://testnet.ckb.dev`

That invokes:

- `scripts/phase4_governance_evidence_check.sh` requires every scenario `tx_hash` in `tests/integration/governance_drill/latest.json` to resolve as **committed** on testnet.
- Stricter `chain_status_latest.json` validation: every scenario must show `tx_status.status == "committed"`.

## How to obtain a run link

After pushing to `main`, open the latest successful **Tests** workflow run for commit `HEAD` and attach the URL here (optional archival step):

- GitHub: `Actions` → workflow **Tests** → select the run → copy URL.

## Local proof (development)

```bash
REAL_GOV_EVIDENCE_REQUIRED=1 CKB_RPC_URL=https://testnet.ckb.dev ./scripts/phase3_closeout_check.sh
```

Expected: all checks PASS including `G2 real chain-backed governance evidence valid (phase4 gate)`.
