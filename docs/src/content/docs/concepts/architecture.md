---
title: Architecture
description: The firewall's consensus layer, pre-flight layer, registry state, and governance flow.
---

For what the firewall actually does, read [Why this exists](/concepts/why-this-exists/) first.

The stack breaks into four pieces:

- The **firewall lock** enforces blacklist checks at consensus
- The **registry cell** stores the blacklist as a BLKL v2 payload
- The **SDKs** run the same check locally before signing
- **Governance** updates the registry through signed, time-locked transactions

## Why both a lock and an SDK

The SDK check runs in your process — the same trust zone as your application code, your dependencies, and any compromised agent runtime. If something in that zone skips the check or manipulates the output list, the SDK does nothing.

The lock runs on every CKB node during consensus validation. It cannot be bypassed from within the transaction builder. If the spent cell uses the firewall lock and an output is blacklisted, the transaction is rejected by the network regardless of how it was constructed.

Running both gives you a fast, actionable error before broadcast (SDK) and a guarantee that survives application-layer compromise (lock).

## The firewall lock in detail

The firewall lock is a RISC-V contract that runs when a firewall-protected cell is consumed. It:

1. Scans cell deps for exactly one registry cell whose type script matches the configured registry identity (by code hash, hash type, and Type ID value)
2. Parses the BLKL v2 payload from that cell
3. Checks each transaction output's lock args and/or type args against the blacklist
4. If all checks pass, spawns the inner lock via `spawn_cell` with the inner lock args and the user's secp256k1 signature as argv
5. Returns success only if the inner lock also exits zero

A single firewall lock can consult multiple registry cells (multi-registry). All required registries must be present as cell deps.

## The registry cell

The registry is a single live cell whose data is a BLKL v2 binary payload. It contains:
- A governance header (signer pubkeys, threshold, validator Merkle root)
- A sorted list of blacklisted identifiers with optional expiry timestamps

The cell's type script is the `blacklist-registry` contract, which enforces: correct payload structure, sort order, governance-lock identity on the cell, and GOV1 v3 witness binding on every update. Its Type ID is the stable identity — the type_id_value in the registry type args stays fixed across governance updates.

## Governance updates

Registry updates replace the registry cell entirely. A governance transaction:
1. Consumes the old registry cell as input
2. Produces a new registry cell as output with updated BLKL data
3. Carries a GOV1 v3 witness (in `WitnessArgs.input_type`) committing to the proposal ID, vote digest, old root, new root, and review window end timestamp
4. Carries governance signer entries (in `WitnessArgs.lock`) that the governance-lock script verifies against the on-chain committee pubkeys from the BLKL header

Only one update can be in-flight at a time — the registry is a single consumed-and-recreated cell.

## Failure behavior

The firewall is intentionally fail-closed:

| Condition | Result |
|---|---|
| Registry dep missing | Reject (`MissingRegistryCellDep`, code 8) |
| Multiple matching registry deps | Reject (`AmbiguousRegistryCellDep`, code 17) |
| Malformed payload | Reject (`InvalidRegistryData`, code 9) |
| Unsorted entries | Reject (`RegistryNotSorted`, code 10) |
| Blacklisted lock args | Reject (`BlacklistedLockArgs`, code 11) |
| Blacklisted type args | Reject (`BlacklistedTypeArgs`, code 12) |

## Data flow for a spend

1. Wallet builds an unsigned transaction with the registry cell in cell deps
2. SDK pre-flight check runs locally — same logic as the lock
3. Transaction is signed and broadcast
4. CKB nodes run the firewall lock during consensus validation
5. If the lock passes, the inner lock (`spawn-aware-secp256k1`) is spawned to verify the secp256k1 signature

## Read next

- [Firewall lock](/concepts/firewall-lock/)
- [Inner lock](/concepts/inner-lock/)
- [Blacklist registry](/concepts/blacklist-registry/)
- [Governance](/concepts/governance/)
- [Security model](/concepts/security-model/)
