---
title: Inner Lock (spawn-aware-secp256k1)
description: The inner lock that the firewall delegates to after passing the blacklist check.
---

The firewall lock does not verify signatures directly. After passing the blacklist check, it spawns an inner lock via CKB's `spawn_cell` syscall and waits for it to exit. If the inner lock exits zero, the spend is authorized.

The canonical inner lock for standard secp256k1-blake160 wallets is `spawn-aware-secp256k1`.

## Why a separate contract

Standard secp256k1 lock scripts read their pubkey hash from `load_script().args()`. The firewall-locked cell's `args` field is taken by the firewall lock itself. The inner lock receives its arguments through `argv` instead.

## Protocol

The firewall lock passes:

- `argv[0]`: hex-encoded pubkey hash (20 bytes, blake160 of the compressed pubkey)
- `argv[1]`: hex-encoded 65-byte secp256k1 signature (`r[32] || s[32] || recovery_id[1]`)

The inner lock:

1. Decodes `argv[0]` → pubkey hash (20 bytes)
2. Decodes `argv[1]` → signature (65 bytes)
3. Loads the transaction hash via syscall
4. Computes `signing_message = ckb_blake2b(tx_hash)`
5. Recovers the compressed pubkey from `(signing_message, sig)`
6. Asserts `blake160(recovered_pubkey) == pubkey_hash`

## Error codes

| Code | Meaning |
|---|---|
| 1 | Wrong number of argv |
| 2 | argv[0] not valid 20-byte hex |
| 3 | argv[1] not valid 65-byte hex |
| 4 | Signature parse failed |
| 5 | Recovery ID out of range |
| 6 | Pubkey recovery failed |
| 7 | Recovered blake160 does not match pubkey hash |

## Deployed location (testnet)

```text
tx_hash: 0x0fe5d47662724a3620c002683d8c3f38103359c7e1ca697196b39442317c709e
index:   0
type_id: 0x9be62e0423d4278b15c071bb881a4ebf936f7e46b3df0f152de50ae416f54465
```

## User-facing behavior

Signing a spend from a firewall-protected cell is identical to signing any other secp256k1 transaction. The wallet signs the transaction hash with its private key and places the 65-byte signature in `WitnessArgs.lock`. The firewall and inner lock handle the rest.
