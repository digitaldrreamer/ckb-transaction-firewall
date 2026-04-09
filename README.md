# CKB Transaction Firewall

> Protocol-level transaction safety for AI agents on Nervos CKB — community-governed blacklist enforcement via lock scripts.

## Overview

CKB Transaction Firewall is a safety infrastructure layer for AI agents operating on the Nervos CKB blockchain. As autonomous AI agents gain the ability to sign and broadcast transactions, the risk of malicious, compromised, or misconfigured agents draining wallets or interacting with exploit contracts becomes real. This project establishes a **protocol-level firewall** — enforced directly in CKB lock scripts — that prevents transactions involving blacklisted addresses from being submitted or confirmed.

The blacklist is **community-governed**: curated and updated by a decentralized set of contributors, and enforced on-chain without requiring any centralized relay or off-chain oracle trust assumption.

---

## Problem Statement

AI agents on blockchain face a unique threat model:

- Agents may be compromised by prompt injection, malicious tool outputs, or adversarial inputs.
- Agents often operate with minimal human oversight, making real-time intervention difficult.
- Smart contracts on CKB are immutable once deployed — bad interactions can't easily be undone.
- Existing wallet security tools (e.g., simulation, static analysis) are reactive, not preventive at the protocol layer.

There is no existing primitive on Nervos CKB that lets an agent's wallet enforce **pre-transaction blacklist checks** directly in the locking logic.

---

## Solution

CKB Transaction Firewall introduces:

1. **Firewall Lock Script** — A custom CKB lock script that verifies, at transaction validation time, that none of the transaction's output `lock_args` or `type_args` match entries in a registered blacklist cell.
2. **Blacklist Registry Cell** — An on-chain data cell holding the current blacklist. Governed by a multisig or DAO mechanism, allowing community-driven updates.
3. **Agent SDK Integration** — A lightweight TypeScript/Rust SDK that AI agent runtimes can use to wrap their signing flow with firewall enforcement before broadcasting.
4. **Governance Module** — Proposals, voting, and update flow for adding/removing blacklist entries.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  AI Agent Runtime                │
│  (LLM + tool calls + wallet signing logic)       │
└────────────────────┬────────────────────────────┘
                     │ sign transaction
                     ▼
┌─────────────────────────────────────────────────┐
│            Firewall SDK (pre-broadcast)          │
│  - Fetches current Blacklist Registry Cell       │
│  - Checks all tx outputs against blacklist       │
│  - Rejects or flags before signing               │
└────────────────────┬────────────────────────────┘
                     │ valid tx
                     ▼
┌─────────────────────────────────────────────────┐
│              CKB Node / Mempool                  │
│  Firewall Lock Script validates on-chain         │
│  (double enforcement at consensus layer)         │
└─────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│           Blacklist Registry Cell                │
│  On-chain data: blacklisted lock_args/addresses  │
│  Updated via governance proposal + multisig      │
└─────────────────────────────────────────────────┘
```

---

## Repository Structure

```
ckb-transaction-firewall/
├── contracts/
│   ├── firewall-lock/          # CKB lock script (Rust + ckb-std)
│   │   ├── src/
│   │   │   └── main.rs
│   │   └── Cargo.toml
│   └── blacklist-registry/     # On-chain blacklist data cell type script
│       ├── src/
│       │   └── main.rs
│       └── Cargo.toml
├── sdk/
│   ├── typescript/             # Agent SDK for pre-broadcast enforcement
│   │   ├── src/
│   │   │   ├── firewall.ts
│   │   │   ├── blacklist.ts
│   │   │   └── index.ts
│   │   └── package.json
│   └── rust/                   # Rust SDK (for native agent runtimes)
│       └── src/
│           └── lib.rs
├── governance/
│   ├── proposal-schema.json    # Blacklist update proposal format
│   └── voting.md               # Governance process documentation
├── tests/
│   ├── unit/
│   └── integration/
├── research/
│   └── research.md             # Background research and design rationale
├── docs/
│   ├── architecture.md
│   ├── lock-script-spec.md
│   └── governance.md
├── scripts/
│   ├── deploy.sh
│   └── update-blacklist.ts
├── Cargo.toml
├── package.json
└── README.md
```

---

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (1.70+)
- [ckb-cli](https://github.com/nervosnetwork/ckb-cli)
- [Node.js](https://nodejs.org/) 18+
- A running CKB testnet node or access to a public testnet RPC

### Building the Lock Script

```bash
# Install ckb-capsule (CKB contract build tool)
cargo install ckb-capsule

# Build the firewall lock contract
cd contracts/firewall-lock
capsule build
```

### Running Tests

```bash
# Unit tests (Rust)
cargo test

# Integration tests against CKB testnet
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
  blacklistCellOutPoint: '<deployed-registry-outpoint>',
});

// Wrap your transaction before signing
const isSafe = await firewall.checkTransaction(myTx);
if (!isSafe) {
  throw new Error('Transaction blocked by firewall: blacklisted address detected');
}
```

---

## Governance

The blacklist registry is updated through a structured governance process:

1. **Submit Proposal** — Anyone can submit a proposal (as a JSON file conforming to `governance/proposal-schema.json`) to add or remove a blacklist entry.
2. **Community Review** — Proposals are reviewed by registered community validators for a minimum of 72 hours.
3. **Multisig Execution** — Approved proposals are executed via a 3-of-5 multisig update to the Blacklist Registry Cell.
4. **On-chain History** — All updates are recorded on-chain with the proposer's identity and vote tally.

See `governance/voting.md` for the full process.

---

## Security Considerations

- **Dual enforcement**: Blacklist checks happen both pre-broadcast (SDK) and at consensus (lock script), preventing both agent-level mistakes and relay-level bypasses.
- **Registry cell integrity**: The Blacklist Registry Cell is protected by a type script that enforces valid governance signatures for any update.
- **No oracle dependency**: All blacklist data lives on-chain. No external API calls are required during transaction validation.
- **Fail-safe default**: If the registry cell cannot be read (e.g., chain fork, cell consumed), the firewall defaults to **blocking** all transactions until the registry is restored.

---

## Contributing

Contributions are welcome. Please open an issue before submitting a pull request for significant changes. For governance-related contributions (blacklist proposals), follow the process in `governance/voting.md`.

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Commit your changes with descriptive messages
4. Open a pull request targeting `main`

---

## License

MIT License. See [LICENSE](./LICENSE).
