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
console.log(payload.governanceHeader); // threshold, validatorMerkleRoot
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

The governance header is embedded immediately after `gov_header_len`. It carries the validator threshold, a Merkle commitment to the validator set, and optional registry treasury metadata. Earlier header versions also include legacy signer fields for layout compatibility, but runtime registry updates are authorized by validator vote witnesses.

| Field | Size | Value |
|-------|------|-------|
| `gh_version` | 1 byte | `0x01`, `0x02`, or `0x03` |
| `signer_count` | 1 byte | legacy signer count retained in the encoded header |
| `threshold` | 1 byte | minimum validator yes-votes required on-chain |
| `pubkeys` | `signer_count × 33` bytes | legacy compressed secp256k1 signer pubkeys retained in the encoded header |
| `validator_count` | 2 bytes `u16` | number of validator committee members |
| `validator_merkle_root` | 32 bytes | Merkle root over the validator pubkeys (see [Validator Merkle tree](#validator-merkle-tree)) |
| `treasury_lock_hash` | 32 bytes, v2 only | blake2b hash of the treasury lock script that must receive returned anchor capacity |
| `treasury_lock_script_len` | 2 bytes `u16`, v3 only | byte length of the serialized treasury lock script |
| `treasury_lock_script` | variable, v3 only | Molecule `Script` bytes for the treasury lock |

**Example sizes** (current encoder always writes `signer_count = 0`; legacy cells may have non-zero signer counts):

- v1, 0 signers: `1 + 1 + 1 + 0 + 2 + 32` = **37 bytes**
- v2, 0 signers (adds treasury hash): `37 + 32` = **69 bytes**
- v3, 0 signers (adds treasury script): `37 + 2 + treasury_lock_script_len` bytes
- Legacy v1, 5 signers: `1 + 1 + 1 + 165 + 2 + 32` = **202 bytes**

The governance-lock script reads `threshold`, `validator_count`, and `validator_merkle_root` from this header on every registry update. It verifies that the transaction witness contains at least `threshold` valid yes-votes from unique validators committed by the Merkle root.

When `gh_version = 0x02` or `0x03`, `blacklist-registry` also enforces treasury return semantics. v2 commits only to the treasury lock hash. v3 commits to the full treasury lock script so clients can discover the public treasury cells directly from the registry state.

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
- `gh_version` inside the governance header must be `0x01`, `0x02`, or `0x03`. v1 has no treasury fields; v2 adds a 32-byte `treasury_lock_hash`; v3 replaces it with a length-prefixed Molecule `Script` encoding of the full treasury lock script.
- `threshold` must be ≥ 1 and ≤ `validator_count`.
- Entries must be sorted in **strict ascending byte order**. Equal or descending adjacent identifiers are invalid.
- Entries are compared as raw byte slices, **not** as hex strings. Identifiers of different lengths follow C-style byte ordering (shorter string wins if it is a prefix of the longer one).
- `expires_at = 0` means permanent. Any non-zero value is a Unix timestamp; on-chain expiry is evaluated against the median block time.

## Reference

- Encoder (CLI): `sdk/cli/src/lib/blkl.ts` — `encodeRegistryPayload`, `encodeGovernanceHeader`
- Parser (SDK): `sdk/typescript/src/blacklist.ts` — `parseRegistryPayload`
- Parser (Rust): `contracts/blacklist-registry/src/main.rs` — `RegistryPayload::parse`
- Governance header parser (Rust): `contracts/governance-lock/src/main.rs` — `parse_governance_header`
- Testnet fixture: [`notes/deployments/testnet.registry.json`](https://github.com/digitaldrreamer/ckb-transaction-firewall/blob/main/notes/deployments/testnet.registry.json)

## See also

- [Registry and cell design](/concepts/registry-design/) — why the format is designed the way it is
- [Registry operator tutorial, step 2](/get-started/operator/2-bootstrap-registry/) — bootstrap the first registry cell
- [How to inspect the live registry](/how-to/inspect-registry/) — read the current payload via CLI or SDK
- [TypeScript SDK API](/reference/typescript-sdk/) — `fetchRegistryPayload`, `parseRegistryPayload`, `RegistryPayload`
