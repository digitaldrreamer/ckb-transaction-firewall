# CKB Transaction Firewall

[![Tests](https://github.com/digitaldrreamer/ckb-transaction-firewall/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/digitaldrreamer/ckb-transaction-firewall/actions/workflows/tests.yml)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

> AI agents can be hijacked into sending funds to malicious addresses.  
> CKB Transaction Firewall enforces a **community-governed blacklist** at **consensus**, inside the **lock script**, so malicious or compromised agent code cannot bypass the check for cells that use this lock. A TypeScript and Rust **SDK** adds a fast **pre-flight** layer before you sign.

---

## Why this exists

Autonomous agents construct, sign, and broadcast transactions without a human in the loop at every step. That autonomy is valuable, but **application-only safety checks are not enough**: compromised agent code, **prompt injection** (including [on-chain payload tricks](https://arxiv.org/abs/2503.16248)), **bad tool outputs**, and **multi-agent cascades** can route funds to attacker-controlled addresses. Simulation can be skipped; monitoring is too late once a tx is final.

The Firewall adds a **protocol-layer floor**: the same blacklist rules the SDK checks are enforced by **every CKB node** when the wallet cell uses the Firewall lock. **Normative governance** (quorum, multisig, review windows) lives in [governance/voting.md](./governance/voting.md) and [docs/governance.md](./docs/governance.md).

**Not only for agents.** Any software that builds CKB transactions (wallets, dapps, custodial batch jobs, scripts) can run the **SDK** pre-flight before signing. **Consensus** enforcement is the same for every spender: it applies to cells whose **lock** is the Firewall lock, regardless of whether an LLM was involved. The blacklist is evaluated against **outputs this transaction creates** (destination lock/type args on those outputs). It does not, by itself, implement a separate “only accept funds from non-blacklisted senders” policy; inbound flows still depend on how you construct and review transactions.

---

## How it works

The system is intentionally **two-layered**: they solve different problems and neither replaces the other.

```
┌──────────────────────────────────────────────────────────────────┐
│                        AI Agent Runtime                          │
│           (LLM + tool calls + wallet signing logic)              │
└──────────────────────────────┬───────────────────────────────────┘
                               │ agent constructs a transaction
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    LAYER 1: SDK Pre-flight                       │
│  Fast feedback, structured errors, fee savings                    │
│  - Resolve registry `cell_dep`, parse BLKL payload               │
│  - Reject blacklisted outputs before signing                      │
└──────────────────────────────┬───────────────────────────────────┘
                               │ transaction passes pre-flight
                               ▼
                    agent signs and broadcasts
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                  LAYER 2: CKB Consensus Enforcement              │
│  Authoritative, miner-enforced (requires Firewall lock on cell)  │
│  - Firewall lock runs in validation                               │
│  - Registry read via `cell_dep`; fail-closed if missing/ambiguous │
└──────────────────────────────────────────────────────────────────┘
```

**Why both?** If the SDK is never called, a standard lock offers no consensus blacklist. If only the SDK existed, a compromised runtime could skip the check entirely. Together: **SDK = fast path for the agent; lock = guarantee for everyone else.**

Deeper CKB rationale (cell model, lock scripts vs account chains, oracle-free design): **[docs/architecture.md](./docs/architecture.md)**. For the **full narrative** (extended threat model, component-by-component description, governance story, security model detail, and Control Hub relationship), see **[ABOUT.md](./ABOUT.md)**.

---

## Prerequisites

| Tool | Notes |
|------|--------|
| **Rust** (stable) + `riscv64imac-unknown-none-elf` | `rustup target add riscv64imac-unknown-none-elf` |
| **Node.js** 20+ and **npm** | Used for the TypeScript SDK; CI uses Node 22. |
| **ckb-cli** | Optional locally; pinned in CI for governance evidence checks ([scripts/README.md](./scripts/README.md)). |

---

## Quick start

From a clean clone: build the firewall binary, then prove the TypeScript SDK typechecks:

```bash
rustup target add riscv64imac-unknown-none-elf
cd contracts/firewall-lock
cargo build --release --target=riscv64imac-unknown-none-elf

cd ../../sdk/typescript
npm ci
npm run typecheck
```

---

## SDK usage

### TypeScript (`sdk/typescript`)

Depend via **workspace** or **`file:`** until an npm publish exists ([`package.json`](./sdk/typescript/package.json) is currently `"private": true`).

```bash
cd sdk/typescript && npm ci && npm run typecheck && npm test
```

```typescript
import { TransactionFirewall } from "@ckb-firewall/sdk";

const firewall = new TransactionFirewall({
  registryScript: {
    codeHash: "0x<32-byte code hash hex>",
    hashType: "type",
    args: "0x<registry type args hex>",
  },
});

const decision = firewall.checkTransaction(unsignedTxLike);
if (!decision.ok) {
  console.error(decision.reason, "code", decision.code);
}
```

### Rust (`sdk/rust`)

```bash
cd sdk/rust && cargo test
```

Use `ckb_transaction_firewall_sdk::check_transaction` with `FirewallConfig` and `UnsignedTxLike`; see [`sdk/rust/src/lib.rs`](./sdk/rust/src/lib.rs).

---

## Building the contracts

```bash
rustup target add riscv64imac-unknown-none-elf

cd contracts/firewall-lock
cargo build --release --target=riscv64imac-unknown-none-elf

cd ../blacklist-registry
cargo build --release --target=riscv64imac-unknown-none-elf --features dev-signer-keys
```

`contracts/governance-lock/` supports governance drills; build the same way when you need that binary.

---

## Running tests

VM integration tests expect **release** RISC-V artifacts:

```bash
cd contracts/firewall-lock && cargo build --release --target=riscv64imac-unknown-none-elf
cd ../blacklist-registry && cargo build --release --target=riscv64imac-unknown-none-elf --features dev-signer-keys
cd ../../tests/unit
cargo test --test firewall_lock_tests
cargo test --test blacklist_registry_tests
```

See [tests/unit/README.md](./tests/unit/README.md).

---

## Using the Firewall lock on-chain

1. **Deploy** scripts and record **code hashes** and **registry type script identity** (see [docs/phase3/runbooks/deployment-runbook.md](./docs/phase3/runbooks/deployment-runbook.md) and [scripts/README.md](./scripts/README.md)).
2. **Normative** lock args, flags, error codes, and registry dep selection: **[docs/lock-script-spec.md](./docs/lock-script-spec.md)** and [contracts/firewall-lock/README.md](./contracts/firewall-lock/README.md).
3. **Spend path:** the firewall lock requires exactly **one** live registry `cell_dep` whose **type script** matches the identity encoded in lock args; otherwise validation fails closed.
4. **Inner lock** delegates ownership checks (e.g. secp256k1). Without the Firewall lock on the cell, **only** the SDK layer applies.

---

## Security model

**Protects against:** sends to **known** blacklisted lock/type args; many agent hijack classes that pick a bad recipient address.

**Does not protect against:** addresses **not yet** on the list; non-address exploit classes; **governance key compromise** (mitigated by multisig + process, not eliminated); cells that **do not** use the Firewall lock.

**Fail-safe:** missing, invalid, or **ambiguous** registry deps → **reject**. See [docs/architecture.md](./docs/architecture.md#failure-semantics).

---

## Ecosystem

The Transaction Firewall is the **enforcement floor** for the [CKB Agent Control Hub](https://github.com/digitaldrreamer/ckb-agent-control-hub) (authorization, identity, marketplace). Control Hub defines what an agent *may* do; this repo defines what **no** agent may do at listed destinations when the lock is in use.

---

## Documentation

| Topic | Where |
|--------|--------|
| **Extended narrative** (threat model, components, governance, security, ecosystem) | [ABOUT.md](./ABOUT.md) |
| Architecture, trust model, **why CKB** | [docs/architecture.md](./docs/architecture.md) |
| Lock script spec (args, errors) | [docs/lock-script-spec.md](./docs/lock-script-spec.md) |
| Governance | [docs/governance.md](./docs/governance.md), [governance/voting.md](./governance/voting.md) |
| Operator / CI scripts | [scripts/README.md](./scripts/README.md) |
| Phase 3 & 4 runbooks & matrices | [docs/phase3/](./docs/phase3/), [docs/phase4/](./docs/phase4/) |
| Internal plans & milestone evidence | [docs/internal/](./docs/internal/) |
| Research notes | [research/](./research/) |
| Contract READMEs | [contracts/firewall-lock/README.md](./contracts/firewall-lock/README.md), [contracts/blacklist-registry/README.md](./contracts/blacklist-registry/README.md) |
| Changelog / versions | [CHANGELOG.md](./CHANGELOG.md) |

---

## Contributing

- **Code & docs:** open an issue for larger changes, then a PR to `main`. Run the relevant `cargo test` / `npm test` paths.
- **Blacklist governance:** follow [governance/voting.md](./governance/voting.md), not ordinary GitHub PRs.
- **Security:** use **GitHub Security Advisories** for sensitive reports when possible.

```bash
git checkout -b feat/your-change
# … edit, test …
git push -u origin feat/your-change
```

---

## License

MIT; see `license = "MIT"` in each crate’s `Cargo.toml` (e.g. [contracts/firewall-lock/Cargo.toml](./contracts/firewall-lock/Cargo.toml)).
