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
- Identified by stable singleton identity (`registry_type_hash` + `registry_type_args_hash`), not mutable outpoint pinning.
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
2. Review and voting complete under governance rules.
3. Multisig signers execute registry replacement transaction.
4. New registry cell becomes authoritative for future transactions.

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
