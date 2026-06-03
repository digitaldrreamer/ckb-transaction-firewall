---
title: Registry Treasury
description: Production funding model for registry growth, proposal anchors, pruning, and public deposits.
---

The production registry has a **global treasury per blacklist registry**. It is not a local CLI setting and not a validator wallet.

The treasury is an on-chain cell tied to the registry identity. It has a public address/balance so anyone can donate CKB to keep the registry funded.

## What the treasury funds

The treasury pays for:

- Proposal anchor cells used to enforce the review delay on-chain
- Extra registry cell capacity when adding entries makes the BLKL payload larger
- Transaction fees for automated maintenance flows, depending on operator policy

Validators do not fund these operations. Validators review, vote, and sign.

## Capacity growth

Adding a blacklist entry can require more registry cell capacity because the registry cell stores the full BLKL payload.

The update builder should use this order:

1. **Prune expired entries first.** Remove expired entries from the new registry payload.
2. **Reuse freed capacity.** If pruning makes enough room, no treasury draw is needed.
3. **Draw from treasury only if needed.** If the post-prune registry output still needs more capacity, consume treasury capacity and add it to the new registry cell.
4. **Return excess.** Any leftover treasury/change capacity returns to the treasury cell.

This avoids a fixed maximum entry count while keeping the single-registry-cell design. Sharding is not needed until the registry approaches transaction size or operational limits.

## Public funding

The treasury should expose:

- A public deposit address
- Current live treasury balance
- Blacklist pool usage percentage
- Minimum recommended reserve
- Recent inflows/outflows

The CLI and GUI show blacklist pool usage as:

```text
registry occupied capacity / (registry cell capacity + live treasury balance)
```

When usage reaches 70% or more, users should donate CKB to the treasury address
shown by `ckb-firewall inspect` or in the GUI pool banner. Donations increase the
treasury cell capacity available for future registry growth and proposal anchors.

## Proposal anchor reclaim

Proposal anchors are real CKB cells. If a proposal executes, the execution transaction consumes the anchor and returns remaining capacity to the treasury.

If a proposal is rejected, abandoned, or never gathers enough votes, an automated reclaim transaction can recover the anchor after a timeout:

```bash
ckb-firewall reclaim --proposal <id>
```

The typed proposal-anchor script enforces:

- The anchor targets this registry
- The anchor has aged past the reclaim delay
- All recovered capacity returns to the registry treasury

The CLI also verifies the same constraints before building the reclaim transaction. Treasury-funded `PBLK` anchors should be created with the `proposal-anchor` type script; untyped treasury anchors are rejected by the production execute/reclaim builders.

## Expired entry pruning

Expired blacklist entries do not hold separate CKB. They are bytes inside the registry cell.

Reclaiming capacity from expired entries means building a prune/update transaction that removes expired entries from the BLKL payload. If the smaller payload needs less capacity, the excess capacity returns to the treasury.

## On-chain design

The registry carries treasury identity in the BLKL governance header:

- Registry Type ID: stable registry identity
- Treasury lock hash: `blake2b(raw lock script)` for consensus enforcement
- Treasury lock script: the preferred production metadata because it lets clients discover treasury cells and public balance from registry state

Registry update validation requires that:

- The `PBLK` proposal anchor input is locked by a script whose lock hash equals `treasury_lock_hash`
- Treasury-locked input capacity can be consumed only for registry cell growth or the bounded anchor fee allowance
- Any excess registry capacity from pruning returns to the treasury
- Any proposal-anchor reclaim returns to the treasury

This makes the treasury global per blacklist registry and auditable from chain state.
