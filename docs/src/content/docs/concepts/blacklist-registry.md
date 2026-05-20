---
title: Blacklist Registry
description: The on-chain registry cell and type script that store and gate updates to the blacklist.
---

The blacklist registry is a single CKB cell whose data is a BLKL v2 binary payload. Every firewall lock that references this registry reads its entries as a cell dep during transaction validation.

## What it stores

- A governance header: signer pubkeys, threshold, validator count, and validator Merkle root
- A sorted list of blacklisted identifiers, each with an optional expiry timestamp

The governance header is embedded directly in the BLKL payload — signer rotation requires a new governance update, not a contract redeployment.

## Type ID identity

The registry cell uses CKB's Type ID mechanism. When a governance update replaces the cell, the new cell keeps the same Type ID value in its type args. The firewall lock identifies the registry by this Type ID value (bytes 34–65 of the 66-byte v2 type args), so updates do not require migrating every firewall-protected wallet.

## Update model

Updates are not edits. Each governance transaction:
- Consumes the old registry cell (input)
- Produces a new registry cell (output) with updated data
- Carries a GOV1 v2 binding in `WitnessArgs.input_type`
- Carries governance signer entries in `WitnessArgs.lock`

The `blacklist-registry` type script validates the payload structure, sort order, governance-lock identity, and GOV1 binding before accepting any update.

## Serialized updates

Only one update can be in-flight at a time. Two governance proposals approved simultaneously will race: only one can succeed, because only one can consume the current registry cell. The second proposal's transaction will fail because the cell it references no longer exists.

## Cell dep timing window

When a governance update confirms, the old registry cell is consumed. Any pending user transaction that holds the old cell as a dep will fail at the miner. Governance updates should be announced before submission so users can rebuild their in-flight transactions against the new cell.

## Expired entries

Entries with `expiresAt` timestamps stay in the registry payload indefinitely — there is no automatic cleanup. Removing an expired entry requires a new governance proposal. Operators should monitor registry size if frequent temporary listings are expected.

## What to read next

- [BLKL format](/reference/blkl-format/)
- [GOV1 witness](/reference/gov1-witness/)
- [Governance](/concepts/governance/)
- [Security model](/concepts/security-model/)
