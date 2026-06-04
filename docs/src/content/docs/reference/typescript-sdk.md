---
title: TypeScript SDK API
description: Complete reference for all types, functions, and classes exported by @ckb-firewall/sdk.
---

Complete reference for `@ckb-firewall/sdk`. For task-oriented usage patterns see [Pre-flight Check (TypeScript)](/how-to/preflight-typescript/).

---

## Types

### `HashType`

```ts
type HashType = "data" | "type" | "data1";
```

CKB script hash type.

---

### `ScriptLike`

```ts
interface ScriptLike {
  codeHash: string;  // 0x-prefixed 32-byte hex
  hashType: HashType;
  args:     string;  // 0x-prefixed hex
}
```

Minimal representation of a CKB lock or type script.

---

### `CellDepLike`

```ts
interface CellDepLike {
  type?: ScriptLike | null;
  data:  string;             // 0x-prefixed hex cell data
}
```

A cell dependency as the SDK sees it — the type script and raw data of the dep cell.

---

### `TxOutputLike`

```ts
interface TxOutputLike {
  lockArgs:  string;   // 0x-prefixed hex
  typeArgs?: string;   // 0x-prefixed hex, optional
}
```

A transaction output reduced to the two fields the firewall checks.

---

### `UnsignedTxLike`

```ts
interface UnsignedTxLike {
  cellDeps: CellDepLike[];
  outputs:  TxOutputLike[];
}
```

The subset of an unsigned CKB transaction that `TransactionFirewall.checkTransaction` needs.

---

### `RegistrySpecLike`

```ts
interface RegistrySpecLike {
  codeHash:    string;   // blacklist-registry Type ID (0x-prefixed 32-byte hex)
  hashType:    HashType;
  typeIdValue: string;   // 32-byte hex — bytes 34..66 of the 66-byte v2 registry type args
  required:    boolean;  // if true, a missing dep is an error; if false, it is skipped
}
```

Identifies a registry cell dep. Matched by `typeIdValue` so the spec survives governance-lock upgrades — the governance code hash (bytes 1–33 of the type args) can rotate without invalidating this value.

---

### `FirewallConfig`

```ts
interface FirewallConfig {
  registries: RegistrySpecLike[];
}
```

Configuration for `TransactionFirewall`. `registries` may contain multiple specs; the effective blacklist is the union of all active entries across all resolved deps.

---

### `RegistryEntry`

```ts
interface RegistryEntry {
  identifier: string;   // 0x-prefixed hex
  expiresAt:  bigint;   // unix timestamp in seconds; 0n = permanent
}
```

A single blacklisted identifier. `expiresAt === 0n` means the entry never expires. Entries with `expiresAt` in the past are treated as inactive by both the SDK and the on-chain lock (requires `header_deps` in the spending transaction for the lock to evaluate expiry correctly).

---

### `RegistryPayload`

```ts
interface RegistryPayload {
  version:           number;
  entries:           RegistryEntry[];
  governanceHeader?: GovernanceHeader;
}
```

The parsed contents of a BLKL v2 registry cell. Returned by `fetchRegistryPayload` and `parseRegistryPayload`. Entries are guaranteed to be in strict ascending byte order.

---

### `GovernanceHeader`

```ts
interface GovernanceHeader {
  version:              number;
  signerCount:          number;
  threshold:            number;
  pubkeys:              Uint8Array[];   // compressed secp256k1 pubkeys, 33 bytes each
  validatorCount:       number;
  validatorMerkleRoot:  Uint8Array;    // 32 bytes
}
```

Governance metadata embedded in the BLKL v2 payload. `validatorMerkleRoot` commits to the authorized validator set. `signerCount` and `pubkeys` are legacy wire-format fields retained for compatibility; they are always 0/empty in current deployments and carry no authorization weight.

---

### `FirewallDecision`

```ts
type FirewallDecision =
  | { ok: true }
  | { ok: false; code: 8;  reason: "MissingRegistryCellDep" }
  | { ok: false; code: 9;  reason: "InvalidRegistryData" }
  | { ok: false; code: 10; reason: "RegistryNotSorted" }
  | { ok: false; code: 11; reason: "BlacklistedLockArgs" }
  | { ok: false; code: 12; reason: "BlacklistedTypeArgs" }
  | { ok: false; code: 17; reason: "AmbiguousRegistryCellDep" };
```

