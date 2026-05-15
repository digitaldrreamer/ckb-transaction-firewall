---
title: Firewall Lock Args
description: Binary layout of the firewall lock configuration stored in the lock script args.
---

The firewall lock args encode two identities:

- the registry cell type-script identity
- the wrapped inner lock script identity

## How it maps to code

The lock args are the bytes you pass into the on-chain lock script. In practice, you derive them from the registry and inner lock identities you want to bind:

```ts
const firewallArgs = {
  version: 1,
  flags: 0b11,
  registryCodeHash: registryScript.codeHash,
  registryHashType: registryScript.hashType,
  registryTypeArgs: registryScript.args,
  innerCodeHash: innerLock.codeHash,
  innerHashType: innerLock.hashType,
  innerArgs: innerLock.args,
};
```

The contract serializes that shape to the byte layout below. If you are authoring a builder, keep the length prefixes exact and do not guess at the registry identity.

## Layout

The v1 layout is:

- `version` - 1 byte, `0x01`
- `flags` - 1 byte
- `registry_code_hash` - 32 bytes
- `registry_hash_type` - 1 byte
- `registry_type_args_len` - 2 bytes, little-endian
- `registry_type_args` - variable-length bytes
- `inner_code_hash` - 32 bytes
- `inner_hash_type` - 1 byte
- `inner_args_len` - 2 bytes, little-endian
- `inner_args` - variable-length bytes

## Flags

- bit 0: check output `lock_args`
- bit 1: check output `type_args`
- bits 2-7: reserved, must be zero

## Invariants

- Total length must match the encoded lengths exactly
- Registry type args must match the registry cell identity exactly
- The inner lock identity must be valid before delegation can succeed

## Practical check

If a wallet cell uses these args, the firewall lock will only accept transactions that include exactly one live registry cell dep whose type script matches the registry identity encoded here.
