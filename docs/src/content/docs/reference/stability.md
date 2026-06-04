---
title: Stability Guarantees
description: What is stable across SDK versions, what may change, and where semantic versioning applies.
---

## Frozen

These identifiers are stable across all SDK and contract versions. Integrations may depend on them without migration risk.

**On-chain error codes.** The numeric codes in [Error codes](/reference/error-codes/) are frozen. Code 8 is always `MissingRegistryCellDep`, code 11 is always `BlacklistedLockArgs`. These codes are also stable in the SDK — `FirewallError::code()` and `FirewallDecision.code` will always return these values for the corresponding error.

**Binary format magic bytes.** `BLKL` (`0x42 0x4c 0x4b 0x4c`) and `GOV1` (`0x47 0x4f 0x56 0x31`) and `PBLK` (`0x50 0x42 0x4c 0x4b`) are frozen.

**BLKL v2 format.** The field layout described in [BLKL format](/reference/blkl-format/) for version `0x02` is frozen. New governance header versions (v2, v3) are additive and backward-compatible.

**FirewallLockArgs v2 layout.** The field layout described in [Firewall lock args](/reference/firewall-lock-args/) for version `0x02` is frozen.

**Testnet Type IDs.** The Type IDs in [Testnet deployment](/reference/testnet-deployment/) are fixed for the lifetime of the current testnet registry instance.

## Versioned by semver

These follow semantic versioning: breaking changes increment the major version.

**TypeScript SDK (`@ckb-firewall/sdk`).** Public exports, function signatures, and type names. Currently v0.x — the API is stable within a minor version but breaking changes may occur at v1.0.

**Rust SDK (`ckb-transaction-firewall-sdk`).** Public traits, structs, and function signatures. Currently v0.x — same policy.

**CLI (`@ckb-firewall/cli`).** Command names and option names. Currently v0.x.

## May change without notice

**Testnet cell outpoints.** The registry cell outpoint changes after every governance update. Contract code cell outpoints may change if contracts are redeployed. Always use `findRegistryCell` or `ckb-firewall inspect` to discover current outpoints; do not hardcode them.

**BLKL governance header versions.** New `gh_version` values (v4 and beyond) may be introduced. Parsers should accept known versions and reject unknown ones.

**GOV1 witness versions.** The current version is `0x04`. New versions may be introduced with additive fields.

**CLI output format.** Human-readable table output, column widths, color, and log messages may change without a major version bump. Do not parse CLI output programmatically; use the SDK instead.

**Internal proposal JSON format.** The `~/.ckb-firewall/proposals/` file format may change between CLI versions. Use `export`/`import` for sharing; do not rely on the internal file structure.

## See also

- [Changelog](/changelog/) — user-facing release notes for what changed and what to do
- [BLKL v2 Format](/reference/blkl-format/) — the frozen binary format
- [Error codes](/reference/error-codes/) — the frozen error code table