Discriminated union returned by `TransactionFirewall.checkTransaction` and `preflightCheck`. The `code` and `reason` fields are narrowed by the discriminant so switch/case and type guards work without casting.

---

### `FIREWALL_ERROR_CODES`

```ts
const FIREWALL_ERROR_CODES = {
  MissingRegistryCellDep:  8,
  InvalidRegistryData:     9,
  RegistryNotSorted:       10,
  BlacklistedLockArgs:     11,
  BlacklistedTypeArgs:     12,
  AmbiguousRegistryCellDep: 17,
} as const;
```

Named constants for the pre-flight error codes. Useful for switch/case without magic numbers.

---

### `OutPointLike`

```ts
interface OutPointLike {
  txHash: string;  // 0x-prefixed 32-byte hex
  index:  number;
}
```

On-chain location of a deployed cell.

---

### `TransactionCellDep`

```ts
interface TransactionCellDep {
  outPoint: OutPointLike;
  depType:  "code" | "dep_group";
}
```

A cell dependency entry for inclusion in a CKB transaction's `cell_deps` array.

---

### `FirewallSpendDepsConfig`

```ts
interface FirewallSpendDepsConfig {
  firewallLockOutPoint: OutPointLike;   // deployed firewall-lock code cell
  innerLockOutPoint:    OutPointLike;   // deployed inner lock code cell
  registryOutPoints:    OutPointLike[]; // live registry data cell(s)
}
```

Input to `buildFirewallSpendCellDeps`. Registry outpoints move after every governance update — always provide fresh values.

---

### `FirewallLockConfig`

```ts
interface FirewallLockConfig {
  firewallCodeHash: string;           // deployed firewall-lock code hash
  firewallHashType: HashType;
  flags:            number;           // bit 0 = check lock_args, bit 1 = check type_args; 0x00 rejected on-chain
  registries:       RegistrySpecLike[];
  innerCodeHash:    string;
  innerHashType:    HashType;
  innerArgs:        string;           // 0x-prefixed hex, max 65535 bytes
}
```

Full configuration for `buildFirewallLockScript`. Encodes to the v2 FirewallLockArgs binary layout.

---

## Functions

### `fetchRegistryPayload`

```ts
async function fetchRegistryPayload(
  rpcUrl:      string,
  txHash:      string,
  outputIndex: number,
  timeoutMs?:  number,   // default: 15000
): Promise<RegistryPayload>
```

