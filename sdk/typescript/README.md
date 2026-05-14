# TypeScript SDK

TypeScript implementation of Layer 1 pre-flight checks for CKB agent transaction flows.

## CKB testnet (public devnet)

Deploy `firewall-lock` and `blacklist-registry` to testnet, then copy the live registry **type script** into `FirewallConfig.registryScript`. Step-by-step commands, `ckb-cli` queries, and an example JSON shape: [docs/deployments/testnet.md](../../docs/deployments/testnet.md), [docs/deployments/testnet.registry.json](../../docs/deployments/testnet.registry.json).

## Module and types

- **ESM-only** build under `dist/`; Node **20+** (`engines` in [`package.json`](./package.json)).
- **Types:** `FirewallDecision` is a discriminated union; failures use literal `reason` strings aligned with `FIREWALL_ERROR_CODES`.
- **Errors:** `MissingRegistryCellDepError`, `InvalidRegistryDataError`, `RegistryNotSortedError`, `AmbiguousRegistryCellDepError` extend `FirewallSdkError` and are thrown from registry resolution / parsing; `TransactionFirewall.checkTransaction` maps them to decisions.

## Responsibilities

- parse caller-supplied blacklist registry cell data,
- inspect transaction outputs before signing,
- return structured allow/deny results for agent runtimes,
- provide helpers for firewall lock configuration.

## Public API Direction (v1)

- `TransactionFirewall`: main check engine.
- `checkTransaction(unsignedTx)`: pre-flight decision API.
- `buildFirewallLock(config)`: helper for firewall lock composition.

## Implemented Modules (current)

- `src/types.ts`: typed transaction/dependency/config/result models.
- `src/errors.ts`: typed SDK errors for registry resolution and parsing.
- `src/blacklist.ts`: exact registry dep resolution + BLKL v1 payload parsing.
- `src/firewall.ts`: deterministic allow/deny preflight evaluation.
- `src/index.ts`: public exports.

## Local Validation

```bash
cd sdk/typescript
npm ci
npm run typecheck
npm test
npm run build
npm run attw
```

## Registry Resolution Contract

- Registry lookup uses the registry cell’s **type script** triple: `codeHash`, `hashType`, `args` (same bytes as in firewall lock args).
- SDK MUST scan provided deps/context and enforce exactly-one-match semantics.
- SDK MUST map zero matches to `MissingRegistryCellDep` (code `8`) and multiple matches to `AmbiguousRegistryCellDep` (code `17`).
- SDK core MUST NOT perform implicit RPC inside `checkTransaction`; callers fetch the registry cell from their chosen source and pass it as `UnsignedTxLike.cellDeps`.

## Expected layout

- `src/firewall.ts`: transaction safety entrypoint.
- `src/blacklist.ts`: registry fetch + parse logic.
- `src/index.ts`: SDK public exports.

## Error Model

SDK methods should return stable, machine-readable error codes plus human-readable messages so operators, dashboards, and autonomous agents can respond consistently.

Canonical public constants are documented in `docs/lock-script-spec.md` and must remain aligned with on-chain lock script codes.
