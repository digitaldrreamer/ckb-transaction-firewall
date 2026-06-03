# Rust Examples

Runnable demo showing the CKB Transaction Firewall in a backend Rust service. Fetches the **live testnet registry** from `https://testnet.ckb.dev`; nothing is mocked.

## Prerequisites

- **Rust 1.70 or later** (MSRV)
- An internet connection (hits the CKB testnet RPC)

## Run

```bash
cargo run --bin preflight_service
```

## Environment variables

| Variable | Default | Notes |
|----------|---------|-------|
| (none) | — | RPC URL is hardcoded to `https://testnet.ckb.dev` in this example |

To use a different RPC, edit `RPC_URL` at the top of `src/bin/preflight_service.rs`.

## What this example demonstrates

### `preflight_service` — Backend transaction service with firewall check

Models a custodian or relayer service that receives unsigned transaction candidates, checks each one against the live registry, and only forwards clean transactions to the signing queue. Blacklisted destinations are rejected before signing is ever attempted.

Shows all three SDK outcomes:
- **`candidate-payment: accepted for signing`** — recipient is not blacklisted
- **`blacklisted-payment: rejected before signing`** — recipient is in the live registry
- **`missing-registry-dep: rejected fail-closed`** — transaction missing the registry cell dep

If the live registry has no active entries, the blacklisted-payment branch is reported as unavailable rather than fabricated.

**SDK patterns:** `FirewallConfig`, `RegistrySpec`, `check_transaction`, `parse_registry_payload`, manual RPC calls with `ureq`.

## Notes

This example uses the local path dependency (`../../sdk/rust`) so it can be run from this repository without publishing to crates.io. In a real project, use the published crate:

```toml
[dependencies]
ckb-transaction-firewall-sdk = "0.3"
```
