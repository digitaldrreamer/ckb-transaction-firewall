---
title: Firewall Lock
description: The consensus-layer lock script that enforces blacklist checks and delegates to an inner lock.
---

The firewall lock is a CKB lock script. It sits in front of the inner lock (usually a standard secp256k1 lock) and enforces blacklist policy at the consensus layer before delegation.

Every CKB transaction that tries to spend a firewall-protected cell must satisfy both the blacklist check and the inner lock. If either fails, the transaction is rejected by the network.

## What it does

1. Scans the transaction's cell deps for a registry cell whose type script matches the configured registry identity
2. Parses the `BLKL` v2 payload from that cell
3. Checks each transaction output against the blacklist
4. If all outputs pass, spawns the inner lock via `spawn_cell` and waits for it to exit zero
5. If any output matches a blacklisted identifier, rejects immediately

## Multi-registry

A single firewall lock can consult multiple independent registry cells. Each registry spec is encoded in the lock args. All required registries must be present as cell deps; the effective blacklist is the union of all active entries across all registries.

## Inner lock delegation

After the blacklist check passes, the firewall lock spawns the inner lock via CKB's `spawn_cell` syscall. The inner lock receives:

- `argv[0]`: hex-encoded inner lock args (e.g. a 20-byte pubkey hash for secp256k1)
- `argv[1]`: hex-encoded 65-byte signature from `WitnessArgs.lock`

The `spawn-aware-secp256k1` contract is the canonical inner lock for standard secp256k1-blake160 wallets.

## Output checks

Two output fields can be checked, controlled by the flag byte in the lock args:

- bit 0: check `lock_args` of each output
- bit 1: check `type_args` of each output

Both bits set (`flags = 0x03`) is the recommended default. `flags = 0x00` is rejected on-chain.

## Fail-closed behavior

The lock rejects if:
- a required registry dep is missing
- more than one matching registry dep exists (ambiguous)
- the registry payload is malformed or not sorted
- an output matches a blacklisted identifier
- the inner lock returns non-zero

## Lock args layout

See [Firewall Lock Args](/reference/firewall-lock-args/) for the binary encoding.
