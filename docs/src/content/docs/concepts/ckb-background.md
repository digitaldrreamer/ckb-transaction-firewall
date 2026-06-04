---
title: CKB Cell Model and Lock Scripts
description: The CKB concepts you need to understand how the Transaction Firewall works — cells, locks, cell deps, and Type ID.
---

The CKB Transaction Firewall is built on CKB's cell model. If you already understand cells, lock scripts, cell deps, and Type ID, skip this page. If you're coming from Ethereum or another account-based chain, read it — the firewall makes no sense without these foundations.

For deeper CKB coverage, see the [CKB documentation](https://docs.nervos.org/).

## Cells, not accounts

CKB does not have accounts with balances. It has **cells** — discrete, immutable units of state that are owned and spent like UTXOs in Bitcoin.

A cell has:
- `capacity` — how many CKB shannons (1 CKB = 10⁸ shannons) the cell locks up
- `lock` — a script that must return zero for the cell to be spent
- `type` — an optional script that enforces type rules on the cell's data
- `data` — arbitrary bytes, validated by the type script if present

When you "send CKB," you consume one or more input cells and create new output cells. The input cells cease to exist; the output cells come into existence. There is no in-place mutation.

## Lock scripts

A lock script is a RISC-V program deployed on-chain. When a transaction tries to spend a cell, CKB runs the cell's lock script. If the script exits with code 0, the spend is authorized. If it exits non-zero, the transaction is rejected.

The standard CKB secp256k1 lock works like this: the lock script reads a pubkey hash from its `args` field, loads the transaction hash, and checks that the witness contains a valid secp256k1 signature from the matching private key.

The firewall lock works differently. It reads the blacklist from a cell dep (see below), checks every transaction output against the blacklist, and then — only if all checks pass — spawns the inner secp256k1 lock to verify the signature. If any output is blacklisted, the firewall lock exits non-zero and the transaction is rejected by every node.

The important property: **the lock script is not code in your application**. It is code that every CKB full node runs, deterministically, during block validation. It cannot be skipped, patched, or configured away by application code.

## Cell deps

A cell dep is a read-only reference to a live cell included in a transaction. Unlike input cells, cell deps are not consumed — they are only read.

CKB uses cell deps for two purposes:
1. **Code cells** — the RISC-V binary of a lock or type script. When a node needs to run `firewall-lock`, it loads the code from the cell dep that contains the compiled binary.
2. **Data cells** — cells whose data a script reads at execution time. The firewall lock reads the live registry cell as a data cell dep to get the current blacklist.

When you build a transaction that spends a firewall-protected cell, you must include:
- The firewall-lock code cell dep (so nodes can load and execute the firewall)
- The inner lock code cell dep (so the firewall can spawn the inner lock)
- The live registry data cell dep (so the firewall can read the current blacklist)

If any of these are missing, the transaction fails with a clear [error code](/reference/error-codes/).

## Type ID

[Type ID](/reference/glossary/#type-id) is a CKB mechanism for giving a cell a stable, unique identity that survives being consumed and re-created.

When the firewall's [registry cell](/reference/glossary/#registry-cell) is updated by governance, the old cell is consumed and a new one is created with updated blacklist data. Without Type ID, the [firewall lock](/reference/glossary/#firewall-lock) would need to know the outpoint (transaction hash + index) of the current cell — which changes every time. With Type ID, the firewall lock can identify the registry cell by a fixed 32-byte value ([`type_id_value`](/reference/glossary/#type_id_value)) that never changes, regardless of how many times governance has updated the cell.

The registry cell's Type ID value is computed once at bootstrap and embedded in the [firewall lock args](/reference/firewall-lock-args/). Governance updates do not require reconfiguring every wallet that uses the firewall lock.

## Why this matters for the firewall

These four properties combine to create the firewall's security model:

- **Cells are immutable** — a live cell's data cannot be changed in place; only governance can create a new registry cell
- **Lock scripts run at consensus** — the firewall check is not optional application logic; it runs on every node, for every spend of a protected cell
- **Cell deps are read-only** — the registry data the firewall reads is the canonical on-chain state, not a cached copy in your app
- **Type ID is stable** — the registry cell's identity does not change when governance updates it; firewall lock configurations stay valid across updates

See [Registry design](/concepts/registry-design/) for how these properties are used in the registry's update model.

## See also

- [Why this exists](/concepts/why-this-exists/) — the threat this project addresses on CKB
- [The two-layer model](/concepts/two-layer-model/) — how the lock script and SDK work together
- [Registry and cell design](/concepts/registry-design/) — how Type ID and the single-cell model work in practice
- [Firewall lock args v2](/reference/firewall-lock-args/) — the lock script's binary configuration format
- [Testnet deployment](/reference/testnet-deployment/) — deployed contract outpoints and Type IDs
