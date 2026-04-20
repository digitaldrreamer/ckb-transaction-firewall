# Tests

This directory contains verification for contract behavior, SDK parity, and end-to-end enforcement.

## Test Strategy

- Validate deterministic blacklist matching behavior.
- Verify fail-closed semantics when dependencies are missing/invalid.
- Confirm SDK and lock-script produce consistent allow/deny outcomes.
- Exercise governance update flow and registry version transitions.

## Submodules

- `unit/`: deterministic logic tests with local fixtures and mocked chain context.
- `integration/`: full transaction path tests against testnet/local devnet.

## Core Scenarios

- Safe transaction passes SDK and consensus.
- Blacklisted destination is rejected in SDK pre-flight.
- Blacklisted destination is rejected at lock-script validation.
- Missing registry `cell_dep` fails closed.
- Ambiguous registry dep matches fail closed (`AmbiguousRegistryCellDep`).
- Invalid registry payload format fails.
- Governance update applies new blacklist version.

## Quality Gates

- No silent allow on parser errors.
- Explicit error code mapping for expected rejection categories.
- Regression suite for previously blocked exploit patterns.
