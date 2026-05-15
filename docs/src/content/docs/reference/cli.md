---
title: CLI Reference
description: Command and option reference for @ckb-firewall/cli.
---

This is the command surface for `@ckb-firewall/cli`.

## Global behavior

- Node 20+ required
- ESM only
- Defaults point to the canonical testnet registry cell
- The registry-touching commands read live registry cell data through RPC before they build or inspect anything

## Commands

### `inspect`

Show the current registry entries.

Options:

- `--rpc-url <url>`
- `--registry-tx <hash>`
- `--registry-index <n>`

Example:

```bash
ckb-firewall inspect --rpc-url https://testnet.ckb.dev
```

### `add`

Quickly append a lock args entry to the registry for testnet/dev use.

Options:

- `--lock-args <hex>`
- `--expires-at <timestamp>`
- `--rpc-url <url>`
- `--registry-tx <hash>`
- `--registry-index <n>`
- `--tx-out <file>`
- `--sign`
- `--from-account <address>`

Example:

```bash
ckb-firewall add \
  --lock-args 0xabc123... \
  --expires-at 0 \
  --tx-out ./tx.json
```

### `remove`

Quickly remove a lock args entry for testnet/dev use.

Options:

- `--lock-args <hex>`
- `--rpc-url <url>`
- `--registry-tx <hash>`
- `--registry-index <n>`
- `--tx-out <file>`
- `--sign`
- `--from-account <address>`

Example:

```bash
ckb-firewall remove \
  --lock-args 0xabc123... \
  --tx-out ./tx.json
```

### `propose`

Create a governance proposal.

Options:

- `--action <add|remove>`
- `--lock-args <hex>`
- `--expires-at <timestamp>`
- `--evidence <text>`
- `--classification <type>`
- `--severity <level>`
- `--rationale <text>`
- `--proposer <name>`

Example:

```bash
ckb-firewall propose --action add --lock-args 0xabc123... --proposer alice
```

### `proposals`

List proposals and filter by status.

Options:

- `--status <status>`

### `vote`

Record a validator vote.

Options:

- `--proposal <id>`
- `--vote <choice>`
- `--validator <id>`

Example:

```bash
ckb-firewall vote --proposal abc123 --vote yes --validator alice
```

### `sign`

Add a governance signer signature.

Options:

- `--proposal <id>`
- `--signer-index <0-4>`
- `--key <hex>`

Example:

```bash
ckb-firewall sign --proposal abc123 --signer-index 0
```

### `execute`

Build and submit the registry update transaction.

Options:

- `--proposal <id>`
- `--rpc-url <url>`
- `--registry-tx <hash>`
- `--registry-index <n>`
- `--tx-out <file>`
- `--sign`
- `--from-account <address>`

Example:

```bash
ckb-firewall execute --proposal abc123 --tx-out ./tx.json
```

## Practical note

`add` and `remove` are convenience flows for testnet and development.

The public governance path is `propose` → `vote` → `sign` → `execute`.

If you need the live cell data that backs these commands, read [How to Use](../getting-started/how-to-use.mdx).
