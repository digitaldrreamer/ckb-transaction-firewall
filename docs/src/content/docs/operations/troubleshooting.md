---
title: Troubleshooting
description: Common failure modes when using the firewall lock, SDKs, and CLI.
---

## Transaction rejected: `MissingRegistryCellDep` (code 8)

The transaction did not include a matching registry cell dep, or the cell dep's type script doesn't match the registry identity encoded in the firewall lock args.

Check:
- The registry cell dep is present in `cell_deps`
- The dep's type args (specifically `args[34..66]`) match the `typeIdValue` in the firewall lock args
- You are not accidentally including the contract binary cell instead of the registry data cell

## Transaction rejected: `AmbiguousRegistryCellDep` (code 17)

More than one cell dep matched the configured registry identity. The firewall requires exactly one.

Fix: remove duplicate registry deps from the transaction.

## `fetchRegistryPayload` throws "is not live"

The registry cell at the outpoint you cached has been consumed by a governance update.

**Fix:** Use `findRegistryCell` to get the new outpoint, then re-fetch:

```ts
import { findRegistryCell, fetchRegistryPayload } from "@ckb-firewall/sdk";

const { txHash, index } = await findRegistryCell(rpcUrl, registrySpec);
const registry = await fetchRegistryPayload(rpcUrl, txHash, index);
```

The CLI (`ckb-firewall inspect`, `ckb-firewall check`, `ckb-firewall execute`) does this automatically when using testnet defaults.

## Transaction rejected: `InvalidRegistryData` (code 9)

The registry cell data doesn't parse as a valid BLKL v2 payload.

Common causes:
- Wrong outpoint — pointing at the contract binary cell rather than the registry data cell
- Stale outpoint — the registry was updated by a governance transaction and the old cell was consumed
- Truncated or manually edited payload

## Transaction rejected: `RegistryNotSorted` (code 10)

The registry entries are not in strict ascending byte order. This means the registry payload was modified incorrectly — entries must be sorted and deduplicated using the governance flow, not edited directly.

## Temporary entries block spends they should allow

A time-based entry (`expiresAt` timestamp) is blocking a spend even though the current time is past the expiry.

**Cause:** The spending transaction is missing `header_deps`. The firewall reads the chain's median block time to evaluate expiry — without `header_deps`, median time returns zero and all temporary entries are treated as permanently active.

**Fix:** Include a recent block hash in `header_deps` when building any transaction that spends a firewall-protected cell if the registry contains time-based entries.

## In-flight transaction fails after a governance update

A pending transaction is rejected by miners even though it was pre-flight checked successfully.

**Cause:** A governance update was confirmed while the transaction was pending. The governance update consumed the old registry cell and created a new one. The pending transaction referenced the old (now consumed) cell as a dep.

**Fix:** Rebuild the transaction against the current registry cell outpoint and resubmit. Use `findRegistryCell` (SDK) or `ckb-firewall inspect` (CLI) to discover the new outpoint:

```ts
import { findRegistryCell } from "@ckb-firewall/sdk";

const { txHash, index } = await findRegistryCell(rpcUrl, registrySpec);
// use txHash and index as the registry cell dep in the rebuilt transaction
```

## Pre-flight check passes but the transaction still fails on-chain

The SDK checked the transaction before signing, but the on-chain lock rejected it.

Common reasons:
- The registry cell was updated between pre-flight and broadcast — a newly listed entry wasn't in your snapshot
- The wrong registry cell was used for pre-flight (different outpoint than what's in the cell deps)
- The transaction includes a different set of outputs than what the pre-flight checked

Always fetch a fresh registry snapshot immediately before building and signing, and make sure the same outpoint appears in both the pre-flight data and the transaction's `cell_deps`.

## `ckb-cli` signing failures

If the CLI cannot sign or submit:
- Confirm `ckb-cli` is installed and on `PATH`
- Confirm the `--from-account` address is available in `ckb-cli`'s keystore
- Confirm the RPC URL is reachable: `curl -s https://testnet.ckb.dev -X POST -H "Content-Type: application/json" -d '{"id":1,"jsonrpc":"2.0","method":"get_tip_header","params":[]}'`

## Proposal execute fails: vote digest mismatch

The `execute` command reports that the stored `voteDigestHash` does not match the recomputed hash from stored votes.

**Cause:** The proposal file was edited after votes were recorded, or votes were imported in an inconsistent state.

**Fix:** Re-import the proposal from the participant who cast the votes, so the votes and digest are consistent.

## Vote command rejects key: not in validator set

The `vote` command says the private key is not an authorized validator.

The validator set on testnet is 5 members with a 3-of-5 governance threshold. Votes from other keys are rejected because the key would fail the Merkle membership proof against the on-chain validator Merkle root.

## Registry cell not found after governance execute

The `execute` command ran and produced a tx hash, but `inspect` still shows the old registry.

**Cause:** The transaction may still be pending confirmation, or it failed silently.

**Fix:** Check the transaction status:
```bash
ckb-cli --url https://testnet.ckb.dev rpc get_transaction \
  --hash <tx-hash>
```

If status is `rejected`, the witness validation failed on-chain. Re-run `execute` after verifying all vote and signer signatures.
