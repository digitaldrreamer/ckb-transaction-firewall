# CKB Transaction Firewall

> Protocol-level transaction safety for AI agents on Nervos CKB — community-governed blacklist enforcement via lock scripts.

---

## What This Is

CKB Transaction Firewall is a **safety primitive for AI agents operating on Nervos CKB**. It prevents agents from sending transactions to blacklisted addresses — addresses known to be exploit contracts, drainer wallets, or compromised protocols.

The enforcement happens at two independent layers: once in the agent's signing flow (fast, pre-broadcast, developer-friendly), and once at CKB consensus (authoritative, enforced by every miner on the network). Both layers check the same community-maintained blacklist, which lives entirely on-chain as a CKB cell.

> **Important:** The consensus layer is bypass-proof only for agents whose wallet cells use the Firewall Lock Script as their lock. An agent cell using a standard secp256k1 lock receives no consensus-layer protection. The lock script must be deliberately adopted — see [Integrating the Firewall Lock Script](#integrating-the-firewall-lock-script).

This is foundational infrastructure. It is the safety floor that all other agent tooling on CKB is built on top of. The [CKB Agent Control Hub](https://github.com/digitaldrreamer/ckb-agent-control-hub) — the authorization and identity layer for CKB agents — uses the Transaction Firewall as its enforcement backend.

---

## Why This Needs to Exist

AI agents are increasingly capable of autonomous blockchain action. They can construct transactions, sign them, and broadcast them without human confirmation at each step. That's the point — autonomy is the value. But autonomy without a safety floor is dangerous for several reasons that are specific to the AI agent threat model, not just to general blockchain security:

**Prompt injection via on-chain data.** An agent reading cell data from an untrusted source could receive embedded instructions designed to redirect its next transaction. The agent, operating autonomously, may comply before any human can intervene. This is not hypothetical: [published research (arXiv 2503.16248)](https://arxiv.org/abs/2503.16248) demonstrated that malicious prompts embedded in on-chain data successfully triggered unauthorized transfers against production AI agent frameworks.

**Compromised tool outputs.** Agents rely on tools — price feeds, DEX quotes, protocol state queries — to make decisions. A compromised tool returning a fabricated address as a "safe" recipient gives the agent no way to verify the claim independently. The Firewall provides that independent verification at the protocol layer.

**Multi-agent cascades.** An orchestrator agent that delegates to sub-agents can propagate a compromise silently through a pipeline. By the time the malicious transaction reaches the final signing agent, there is no human in the loop and no application-layer check to catch it.

**Agents run continuously with minimal oversight.** A human developer reviewing every transaction defeats the purpose of an autonomous agent. Safety infrastructure must therefore be passive — always on, requiring no per-transaction human action.

Existing approaches to this problem are insufficient:

- **Simulation / static analysis** is reactive. It tells you what a transaction *would* do, but only if you run it before signing. Agents under adversarial conditions can be directed to skip simulation.
- **Application-level checks** (SDK guards, pre-flight validation in agent code) can be bypassed if the agent's own code is compromised or manipulated. Research confirms that prompt-based defenses in agent code are insufficient against context manipulation attacks.
- **Off-chain monitoring** catches problems after they happen. On a blockchain, after is too late — transactions are final.

None of these approaches enforce at the protocol layer. The Transaction Firewall does.

---

## Why CKB Is the Right Chain for This

This is not a generic blockchain project. The Transaction Firewall is built the way it is specifically because of properties unique to Nervos CKB. Understanding these properties explains every architectural decision.

### Lock Scripts Are First-Class Validation Logic

On Ethereum, the traditional account model separates externally-owned accounts (EOAs, with no programmable validation logic) from smart contracts (which require explicit coding of every validation rule and carry deployment overhead). There is no native way to say "any transaction spending from this address must pass this blacklist check" without deploying a custom contract wallet or modifying every application that interacts with the address.

This gap has narrowed with recent Ethereum upgrades. [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702), shipped in the Pectra upgrade (May 2025), allows EOAs to delegate execution to contract code for the duration of a transaction, and [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) (live since 2023) enables arbitrary validation logic via smart contract wallets. These are meaningful steps toward programmable validation at the address level.

However, CKB's model is structurally different in ways that matter for this use case. On CKB, every cell has a **lock script** — arbitrary RISC-V code that runs at consensus every time the cell is spent. The lock script is not an application contract. It is the spending condition itself, evaluated by every CKB node as part of transaction validation. This is a permanent, unconditional constraint baked into the cell — not a transaction-scoped delegation (as in EIP-7702) or a separate infrastructure layer requiring bundlers and an alt mempool (as in ERC-4337).

This means a firewall lock script can be applied to any agent wallet cell. When the agent tries to spend its funds, the lock script runs, checks the blacklist, and either permits or rejects the transaction — at the miner level, not the application level. No contract deployment per wallet. No trust in the agent's own code. The check is simply part of what it means to spend the cell.

### The Cell Model Makes Blacklists Composable

On CKB, data lives in cells. A cell can be referenced in a transaction as a `cell_dep` — a read-only dependency that is available to all scripts during validation but is not consumed by the transaction. This is the mechanism the Firewall uses for its blacklist.

The Blacklist Registry Cell contains the current blacklist data. Scripts reference it as a `cell_dep` during transaction validation. This has several important consequences:

- The blacklist is read by every transaction that uses the Firewall lock, without those transactions spending or modifying the blacklist cell.
- Updating the blacklist is a single governance transaction that replaces the Registry Cell. All future transactions automatically use the new blacklist — no redeployment of scripts, no migration, no per-wallet update.
- The Registry Cell's integrity is protected by its own type script, which requires valid governance signatures for any update. The blacklist cannot be silently modified.

This architecture is not possible on account-model chains without significantly more complexity. On CKB it is the natural pattern.

> **Governance sequencing note:** When a governance transaction destroys the Registry Cell to replace it, any in-flight transactions that reference the old cell as a `cell_dep` may cause miners to fail block template generation if the cells are in the same mempool window. Governance updates should be timed and sequenced carefully. This is an inherent property of the CKB cell model and is not unique to this project. See [CKB security advisory GHSA-v666-6w97-pcwm](https://github.com/nervosnetwork/ckb/security/advisories/GHSA-v666-6w97-pcwm) for context.

### No Oracle Dependency

Many blockchain security systems rely on off-chain oracles to feed data on-chain for validation. Oracles introduce trust assumptions: if the oracle is compromised, the security guarantee disappears. The Transaction Firewall has no oracle. The blacklist is a CKB cell, updated by on-chain governance transactions, read by on-chain scripts. The entire system operates within CKB's security model.

---

## The Dual-Layer Design

The Firewall enforces at two layers. This is intentional and necessary — they serve different purposes and neither can replace the other.

```
┌──────────────────────────────────────────────────────────────────┐
│                        AI Agent Runtime                          │
│           (LLM + tool calls + wallet signing logic)              │
└──────────────────────────────┬───────────────────────────────────┘
                               │ agent constructs a transaction
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    LAYER 1 — SDK Pre-flight                      │
│                                                                  │
│  Purpose: fast feedback, human-readable errors, fee savings      │
│                                                                  │
│  - Fetches Blacklist Registry Cell from CKB node                 │
│  - Checks all transaction outputs against the blacklist          │
│  - Rejects with a structured error before signing                │
│  - Logs the blocked attempt for audit                            │
└──────────────────────────────┬───────────────────────────────────┘
                               │ transaction passes pre-flight
                               ▼
                    agent signs and broadcasts
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                  LAYER 2 — CKB Consensus Enforcement             │
│                                                                  │
│  Purpose: authoritative, miner-enforced (requires Firewall lock) │
│                                                                  │
│  - Firewall Lock Script runs during transaction validation        │
│  - References Blacklist Registry Cell as a cell_dep              │
│  - Transaction is rejected by the network if blacklist hit       │
│  - No application code can bypass this — it is consensus logic   │
└──────────────────────────────────────────────────────────────────┘
```

**Why both layers, and not just one?**

The SDK layer alone is insufficient. If an agent's code is compromised, manipulated by prompt injection, or simply bypassed — if the SDK check is never called — the transaction goes through unchecked. The SDK is a guard in application code, and application code can be circumvented.

The consensus layer alone is also insufficient on its own from a developer experience perspective. Without the SDK check, an agent that constructs a blacklisted transaction will broadcast it, spend fees, wait for mempool propagation, and then receive a silent consensus rejection. The developer gets no structured error. The agent gets no actionable feedback. The fees are wasted. At high transaction volume, this compounds quickly.

Together, they form a complete system. The SDK layer gives fast, contextual feedback during development and normal operation. The consensus layer provides the ground truth that no application-layer logic can override. This pattern — application-layer pre-flight plus protocol-layer enforcement — is standard in every mature security system. Network firewalls work this way. TradFi payment systems work this way. USDC's blacklist works this way (the application checks before signing; the contract enforces at settlement). The Transaction Firewall applies the same pattern to CKB agent transactions.

A useful way to think about it: **the SDK layer is for the agent's benefit, the consensus layer is for everyone else's.** The SDK helps the agent fail fast and cheaply. The consensus layer means that even if the agent never runs the SDK, the network will still reject the transaction — provided the Firewall Lock Script is in use as the cell's lock.

---

## Components

### Firewall Lock Script

A CKB lock script written in Rust using `ckb-std`. When deployed and used as the lock for an agent's wallet cells, it runs on every transaction that spends those cells. It reads the Blacklist Registry Cell as a `cell_dep`, iterates the blacklist entries, and aborts transaction validation if any output `lock_args` or `type_args` match a blacklisted entry.

The lock script is composable. It can wrap existing lock scripts (secp256k1, Omnilock) using CKB's script delegation pattern, so agents do not need to migrate to an entirely new wallet type to gain firewall protection.

### Blacklist Registry Cell

An on-chain data cell containing the current blacklist as a serialized, sorted byte array of blacklisted `lock_args` entries. It is protected by a type script that enforces governance authorization for any update — the cell's data cannot be changed without valid multisig signatures from the current governance keyholders.

The Registry Cell is referenced as a `cell_dep` in transactions, not consumed. This means:
- Checking the blacklist costs no capacity and does not create a transaction ordering dependency.
- Many agents can check the same Registry Cell in the same block simultaneously.
- Updating the blacklist is a clean, atomic replacement of the cell.

### Agent SDK (TypeScript + Rust)

A lightweight library that wraps the agent's transaction signing flow with Layer 1 pre-flight checks. It fetches the Registry Cell from a CKB node, runs the blacklist check locally, and returns structured results before the transaction is signed. The SDK is framework-agnostic — it operates on CKB transaction objects and integrates with any agent runtime that produces them.

### Governance Module

The mechanism by which the blacklist is updated. The process runs entirely on-chain:

1. **Proposal submission** — any community member submits a structured proposal (JSON, conforming to `governance/proposal-schema.json`) to add or remove a blacklist entry, with evidence.
2. **Review period** — a minimum 72-hour window during which the community reviews the proposal. This prevents rushed additions that could be weaponized to censor legitimate addresses.
3. **Voting** — registered community validators vote on-chain. One validator equals one vote.
4. **Multisig execution** — approved proposals are executed via a 3-of-5 multisig transaction that replaces the Registry Cell with an updated version.
5. **On-chain record** — the old Registry Cell is consumed; the new one's data includes a reference to the governance transaction that authorized the change. The full history is readable on-chain.

The governance model is designed around one hard constraint: no single entity should be able to add or remove blacklist entries unilaterally. The 72-hour review window and 3-of-5 multisig requirement mean that even a partially compromised governance set cannot push a malicious update silently.

---

## Repository Structure

```
ckb-transaction-firewall/
├── contracts/
│   ├── firewall-lock/            # Lock script (Rust + ckb-std)
│   │   ├── src/
│   │   │   └── main.rs           # Core blacklist validation logic
│   │   └── Cargo.toml
│   └── blacklist-registry/       # Registry Cell type script
│       ├── src/
│       │   └── main.rs           # Governance signature enforcement
│       └── Cargo.toml
├── sdk/
│   ├── typescript/               # Pre-flight SDK for agent runtimes
│   │   ├── src/
│   │   │   ├── firewall.ts       # Main pre-flight check logic
│   │   │   ├── blacklist.ts      # Registry Cell fetch + parsing
│   │   │   └── index.ts
│   │   └── package.json
│   └── rust/                     # Rust SDK for native agent runtimes
│       └── src/
│           └── lib.rs
├── governance/
│   ├── proposal-schema.json      # JSON schema for blacklist proposals
│   └── voting.md                 # Full governance process documentation
├── tests/
│   ├── unit/                     # Script unit tests (ckb-testtool)
│   └── integration/              # End-to-end tests against CKB testnet
├── research/
│   └── research.md               # Background research and design rationale
├── docs/
│   ├── architecture.md           # Detailed architecture documentation
│   ├── lock-script-spec.md       # Lock script interface specification
│   └── governance.md             # Governance model deep-dive
├── scripts/
│   ├── deploy.sh                 # Deployment script for testnet/mainnet
│   └── update-blacklist.ts       # CLI tool for governance submissions
├── Cargo.toml
├── package.json
└── README.md
```

---

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [ckb-capsule](https://github.com/nervosnetwork/capsule) — CKB contract build tool
- [ckb-cli](https://github.com/nervosnetwork/ckb-cli)
- [Node.js](https://nodejs.org/) 18+
- Access to a CKB testnet node (public RPC: `https://testnet.ckb.dev`)

### Building the Contracts

```bash
# Install ckb-capsule
cargo install ckb-capsule

# Build the firewall lock script
cd contracts/firewall-lock
capsule build

# Build the blacklist registry type script
cd ../blacklist-registry
capsule build
```

### Running Tests

```bash
# Unit tests — runs against the compiled contracts in a simulated CKB environment
cargo test

# Integration tests — requires a running testnet node
cd tests/integration
npm install
npm test
```

### Using the TypeScript SDK

```bash
npm install @ckb-firewall/sdk
```

```typescript
import { TransactionFirewall } from '@ckb-firewall/sdk';

const firewall = new TransactionFirewall({
  rpcUrl: 'https://testnet.ckb.dev',
  // Registry cell type script identity (matches lock args; not an outpoint)
  blacklistRegistryTypeScript: {
    codeHash: '<registry-type-code-hash>',
    hashType: 'type',
    args: '<registry-type-args-hex>',
  },
});

// Call before signing any transaction
const result = await firewall.checkTransaction(myUnsignedTx);

if (!result.safe) {
  console.error('Transaction blocked:', result.reason);
  console.error('Flagged output index:', result.flaggedIndex);
  // Do not sign. Log the attempt. Alert the operator.
} else {
  // Proceed with signing and broadcast
  const signedTx = await wallet.signTransaction(myUnsignedTx);
  await ckbRpc.sendTransaction(signedTx);
}
```

### Integrating the Firewall Lock Script

To protect an agent wallet with the consensus-layer firewall, the agent's CKB cells must use the Firewall Lock Script as their lock. The SDK includes a helper for constructing firewall-protected cells:

```typescript
import { buildFirewallLock } from '@ckb-firewall/sdk';

const firewallLock = buildFirewallLock({
  // The underlying lock that controls ownership (e.g., secp256k1 or Omnilock)
  innerLock: mySecp256k1Lock,
  // The deployed Firewall Lock Script's code hash and hash type
  firewallCodeHash: '<deployed-firewall-code-hash>',
  firewallHashType: 'type',
  // Registry cell type script (used to locate the correct cell_dep at runtime)
  registryTypeScript: {
    codeHash: '<registry-type-code-hash>',
    hashType: 'type',
    args: '<registry-type-args-hex>',
  },
});

// Use firewallLock as the lock for the agent's wallet cells
```

---

## Governance

The blacklist is community property. It is not controlled by any single developer, company, or team. The governance process is designed to be:

- **Deliberate** — a 72-hour minimum review window prevents rushed additions.
- **Transparent** — all proposals, votes, and updates are on-chain and publicly readable.
- **Resistant to single-party control** — the 3-of-5 multisig requirement means any update requires coordination among multiple independent keyholders.
- **Auditable** — every version of the blacklist is recoverable from on-chain history.

The threshold for adding an address to the blacklist is evidence of malicious intent — confirmed exploit contracts, active drainer wallets, addresses flagged by multiple independent security researchers. The threshold for removal is evidence that the flagging was erroneous or that the risk has been remediated.

**Normative policy** (quorum, voting, multisig execution, emergency temporary adds with `expires_at`, and housekeeping) lives in [`governance/voting.md`](./governance/voting.md) and the overview in [`docs/governance.md`](./docs/governance.md). This README stays descriptive; those files are the single source of truth so thresholds cannot drift in two places.

See `governance/voting.md` for the complete process, including how to become a registered validator and how to submit a proposal.

---

## Security Model

**What the Firewall protects against:**
- Transactions sent to known exploit contracts or drainer wallets.
- Agents compromised by prompt injection that attempt to redirect funds to attacker-controlled addresses.
- Sub-agents in multi-agent pipelines being directed to send to blacklisted destinations by a compromised orchestrator.

**What the Firewall does not protect against:**
- Addresses not yet on the blacklist. New exploits require governance proposals before protection applies.
- Malicious logic within a transaction that does not involve blacklisted *addresses* specifically (e.g., data corruption, non-financial exploits). The Firewall is an address-based blacklist, not a general transaction safety analyzer.
- Compromise of the governance keyholder set itself. This is mitigated by the multisig threshold and review window, but not eliminated.
- Agent wallet cells that do not use the Firewall Lock Script. Consensus enforcement only applies to cells explicitly protected with this lock.

**Fail-safe behavior:**
If the Firewall Lock Script cannot read the Registry Cell during validation, it defaults to **rejecting the transaction**. A firewall that fails open is not a firewall. Registry lookup uses stable identity matching across `cell_deps`, and validation requires exactly one matching registry dep: zero matches or multiple matches both fail closed.

**Deterministic registry dep selection:**
The firewall lock MUST scan all `cell_deps` and select registry candidates whose **type script** matches the configured `(code_hash, hash_type, args)` triple from lock args. Validation continues only when exactly one candidate is found. This prevents ambiguity between SDK and on-chain implementations.

**Registry Cell integrity:**
The Registry Cell's type script verifies that any update carries valid multisig authorization. An update transaction that modifies the blacklist without the required signatures will be rejected at consensus. The blacklist cannot be silently poisoned.

---

## Relationship to CKB Agent Control Hub

The Transaction Firewall is the enforcement backend for the [CKB Agent Control Hub](https://github.com/digitaldrreamer/ckb-agent-control-hub). The Control Hub is the full authorization and identity layer for CKB agents — it manages agent identities, configuration (model parameters, system prompts, tool permissions, retrieval rules), permission cells, and a CKB-native agent marketplace.

The relationship is layered:

```
CKB Agent Control Hub
  └── Defines what an agent is authorized to do
       (identity, config, capabilities, permissions)

CKB Transaction Firewall  ← this repo
  └── Enforces what no agent is ever allowed to do
       (blacklisted addresses, consensus-level, requires Firewall lock)
```

An agent operating on CKB should use both. The Firewall provides the absolute floor — the rules that apply to every agent regardless of configuration. The Control Hub provides the policy layer above that floor — the rules that are specific to each agent's authorized scope.

---

## Contributing

Contributions are welcome. For code changes, open an issue before submitting a pull request for anything significant. For blacklist governance contributions (proposals to add or remove entries), follow the process in `governance/voting.md`.

```bash
# Fork the repo, then:
git checkout -b feat/your-feature
# Make changes
git commit -m "feat: description"
# Push and open a PR targeting main
```

---

## License

MIT License. See [LICENSE](./LICENSE).
