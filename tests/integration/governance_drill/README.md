# Governance Drill Artifacts

This folder defines the evidence format for Phase 3 governance end-to-end drills on testnet.

## Files

- `template.json`: required scenario matrix and schema shape.
- `latest.json`: operator-produced latest run evidence.
- `mode2_signer_state.json`: strict mode (option 2) signer-separation evidence.

## Execution Workflow (Strict Mode: option 2)

1. Ensure CKB operator tools are installed on the execution host:
   - `ckb-cli`
   - Node.js (for `scripts/update-blacklist.ts`)
2. Initialize artifacts:
   - `scripts/phase3_governance_mode2.sh init`
3. Execute each drill scenario on testnet and capture tx hash + signer set:
   - `scripts/phase3_governance_mode2.sh run --id <scenario_id> --signers "0,1,2" --cmd "..."`
4. Validate completion gate:
   - `scripts/phase3_governance_mode2.sh validate`

## Required Scenario IDs

- `bootstrap_0_to_1`
- `update_1_to_1`
- `negative_invalid_signer_set`
- `negative_invalid_root_binding`

## Status Rules

- Allowed values: `pass`, `fail`, `pending`.
- For `pass`/`fail`, `tx_hash` must be set to a 0x-prefixed 32-byte hash.
- `pending` is only valid before execution and fails the Phase 3 governance gate.

## Strict Mode-2 Signer Rules

- `bootstrap_0_to_1`: must use signer indexes exactly `0,1,2,3,4`.
- `update_1_to_1`: must use at least 3 unique signer indexes from `[0..4]`.
- negative scenarios must declare at least one signer index for audit traceability.
