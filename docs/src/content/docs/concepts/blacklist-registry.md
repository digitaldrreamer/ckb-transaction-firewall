---
title: Blacklist Registry
description: The on-chain registry cell and governance type script that store and update the blacklist.
---

The blacklist registry is the shared on-chain state that stores the blacklist as `BLKL` payload data.

## Responsibilities

- Hold the blacklist entries
- Keep the payload format deterministic
- Gate updates through governance
- Preserve a stable type-script identity across updates

## Why it is a cell

CKB cells are the native shared state primitive. Using a cell for the registry means:

- the firewall lock can read the registry as a `cell_dep`
- the blacklist can be replaced atomically by governance
- the registry history remains reconstructable from chain data

## Update model

Updates are not free-form edits.

They are governance transactions that replace the registry cell while preserving the registry type-script identity expected by the firewall lock.

## What to read next

- [BLKL registry format](../reference/blkl-format.md)
- [GOV1 witness](../reference/gov1-witness.md)
- [Governance](./governance.md)
