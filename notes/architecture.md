# Architecture

This document defines the v1 architecture of the CKB Transaction Firewall and the boundaries between off-chain pre-flight checks and on-chain consensus enforcement.

## Goals

- Prevent transactions from reaching blacklisted destinations.
- Preserve agent autonomy while adding a passive safety floor.
- Keep blacklist governance decentralized and auditable.
- Ensure checks remain enforceable even if application code is compromised.

## Non-goals

- Detecting non-address-based exploit behavior.
- Replacing full transaction simulation or formal verification.
- Providing cross-chain blacklist synchronization in v1.

## System Components

### 1) Firewall Lock Script (consensus layer)

- Runs for every spend of firewall-protected cells.
- Loads the Blacklist Registry Cell via `cell_dep`.
- Extracts transaction output destination identifiers (`lock_args`, optional `type_args` strategy per policy).
- Rejects transaction on first blacklist match.

### 2) Blacklist Registry Cell (shared state)

- Stores serialized blacklist data in on-chain cell data.
- Protected by a registry type script that validates governance authorization.
- Identified by stable **type script identity** (`code_hash`, `hash_type`, `args`) on the registry cell, not mutable outpoint pinning.
- Referenced read-only as `cell_dep` by transactions using the firewall lock.

### 3) Agent SDK (pre-flight layer)

- Fetches and parses the latest registry cell data from CKB RPC.
- Performs deterministic local checks before signing.
- Returns structured errors for operators and automated runtimes.
- Does not replace consensus checks; it complements them.

### 4) Governance Module

- Defines proposal schema and review/voting/execution lifecycle.
- Produces signed update transactions that replace the registry cell.
- Maintains transparent on-chain history of changes.

## Data Flow

### Transaction path (normal)

1. Agent runtime constructs unsigned transaction.
2. SDK pre-flight check runs against current registry snapshot.
3. If safe, agent signs and broadcasts.
4. Nodes validate; firewall lock enforces the same policy at consensus.

### Governance path (registry update)

1. Proposal created from evidence-backed request.
2. Treasury-funded proposal anchor cell created on-chain; 72-hour review window begins at consensus.
3. Validators vote; each vote is secp256k1 signed and vote signatures are used directly in the execute transaction.
4. After the review window and vote threshold are met, the execute transaction consumes the proposal anchor and produces the new registry cell (keyless — no separate signing step).
5. New registry cell becomes authoritative for future transactions.

## Trust and Threat Model

- Agent runtime is not trusted as a sole enforcement point.
- SDK may be bypassed by malicious prompts or compromised tool chains.
- Consensus lock validation is trusted because miners/nodes run it.
- Governance keyholder compromise is mitigated, not eliminated, by multisig threshold and process transparency.

## Failure Semantics

- Missing/invalid registry dependency defaults to rejection for firewall-protected spends.
- Registry dep selection is deterministic: exactly one matching registry dep is required; zero or multiple matches reject.
- SDK RPC failures return explicit retriable errors and should block signing by default.
- Governance execution that fails type-script checks is rejected by consensus.

## Operational Constraints

- Governance updates must be sequenced carefully to avoid dep-cell race windows with in-flight mempool transactions.
- Registry growth increases script processing overhead; size/perf limits should be monitored.
- Emergency update policy is recommended for actively exploited addresses.

## Versioning Strategy

- Contract and SDK versions must be tracked independently.
- Registry data format version should be included in serialized payload.
- Any breaking change to registry encoding requires compatibility notes and migration planning.

---

## Why CKB fits this design

This section complements the component view above: it explains **why** the Firewall is implemented on Nervos CKB rather than as a generic “any chain” library.

### Lock scripts are first-class validation logic

On Ethereum, the traditional account model separates externally-owned accounts (EOAs, with no programmable validation logic) from smart contracts (which require explicit coding of every validation rule and carry deployment overhead). There is no native way to say “any transaction spending from this address must pass this blacklist check” without deploying a custom contract wallet or modifying every application that interacts with the address.

This gap has narrowed with recent Ethereum upgrades. [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702), shipped in the Pectra upgrade (May 2025), allows EOAs to delegate execution to contract code for the duration of a transaction, and [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) (live since 2023) enables arbitrary validation logic via smart contract wallets. These are meaningful steps toward programmable validation at the address level.

However, CKB’s model is structurally different in ways that matter for this use case. On CKB, every cell has a **lock script**: arbitrary RISC-V code that runs at consensus every time the cell is spent. The lock script is not an application contract. It is the spending condition itself, evaluated by every CKB node as part of transaction validation. This is a permanent, unconditional constraint baked into the cell, not a transaction-scoped delegation (as in EIP-7702) or a separate infrastructure layer requiring bundlers and an alt mempool (as in ERC-4337).

This means a firewall lock script can be applied to any agent wallet cell. When the agent tries to spend its funds, the lock script runs, checks the blacklist, and either permits or rejects the transaction at the miner level, not the application level. No contract deployment per wallet. No trust in the agent’s own code. The check is simply part of what it means to spend the cell.

### The cell model makes blacklists composable

On CKB, data lives in cells. A cell can be referenced in a transaction as a `cell_dep`, a read-only dependency that is available to all scripts during validation but is not consumed by the transaction. This is the mechanism the Firewall uses for its blacklist.

The Blacklist Registry Cell contains the current blacklist data. Scripts reference it as a `cell_dep` during transaction validation. Important consequences:

- The blacklist is read by every transaction that uses the Firewall lock, without those transactions spending or modifying the blacklist cell.
- Updating the blacklist is a single governance transaction that replaces the Registry Cell. All future transactions automatically use the new blacklist, with no redeployment of scripts, no migration, and no per-wallet update.
- The Registry Cell’s integrity is protected by its own type script, which requires valid governance signatures for any update. The blacklist cannot be silently modified.

This architecture is not possible on account-model chains without significantly more complexity. On CKB it is the natural pattern.

> **Governance sequencing note:** When a governance transaction destroys the Registry Cell to replace it, any in-flight transactions that reference the old cell as a `cell_dep` may cause miners to fail block template generation if the cells are in the same mempool window. Governance updates should be timed and sequenced carefully. This is an inherent property of the CKB cell model and is not unique to this project. See [CKB security advisory GHSA-v666-6w97-pcwm](https://github.com/nervosnetwork/ckb/security/advisories/GHSA-v666-6w97-pcwm) for context.

### No oracle dependency

Many blockchain security systems rely on off-chain oracles to feed data on-chain for validation. Oracles introduce trust assumptions: if the oracle is compromised, the security guarantee disappears. The Transaction Firewall has no oracle. The blacklist is a CKB cell, updated by on-chain governance transactions, read by on-chain scripts. The entire system operates within CKB’s security model.
