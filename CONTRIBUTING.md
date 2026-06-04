# Contributing to CKB Transaction Firewall

## Before you start

Open an issue before submitting a large change. For small fixes (docs, tests, minor bugs) a PR is fine without prior discussion.

## Repository layout

```
contracts/          Rust on-chain contracts (RISC-V)
sdk/typescript/     TypeScript SDK (@ckb-firewall/sdk)
sdk/rust/           Rust SDK (ckb-transaction-firewall-sdk)
sdk/cli/            CLI + governance GUI (@ckb-firewall/cli)
tests/unit/         Rust integration tests for contracts
examples/           Runnable examples (TypeScript + Rust)
docs/               Astro documentation site
```

## Prerequisites

- Rust stable + `riscv64imac-unknown-none-elf` target
- Node.js 22+
- `ckb-cli` v1.15.0 (required for governance scripts; see `scripts/ci/install_ckb_cli.sh`)

```bash
rustup target add riscv64imac-unknown-none-elf
```

## Running tests

```bash
# Contract unit tests
cargo test --manifest-path contracts/firewall-lock/Cargo.toml --features std

# Contract integration tests
cargo test --manifest-path tests/unit/Cargo.toml

# TypeScript SDK
cd sdk/typescript && npm ci && npm test

# Rust SDK
cargo test --manifest-path sdk/rust/Cargo.toml

# CLI
cd sdk/cli && npm ci && npm test
```

The full CI suite also runs `scripts/phase3_verify.sh` and `scripts/phase3_compat_check.sh`. You can run those locally after building the RISC-V binaries.

## Submitting a PR

- Target `main`.
- Keep commits focused; one logical change per commit.
- Update `CHANGELOG.md` under `Unreleased` if the change affects users.
- CI must pass. The phase 3 closeout gate is blocking on PRs to `main`.

## Security issues

Do not open public issues for security vulnerabilities. See [SECURITY.md](./SECURITY.md) for the reporting process.

## License

By contributing you agree that your contributions will be licensed under the [MIT License](./LICENSE).
