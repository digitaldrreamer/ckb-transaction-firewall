---
title: PBLK Proposal Cell
description: Binary layout of the PBLK v1 and v2 proposal cell data used by the governance system.
---

A `PBLK` cell is an on-chain proposal cell created by `ckb-firewall anchor`. The registry type script (`blacklist-registry`) reads this cell during the execute transaction and verifies that the BLKL state transition exactly matches what the proposal commits to.

## v1 — blacklist entry proposals

Used for `add` and `remove` actions.

| Field | Offset | Size | Value |
|---|---|---|---|
| `magic` | 0 | 4 bytes | `PBLK` (`0x50 0x42 0x4c 0x4b`) |
| `version` | 4 | 1 byte | `0x01` |
| `registry_type_id_value` | 5 | 32 bytes | Type ID value of the registry this proposal targets |
| `action` | 37 | 1 byte | `0x01` = add, `0x02` = remove |
| `identifier_len` | 38 | 1 byte | Byte length of the lock-args identifier |
| `identifier` | 39 | `identifier_len` bytes | Lock or type args to add or remove |
| `expires_at` | after identifier | 8 bytes | LE u64 Unix timestamp in seconds; `0` = permanent |
| `evidence_hash` | final 32 bytes | 32 bytes | blake2b of the evidence text |

**Minimum size** (0-byte identifier): `4 + 1 + 32 + 1 + 1 + 0 + 8 + 32` = **79 bytes**.

## v2 — treasury metadata proposals

Used for `set-treasury` actions. Updates the governance header treasury lock script without changing blacklist entries.

| Field | Offset | Size | Value |
|---|---|---|---|
| `magic` | 0 | 4 bytes | `PBLK` (`0x50 0x42 0x4c 0x4b`) |
| `version` | 4 | 1 byte | `0x02` |
| `registry_type_id_value` | 5 | 32 bytes | Type ID value of the registry this proposal targets |
| `action` | 37 | 1 byte | `0x03` = set-treasury |
| `treasury_lock_hash` | 38 | 32 bytes | blake2b hash of the new treasury lock script |
| `evidence_hash` | 70 | 32 bytes | blake2b of the evidence text |

**Total: 102 bytes.**

## Validation

The `blacklist-registry` type script rejects the execute transaction if:

- The proposal cell is missing from the inputs
- More than one input cell hashes to the same `proposal_data_hash`
- The `registry_type_id_value` in the cell does not match the registry being updated
- For v1: the BLKL output contains any change beyond the single proposed add/remove
- For v2: the BLKL output changes blacklist entries, or sets a treasury lock hash that does not match `treasury_lock_hash`

## Proposal-anchor type script

`PBLK` cells created by the treasury-funded flow carry the `proposal-anchor` type script. This type script additionally enforces that:

- The cell is locked by the registry treasury lock
- The anchor targets the correct registry Type ID
- At reclaim or execute time, the capacity returns to the treasury

See [Proposal anchor](/reference/proposal-anchor/) for the proposal-anchor contract's validation rules.

## Reference

- Encoder: `sdk/cli/src/lib/governance-v4.ts` — `encodeProposalCellData`, `proposalCellDataHash`
- GOV1 witness binding: [GOV1 v4 Witness](/reference/gov1-witness/) — `proposal_data_hash`
