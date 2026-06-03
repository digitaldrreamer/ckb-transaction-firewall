# Rust Examples

Run from this directory:

```bash
cargo run --bin preflight_service
```

The example models a backend transaction service. It fetches the current testnet
registry from CKB RPC, checks unsigned transaction candidates with the Rust SDK,
and only forwards clean transactions to the signing queue.

If the current registry has no active entries, the blacklisted-payment branch is
reported as unavailable instead of using mocked data.
