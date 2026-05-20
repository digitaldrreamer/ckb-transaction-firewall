---
title: Security Model
description: What the firewall protects, what it does not, and the operational hazards to know before deploying.
---

## What it is

The firewall is an **outgoing payment filter**. It prevents a wallet cell from being spent in a transaction that sends to a blacklisted address. It does not block incoming payments, does not filter other inputs in the same transaction, and does not affect counterparties that interact with contracts you use.

If a blacklisted entity sends CKB to your wallet, you receive it. If your wallet cell uses the firewall lock and you try to send to a blacklisted address, the transaction is rejected at consensus.

## Protects against

- Sends to known blacklisted lock or type args, enforced by every CKB node
- Application code that skips a client-side check — the lock runs regardless
- Compromised agent runtimes, prompt injection, or hijacked tool outputs that produce a bad destination address

## Does not protect against

- Addresses not yet on the blacklist
- Attack vectors that do not boil down to "send to this address"
- Incoming transfers from blacklisted addresses
- Wallet cells that do not use the firewall lock
- A compromised governance key producing an authorized blacklist update

## Fail-closed behavior

Missing registry dep → reject  
More than one matching registry dep → reject  
Malformed or unsorted registry payload → reject  
Output matches a blacklisted identifier → reject

## Time-based entries and header deps

Blacklist entries can have an `expiresAt` unix timestamp. The firewall reads the chain's median block time to evaluate expiry — and **median block time requires `header_deps` in the spending transaction**.

If a transaction spending a firewall-protected cell omits `header_deps`, the median time evaluates to zero, and all temporary entries are treated as permanently active. The transaction does not fail with a clear error — it silently enforces the wrong policy, blocking spends it should allow.

Always include a recent block hash in `header_deps` when spending a firewall-protected cell if the registry contains time-based entries.

## Registry updates and in-flight transactions

A governance update consumes the old registry cell and creates a new one. Any pending user transaction that holds a reference to the old cell as a `cell_dep` will fail at the miner level once the governance transaction confirms — the referenced dep cell no longer exists.

For this reason, governance updates should be announced before submission, and submitted at low-traffic periods when fewer in-flight transactions are likely to be affected.

## Governance serialization

Only one registry update can be in-flight at a time. The registry is a single cell; two simultaneously-approved governance proposals will race, and one will fail because the cell it references has already been consumed. The CLI does not automatically detect or retry this race.

## What the governance lock enforces on-chain

The `governance-lock` script reads the signer pubkeys and threshold from the BLKL v2 governance header embedded in the registry cell. For each governance signer entry in the witness, it recovers the pubkey via secp256k1 and checks that it matches the committee pubkey at the declared index. Fewer than threshold valid signatures → reject.

Vote signatures are verified off-chain by the `execute` CLI command before the transaction is built. The `execute` command also verifies that each vote pubkey has a valid Merkle membership proof against the on-chain validator Merkle root.
