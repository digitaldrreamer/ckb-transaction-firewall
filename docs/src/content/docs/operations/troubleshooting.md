---
title: Troubleshooting
description: Common failure modes when using the firewall lock, SDKs, and CLI.
---

## `MissingRegistryCellDep`

The transaction did not include a matching registry cell dep.

Check:

- the configured `registryScript`
- the `cellDeps` entry you pass to the SDK
- the registry outpoint used by the CLI or deployment flow

## `AmbiguousRegistryCellDep`

More than one cell dep matched the configured registry identity.

Fix:

- keep only one matching registry dep in the transaction
- ensure you are not duplicating the registry dep across helper layers

## `InvalidRegistryData`

The registry cell data does not match the `BLKL` format.

Common causes:

- wrong outpoint
- contract binary cell used instead of registry cell data
- truncated or malformed payload

## `RegistryNotSorted`

The registry entries are not in the required order.

This usually means the registry payload was edited without using the repository helpers or governance flow.

## `ckb-cli` signing failures

If the CLI cannot sign or submit:

- confirm `ckb-cli` is installed and on `PATH`
- confirm the `--from-account` address is available in `ckb-cli`
- confirm the RPC URL is reachable

## Live registry mismatch

If the SDK succeeds against one registry snapshot but your runtime fails later, make sure you are using the same live registry cell data in both places. The SDK does not fetch RPC data on its own.
