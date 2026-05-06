# Governance Drill Artifacts

This folder defines the evidence format for Phase 3 governance end-to-end drills on testnet.

## Files

- `template.json`: required scenario matrix and schema shape.
- `latest.json`: operator-produced latest run evidence (not committed until executed).

## Execution Workflow (Testnet)

1. Ensure CKB operator tools are installed on the execution host:
   - `ckb-cli`
   - `capsule` (if rebuilding artifacts on same host)
2. Initialize latest artifact:
   - `scripts/phase3_governance_drill_update.sh init`
3. Execute each drill scenario on testnet and capture tx hash + outcome.
4. Record each scenario outcome:
   - `scripts/phase3_governance_drill_update.sh set --id <scenario_id> --status <pass|fail> --tx-hash 0x... --notes "..."`
5. Validate completion gate:
   - `scripts/phase3_governance_drill_update.sh validate`

## Required Scenario IDs

- `bootstrap_0_to_1`
- `update_1_to_1`
- `negative_invalid_signer_set`
- `negative_invalid_root_binding`

## Status Rules

- Allowed values: `pass`, `fail`, `pending`.
- For `pass`/`fail`, `tx_hash` must be set to a 0x-prefixed 32-byte hash.
- `pending` is only valid before execution and fails the Phase 3 governance gate.
