# CKB Transaction Firewall

<p align="center">
  <img src="./assets/logo.png" alt="CKB Transaction Firewall" width="120" />
</p>

[![npm sdk](https://img.shields.io/npm/v/@ckb-firewall/sdk?label=%40ckb-firewall%2Fsdk)](https://www.npmjs.com/package/@ckb-firewall/sdk)
[![npm cli](https://img.shields.io/npm/v/@ckb-firewall/cli?label=%40ckb-firewall%2Fcli)](https://www.npmjs.com/package/@ckb-firewall/cli)
[![Tests](https://github.com/digitaldrreamer/ckb-transaction-firewall/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/digitaldrreamer/ckb-transaction-firewall/actions/workflows/tests.yml)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

> The firewall checks your **outputs, not your counterparties.**  
> It prevents a protected cell from sending to blacklisted destinations — at consensus, inside the lock script — regardless of what your application code does.

**Deployed to CKB testnet.** Registry cell [`0x0e96b7c0`](https://testnet.explorer.nervos.org/transaction/0x0e96b7c0bd201654b854cf4d1937e1c51b9f9802e961d637d4ea61cd5b46efb3) · All outpoints in [`notes/deployments/testnet.registry.json`](./notes/deployments/testnet.registry.json).

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

# 4. Sign after review window (72h) and vote threshold (3/5) are met
ckb-firewall sign --proposal <id> --signer-index 0

# 5. Execute on-chain
ckb-firewall execute --proposal <id>
```

### TypeScript SDK

```bash
npm install @ckb-firewall/sdk
```

```typescript
import { fetchRegistryPayload, preflightCheck, buildFirewallLockScript } from "@ckb-firewall/sdk";

// Fetch the live registry
const registry = await fetchRegistryPayload(
  "https://testnet.ckb.dev",
  "0x0e96b7c0bd201654b854cf4d1937e1c51b9f9802e961d637d4ea61cd5b46efb3",
  0
);

// Check outputs before signing
const decision = preflightCheck(
  [{ lockArgs: "0x..." }],
  [registry]
);

if (!decision.ok) {
  throw new Error(`Blocked: ${decision.reason}`);
}
```

Build a firewall-protected lock script:

```typescript
const lock = buildFirewallLockScript({
  firewallCodeHash: "0x8192c9df809976ae9b093dd0d6b072a96101be8cffe61a7e9ac87c04e1f4dc54",
  firewallHashType: "type",
  flags: 0x03,
  registries: [{
    codeHash:    "0xbbfbcf51b88c57c9c1d6414de4a7e4f9dae133625dfab71588c8bc5d05b71096",
    hashType:    "type",
    typeIdValue: "0xcd5d844661356e465c27b7d693e84f20e884da63153d2f6f40381ceb0807761c",
    required:    true,
  }],
  innerCodeHash: "0x9be62e0423d4278b15c071bb881a4ebf936f7e46b3df0f152de50ae416f54465",
  innerHashType: "type",
  innerArgs: "0x<20-byte-pubkey-hash>",
});
```

See [`sdk/cli/README.md`](./sdk/cli/README.md) and [`sdk/typescript/`](./sdk/typescript/) for full option documentation.

---

## Important operational details

**Address migration.** Using the firewall lock gives you a different lock script and therefore a different CKB address. Existing UTXOs must be migrated to the new address.

**Temporary entries require header deps.** If a blacklist entry has an `expiresAt` timestamp, the spending transaction must include `header_deps` so the firewall can read the chain's median time. Omitting header deps causes time-based entries to behave as permanent — the transaction does not fail with a clear error, it just silently enforces the wrong policy.

**Registry updates invalidate in-flight transactions.** When a governance update is confirmed, the old registry cell is consumed. Any pending user transaction that references the old cell as a dep will fail at the miner level. Governance updates should be announced and submitted at low-traffic periods.

---

## Deployed contracts (testnet, 2026-05-20)

| Contract | Tx | Index |
|---|---|---|
| `governance-lock` | `0xe2129b25...` | 0 |
| `firewall-lock` | `0x128193cc...` | 0 |
| `blacklist-registry` | `0x128193cc...` | 1 |
| `spawn-aware-secp256k1` | `0x0fe5d476...` | 0 |
| Registry cell | `0x0e96b7c0...` | 0 |

Full outpoints and Type IDs: [`notes/deployments/testnet.registry.json`](./notes/deployments/testnet.registry.json).

---

## Security model

**Protects against:** sending to blacklisted lock/type args at consensus — regardless of what application code does.

**Does not protect against:** addresses not yet on the list; non-address exploit classes; cells that do not use the firewall lock; governance key compromise.

**Fail-closed:** missing, invalid, or ambiguous registry dep → reject. See [Architecture](https://ckb-firewall.drreamer.digital/concepts/architecture/).

---

## Documentation

**https://ckb-firewall.drreamer.digital**

| | |
|---|---|
| [Why this exists](https://ckb-firewall.drreamer.digital/concepts/why-this-exists/) | What the firewall does and does not do |
| [Architecture](https://ckb-firewall.drreamer.digital/concepts/architecture/) | Lock, registry, SDK, and governance |
| [Wallet integration](https://ckb-firewall.drreamer.digital/getting-started/wallet-integration/) | Step-by-step for wallet developers |
| [Governance runbook](https://ckb-firewall.drreamer.digital/operations/governance-runbook/) | Multi-party update coordination |
| [Testnet deployment](https://ckb-firewall.drreamer.digital/operations/testnet-deployment/) | Live outpoints and registry values |
| [BLKL format](https://ckb-firewall.drreamer.digital/reference/blkl-format/) | Binary registry payload layout |
| [Firewall lock args](https://ckb-firewall.drreamer.digital/reference/firewall-lock-args/) | Lock script args encoding |
| [CLI reference](https://ckb-firewall.drreamer.digital/reference/cli/) | All commands and options |

---

## Ecosystem

The Transaction Firewall is the enforcement floor for the [CKB Agent Control Hub](https://github.com/digitaldrreamer/ckb-agent-control-hub). The Control Hub defines what an agent may do; this enforces what no agent may do at listed destinations when the firewall lock is in use.

---

## License

MIT
