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

## Registry invariants

- Entries are sorted strictly by identifier bytes; duplicates cause `RegistryNotSorted` and are rejected
- `lock_args` and `type_args` are checked independently, controlled by the flags byte in the lock args
- The registry cell outpoint moves after every governance update — always fetch a fresh outpoint before building a transaction

## Fail-closed behavior

[Fail-closed](/reference/glossary/#fail-closed) means when in doubt, reject — there is no "allow by default":

- Missing [registry dep](/reference/glossary/#cell-dep) → reject ([`MissingRegistryCellDep`](/reference/error-codes/#firewall-lock), code 8)
- More than one matching registry dep → reject ([`AmbiguousRegistryCellDep`](/reference/error-codes/#firewall-lock), code 17)
- Malformed or unsorted registry payload → reject ([`InvalidRegistryData`](/reference/error-codes/#firewall-lock), code 9)
- Output matches a blacklisted identifier → reject ([`BlacklistedLockArgs`](/reference/error-codes/#firewall-lock), code 11)

## Time-based entries and header_deps

Blacklist entries can have an `expiresAt` unix timestamp. The firewall reads the chain's [median block time (MTP)](/reference/glossary/#median-block-time-mtp) to evaluate expiry — and **median block time requires [`header_deps`](/reference/glossary/#header_deps) in the spending transaction**.

If a [firewall-protected cell](/reference/glossary/#firewall-protected-cell) is spent without `header_deps`, the median time evaluates to zero, and all temporary entries are treated as permanently active. The transaction does not fail with a clear error — it silently enforces the wrong policy, blocking spends it should allow.

Always include a recent block hash in `header_deps` when spending a firewall-protected cell if the [registry cell](/reference/glossary/#registry-cell) contains time-based entries.

## Registry updates and in-flight transactions

A governance update consumes the old registry cell and creates a new one. Any pending user transaction that holds a reference to the old cell as a `cell_dep` will fail at the miner level once the governance transaction confirms — the referenced dep cell no longer exists.

For this reason, governance updates should be announced before submission, and submitted at low-traffic periods when fewer in-flight transactions are likely to be affected.

## Governance serialization

Only one registry update can be in-flight at a time. The registry is a single cell; two simultaneously-approved governance proposals will race, and one will fail because the cell it references has already been consumed. The CLI does not automatically detect or retry this race.

## What the governance lock enforces on-chain

The `governance-lock` script enforces three things:

**Review window.** The anchored `PBLK` proposal input's `since` field must encode a relative median-time-past delay >= `review_delay_ms` from the GOV1 v4 witness. CKB consensus refuses to include the transaction until that proposal input has aged by the required delay. This is not a CLI rule — bypassing the CLI and building the transaction manually does not circumvent it.

**Validator vote threshold.** The script reads the validator Merkle root and threshold from the BLKL v2 governance header embedded in the registry cell. Each yes vote in `WitnessArgs.lock` carries the validator pubkey, vote signature, and Merkle proof. Fewer than threshold valid validator yes votes → reject.

The `execute` CLI also verifies vote signatures and Merkle proofs before building the transaction, but the on-chain governance lock is the final authority.

## See also

- [The two-layer model](/concepts/two-layer-model/) — why both the SDK check and the on-chain lock are necessary
- [Trust model and guarantees](/concepts/trust-model-and-guarantees/) — exact guarantees, trust assumptions, what key compromise means
- [Before you adopt the firewall lock](/concepts/before-you-adopt/) — irreversible operational consequences before committing
- [How to handle time-based entries](/how-to/time-based-entries/) — how to add `header_deps` for temporary blacklist entries
- [How to recover when the registry cell moves](/how-to/recover-stale-registry/) — registry outpoint staleness after governance updates
- [Troubleshooting](/how-to/troubleshoot/) — symptom-to-fix routing for all error codes
