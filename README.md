# CKB Transaction Firewall

<p align="center">
  <img src="./assets/logo.png" alt="CKB Transaction Firewall" width="120" />
</p>

[![npm sdk](https://img.shields.io/npm/v/@ckb-firewall/sdk?label=%40ckb-firewall%2Fsdk)](https://www.npmjs.com/package/@ckb-firewall/sdk)
[![npm cli](https://img.shields.io/npm/v/@ckb-firewall/cli?label=%40ckb-firewall%2Fcli)](https://www.npmjs.com/package/@ckb-firewall/cli)
[![crates.io](https://img.shields.io/crates/v/ckb-transaction-firewall-sdk)](https://crates.io/crates/ckb-transaction-firewall-sdk)
[![Tests](https://github.com/digitaldrreamer/ckb-transaction-firewall/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/digitaldrreamer/ckb-transaction-firewall/actions/workflows/tests.yml)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

> The firewall checks your **outputs, not your counterparties.**  
> It prevents a protected cell from sending to blacklisted destinations — at consensus, inside the lock script — regardless of what your application code does.

**Deployed to CKB testnet.** Registry cell [`0xd841c6c1`](https://testnet.explorer.nervos.org/transaction/0xd841c6c1e0841ea58274a7a114cce505bc19503cca4ab2da07c060d10a436672) · All outpoints in [`notes/deployments/testnet.registry.json`](./notes/deployments/testnet.registry.json).

---

## What it does

The firewall is an **outgoing payment filter**. It blocks a wallet cell from being spent in a transaction that sends to a blacklisted address. It does not block incoming payments, does not filter what appears in other inputs, and does not affect contracts the wallet interacts with.

Appropriate for:
- An AI agent that should never fund a known-malicious address, even if its runtime is compromised
- A wallet that wants a consensus-layer check on top of an off-chain pre-flight scan
- Any software that builds CKB transactions and wants to be unable to produce outputs to blacklisted destinations

Not for:
- Blocking association with a blacklisted entity in general
- Blocking incoming payments from blacklisted sources
- Screening counterparties in DeFi or other multi-party contracts

```text
┌────────────────────────────────────────┐
│         AI Agent / Wallet Runtime      │
└───────────────────┬────────────────────┘
                    │ constructs transaction
                    ▼
┌────────────────────────────────────────┐
│       Layer 1 — SDK Pre-flight         │
│  Fast, synchronous check before sign   │
│  Returns structured errors             │
└───────────────────┬────────────────────┘
                    │ passes → sign and broadcast
                    ▼
┌────────────────────────────────────────┐
│   Layer 2 — CKB Consensus Enforcement  │
│  Every node validates the firewall     │
│  lock; fails closed if dep is missing  │
│  or output is blacklisted              │
└────────────────────────────────────────┘
```

The SDK gives you a fast error before broadcast. The lock is what every node enforces — the SDK can be skipped by compromised code, the lock cannot.

---

## Quick start

### TypeScript SDK

```bash
npm install @ckb-firewall/sdk
```

```typescript
import { TransactionFirewall, fetchRegistryPayload } from "@ckb-firewall/sdk";

const firewall = new TransactionFirewall({
  registries: [{
    codeHash:    "0x493f1700508125b0e281b8fb1d168b03bd5ef71480399dd59221224901a9cd09",
    hashType:    "type",
    typeIdValue: "0x9be0ad6e4e5039a64d9725ff037057c16ef59f126e3bdd9841b802f0e0a112fe",
    required:    true,
  }],
});

// Fetch the live registry cell from your CKB node
const { type: registryType, data: registryData } = await fetchRegistryPayload(
  "https://testnet.ckb.dev",
  "0xd841c6c1e0841ea58274a7a114cce505bc19503cca4ab2da07c060d10a436672",
  0
);

// Check outputs before signing — synchronous, no RPC calls
const result = firewall.checkTransaction({
  cellDeps: [{ type: registryType, data: registryData }],
  outputs:  [{ lockArgs: "0x..." }],
});

if (!result.ok) {
  throw new Error(`Blocked: ${result.reason}`); // e.g. "BlacklistedLockArgs"
}
```

See [`sdk/typescript/`](./sdk/typescript/) for the full API including `buildFirewallLockScript` for constructing firewall-protected lock scripts.

### Rust SDK

```toml
[dependencies]
ckb-transaction-firewall-sdk = "0.3"
```

```rust
use ckb_transaction_firewall_sdk::{check_transaction, FirewallConfig, RegistrySpec, HashType};

let cfg = FirewallConfig {
    registries: vec![RegistrySpec {
        code_hash:      [/* blacklist_registry code hash */0u8; 32],
        hash_type:      HashType::Type,
        type_id_value:  [/* bytes 34-66 of registry type args */0u8; 32],
        required:       true,
    }],
};

// Build your transaction, pass the live registry cell as a dep
match check_transaction(&cfg, &tx, now_secs) {
    Ok(()) => { /* safe to sign */ }
    Err(e) => eprintln!("blocked: {} (code {})", e, e.code()),
}
```

See [`sdk/rust/`](./sdk/rust/) for the full API.

### CLI

```bash
npm install -g @ckb-firewall/cli
ckb-firewall inspect
```

Check whether an address is blacklisted:

```bash
ckb-firewall check --lock-args 0xabc123...
```

Full governance flow:

```bash
# 1. Create a proposal
ckb-firewall propose

# 2. Export and share with other participants
ckb-firewall export --proposal <id> --out proposal.json

# 3. Each participant imports and votes with their private key
ckb-firewall import proposal.json
ckb-firewall vote --proposal <id> --vote yes

# 4. Anchor the proposal on-chain as a PBLK cell
ckb-firewall anchor --proposal <id> --to-address <proposal-cell-owner-address>
# after the transfer is accepted, record it once if you did not use --submit
ckb-firewall anchor --proposal <id> --proposal-tx <anchor-tx> --proposal-index <data-output-index>

# 5. Execute on-chain after review window (72h) and vote threshold (3/5)
ckb-firewall execute --proposal <id>
```

For multi-registry deployments or self-managed registries, see [Private registry](https://ckb-firewall.drreamer.digital/operations/private-registry/).

---

## Important operational details

**Address migration.** Using the firewall lock gives you a different lock script and therefore a different CKB address. Existing UTXOs must be migrated to the new address.

**Temporary entries require header deps.** If a blacklist entry has an `expiresAt` timestamp, the spending transaction must include `header_deps` so the firewall can read the chain's median time. Omitting header deps causes time-based entries to behave as permanent — the transaction does not fail with a clear error, it just silently enforces the wrong policy.

**Registry updates invalidate in-flight transactions.** When a governance update is confirmed, the old registry cell is consumed. Any pending user transaction that references the old cell as a dep will fail at the miner level. Governance updates should be announced and submitted at low-traffic periods.

---

## Deployed contracts (testnet)

| Contract | Tx | Index |
|---|---|---|
| `governance-lock` | [`0x5033e680...`](https://testnet.explorer.nervos.org/transaction/0x5033e680435bc7ef2255767cfd46b355ab1bc6dcda5ec01e38ef0d29119ad711) | 0 |
| `firewall-lock` | [`0x128193cc...`](https://testnet.explorer.nervos.org/transaction/0x128193cc2d547b224ccf10a6e299cb0749c633c5f9354ff5a9a5fd3e894318d2) | 0 |
| `blacklist-registry` | [`0xa165e5af...`](https://testnet.explorer.nervos.org/transaction/0xa165e5af82538c072caaee87ae5b919ad89ca2448d66daf9a29092b5ad87294d) | 0 |
| `proposal-anchor` | [`0x9d8cc6d2...`](https://testnet.explorer.nervos.org/transaction/0x9d8cc6d26fce08eba8104dba8b5e5b5acb097b9c71f96b6bd6d68d12531413ee) | 0 |
| `spawn-aware-secp256k1` | [`0x0fe5d476...`](https://testnet.explorer.nervos.org/transaction/0x0fe5d47662724a3620c002683d8c3f38103359c7e1ca697196b39442317c709e) | 0 |
| Registry cell | [`0xa3dcb46f...`](https://testnet.explorer.nervos.org/transaction/0xa3dcb46fdeb92735e7f9f0393811a8541b71e275e8f713e62ea35f59746c78a8) | 0 |

Full outpoints and Type IDs: [`notes/deployments/testnet.registry.json`](./notes/deployments/testnet.registry.json).

### Live testnet blacklist

Real entries confirmed on the testnet registry as of 2026-06-02:

| Lock args | Added by | Status |
|---|---|---|
| `0xababababababababababababababababababababab` | proposal [`7a3ebccd`](https://testnet.explorer.nervos.org/transaction/0xa3dcb46fdeb92735e7f9f0393811a8541b71e275e8f713e62ea35f59746c78a8) | active |
| `0x3f54dea35bcc7a0efef541d361799f77bd1b858` | proposal `dbf110bb` | pending execution (review window) |
| `0x9888a8a74df4e0ce82e7a4604f8fd403fd4622ca` | proposal `dbe06fc7` | pending execution (review window) |

---

## Security model

**Protects against:** sending to blacklisted lock/type args at consensus — regardless of what application code does.

**Does not protect against:** addresses not yet on the list; non-address exploit classes; cells that do not use the firewall lock; governance key compromise.

**Fail-closed:** missing, invalid, or ambiguous registry dep → reject. See [Architecture](https://ckb-firewall.drreamer.digital/concepts/architecture/).

---

## Documentation

**https://ckb-firewall.drreamer.digital**

**Concepts**

| | |
|---|---|
| [Why this exists](https://ckb-firewall.drreamer.digital/concepts/why-this-exists/) | What the firewall does and does not do |
| [Architecture](https://ckb-firewall.drreamer.digital/concepts/architecture/) | Lock, registry, SDK, and governance |
| [Security model](https://ckb-firewall.drreamer.digital/concepts/security-model/) | What is and isn't protected |

**Guides**

| | |
|---|---|
| [Pre-flight check (TypeScript)](https://ckb-firewall.drreamer.digital/guides/typescript-preflight/) | Fetch the registry and reject blacklisted outputs before signing |
| [Pre-flight check (Rust)](https://ckb-firewall.drreamer.digital/guides/rust-preflight/) | In-process blacklist check with no network dependency |
| [Wallet integration](https://ckb-firewall.drreamer.digital/guides/typescript-wallet-integration/) | Wrap a secp256k1 wallet cell with the firewall lock |
| [Blacklisting an address](https://ckb-firewall.drreamer.digital/guides/governance-blacklist/) | Full governance lifecycle — propose, vote, sign, execute |
| [CLI walkthrough](https://ckb-firewall.drreamer.digital/guides/cli-walkthrough/) | Inspect the registry and run governance commands |

**Reference**

| | |
|---|---|
| [TypeScript SDK API](https://ckb-firewall.drreamer.digital/reference/sdk-api/) | All types, classes, and functions |
| [Rust SDK API](https://ckb-firewall.drreamer.digital/reference/rust-sdk-api/) | All types and functions |
| [CLI reference](https://ckb-firewall.drreamer.digital/reference/cli/) | All commands and options |
| [BLKL format](https://ckb-firewall.drreamer.digital/reference/blkl-format/) | Binary registry payload layout |
| [Firewall lock args](https://ckb-firewall.drreamer.digital/reference/firewall-lock-args/) | Lock script args encoding |
| [Error codes](https://ckb-firewall.drreamer.digital/reference/error-codes/) | All SDK and on-chain error codes |

**Operations**

| | |
|---|---|
| [Testnet deployment](https://ckb-firewall.drreamer.digital/operations/testnet-deployment/) | Live outpoints and registry values |
| [Governance runbook](https://ckb-firewall.drreamer.digital/operations/governance-runbook/) | Multi-party update coordination |
| [Private registry](https://ckb-firewall.drreamer.digital/operations/private-registry/) | Multi-registry deployment and self-managed blacklist registries |

---

## Ecosystem

The Transaction Firewall is the enforcement floor for the [CKB Agent Control Hub](https://github.com/digitaldrreamer/ckb-agent-control-hub). The Control Hub defines what an agent may do; this enforces what no agent may do at listed destinations when the firewall lock is in use.

---

## License

MIT
