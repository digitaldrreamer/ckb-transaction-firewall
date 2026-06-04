---
title: Proposal Anchor Contract
description: Type script validation behavior, spending conditions, and error codes for the proposal-anchor contract.
---

The `proposal-anchor` type script governs the lifecycle of `PBLK` proposal cells that are treasury-funded. It enforces that proposal cells can only be created, spent during execution, or reclaimed in ways that are consistent with the governance protocol.

## What it validates

The `proposal-anchor` type script runs in two contexts:

**At anchor creation** (the anchor transaction):
- The cell data is a valid PBLK v1 or v2 payload
- The cell is locked by the registry treasury lock (`lock_hash == treasury_lock_hash` from the registry governance header)
- The `registry_type_id_value` in the cell data matches the target registry

**At execute or reclaim** (the governance transaction):
- The spending transaction inputs include a registry cell being updated (execute) or have the anchor aged past the reclaim delay (reclaim)
- All remaining capacity from the anchor is returned to the treasury lock
- The `since` field on the anchor input encodes a valid relative median-time-past delay

## Error codes

| Code | Name | Meaning |
|---|---|---|
| `31` | `InvalidTypeArgs` | Proposal-anchor type args are malformed (not 64 bytes encoding two 32-byte Type IDs) |
| `32` | `InvalidTopology` | Transaction input/output structure is invalid for the current operation |
| `33` | `InvalidProposalData` | PBLK cell data is malformed or has an unsupported version |
| `34` | `UnauthorizedTreasuryLock` | The cell is not locked by the registry treasury lock |
| `35` | `InvalidReclaimReturn` | Reclaim output does not return full capacity to the treasury lock |
| `36` | `InvalidReclaimSince` | The anchor input's `since` field does not encode a valid relative timestamp delay |

## Type args layout

The proposal-anchor type args are 64 bytes:

| Field | Offset | Size | Value |
|---|---|---|---|
| `governance_lock_type_id` | 0 | 32 bytes | Type ID of the governance-lock contract |
| `proposal_anchor_type_id` | 32 | 32 bytes | Type ID of this proposal-anchor contract |

These values are fixed at deploy time and match the args embedded in the treasury-lock contract.

## Deployed outpoint (testnet)

```
tx_hash: 0x0daff588f0053bdf34d4c2eebaf2c092f70192cdd4a2d1dd95aee07ce100dea9
index:   0
type_id: 0x89decc8507addb114e35c2a2e2ae943089832884818fc7ac6de3c3b8cdae6a12
```

## Reference

- Contract source: `contracts/proposal-anchor/src/main.rs`
- PBLK cell layout: [PBLK Proposal Cell](/reference/pblk-cell/)
- Treasury model: [The autonomous treasury model](/concepts/treasury-design/)

## See also

- [The autonomous treasury model](/concepts/treasury-design/) — why keyless spending works
- [How to anchor a proposal](/how-to/anchor-proposal/) — create the PBLK cell via CLI
- [How to reclaim an abandoned anchor](/how-to/reclaim-anchor/) — recover treasury capacity
- [PBLK Proposal Cell](/reference/pblk-cell/) — the data payload inside the anchor cell
- [GOV1 v4 Witness](/reference/gov1-witness/) — the governance witness that references the anchor