Fetches the registry cell at the given outpoint via `get_live_cell` and parses its BLKL v2 data. Throws a plain `Error` (not a `FirewallSdkError`) if the cell is not live, the network is unreachable, or the payload fails to parse. See [error handling](/how-to/preflight-typescript/#error-handling) for the recovery pattern.

---

### `findRegistryCell`

```ts
async function findRegistryCell(
  rpcUrl:    string,
  spec:      RegistrySpecLike,
  timeoutMs?: number,   // default: 15000
): Promise<{ txHash: string; index: number }>
```

Discovers the current live registry cell outpoint via `get_cells` on the CKB indexer. Queries by `codeHash` + version prefix and filters client-side by `typeIdValue` — survives governance-lock upgrades without any config change. Requires a CKB node with the built-in indexer enabled (CKB ≥ 0.109). Throws if no matching cell is found or the RPC is unreachable.

---

### `parseRegistryPayload`

```ts
function parseRegistryPayload(registryDataHex: string): RegistryPayload
```

Parses a BLKL v2 hex string into a `RegistryPayload`. Throws `InvalidRegistryDataError` if the magic, version, or structure is invalid. Throws `RegistryNotSortedError` if entries are not in strict ascending byte order. Use `fetchRegistryPayload` instead when fetching from a node.

---

### `resolveRegistryDeps`

```ts
function resolveRegistryDeps(
  deps:  CellDepLike[],
  specs: RegistrySpecLike[],
): CellDepLike[]
```

Resolves each `RegistrySpecLike` to the matching cell dep from `deps`. Used internally by `TransactionFirewall.checkTransaction`. Throws `MissingRegistryCellDepError` for a required spec with no match, and `AmbiguousRegistryCellDepError` if more than one dep matches a spec.

---

### `preflightCheck`

```ts
function preflightCheck(
  outputs:    TxOutputLike[],
  registries: RegistryPayload[],
): FirewallDecision
```

Checks all outputs against already-fetched registry payloads. Synchronous — no network call. Returns `{ ok: true }` if all outputs are clean, or `{ ok: false, code, reason }` on the first blocked output. Use this when you have payloads from `fetchRegistryPayload` and the transaction is not yet fully assembled. For cell-dep-aware checking, use `TransactionFirewall.checkTransaction`.

---

### `isBlacklisted`

```ts
function isBlacklisted(
  lockArgs:   string,
  registries: RegistryPayload[],
): boolean
```

Returns `true` if `lockArgs` matches an active entry in any of the given registries. Entries with `expiresAt` in the past (compared against the current wall-clock time) are treated as inactive. Synchronous.

---

### `isTypeArgsBlacklisted`

```ts
function isTypeArgsBlacklisted(
  typeArgs:   string,
  registries: RegistryPayload[],
): boolean
```

Same as `isBlacklisted` but for type args. Both functions search the same entry list — the distinction is semantic: `isBlacklisted` is for lock args checks (flag bit 0), `isTypeArgsBlacklisted` is for type args checks (flag bit 1).

---

### `buildFirewallLockScript`

```ts
function buildFirewallLockScript(config: FirewallLockConfig): ScriptLike
```

Builds the firewall lock script for a wallet cell. Returns `{ codeHash, hashType, args }` where `args` encodes the v2 FirewallLockArgs binary layout. See [Firewall Lock Args](/reference/firewall-lock-args/) for the byte layout.

---

### `buildFirewallSpendCellDeps`

```ts
function buildFirewallSpendCellDeps(
  config: FirewallSpendDepsConfig,
): TransactionCellDep[]
```

Returns the cell deps required for a transaction that spends a firewall-protected cell: the firewall-lock code cell, the inner lock code cell, and one `"code"` dep per registry outpoint.

---

## Classes

### `TransactionFirewall`

```ts
class TransactionFirewall {
  constructor(config: FirewallConfig);
  checkTransaction(tx: UnsignedTxLike): FirewallDecision;
}
```

Cell-dep-aware pre-flight checker. `checkTransaction` resolves registry cell deps from `tx.cellDeps` by `typeIdValue`, parses their BLKL payloads, and checks every output. Use this when the transaction is fully assembled and the registry dep is already in `cellDeps` — it confirms the same dep that will be broadcast is the one that was validated.

---

### `FirewallSdkError`

```ts
abstract class FirewallSdkError extends Error {
  abstract readonly code: FirewallReasonCode;
}
```

Abstract base for SDK errors that map to firewall pre-flight codes. Use `isFirewallSdkError` to narrow an unknown error to this type.

---

### `MissingRegistryCellDepError`

```ts
class MissingRegistryCellDepError extends FirewallSdkError {
  readonly code = 8;
}
```

Thrown when a required registry spec has no matching cell dep.

---

### `InvalidRegistryDataError`

```ts
class InvalidRegistryDataError extends FirewallSdkError {
  readonly code = 9;
}
```

Thrown when a registry cell dep's data fails BLKL v2 parsing.

---

### `RegistryNotSortedError`

```ts
class RegistryNotSortedError extends FirewallSdkError {
  readonly code = 10;
}
```

Thrown when registry entries are not in strict ascending byte order.

---

### `AmbiguousRegistryCellDepError`

```ts
class AmbiguousRegistryCellDepError extends FirewallSdkError {
  readonly code = 17;
}
```

Thrown when more than one cell dep matches a registry spec.

---

### `isFirewallSdkError`

```ts
function isFirewallSdkError(err: unknown): err is FirewallSdkError
```

Type guard. Returns `true` if `err` is a `FirewallSdkError` instance — i.e., one of the four typed error classes above.

## See also

- [How to run a pre-flight check in TypeScript](/how-to/preflight-typescript/) — patterns: `preflightCheck` vs `TransactionFirewall.checkTransaction`
- [How to check a single address](/how-to/single-address-check/) — `isBlacklisted` without a full transaction
- [How to handle time-based entries](/how-to/time-based-entries/) — `header_deps` for `expiresAt` entries
- [How to build a firewall lock script](/how-to/build-firewall-lock-script/) — `buildFirewallLockScript`
- [How to build cell deps for spending](/how-to/build-spend-cell-deps/) — `buildFirewallSpendCellDeps`
- [Error codes](/reference/error-codes/) — what each numeric code means
- [Example: wallet-feedback](/examples/wallet-feedback/) — runnable demo of all three pre-flight outcomes
- [Example: agent-preflight](/examples/agent-preflight/) — SDK in an AI agent tool
