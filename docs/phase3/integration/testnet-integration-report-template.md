# Testnet Integration Report (Template)

## Context

- Date (UTC):
- Environment:
- RPC endpoint:
- Deployed script identities:

## Test Matrix

| Scenario | Expected | Observed | Status | Evidence |
|---|---|---|---|---|
| safe_tx_before_update | pass | pass/fail | pass/fail | tx hash/log |
| blocked_tx_before_update | reject | pass/fail | pass/fail | tx hash/log |
| governance_add_entry | executed | pass/fail | pass/fail | tx hash/log |
| now_blocked_tx_after_update | reject | pass/fail | pass/fail | tx hash/log |
| governance_remove_entry | executed | pass/fail | pass/fail | tx hash/log |
| previously_blocked_tx_after_removal | pass | pass/fail | pass/fail | tx hash/log |

## SDK vs On-Chain Parity

- SDK decision summary:
- On-chain result summary:
- Parity: `matched` / `mismatch`

## Outcome

- Integration gate: `pass` / `fail`
- Notes:
