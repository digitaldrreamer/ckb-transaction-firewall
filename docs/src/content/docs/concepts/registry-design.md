---
title: Registry and Cell Design
description: Why the registry is a single consumed-and-recreated cell, why sorted entries, what fail-closed means operationally, and how the Type ID mechanism works.
---

The blacklist registry is a single live CKB cell. Every time it is updated, the old cell is consumed and a new one is created. This seems like an obvious implementation detail, but the design consequences run deeper than they appear.

## Why a single cell

The registry could have been designed as a list of cells — one per entry, or one per batch. Updates would touch only the affected cells. The blacklist could grow without any structural constraint.

The single-cell model was chosen deliberately, and it is worth understanding why.

**The [firewall lock](/reference/glossary/#firewall-lock) requires exactly one matching [registry dep](/reference/glossary/#cell-dep).** If a transaction includes two registry deps that both match the configured identity, the firewall rejects with [`AmbiguousRegistryCellDep`](/reference/error-codes/#firewall-lock) (code 17). This [fail-closed](/reference/glossary/#fail-closed) behavior eliminates a class of attack: an adversary cannot inject a manipulated registry alongside the real one and hope the firewall reads the manipulated version.

**Governance serialization is enforced by the cell model itself.** Two governance transactions cannot both succeed, because they both consume the same input cell. The second one to be mined finds its input cell already spent and fails. No additional coordination protocol is needed to prevent concurrent updates.

**The complete state is always in one place.** A validator, auditor, or integration that needs the current blacklist fetches one cell. There is no need to aggregate across multiple cells, reconcile partial updates, or handle the case where a subset of cells has been updated and a subset has not.

The tradeoff: the registry cell is a bottleneck. Only one governance update can be in-flight at a time. For a community blacklist with a 72-hour review window per entry, this is not a practical constraint. For a high-volume registry that needs to process many additions per day, it would be.

## Why entries must be sorted

The firewall lock uses binary search to check whether an output's lock or type args appears in the blacklist. Binary search requires the entries to be in strict ascending byte order.

If entries were unsorted, the lock would need to scan the entire list for each output — O(N) instead of O(log N). For a registry with thousands of entries, this would be significantly slower and would increase the on-chain execution cost.

The [`blacklist-registry`](/reference/glossary/#blacklist-registry) type script rejects any update that produces an unsorted payload. The SDK's [`parseRegistryPayload`](/reference/typescript-sdk/) also throws `RegistryNotSortedError` if entries are not in strict order. This means a client that has correctly fetched and parsed the registry is guaranteed to be working with a sorted list — the check happens at parse time, not at query time.

The sort order is raw byte comparison: the bytes of the lock args are compared as byte arrays, not as hex strings. Identifiers of different lengths follow C-style ordering (shorter is less if it is a prefix of the longer one).

## Why Type ID for registry identity

When the registry cell is updated, its outpoint changes — a new transaction, a new index. Every component that references the registry needs to track the current outpoint: the SDK, the CLI, and any firewall lock args that embed the registry identity.

[Type ID](/reference/glossary/#type-id) solves this by giving the cell a stable identity that survives outpoint changes. The identity — [`type_id_value`](/reference/glossary/#type_id_value) — is a 32-byte value computed once at bootstrap as `blake2b(first_input_outpoint || output_index_u64_le)` and embedded in every successor cell's type args. It never changes, no matter how many times governance updates the cell.

The [firewall lock args](/reference/firewall-lock-args/) embed `type_id_value`. When the lock needs to find the registry cell dep, it matches by `type_id_value` against the type args of every cell dep in the transaction — not by outpoint, code hash, or any other property that governance could change.

This means governance can upgrade the governance-lock contract (which changes the `governance_code_hash` stored in the registry type args at bytes 1–33) without breaking any existing firewall lock configuration. The `type_id_value` at bytes 34–65 does not change.

## What fail-closed means operationally

Fail-closed means that when the firewall cannot determine whether a spend is safe, it rejects rather than allows. Specifically:

| Condition | Result |
|---|---|
| Registry dep is missing from the transaction | Reject — [`MissingRegistryCellDep`](/reference/error-codes/#firewall-lock) (code 8) |
| Registry dep is present but payload is malformed | Reject — [`InvalidRegistryData`](/reference/error-codes/#firewall-lock) (code 9) |
| Registry payload entries are not sorted | Reject — [`RegistryNotSorted`](/reference/error-codes/#firewall-lock) (code 10) |
| More than one dep matches the registry identity | Reject — [`AmbiguousRegistryCellDep`](/reference/error-codes/#firewall-lock) (code 17) |
| Output matches a blacklisted identifier | Reject — [`BlacklistedLockArgs`](/reference/error-codes/#firewall-lock) (code 11) or [`BlacklistedTypeArgs`](/reference/error-codes/#firewall-lock) (code 12) |

There is no "allow by default if uncertain." A transaction spending a firewall-protected cell that omits the registry dep fails at consensus, not silently.

The SDK mirrors this behavior: all of the same rejection conditions surface as typed errors before signing.

## In-flight transactions and governance updates

When a governance update is mined, the old registry cell is consumed. Any pending user transaction that holds the old cell as a dep will fail at the miner level: the dep cell it references no longer exists.

This is a consequence of the single-cell model. It is not a bug, but it has operational implications:
- Applications should use `findRegistryCell` to discover the current outpoint rather than caching a fixed outpoint
- Governance updates should be coordinated at low-traffic periods
- The CLI and SDK auto-discover the current outpoint via the indexer; only applications that hardcode outpoints are affected

See [How to recover when the registry cell moves](/how-to/recover-stale-registry/) for the recovery pattern.

## Expired entries and capacity

Blacklist entries with an `expiresAt` timestamp do not automatically disappear from the registry cell. They stay in the BLKL payload until a governance transaction explicitly removes them.

Expired entries are treated as inactive by both the firewall lock and the SDK — an output matching an expired entry is not blocked. But the bytes are still in the cell, and the cell still holds capacity for those bytes.

Reclaiming capacity from expired entries requires a governance update that removes them from the BLKL payload. If the smaller payload needs less capacity, the excess returns to the treasury. This is intentional: it creates an incentive to prune expired entries rather than accumulate them indefinitely.

## See also

- [BLKL v2 Format reference](/reference/blkl-format/) — exact binary layout of the registry payload
- [Registry operator tutorial](/get-started/operator/) — deploy your own registry from scratch
- [Error codes reference](/reference/error-codes/) — all codes the firewall returns when registry checks fail
- [Troubleshooting: stale registry cell](/how-to/fix-stale-registry-cell/) — what to do when the outpoint moves
- [Troubleshooting: in-flight failure](/how-to/fix-in-flight-failure/) — what to do when a governance update invalidates pending transactions
