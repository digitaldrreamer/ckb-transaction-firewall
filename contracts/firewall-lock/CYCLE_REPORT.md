# Firewall Lock Cycle Report

## Scope

- Contract: `contracts/firewall-lock`
- Binary: `target/riscv64imac-unknown-none-elf/release/firewall-lock`
- Test harness: `tests/unit/tests/firewall_lock_tests.rs`

## Environment

- Rust toolchain:
- CKB debugger version:
- Machine:
- Date:

## Commands

```bash
cd contracts/firewall-lock
./build.sh

# Optional: run integration tests first
cd ../../tests/unit
cargo test --test firewall_lock_tests
```

```bash
# Back in firewall-lock directory
cd ../../contracts/firewall-lock
./profile-cycles.sh
```

The script records happy-path cycle variants using `ckb-testtool` `verify_tx()` and updates this report.

## Results

| Scenario | Expected Result | Cycles Used | Notes |
|---|---|---:|---|
| invalid args layout | reject (5) |  |  |
| unsupported version | reject (6) |  |  |
| unsupported flags | reject (7) |  |  |
| missing registry dep | reject (8) |  |  |
| invalid registry data | reject (9) |  |  |
| registry not sorted | reject (10) |  |  |
| blacklisted lock args | reject (11) |  |  |
| blacklisted type args | reject (12) |  |  |
| ambiguous registry dep | reject (17) |  |  |
| happy path (lock-only) | pass |  | ckb-testtool verify_tx() cycle probe |
| happy path (type-only) | pass |  | ckb-testtool verify_tx() cycle probe |
| happy path (both-checks) | pass |  | ckb-testtool verify_tx() cycle probe |
| happy path (large registry, 512 entries, both-checks) | pass |  | ckb-testtool verify_tx() cycle probe |
| happy path (very large registry, 2000 entries, both-checks) | pass |  | ckb-testtool verify_tx() cycle probe |

## Targets

- Soft target: < 10,000,000 cycles for typical happy-path tx
- Hard cap used in tests: 70,000,000 cycles

## Follow-ups

- [ ] Add median-time expiry integration scenario cycle entry
- [ ] Add stress scenario (large registry payload) cycle entry
- [ ] Add testnet sample transaction cycle entry
