---
title: Security Model
description: What the firewall protects, what it does not protect, and the limits of on-chain governance enforcement.
---

The firewall is designed around a narrow security claim: if a wallet cell uses the firewall lock, blacklisted destinations should fail closed at consensus.

## Protects against

- Compromised application code that skips a client-side check
- Unsafe outputs that target already listed destinations
- Missing or ambiguous registry dependencies

## Does not protect against

- Addresses not yet added to the registry
- Other exploit classes that are not address-based
- Governance key compromise
- Wallet cells that do not use the firewall lock

## Governance enforcement limits

- The registry type script validates update topology and the registry payload.
- The governance workflow binds each update to proposal and vote context.
- On-chain validation does not by itself guarantee broader policy outcomes beyond those checks.

For the operational update path, see [How to Use](../getting-started/how-to-use.mdx) and the [CLI reference](../reference/cli.md).

## Operational assumption

The system assumes the registry cell that the lock reads is the one produced by the current governance process. If that assumption is broken, the chain should still fail closed rather than silently accept a bad update.
