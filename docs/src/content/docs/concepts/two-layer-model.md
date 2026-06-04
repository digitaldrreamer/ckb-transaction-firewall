---
title: The Two-Layer Model
description: Why the firewall uses both an off-chain SDK check and an on-chain lock script, and what each layer actually guarantees.
---

The firewall has two enforcement layers: an off-chain SDK pre-flight check and an on-chain lock script. They are not redundant. They serve different purposes and protect against different failure modes. Using one without the other is weaker than it might appear.

## What each layer does

**The [SDK pre-flight check](/reference/glossary/#pre-flight-check)** runs in your process — the same trust zone as your application code, your dependencies, and any tooling that has access to your build environment. It is synchronous, gives you structured [error codes](/reference/error-codes/) before signing, and costs nothing on-chain. It is fast feedback for the common case.

**The on-chain [lock script](/reference/glossary/#firewall-lock)** runs on every CKB full node during transaction validation. It cannot be skipped by application code, bypassed by a compromised dependency, or turned off by a configuration flag. If a transaction tries to spend a [firewall-protected cell](/reference/glossary/#firewall-protected-cell) and an output matches a blacklisted identifier, every node rejects the transaction — regardless of what your application did or did not do.

## The trust zone distinction

The SDK check runs inside your application's trust zone:

```
┌──────────────────────────────────────────────────────────┐
│  Application trust zone                                  │
│                                                          │
│  your code → SDK check → sign → broadcast                │
│                                                          │
│  Also in this zone:                                      │
│  - compromised dependencies                              │
│  - dead feature flags that disable checks                │
│  - forked code paths that skip the SDK call              │
│  - prompt injection that rewrites outputs after checking │
└──────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│  CKB network                                             │
│                                                          │
│  Every node runs the firewall lock script                │
│  Nothing in the application trust zone affects this      │
└──────────────────────────────────────────────────────────┘
```

An attacker who controls any part of the application trust zone can, in principle, skip the SDK check. They cannot skip the lock script.

## Why you still need the SDK

If the lock script provides the real guarantee, why run the SDK at all?

**The lock rejects without explanation.** A transaction rejected at consensus leaves the user with a failed broadcast and no structured error. The SDK gives a typed error code before you sign — [`BlacklistedLockArgs`](/reference/error-codes/#firewall-lock), [`MissingRegistryCellDep`](/reference/error-codes/#firewall-lock), [`RegistryNotSorted`](/reference/error-codes/#firewall-lock) — that your application can handle and surface meaningfully.

**The lock costs fees to learn from.** Submitting a transaction just to have it rejected wastes fees. For applications that build many transactions, pre-flight filtering is economically necessary.

**The lock runs after signing.** If your application signs first and submits, discovering a rejection means the signed transaction is wasted. Pre-flight moves the discovery before the signing step.

**The lock cannot tell you which output was blocked.** The SDK can identify the exact output and the exact registry entry that matched, because it runs in a context where you have that information structured. The lock just exits with an error code.

## Why you still need the lock

If the SDK catches blacklisted outputs before signing, why run the lock at all?

**Compromised code paths skip the SDK.** The SDK can only run if the code that calls it runs. A bug, a dead code path, a compromised process, or an adversarial tool that generates transactions without going through your SDK integration all bypass the check silently.

**The SDK is optional.** Nothing enforces that every piece of software that builds transactions involving your wallet calls the SDK. A transaction built by a third-party tool, a migration script, or an emergency recovery tool might never touch it.

**The SDK operates on your snapshot of the registry.** The lock operates on the live chain state. A sophisticated attacker who manages to slip a transaction between a registry update and your next SDK refresh would pass the SDK check but still fail the lock — if the cell uses the firewall lock.

## The guarantee each layer provides

| Layer | Guarantee |
|---|---|
| SDK | "This output was not blacklisted at the time this code ran" |
| Lock | "This output was not blacklisted at the time this block was validated, on every node" |

The SDK guarantee depends on the integrity of the process that ran it. The lock guarantee depends on CKB consensus — it holds regardless of what any application did.

## What neither layer guarantees

- Addresses not yet on the blacklist at the time of validation
- Attacks that do not produce a blacklisted output
- Cells that do not use the firewall lock
- The SDK is not a substitute for the lock when the threat model includes compromised application code

See [Security model](/concepts/security-model/) for the complete boundary, and [Why this exists](/concepts/why-this-exists/) for the specific threat scenarios this design addresses.

## See also

- [Why this exists](/concepts/why-this-exists/) — the threat scenarios that motivate this design
- [Integration tutorial](/get-started/integration/) — build the SDK pre-flight check yourself in 5 steps
- [How to run a pre-flight check in TypeScript](/how-to/preflight-typescript/) — all SDK pre-flight patterns
- [How to run a pre-flight check in Rust](/how-to/preflight-rust/) — Rust SDK check with `check_transaction`
- [Security model](/concepts/security-model/) — what both layers protect against and where the boundary is
