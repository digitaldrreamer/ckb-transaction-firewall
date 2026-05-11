# Governance drill — live execution (Phase 4)

## Purpose

Re-run or refresh **chain-backed** governance drill evidence under the same rules enforced on `main` in CI:

- `tests/integration/governance_drill/latest.json`
- `tests/integration/governance_drill/mode2_signer_state.json`
- `tests/integration/governance_drill/chain_status_latest.json`

## Prerequisites

- `ckb-cli` installed (CI uses **v1.15.0** via `scripts/ci/install_ckb_cli.sh`; match or document variance).
- `jq`, `bash`, Rust toolchain as in repository README.
- Funded testnet accounts and signer separation policy for Mode 2 (see `scripts/phase3_governance_prereq_check.sh` and `scripts/phase3_governance_mode2.sh`).
- Network access to `CKB_RPC_URL` (default `https://testnet.ckb.dev`).

## One-command live autorun

Full scenario submission and evidence refresh:

```bash
./scripts/phase4_governance_autorun_live.sh --auto-from-tx-files
```

This prepares missing transaction files, submits scenarios, refreshes drill JSON, runs `phase4_governance_evidence_check.sh`, and updates chain status.

## Incremental commands

| Step | Command |
|------|---------|
| Validate drill JSON schema | `./scripts/phase3_governance_drill_check.sh tests/integration/governance_drill/latest.json` |
| Chain-verify all hashes committed | `./scripts/phase4_governance_evidence_check.sh tests/integration/governance_drill/latest.json` |
| Refresh `chain_status_latest.json` (polls until committed/rejected) | `./scripts/phase4_governance_tx_status.sh` |
| Full closeout including Phase 4 gate | `REAL_GOV_EVIDENCE_REQUIRED=1 ./scripts/phase3_closeout_check.sh` |

## Failure handling

- **`Tx hash is not chain-committed`:** Wait for testnet inclusion, then re-run `phase4_governance_tx_status.sh`. If permanently rejected, regenerate the scenario tx via autorun and update `latest.json`.
- **Synthetic evidence marker:** Remove forbidden phrases from scenario `notes` in `latest.json` (`phase4_governance_evidence_check.sh` rejects deterministic/synthetic markers).
- **RPC errors:** Retry with a stable RPC endpoint; set `CKB_RPC_URL` consistently for evidence check and status polling.

## Rollback

- Revert `tests/integration/governance_drill/*.json` to the last known-good commit.
- Re-run `phase3_governance_drill_check.sh` only (without `REAL_GOV_EVIDENCE_REQUIRED`) for local debugging — **do not** use this relaxed posture on `main` merges.

## Related Phase 3 runbooks

- [docs/phase3/runbooks/deployment-runbook.md](../phase3/runbooks/deployment-runbook.md)
- [docs/phase3/runbooks/governance-incident-playbook.md](../phase3/runbooks/governance-incident-playbook.md)
