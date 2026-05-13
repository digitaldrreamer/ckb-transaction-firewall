# M4: Dry-run transcript (operator rehearsal)

The following commands were executed successfully during Phase 4 closure (local environment, testnet RPC).

```text
$ ./scripts/phase4_governance_evidence_check.sh tests/integration/governance_drill/latest.json
Phase 4 governance evidence check passed (chain-verifiable tx hashes).

$ ./scripts/phase4_governance_tx_status.sh \
    --input tests/integration/governance_drill/latest.json \
    --out tests/integration/governance_drill/chain_status_latest.json
wrote chain status artifact: tests/integration/governance_drill/chain_status_latest.json

$ REAL_GOV_EVIDENCE_REQUIRED=1 CKB_RPC_URL=https://testnet.ckb.dev ./scripts/phase3_closeout_check.sh
Phase 3 closeout checks passed.
(including G2 real chain-backed governance evidence valid (phase4 gate))
```

**Notes**

- Requires `ckb-cli` on `PATH` and outbound HTTPS to `CKB_RPC_URL`.
- For full live drill execution (rebuilding scenario txs), use `scripts/phase4_governance_autorun_live.sh` per [docs/phase4/runbooks/governance-drill-live-execution.md](../../phase4/runbooks/governance-drill-live-execution.md).
