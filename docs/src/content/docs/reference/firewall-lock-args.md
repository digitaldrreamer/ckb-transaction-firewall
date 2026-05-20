---
title: Firewall Lock Args
description: Binary layout of the v2 firewall lock args — multi-registry configuration with inner lock delegation.
---

The firewall lock args encode everything the on-chain lock needs to enforce blacklist checking: which registry cells to consult, which flags to apply, and which inner lock to delegate to once the check passes.

## Quick start

```ts
import { buildFirewallLockScript } from "@ckb-firewall/sdk";
import type { FirewallLockConfig } from "@ckb-firewall/sdk";

const config: FirewallLockConfig = {
  firewallCodeHash: "0xabc...",  // deployed firewall-lock code hash
  firewallHashType: "type",
  flags: 0x03,                  // check both lock_args and type_args
  registries: [
    {
      codeHash: "0xdef...",     // blacklist-registry code hash
      hashType: "type",
      typeIdValue: "0x123...",  // 32-byte Type ID of the registry cell
      required: true,
    },
  ],
  innerCodeHash: "0x9bd...",    // secp256k1 lock code hash
  innerHashType: "type",
  innerArgs: "0x<20-byte-pubkey-hash>",
};

const lockScript = buildFirewallLockScript(config);
// { codeHash, hashType: "type", args: "0x<encoded v2 args>" }
```

## Layout

All multi-byte integers are little-endian. Version `0x02` is the current on-chain format.

| Field | Size | Value |
|-------|------|-------|
| `version` | 1 byte | `0x02` |
| `flags` | 1 byte | see [Flags](#flags) |
| `registry_count` | 1 byte | number of registry specs (0–255) |
| `registry_specs` | `registry_count × 66` bytes | see [Registry spec](#registry-spec) |
| `inner_code_hash` | 32 bytes | code hash of the inner lock script |
| `inner_hash_type` | 1 byte | hash type of the inner lock (`0x00`=data, `0x01`=type, `0x02`=data1) |
| `inner_args_len` | 2 bytes `u16` | byte length of `inner_args` |
| `inner_args` | `inner_args_len` bytes | args passed to the inner lock (e.g. 20-byte pubkey hash for secp256k1) |

**Minimum size** (0 registries, 0-byte inner args): `1 + 1 + 1 + 32 + 1 + 2` = **38 bytes**.

With 1 registry and a 20-byte secp256k1 pubkey hash: `38 + 66 + 20` = **124 bytes**.

## Registry spec

Each registry spec is exactly 66 bytes:

| Field | Offset within spec | Size | Value |
|-------|-------------------|------|-------|
| `code_hash` | 0 | 32 bytes | code hash of the blacklist-registry type script |
| `hash_type` | 32 | 1 byte | `0x00`=data, `0x01`=type, `0x02`=data1 |
| `type_id_value` | 33 | 32 bytes | Type ID of the specific registry instance (bytes 34–65 of the 66-byte registry type args) |
| `required` | 65 | 1 byte | `0x01` = transaction fails if this registry dep is absent; `0x00` = optional |

The firewall lock matches a cell dep against a registry spec by comparing `code_hash`, `hash_type`, and `dep.type.args[34..66] == type_id_value`. This means the governance lock's code hash (stored in registry type args bytes 1–33) can be upgraded without invalidating existing firewall lock configurations.

## Flags

| Bit | Meaning |
|-----|---------|
| 0 (`0x01`) | Check output `lock_args` against the blacklist |
| 1 (`0x02`) | Check output `type_args` against the blacklist |
| 2–7 | Reserved — must be zero |

Both bits set (`0x03`) is the recommended default. Setting `flags = 0x00` is rejected on-chain with error `UnsupportedFlags` (code 7).

## Multi-registry

The v2 layout supports up to 255 registry specs in a single firewall lock. All required registries must be present as cell deps; the blacklist is the union of all active entries across all registries. If any required registry dep is missing the transaction fails with `MissingRegistryCellDep` (code 8).

```ts
const config: FirewallLockConfig = {
  // ...
  registries: [
    { codeHash: "0x...", hashType: "type", typeIdValue: "0x...", required: true },
    { codeHash: "0x...", hashType: "type", typeIdValue: "0x...", required: false },
  ],
};
```

Optional registries (`required: false`) are checked if present in the transaction's cell deps but do not cause a failure if absent. Use them for supplementary watchlists that may not always be available.

## Inner lock delegation

After all blacklist checks pass, the firewall lock spawns the inner lock via `spawn_cell`. The inner lock's `argv` receives:

- `argv[0]` — hex-encoded inner args (e.g. the 20-byte pubkey hash)
- `argv[1]` — hex-encoded secp256k1 signature (65 bytes) from `WitnessArgs.lock`

The inner lock is expected to verify the signature and exit `0` on success or any non-zero value on failure. The `spawn-aware-secp256k1` contract is the canonical inner lock for standard secp256k1-blake160 wallets.

## Reference

- Builder (SDK): `sdk/typescript/src/builder.ts` — `buildFirewallLockArgs`, `buildFirewallLockScript`
- Parser (Rust): `contracts/firewall-lock/src/main.rs` — `FirewallLockArgs::parse`
- Inner lock: `contracts/spawn-aware-secp256k1/src/main.rs`
