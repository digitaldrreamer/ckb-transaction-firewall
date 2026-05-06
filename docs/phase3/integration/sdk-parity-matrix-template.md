# SDK Parity Matrix (Template)

Ensure TypeScript SDK, Rust SDK, and on-chain contract semantics align.

| Scenario | Expected Code/Result | TypeScript SDK | Rust SDK | On-Chain Reference | Status |
|---|---|---|---|---|---|
| Missing registry dep | `8` | pass/fail | pass/fail | firewall-lock | pass/fail |
| Ambiguous registry dep | `17` | pass/fail | pass/fail | firewall-lock | pass/fail |
| Invalid registry payload | `9` | pass/fail | pass/fail | firewall-lock | pass/fail |
| Unsorted registry entries | `10` | pass/fail | pass/fail | firewall-lock | pass/fail |
| Blacklisted lock args | `11` | pass/fail | pass/fail | firewall-lock | pass/fail |
| Blacklisted type args | `12` | pass/fail | pass/fail | firewall-lock | pass/fail |

## Evidence

- TypeScript test run:
- Rust test run:
- Contract integration test run:
- Notes:
