---
title: Before You Adopt the Firewall Lock
description: Irreversible operational consequences of adopting the firewall lock that architects and operators need to know before committing.
---

Adopting the firewall lock has operational consequences that are difficult or impossible to reverse. This page describes them clearly so they do not become surprises after you have deployed.

## Your CKB address changes

The firewall lock is a different lock script from the standard secp256k1 lock. A different lock script produces a different CKB address.

Every existing UTXO your wallet holds is protected by your old lock script, at your old address. Those cells are not automatically migrated. If you adopt the firewall lock, you must explicitly spend each existing cell into a new output at your new firewall-protected address. Until that migration is complete, the old cells remain under the old lock with no firewall protection.

There is no in-place upgrade. There is no way to retroactively apply the firewall lock to cells that were created under a different lock.

## Lock args are immutable after deployment

The firewall lock args encode which registry cells the lock consults and which inner lock it delegates to. Once a cell is created with a particular set of lock args, those args cannot change — to change them, you must create a new cell with new lock args and spend the old cell into it. This is effectively a new address migration.

This matters in two scenarios:

**Registry change.** If you want to point at a different registry, or add a second registry to an existing configuration, every cell using the old lock args must be migrated to new lock args.

**Inner lock change.** If you want to change the inner lock (for example, moving from `spawn-aware-secp256k1` to a different signing scheme), every protected cell must be migrated.

Plan the registry identity and inner lock choice carefully before the first migration, because changing them is as expensive as the initial migration.

## In-flight transactions fail after governance updates

When a governance update confirms, the old registry cell is consumed. Any pending user transaction that includes the old cell as a dep will fail at the miner level — the dep no longer exists.

This is not a special failure mode; it is normal CKB behavior for any consumed cell dep. But it is easy to overlook when a governance update is submitted during a period of active user traffic.

Applications that hardcode the registry cell outpoint are most exposed. The SDK's `findRegistryCell` and the CLI's auto-discovery avoid this by discovering the current outpoint via the indexer before building each transaction.

Governance updates should be announced before submission and submitted at low-traffic periods.

## Only one governance update can be in-flight at a time

The registry is a single cell. Two governance transactions that both try to consume the current registry cell will race — only one can succeed. The other fails because the cell it references has already been consumed.

The governance system provides no mechanism to queue or merge proposals. If two proposals are ready to execute simultaneously, one must wait until the other confirms and a new registry cell exists.

For community registries with moderate update volume, this is not a practical constraint. For registries that need to process many additions quickly (for example, during an active exploit), the serialization constraint can delay entries reaching the chain.

## The treasury-lock args are fixed at deploy time

The treasury-lock's args encode the `governance_lock_type_id` and `proposal_anchor_type_id`. These values are set at treasury-lock deploy time and cannot change.

If the governance-lock or proposal-anchor contracts are redeployed (new code, new Type IDs), the treasury-lock becomes incompatible with them. Treasury funds would be stranded — the old treasury-lock accepts spending only for the old contract Type IDs, but governance now uses the new ones.

Recovering stranded treasury funds requires either:
- Deploying a new treasury-lock with updated args and migrating all pool cells to the new address
- Or including a migration path in the contract upgrade that the old treasury-lock accepts

Contract upgrades that change Type IDs require careful planning to avoid this situation.

## Adopting the firewall lock is a security commitment, not a feature flag

Adding the firewall lock to a wallet cell means every spend of that cell must include a valid registry dep and pass the blacklist check. This is a permanent, per-cell commitment. You cannot build a transaction that spends a firewall-protected cell and "skip" the firewall for a particular transfer.

If you need to send to an address that is currently blacklisted and you believe the listing is in error, the resolution path is governance — proposing removal and waiting for the review window — not bypassing the lock.

## Summary

Before adopting the firewall lock, confirm that:

- You have a plan for migrating existing UTXOs to the new address
- You have chosen the correct registry identity and inner lock for your long-term configuration
- Your transaction-building code uses `findRegistryCell` rather than a hardcoded outpoint
- Your operations team understands the governance update timing constraint
- The treasury (if you operate your own registry) has a maintenance plan for contract upgrades

## See also

- [Trust model and guarantees](/concepts/trust-model-and-guarantees/) — exact guarantees and trust assumptions
- [How to build a firewall lock script](/how-to/build-firewall-lock-script/) — construct the v2 lock args
- [How to build cell deps for spending](/how-to/build-spend-cell-deps/) — assemble the required cell deps
- [Registry operator tutorial](/get-started/operator/) — deploy a registry and understand the lifecycle end-to-end
