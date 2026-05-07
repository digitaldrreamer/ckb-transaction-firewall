# Integration Tests

Integration tests validate full system behavior with real transaction assembly and RPC communication.

## Scope

- Deploy or reference firewall lock + registry artifacts.
- Build unsigned transactions through SDK pipeline.
- Submit safe transactions and assert successful inclusion.
- Submit blocked transactions and assert deterministic rejection.
- Verify registry update transaction changes enforcement outcome.

## Environment

- Preferred for CI: local CKB devnet (deterministic, fewer flakes).
- Optional / periodic smoke: public testnet (e.g. `https://testnet.ckb.dev`) for realistic network behavior.

## Minimum Scenario Matrix

- `safe_tx_before_update` -> pass.
- `blocked_tx_before_update` -> reject.
- `governance_add_entry` -> executed.
- `now_blocked_tx_after_update` -> reject.
- `governance_remove_entry` -> executed.
- `previously_blocked_tx_after_removal` -> pass.

## Artifacts

Each run should emit:

- tx hashes,
- rejection reasons or error codes,
- registry version before/after,
- environment metadata for reproducibility.

For governance-specific testnet drills, use the artifact format in:

- `tests/integration/governance_drill/template.json`
- validated by `scripts/phase3_governance_drill_check.sh`
