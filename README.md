# CKB Transaction Firewall

<p align="center">
  <img src="./assets/logo.png" alt="CKB Transaction Firewall" width="120" />
</p>

[![npm sdk](https://img.shields.io/npm/v/@ckb-firewall/sdk?label=%40ckb-firewall%2Fsdk)](https://www.npmjs.com/package/@ckb-firewall/sdk)
[![npm cli](https://img.shields.io/npm/v/@ckb-firewall/cli?label=%40ckb-firewall%2Fcli)](https://www.npmjs.com/package/@ckb-firewall/cli)
[![Tests](https://github.com/digitaldrreamer/ckb-transaction-firewall/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/digitaldrreamer/ckb-transaction-firewall/actions/workflows/tests.yml)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

> AI agents can be hijacked into sending funds to malicious addresses.  
> CKB Transaction Firewall enforces a **community-governed blacklist** at **consensus** — inside the lock script — so no compromised or injected agent code can bypass the check. A TypeScript SDK adds a fast **pre-flight** layer before you sign.

**Contracts live on CKB testnet.** Cell tx [`0x11b0397c`](https://testnet.explorer.nervos.org/transaction/0x11b0397cd58dce5c2bd704108ee6e1609128c0d828a3f3360237585e82bb7aed) committed at block `0x141be3d`. Registry values: [`notes/deployments/testnet.registry.json`](./notes/deployments/testnet.registry.json).

---

## Why this exists

Autonomous agents construct, sign, and broadcast transactions without a human in the loop. That autonomy is valuable — but **application-only safety checks are not enough**: compromised agent code, prompt injection (including [on-chain payload tricks](https://arxiv.org/abs/2503.16248)), bad tool outputs, and multi-agent cascades can all route funds to attacker-controlled addresses. Simulation can be skipped; monitoring is too late once a transaction is final.

The Firewall adds a **protocol-layer floor**: the same blacklist rules the SDK checks are enforced by **every CKB node** when the wallet cell uses the Firewall lock. Governance (quorum, multisig, review windows) is documented in [notes/governance.md](./notes/governance.md).

**Not only for agents.** Any software that builds CKB transactions — wallets, dapps, custodial batch jobs — can run the SDK pre-flight before signing, and the on-chain enforcement applies to any cell using the Firewall lock regardless of whether an LLM was involved.

---

## How it works

```text
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

For deeper CKB rationale (cell model, lock scripts, oracle-free design): [notes/architecture.md](./notes/architecture.md).

---

## Quick start

### CLI

Install and inspect the live testnet blacklist:

```bash
npm install -g @ckb-firewall/cli
ckb-firewall inspect
```

Or use the one-line installer (handles Node version checks and PATH setup):

```bash
curl -fsSL https://raw.githubusercontent.com/digitaldrreamer/ckb-transaction-firewall/main/scripts/install-cli.sh | bash
```

**Quick path** (testnet/dev — placeholder governance, immediate tx output):

```bash
ckb-firewall add --lock-args 0xabc123...
ckb-firewall remove --lock-args 0xabc123...
```

**Full governance flow** (community review + voting + multisig):

```bash
# 1. Propose a change (prompted interactively)
ckb-firewall propose

# 2. Validators vote (72-hour review window; testnet: 3 yes, production: 5-of-6)
ckb-firewall vote --proposal <id> --vote yes --validator alice

# 3. Track status
ckb-firewall proposals

# 4. Sign after threshold met (3-of-5 multisig)
ckb-firewall sign --proposal <id> --signer-index 0

# 5. Execute on-chain
ckb-firewall execute --proposal <id>
```

All commands are interactive when flags are omitted. See [`sdk/cli/`](./sdk/cli/) for source and `ckb-firewall --help` for all options.

### TypeScript SDK

```bash
npm install @ckb-firewall/sdk
```

```typescript
import { TransactionFirewall } from "@ckb-firewall/sdk";

const registryScript = {
  codeHash: "0xbbfbcf51b88c57c9c1d6414de4a7e4f9dae133625dfab71588c8bc5d05b71096",
  hashType: "type",
  args: "0x019bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce80114003f54dea35bcc7a0efef541d361799f77bd1b8581",
};
const registryData = "0x..."; // fetch live cell data from your CKB node
const recipientLockArgs = "0x..."; // the lock args you want to check

const firewall = new TransactionFirewall({ registryScript });

const result = firewall.checkTransaction({
  cellDeps: [{ type: registryScript, data: registryData }],
  outputs: [{ lockArgs: recipientLockArgs }],
});

if (!result.ok) {
  console.error(result.reason, result.code);
}
```

Real testnet values for `registryScript` and `canonicalRegistryCell` are in [`notes/deployments/testnet.registry.json`](./notes/deployments/testnet.registry.json).

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

Full deployment walkthrough: [notes/deployments/testnet.md](./notes/deployments/testnet.md).

To use the Firewall lock on a cell, encode the registry type script identity into the lock args (see [notes/lock-script-spec.md](./notes/lock-script-spec.md)). The lock requires exactly one live registry `cell_dep` whose type script matches; it fails closed otherwise.

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

**Fail-safe:** missing, invalid, or ambiguous registry deps → **reject**. See [notes/architecture.md](./notes/architecture.md#failure-semantics).

---

## Ecosystem

The Transaction Firewall is the enforcement floor for the [CKB Agent Control Hub](https://github.com/digitaldrreamer/ckb-agent-control-hub) — the authorization, identity, and marketplace protocol for AI agents on CKB. The Control Hub defines what an agent *may* do; this repo enforces what **no** agent may do at listed destinations when the lock is in use.

---

## Documentation

| Topic | Link |
|-------|------|
| Architecture and trust model | [notes/architecture.md](./notes/architecture.md) |
| Lock script spec (args, error codes) | [notes/lock-script-spec.md](./notes/lock-script-spec.md) |
| Governance | [notes/governance.md](./notes/governance.md) |
| CLI (`@ckb-firewall/cli`) | [sdk/cli/README.md](./sdk/cli/README.md) |
| Testnet deployment | [notes/deployments/testnet.md](./notes/deployments/testnet.md) |
| Canonical registry values | [notes/deployments/testnet.registry.json](./notes/deployments/testnet.registry.json) |
| Changelog | [CHANGELOG.md](./CHANGELOG.md) |

---

## Contributing

Open an issue for larger changes before a PR. For blacklist governance, follow [notes/governance.md](./notes/governance.md) rather than ordinary PRs. Security reports: use GitHub Security Advisories.

---

## License

MIT — see `Cargo.toml` in each crate and `sdk/typescript/LICENSE`.
