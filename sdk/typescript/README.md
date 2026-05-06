# TypeScript SDK

TypeScript implementation of Layer 1 pre-flight checks for CKB agent transaction flows.

## Responsibilities

- fetch and parse blacklist registry state from CKB RPC,
- inspect transaction outputs before signing,
- return structured allow/deny results for agent runtimes,
- provide helpers for firewall lock configuration.

## Public API Direction (v1)

- `TransactionFirewall`: main check engine.
- `checkTransaction(unsignedTx)`: pre-flight decision API.
- `buildFirewallLock(config)`: helper for firewall lock composition.

## Implemented Modules (current)

- `src/types.ts`: typed transaction/dependency/config/result models.
- `src/blacklist.ts`: exact registry dep resolution + BLKL v1 payload parsing.
- `src/firewall.ts`: deterministic allow/deny preflight evaluation.
- `src/index.ts`: public exports.

## Registry Resolution Contract

- Registry lookup uses the registry cell’s **type script** triple: `codeHash`, `hashType`, `args` (same bytes as in firewall lock args).
- SDK MUST scan provided deps/context and enforce exactly-one-match semantics.
- SDK MUST map zero matches to `MissingRegistryCellDep` (code `8`) and multiple matches to `AmbiguousRegistryCellDep` (code `17`).

## Expected layout

- `src/firewall.ts`: transaction safety entrypoint.
- `src/blacklist.ts`: registry fetch + parse logic.
- `src/index.ts`: SDK public exports.

## Error Model

SDK methods should return stable, machine-readable error codes plus human-readable messages so operators, dashboards, and autonomous agents can respond consistently.

Canonical public constants are documented in `docs/lock-script-spec.md` and must remain aligned with on-chain lock script codes.
