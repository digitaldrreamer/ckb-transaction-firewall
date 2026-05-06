# Governance Drill Artifacts

This folder defines the evidence format for Phase 3 governance end-to-end drills on testnet.

## Files

- `template.json`: required scenario matrix and schema shape.
- `latest.json`: operator-produced latest run evidence (not committed until executed).

## Required Scenario IDs

- `bootstrap_0_to_1`
- `update_1_to_1`
- `negative_invalid_signer_set`
- `negative_invalid_root_binding`

## Status Rules

- Allowed values: `pass`, `fail`, `pending`.
- For `pass`/`fail`, `tx_hash` must be set to a 0x-prefixed 32-byte hash.
- `pending` is only valid before execution and fails the Phase 3 governance gate.
