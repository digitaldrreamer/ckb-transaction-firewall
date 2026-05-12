# Blacklist Registry Cycle Report

## Scope

- Contract: `contracts/blacklist-registry`
- Binary: `target/riscv64imac-unknown-none-elf/release/blacklist-registry`
- Integration harness: `tests/unit/tests/blacklist_registry_tests.rs` (ckb-testtool)

## Governance path (Phase 4)

Cycle micro-benchmarking for this contract is integrated with the **full unit + integration suite** executed by `scripts/phase3_verify.sh` (see `docs/internal/phase3_artifacts/cycles_*.log` from CI or local verification runs). Governance-heavy scenarios (GOV1 parsing, secp256k1 recovery, threshold checks) are covered by integration tests; aggregate **firewall + registry** cycle budgets for large-registry happy paths are enforced in `scripts/phase3_verify.sh` against the firewall lock `profile-cycles.sh` output (registry participates in joint verification fixtures where applicable).

## Policy

- **P4-VM-002:** Governance verification must remain within the same operational discipline as Phase 3 verification: no `InvalidInstruction` on target VM; regression coverage via `blacklist_registry_tests` and live testnet drills.
- **Production binary:** Built without `dev-signer-keys`; release RISC-V artifact used in governance drill preparation scripts.

## Commands

```bash
cd contracts/blacklist-registry
cargo build --locked --release --target=riscv64imac-unknown-none-elf

cd ../../tests/unit
cargo test --test blacklist_registry_tests
```

## Results snapshot

| Check | Status |
|-------|--------|
| `blacklist_registry_tests` (12 tests) | PASS (see `docs/internal/phase4_artifacts/m2-test-results.txt`) |
| Live governance drill VM execution | PASS (committed txs in `tests/integration/governance_drill/latest.json`) |

## Date

2026-05-11 (UTC), aligned with Phase 4 closure evidence refresh.
