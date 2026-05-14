# CKB Transaction Firewall

[![npm](https://img.shields.io/npm/v/@ckb-firewall/sdk)](https://www.npmjs.com/package/@ckb-firewall/sdk)
[![Tests](https://github.com/digitaldrreamer/ckb-transaction-firewall/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/digitaldrreamer/ckb-transaction-firewall/actions/workflows/tests.yml)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

> AI agents can be hijacked into sending funds to malicious addresses.  
> CKB Transaction Firewall enforces a **community-governed blacklist** at **consensus** — inside the lock script — so no compromised or injected agent code can bypass the check. A TypeScript SDK adds a fast **pre-flight** layer before you sign.

**Contracts live on CKB testnet.** Cell tx [`0x11b0397c`](https://explorer.nervos.org/transaction/0x11b0397cd58dce5c2bd704108ee6e1609128c0d828a3f3360237585e82bb7aed) committed at block `0x141be3d`. Registry values: [`docs/deployments/testnet.registry.json`](./docs/deployments/testnet.registry.json).

---

## Why this exists

Autonomous agents construct, sign, and broadcast transactions without a human in the loop. That autonomy is valuable — but **application-only safety checks are not enough**: compromised agent code, prompt injection (including [on-chain payload tricks](https://arxiv.org/abs/2503.16248)), bad tool outputs, and multi-agent cascades can all route funds to attacker-controlled addresses. Simulation can be skipped; monitoring is too late once a transaction is final.

The Firewall adds a **protocol-layer floor**: the same blacklist rules the SDK checks are enforced by **every CKB node** when the wallet cell uses the Firewall lock. Governance (quorum, multisig, review windows) is documented in [docs/governance.md](./docs/governance.md).

**Not only for agents.** Any software that builds CKB transactions — wallets, dapps, custodial batch jobs — can run the SDK pre-flight before signing, and the on-chain enforcement applies to any cell using the Firewall lock regardless of whether an LLM was involved.

---

## How it works

```
┌─────────────────────────────────────────────────┐
│              AI Agent / Wallet Runtime           │
└──────────────────────┬──────────────────────────┘
                       │ constructs a transaction
                       ▼
┌─────────────────────────────────────────────────┐
│            Layer 1 — SDK Pre-flight             │
│  Fast, synchronous, no RPC                      │
│  Parses registry cell dep, rejects blacklisted  │
│  outputs before signing                         │
└──────────────────────┬──────────────────────────┘
                       │ passes pre-flight → sign and broadcast
                       ▼
┌─────────────────────────────────────────────────┐
│        Layer 2 — CKB Consensus Enforcement      │
│  Every node validates the Firewall lock         │
│  Fails closed on missing/invalid/ambiguous dep  │
└─────────────────────────────────────────────────┘
```

**Why both?** If the SDK is never called, a standard lock offers no consensus blacklist. If only the SDK existed, a compromised runtime could skip the check entirely. Together: **SDK = fast path for the agent; lock = guarantee for everyone else.**

For deeper CKB rationale (cell model, lock scripts, oracle-free design): [docs/architecture.md](./docs/architecture.md).

---

## Quick start

### TypeScript SDK

```bash
npm install @ckb-firewall/sdk
```

```typescript
import { TransactionFirewall } from "@ckb-firewall/sdk";

const firewall = new TransactionFirewall({
  registryScript: {
    codeHash: "0xbbfbcf51b88c57c9c1d6414de4a7e4f9dae133625dfab71588c8bc5d05b71096",
    hashType: "type",
    args: "0x019bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce80114003f54dea35bcc7a0efef541d361799f77bd1b8581",
  },
});

const result = firewall.checkTransaction({
  cellDeps: [{ type: registryScript, data: registryData }],
  outputs: [{ lockArgs: recipientLockArgs }],
});

if (!result.ok) {
  console.error(result.reason, result.code);
}
```

Real testnet values for `registryScript` and `canonicalRegistryCell` are in [`docs/deployments/testnet.registry.json`](./docs/deployments/testnet.registry.json).

### Rust SDK

```bash
cd sdk/rust && cargo test
```

Use `ckb_transaction_firewall_sdk::check_transaction` with `FirewallConfig` and `UnsignedTxLike`; see [`sdk/rust/src/lib.rs`](./sdk/rust/src/lib.rs).

---

## On-chain enforcement

The Firewall lock and blacklist registry contracts are deployed to CKB testnet. To deploy your own instance or upgrade an existing one:

```bash
./scripts/deploy.sh \
  --network testnet \
  --rpc-url https://testnet.ckb.dev \
  --from-address <YOUR_CKT1_ADDRESS>
```

Full deployment walkthrough: [docs/deployments/testnet.md](./docs/deployments/testnet.md).

To use the Firewall lock on a cell, encode the registry type script identity into the lock args (see [docs/lock-script-spec.md](./docs/lock-script-spec.md)). The lock requires exactly one live registry `cell_dep` whose type script matches; it fails closed otherwise.

---

## Building and testing locally

```bash
rustup target add riscv64imac-unknown-none-elf

# Build contracts
cd contracts/firewall-lock
cargo build --release --target=riscv64imac-unknown-none-elf
cd ../blacklist-registry
cargo build --release --target=riscv64imac-unknown-none-elf --features dev-signer-keys

# Run Rust unit tests
cd ../../tests/unit
cargo test --test firewall_lock_tests
cargo test --test blacklist_registry_tests

# Run TypeScript SDK tests
cd ../sdk/typescript
npm ci && npm test
```

---

## Security model

**Protects against:** sends to known blacklisted lock/type args; agent hijack classes that pick a bad recipient address, including prompt injection and compromised tool outputs.

**Does not protect against:** addresses not yet on the list; non-address exploit classes; governance key compromise (mitigated by multisig and process); cells that do not use the Firewall lock.

**Fail-safe:** missing, invalid, or ambiguous registry deps → **reject**. See [docs/architecture.md](./docs/architecture.md#failure-semantics).

---

## Ecosystem

The Transaction Firewall is the enforcement floor for the [CKB Agent Control Hub](https://github.com/digitaldrreamer/ckb-agent-control-hub) — the authorization, identity, and marketplace protocol for AI agents on CKB. The Control Hub defines what an agent *may* do; this repo enforces what **no** agent may do at listed destinations when the lock is in use.

---

## Documentation

| Topic | Link |
|-------|------|
| Architecture and trust model | [docs/architecture.md](./docs/architecture.md) |
| Lock script spec (args, error codes) | [docs/lock-script-spec.md](./docs/lock-script-spec.md) |
| Governance | [docs/governance.md](./docs/governance.md) |
| Testnet deployment | [docs/deployments/testnet.md](./docs/deployments/testnet.md) |
| Canonical registry values | [docs/deployments/testnet.registry.json](./docs/deployments/testnet.registry.json) |
| Operator scripts | [scripts/README.md](./scripts/README.md) |
| Changelog | [CHANGELOG.md](./CHANGELOG.md) |

---

## Contributing

Open an issue for larger changes before a PR. For blacklist governance, follow [docs/governance.md](./docs/governance.md) rather than ordinary PRs. Security reports: use GitHub Security Advisories.

---

## License

MIT — see `Cargo.toml` in each crate and `sdk/typescript/LICENSE`.
