# @ckb-firewall/sdk

[![npm](https://img.shields.io/npm/v/@ckb-firewall/sdk)](https://www.npmjs.com/package/@ckb-firewall/sdk)
[![Tests](https://github.com/digitaldrreamer/ckb-transaction-firewall/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/digitaldrreamer/ckb-transaction-firewall/actions/workflows/tests.yml)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

Pre-flight blacklist enforcement for CKB transactions. Works in AI agent runtimes, wallets, dapps, and any service that builds CKB transactions before signing.

## Install

```bash
npm install @ckb-firewall/sdk
```

Node 20+. ESM only (`import`; no `require`).

## Usage

```typescript
import { TransactionFirewall } from "@ckb-firewall/sdk";

const firewall = new TransactionFirewall({
  registryScript: {
    codeHash: "0x...",
    hashType: "type",
    args: "0x...",
  },
});

const result = firewall.checkTransaction({
  cellDeps: [{ type: registryScript, data: registryData }],
  outputs: [{ lockArgs: "0x..." }],
});

if (!result.ok) {
  // result.code and result.reason are narrowed by the discriminated union
  console.error(result.reason); // e.g. "BlacklistedLockArgs"
}
```

`checkTransaction` is synchronous and makes no RPC calls. You fetch the live registry cell from your CKB node and pass it as a `cellDep` — the SDK parses the BLKL payload and checks every output in the transaction.

## Testnet

The canonical testnet registry values are in [`docs/deployments/testnet.registry.json`](../../docs/deployments/testnet.registry.json). Use those for `registryScript` against `https://testnet.ckb.dev`.

## Result codes

`checkTransaction` returns `{ ok: true }` or `{ ok: false, code, reason }`:

| Code | Reason | Meaning |
|------|--------|---------|
| 8 | `MissingRegistryCellDep` | No registry cell dep matched |
| 9 | `InvalidRegistryData` | Registry payload failed to parse |
| 10 | `RegistryNotSorted` | Registry entries are out of order |
| 11 | `BlacklistedLockArgs` | An output's lock args are blacklisted |
| 12 | `BlacklistedTypeArgs` | An output's type args are blacklisted |
| 17 | `AmbiguousRegistryCellDep` | More than one registry cell dep matched |

## Typed errors

Registry parsing errors are exported as typed classes for `instanceof` checks in your own error handling:

```typescript
import {
  isFirewallSdkError,
  MissingRegistryCellDepError,
  InvalidRegistryDataError,
  RegistryNotSortedError,
  AmbiguousRegistryCellDepError,
} from "@ckb-firewall/sdk";
```

## More

- [CKB Transaction Firewall](https://github.com/digitaldrreamer/ckb-transaction-firewall) — contracts, Rust SDK, governance, testnet deployment
- [Testnet deployment guide](../../docs/deployments/testnet.md)
- [Architecture and trust model](../../docs/architecture.md)
