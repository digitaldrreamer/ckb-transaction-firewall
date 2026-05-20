---
title: BLKL Registry Format
description: Binary layout for the v2 blacklist registry payload parsed by the SDKs and on-chain contracts.
---

`BLKL` is the binary payload stored in the live registry cell. The on-chain contracts, the TypeScript SDK, and the CLI all parse the same byte layout. This page describes version `0x02`, which is the only version accepted by current deployments.

## Quick start

```ts
import { parseRegistryPayload, fetchRegistryPayload } from "@ckb-firewall/sdk";

// Parse from raw hex (e.g. from a cell dep you already have)
const payload = parseRegistryPayload(liveCell.data);

// Or fetch + parse from a CKB node
const payload = await fetchRegistryPayload(rpcUrl, txHash, outputIndex);

console.log(payload.version);          // 2
console.log(payload.governanceHeader); // signer pubkeys, validator Merkle root
console.log(payload.entries);          // [{ identifier, expiresAt }, ...]
```

## Top-level layout

All multi-byte integers are little-endian.

| Field | Size | Value |
|-------|------|-------|
| `magic` | 4 bytes | ASCII `BLKL` |
| `version` | 1 byte | `0x02` |
| `gov_header_len` | 2 bytes `u16` | byte length of the governance header that follows |
| `gov_header` | `gov_header_len` bytes | see [Governance header](#governance-header) |
| `entry_count` | 4 bytes `u32` | number of blacklist entries |
| `entries` | variable | see [Entry layout](#entry-layout) |

Minimum payload size (0 entries, minimal governance header): **`4 + 1 + 2 + 37 + 4`** = 48 bytes.

## Governance header

The governance header is embedded immediately after `gov_header_len`. It carries the governance committee's signing keys and a Merkle commitment to the validator set.

| Field | Size | Value |
|-------|------|-------|
| `gh_version` | 1 byte | `0x01` |
| `signer_count` | 1 byte | number of on-chain governance signers (≤ 255) |
| `threshold` | 1 byte | minimum valid signatures required (1 ≤ threshold ≤ signer_count) |
| `pubkeys` | `signer_count × 33` bytes | compressed secp256k1 public keys, one per signer |
| `validator_count` | 2 bytes `u16` | number of off-chain validator committee members |
| `validator_merkle_root` | 32 bytes | Merkle root over the validator pubkeys (see [Validator Merkle tree](#validator-merkle-tree)) |

**Example sizes:**

- 1 signer: `1 + 1 + 1 + 33 + 2 + 32` = **70 bytes**
- 5 signers: `1 + 1 + 1 + 165 + 2 + 32` = **202 bytes**

The governance-lock script reads `pubkeys` and `threshold` from this header on every registry update to verify the multi-signature.

## Entry layout

Each entry in `entries` is:

| Field | Size | Value |
|-------|------|-------|
| `identifier_len` | 1 byte | byte length of the identifier (0–255) |
| `identifier` | `identifier_len` bytes | raw bytes of the blacklisted lock or type args |
| `expires_at` | 8 bytes `u64` | Unix timestamp; `0` means the entry never expires |

Entries are sorted in strict ascending order by identifier bytes (raw byte comparison, not hex string). Duplicate identifiers are invalid and rejected by both the type script and the TypeScript SDK.

## Registry type args (v2)

The registry cell's type script uses 66-byte args that bind the cell to its governance lock and establish its unique identity via CKB's Type ID mechanism:

| Field | Offset | Size | Value |
|-------|--------|------|-------|
| `version` | 0 | 1 byte | `0x02` |
| `governance_code_hash` | 1 | 32 bytes | code hash of the governance-lock script |
| `governance_hash_type` | 33 | 1 byte | hash type (`0x00`=data, `0x01`=type, `0x02`=data1) |
| `type_id_value` | 34 | 32 bytes | Type ID — unique per cell instance |

**Total: 66 bytes (132 hex chars after `0x`).**

The `type_id_value` is computed at bootstrap as `blake2b(first_input_outpoint_36_bytes || output_index_u64_le)` and never changes for the life of the registry cell. The `governance_code_hash` and `governance_hash_type` can be updated by governance action without changing the cell identity.

The TypeScript SDK and the CLI identify a registry cell dep by `type_id_value` alone (bytes 34–65 of the type args), allowing the governance lock to be upgraded without breaking existing firewall lock configurations.

## Validator Merkle tree

The `validator_merkle_root` commits to the set of authorized off-chain validators. The tree uses CKB's blake2b (`personal = "ckb-default-hash"`) and is constructed as:

1. **Leaves:** `blake2b(compressed_pubkey_33_bytes)` for each validator, in list order.
2. **Padding:** the leaf list is padded to the next power of 2 with 32-byte zero leaves.
3. **Internal nodes:** `blake2b(left_child_32_bytes || right_child_32_bytes)`, built bottom-up.

A 5-validator set produces a tree of depth 3 (padded to 8 leaves). Each vote stored in a governance proposal includes a Merkle proof (sibling hashes from leaf to root) and a leaf index. The CLI verifies these proofs against the on-chain root before building the execute transaction.

## Rules

- The payload **must** begin with the four bytes `BLKL` (`0x42 0x4c 0x4b 0x4c`).
- `version` must be `0x02`. Version `0x01` is rejected by all current deployments.
- `gh_version` inside the governance header must be `0x01`.
- `threshold` must be ≥ 1 and ≤ `signer_count`.
- Entries must be sorted in **strict ascending byte order**. Equal or descending adjacent identifiers are invalid.
- Entries are compared as raw byte slices, **not** as hex strings. Identifiers of different lengths follow C-style byte ordering (shorter string wins if it is a prefix of the longer one).
- `expires_at = 0` means permanent. Any non-zero value is a Unix timestamp; on-chain expiry is evaluated against the median block time.

## Reference

- Encoder (CLI): `sdk/cli/src/lib/blkl.ts` — `encodeRegistryPayload`, `encodeGovernanceHeader`
- Parser (SDK): `sdk/typescript/src/blacklist.ts` — `parseRegistryPayload`
- Parser (Rust): `contracts/blacklist-registry/src/main.rs` — `RegistryPayload::parse`
- Governance header parser (Rust): `contracts/governance-lock/src/main.rs` — `parse_governance_header`
- Testnet fixture: [`notes/deployments/testnet.registry.json`](https://github.com/digitaldrreamer/ckb-transaction-firewall/blob/main/notes/deployments/testnet.registry.json)
