---
title: BLKL Registry Format
description: Binary layout for the blacklist registry payload parsed by the SDKs and firewall lock.
---

`BLKL` is the registry payload format used by the firewall.

## Minimal code path

The TypeScript SDK parses the live registry cell data directly:

```ts
import { parseRegistryPayload } from "@ckb-firewall/sdk";

const payload = parseRegistryPayload(liveCell.data);
console.log(payload.version);
console.log(payload.entries);
```

If you are building or replacing the payload, follow the same byte layout as `sdk/cli/src/lib/blkl.ts`.

## Layout

All multi-byte values are little-endian.

- `magic` - 4 bytes, ASCII `BLKL`
- `version` - 1 byte, currently `0x01`
- `entry_count` - 4 bytes, `u32`
- `entries` - repeated records

Each entry is:

- `identifier_len` - 1 byte
- `identifier` - variable-length bytes
- `expires_at` - 8 bytes, `u64` Unix timestamp, `0` for permanent

## Rules

- The payload must begin with `BLKL`
- The version must be `0x01`
- Entries must be sorted deterministically
- The TypeScript parser currently allows equal identifiers, but the Rust parser rejects non-increasing order. Keep entries strictly sorted if you want both SDKs to accept the same cell data.
- Temporary entries expire based on the chain time used by the lock

## Notes

The SDK and the lock both parse this same payload shape, so docs and fixtures need to stay in sync with the contract behavior.

The checked-in testnet fixture is [`notes/deployments/testnet.registry.json`](https://github.com/digitaldrreamer/ckb-transaction-firewall/blob/main/notes/deployments/testnet.registry.json).
