---
title: Error Codes
description: Public mapping of firewall and registry error codes used by the contracts and SDKs.
---

The firewall and registry layers use stable error codes for deterministic handling.

## Handle them in code

```ts
const result = firewall.checkTransaction(tx);

if (!result.ok) {
  switch (result.code) {
    case 8:
      // Missing registry dep
      break;
    case 9:
      // Invalid registry payload
      break;
    case 10:
      // Registry payload order is wrong
      break;
    case 11:
      // Blacklisted lock args
      break;
    case 12:
      // Blacklisted type args
      break;
    case 17:
      // More than one registry dep matched
      break;
  }
}
```

## Firewall lock

- `5` `InvalidArgsLayout`
- `6` `UnsupportedVersion`
- `7` `UnsupportedFlags`
- `8` `MissingRegistryCellDep`
- `9` `InvalidRegistryData`
- `10` `RegistryNotSorted`
- `11` `BlacklistedLockArgs`
- `12` `BlacklistedTypeArgs`
- `13` `MissingInnerLockCellDep`
- `14` `InvalidInnerLockScript`
- `15` `InnerLockRejected`
- `16` `OutputScriptParseFailed`
- `17` `AmbiguousRegistryCellDep`

## Governance lock

These codes are returned by `governance-lock` when a registry update transaction is rejected.

- `1` `InvalidArgs` — contract args are not 1 byte (version)
- `2` `InvalidBlkl` — registry cell data is not a valid BLKL v2 payload or governance header
- `3` `InvalidWitness` — GOV1 payload is malformed (wrong magic, wrong version, wrong length, or zero hashes)
- `4` `SigVerificationFailed` — a validator vote entry has an invalid secp256k1 signature, a mismatched recovered pubkey, or an invalid validator Merkle proof
- `5` `ThresholdNotMet` — fewer than the required number of valid validator yes-votes
- `6` `ReviewWindowNotMet` — the anchored `PBLK` proposal input's `since` field does not encode a relative median-time-past delay of at least `review_delay_ms`

## Blacklist registry

- `20` `InvalidTypeArgsLayout`
- `21` `InvalidRegistryCellTopology`
- `22` `InvalidRegistryPayload`
- `23` `UnsupportedRegistryVersion`
- `24` `InvalidGovernanceWitness`
- `25` `UnauthorizedGovernanceLock`
- ~~`26`~~ — reserved (removed during development; not emitted by any contract)
- `27` `InvalidTypeId`
- `28` `InvalidProposalCell` — the `PBLK` proposal cell data is malformed or does not match the registry transition

## Proposal anchor

These codes are returned by the `proposal-anchor` type script, which validates `PBLK` cells during anchor creation, execution, and reclaim.

- `31` `InvalidTypeArgs` — proposal-anchor type args are malformed
- `32` `InvalidTopology` — transaction input/output structure is invalid for a proposal-anchor operation
- `33` `InvalidProposalData` — `PBLK` cell data is malformed or has an unsupported version
- `34` `UnauthorizedTreasuryLock` — the input spending the anchor is not locked by the registry treasury lock
- `35` `InvalidReclaimReturn` — reclaim output does not return full capacity to the treasury lock
- `36` `InvalidReclaimSince` — the anchor input's `since` field does not encode a valid relative timestamp delay for reclaim


## SDK mapping

The TypeScript SDK currently exposes the subset of codes relevant to pre-flight validation:

- `8`
- `9`
- `10`
- `11`
- `12`
- `17`

## Why this matters

These codes are stable identifiers shared by the on-chain scripts, the SDKs, and the CLI.

## Fix these codes

| Code(s) | Fix |
|---|---|
| `8` `MissingRegistryCellDep` | [Fix: MissingRegistryCellDep](/how-to/fix-missing-registry-dep/) |
| `9` `InvalidRegistryData`, `10` `RegistryNotSorted` | [Fix: stale registry cell](/how-to/fix-stale-registry-cell/) |
| `17` `AmbiguousRegistryCellDep` | [Fix: AmbiguousRegistryCellDep](/how-to/fix-ambiguous-registry-dep/) |
| `11` `BlacklistedLockArgs`, `12` `BlacklistedTypeArgs` | Pre-flight caught a blacklisted output. Block the transfer. |
| Pre-flight passes but on-chain fails | [Fix: pre-flight passes, on-chain fails](/how-to/fix-preflight-passes-onchain-fails/) |
| All codes — symptom not clear | [Troubleshooting index](/how-to/troubleshoot/) |

## Related pages

- [TypeScript SDK API](/reference/typescript-sdk/) — `FirewallSdkError` and its subclasses
- [Rust SDK API](/reference/rust-sdk/) — `FirewallError` enum variants
- [Proposal anchor contract](/reference/proposal-anchor/) — codes 31–36 in detail
