---
title: Architecture
description: The firewall’s consensus layer, pre-flight layer, registry state, and governance flow.
---

For motivation and scope, read [Why this exists](/concepts/why-this-exists/) first.

The stack breaks down into four pieces:

- The firewall lock enforces blacklist checks during transaction validation.
- The registry cell stores the blacklist.
- The SDKs do local pre-flight checking before signing.
- Governance updates the registry through signed transactions.

## Why this split exists

The SDK gives you a fast answer and a structured error.

The lock script is the actual enforcement floor. If the SDK is skipped, the on-chain lock still has to reject blacklisted spends.

## Data path

1. A wallet or agent builds an unsigned transaction.
2. The SDK reads the live registry data and checks the outputs.
3. If the transaction is acceptable, it is signed and broadcast.
4. CKB nodes validate the firewall lock again during consensus.

## Registry updates

Registry updates replace the registry cell itself.

Wallet cells that use the firewall lock do not need a migration as long as the registry type-script identity stays the same.

## Failure behavior

The firewall is intentionally fail-closed:

- Missing registry dependency: reject
- Ambiguous registry dependency: reject
- Invalid registry payload: reject
- Blacklisted output: reject

## Next

- [Firewall lock](/concepts/firewall-lock/)
- [Blacklist registry](/concepts/blacklist-registry/)
- [Governance](/concepts/governance/)
