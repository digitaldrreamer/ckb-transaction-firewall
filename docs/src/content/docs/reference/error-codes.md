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
- 17 AmbiguousRegistryCellDep

## Blacklist registry

- 20 InvalidTypeArgsLayout
- 21 InvalidRegistryCellTopology
- 22 InvalidRegistryPayload
- 23 UnsupportedRegistryVersion
- 24 InvalidGovernanceWitness
- 25 UnauthorizedGovernanceLock
- 27 InvalidTypeId


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
