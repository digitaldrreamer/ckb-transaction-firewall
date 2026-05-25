# CKB public testnet (TypeScript-first deployment)

Nervos **CKB testnet** is the shared public network most teams use as a devnet. Default RPC in this repo is `https://testnet.ckb.dev`. There is no separate npm publish step for on-chain code: you deploy **contracts** with `ckb-cli`, then point the **TypeScript SDK** at the resulting **registry type script** and live **registry cell data**.

## Prerequisites

- **Rust** with `riscv64imac-unknown-none-elf` (`rustup target add riscv64imac-unknown-none-elf`).
- **`ckb-cli`** installed and on `PATH` (CI pins **v1.15.0**; match or document variance).
- A **testnet account** with enough CKB to pay deployment fees (see `ckb-cli account` / wallet import).
- **`jq`** for inspecting `deploy/info.json`.

## 1. Deploy `firewall-lock` and `blacklist-registry`

From the repository root:

```bash
./scripts/deploy.sh --network testnet --rpc-url https://testnet.ckb.dev --from-address <YOUR_CKT1_ADDRESS>
```

Omit `--from-address` if `ckb-cli account list` already has a default for testnet.

Useful flags:

- `--dry-run`: runs `deploy gen-txs` and prints `sign-txs` / `apply-txs` commands without signing. **Note:** this still refreshes `deploy/info.json` (existing file is rotated to `*.bak`).
- `--no-build`: skip `cargo build` if you already have fresh RISC-V binaries.
- `--strict-governance-lock`: two-stage deploy for strict governance-lock drills (not required for a first TS-focused testnet smoke).

Outputs (under `deploy/`, which is **gitignored**):

- `deploy/info.json`: deployment recipe, tx hashes, cell indices.
- `deploy/migrations/`: migration JSON for `deploy apply-txs`.

After a dry run, run the printed commands, for example:

```bash
ckb-cli --url https://testnet.ckb.dev deploy sign-txs --from-account <YOUR_CKT1_ADDRESS> --add-signatures --info-file deploy/info.json
ckb-cli --url https://testnet.ckb.dev deploy apply-txs --migration-dir deploy/migrations --info-file deploy/info.json
```

**`ckb-cli` 2.x RPC naming:** `rpc get_transaction` takes **`--hash`**, not `--tx-hash`. `rpc get_live_cell` uses **`--tx-hash`** and **`--index`**.

## 2. Read the registry **type script** for the TypeScript SDK

The TypeScript SDK uses `FirewallConfig.registries` (an array of `RegistrySpecLike`). The `typeIdValue` is bytes 34–66 of the registry cell's 66-byte v2 type args — the stable identifier that survives governance-lock upgrades. After txs are **committed**, take `tx_hash` and `index` for the `blacklist_registry` output from `deploy/info.json` (see `new_recipe.cell_recipes`), then confirm status and read the cell:

```bash
TX="<tx_hash from info.json>"
IDX="<decimal index, e.g. 1>"
ckb-cli --url https://testnet.ckb.dev rpc get_transaction --hash "$TX" --output-format json \
  | jq '.tx_status.status'
ckb-cli --url https://testnet.ckb.dev rpc get_live_cell --tx-hash "$TX" --index "$IDX" \
  --output-format json \
  | jq '.cell.output.type'
```

Copy `code_hash`, `hash_type`, and `args` into your app (hex strings with `0x` prefix for the SDK). See [`sdk/typescript/README.md`](../../sdk/typescript/README.md) and [`testnet.registry.json`](testnet.registry.json).

## 3. Build `cellDeps` for `checkTransaction`

The SDK does not perform RPC by itself in the current build: your runtime should fetch the live registry cell (or equivalent), map it to `CellDepLike` (`type`, `data` as hex), and attach it to `UnsignedTxLike.cellDeps` before calling `TransactionFirewall.checkTransaction`.

**TYPE_ID deploy cell vs BLKL:** the `blacklist_registry` row in `deploy/info.json` is the **type script binary** cell created by `ckb-cli deploy` (`enable_type_id = true`). Its **cell data** is the RISC-V program (ELF), not a `BLKL` v2 payload. The on-chain firewall lock and the TS SDK both parse **registry dep data** as `BLKL` v2.

For the current canonical testnet registry, use [`testnet.registry.json`](testnet.registry.json):

- `registrySpec`: use `codeHash` and `hashType` from this; derive `typeIdValue` as bytes 34–66 of the `args` hex to build a `RegistrySpecLike` for `FirewallConfig.registries`.
- `canonicalRegistryCell`: fetch this outpoint from testnet via `fetchRegistryPayload(rpcUrl, txHash, index)` and pass the result to `preflightCheck`.
- `firewallLockDeployOutPoint`: the deployed `firewall-lock` contract binary cell. Deployment metadata only.
- `blacklistRegistryDeployOutPoint`: the deployed `blacklist-registry` contract binary cell. Deployment metadata only; do not use its ELF data as a registry payload.
- `deploymentHistory`: log of past deployments with block numbers and tx hashes for upgrade traceability.

## 4. Optional: publish canonical constants

Because `deploy/` is gitignored, teams usually add a **checked-in** small JSON (for example under `notes/deployments/`) once you agree on a **canonical** community testnet deployment, or publish hashes in release notes. [`testnet.registry.json`](testnet.registry.json) records the current canonical testnet registry script and BLKL cell outpoint.

## 5. Use the canonical registry in the SDK

Use this for real testnet pre-flight checks:

1. Open [`testnet.registry.json`](testnet.registry.json).
2. In your app, build a `RegistrySpecLike` from the `registrySpec` object: set `codeHash`/`hashType` directly, and derive `typeIdValue` as bytes 34–66 (64 hex chars) of the `args` field.
3. Fetch the live BLKL payload: `const registry = await fetchRegistryPayload("https://testnet.ckb.dev", canonicalRegistryCell.txHash, canonicalRegistryCell.index)`.
4. Run pre-flight: `preflightCheck(outputs, [registry])`.
5. Build `outputs` the way your wallet or dapp normally would (lock args and type args you want to check).
6. From repo root, confirm the SDK still passes: `cd sdk/typescript && npm ci && npm test`.
7. Integrate the same pattern into your runtime (config or fetched BLKL payload depending on product needs).

For local/off-chain mocks only, `exampleEmptyRegistryPayloadHex` remains a minimal empty `BLKL` payload.

To rotate or replace the canonical BLKL cell, run the governance bootstrap/update flow with `scripts/phase4_prepare_tx_files.sh` and `scripts/phase4_submit_tx.sh`, then update `canonicalRegistryCell` after the replacement transaction is committed.

## Related

- [Governance](https://ckb-firewall.drreamer.digital/concepts/governance/)
- [Testnet deployment](https://ckb-firewall.drreamer.digital/operations/testnet-deployment/)
- [Architecture](https://ckb-firewall.drreamer.digital/concepts/architecture/)
- [Internal governance notes](../governance.md)
