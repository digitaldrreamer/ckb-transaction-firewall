---
title: Spawn-Aware Secp256k1 Inner Lock
description: Protocol, argv encoding, error codes, and deployed outpoint for the spawn-aware-secp256k1 inner lock contract.
---

`spawn-aware-secp256k1` is the canonical inner lock for standard secp256k1-blake160 wallets protected by the firewall lock. It receives its arguments via `argv` rather than lock script args, because the firewall lock occupies the `args` field.

## Protocol

The firewall lock passes two arguments via `spawn_cell`:

| Argument | Value |
|---|---|
| `argv[0]` | Hex-encoded 20-byte blake160 hash of the compressed secp256k1 pubkey |
| `argv[1]` | Hex-encoded 65-byte secp256k1 signature: `r(32) \|\| s(32) \|\| recovery_id(1)` |

The inner lock:

1. Decodes `argv[0]` → pubkey hash (20 bytes)
2. Decodes `argv[1]` → signature (65 bytes)
3. Loads the transaction hash via `ckb_load_tx_hash` syscall
4. Computes `signing_message = ckb_blake2b(tx_hash)`
5. Recovers the compressed pubkey from `(signing_message, signature)`
6. Asserts `blake160(recovered_pubkey) == pubkey_hash`

Exit code `0` = authorized. Any non-zero exit code = rejected. The firewall lock propagates the inner lock's exit code as its own exit code if inner lock validation fails (code 15: `InnerLockRejected`).

## Error codes

| Code | Meaning |
|---|---|
| `1` | Wrong number of argv — expected exactly 2 |
| `2` | `argv[0]` is not valid 20-byte hex |
| `3` | `argv[1]` is not valid 65-byte hex |
| `4` | Signature parse failed |
| `5` | Recovery ID out of range (not 0 or 1) |
| `6` | Pubkey recovery failed |
| `7` | Recovered blake160 does not match pubkey hash |

## Signing

Signing a spend from a firewall-protected cell is identical to signing any secp256k1 transaction. The wallet signs the transaction hash with its private key and places the 65-byte signature in `WitnessArgs.lock`. The firewall and inner lock handle the rest.

## Deployed outpoint (testnet)

```
tx_hash: 0x0fe5d47662724a3620c002683d8c3f38103359c7e1ca697196b39442317c709e
index:   0
type_id: 0x9be62e0423d4278b15c071bb881a4ebf936f7e46b3df0f152de50ae416f54465
```

## Reference

- Contract source: `contracts/spawn-aware-secp256k1/src/main.rs`
- Firewall lock delegation: [Firewall lock args](/reference/firewall-lock-args/) — inner lock section
- Error codes from the firewall lock (not inner lock): [Error codes](/reference/error-codes/)

## See also

- [Firewall lock args v2](/reference/firewall-lock-args/) — how the inner lock is referenced in the lock args
- [How to build a firewall lock script](/how-to/build-firewall-lock-script/) — specify `innerCodeHash` and `innerArgs`
- [CKB cell model and lock scripts](/concepts/ckb-background/) — what spawn and inner locks are
