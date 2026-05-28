# @ckb-firewall/sdk

<p align="center">
  <img src="https://raw.githubusercontent.com/digitaldrreamer/ckb-transaction-firewall/main/assets/logo.png" alt="CKB Transaction Firewall" width="100" />
</p>

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
  registries: [
    {
      codeHash: "0x...",
      hashType: "type",
      typeIdValue: "0x...", // 32-byte hex, bytes 34..66 of the v2 registry type args
      required: true,
    },
  ],
});

// registryScriptType: the type script of the registry cell dep (code_hash, hash_type, args)
// registryData: the hex-encoded BLKL v2 payload from the registry cell's data field
// Both are available from fetchRegistryPayload or the live cell via get_live_cell.
const result = firewall.checkTransaction({
  cellDeps: [{ type: registryScriptType, data: registryData }],
  outputs: [{ lockArgs: "0x..." }],
});

if (!result.ok) {
  // result.code and result.reason are narrowed by the discriminated union
  console.error(result.reason); // e.g. "BlacklistedLockArgs"
}
```

`checkTransaction` is synchronous and makes no RPC calls. You fetch the live registry cell from your CKB node and pass it as a `cellDep` — the SDK parses the BLKL payload and checks every output in the transaction.

## How the SDK and the lock script fit together

This SDK is the **pre-flight** half of a two-part system.

The other half is the **Firewall lock script** — a CKB lock deployed on-chain. When a cell uses the Firewall lock, every CKB node enforces the same blacklist check at consensus, regardless of what the application layer does. A compromised agent that skips the SDK call entirely cannot bypass the lock.

The SDK catches bad transactions **before you sign**, saving fees and giving your runtime a structured error to act on. The lock catches anything that makes it to the network anyway. Used together, neither layer can be bypassed independently — the SDK alone can be skipped by compromised code, and the lock alone gives you no early feedback before broadcasting.

If your cells don't use the Firewall lock, the SDK still works as a standalone pre-flight check — but the consensus-level guarantee doesn't apply.

## Testnet

The canonical testnet registry values are in [`notes/deployments/testnet.registry.json`](../../notes/deployments/testnet.registry.json). The `registrySpec` object in that file maps directly to a `RegistrySpecLike` entry in the `registries` array.

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
- [Documentation](https://ckb-firewall.drreamer.digital/)
- [How to use](https://ckb-firewall.drreamer.digital/guides/governance-how-to-use/)
- [Testnet deployment](https://ckb-firewall.drreamer.digital/operations/testnet-deployment/)
- [Architecture](https://ckb-firewall.drreamer.digital/concepts/architecture/)
