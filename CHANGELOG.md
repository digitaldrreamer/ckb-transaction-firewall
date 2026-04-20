# Changelog

## 2026-04-20

- Scaffolded repository structure from `README.md` with core folders and markdown placeholders.

## 2026-04-20 (docs enrichment)

- Expanded architecture, lock script spec, and governance docs with v1-ready detail.
- Expanded tests, integration scope, and scripts documentation including CLI direction.
- Expanded contract and SDK module READMEs with responsibilities and security properties.

## 2026-04-20 (policy freeze pass)

- Frozen governance voting model to 9 active validators with one-validator-one-vote and explicit per-proposal thresholds.
- Added emergency temporary-add-only policy with 6-hour minimum vote window, 72-hour TTL, and ratification requirement.
- Switched lock spec to stable registry identity matching with exact dep uniqueness rule (zero/multiple matches fail).
- Frozen V1 lock args layout and public custom error constants starting at code 5.

## 2026-04-20 (full consistency pass)

- Updated remaining docs to align with stable registry identity + exactly-one dep-selection rule.
- Replaced residual outdated wording and aligned validator lifecycle policy details.
- Synced SDK/contract/script/test docs to canonical error semantics (including AmbiguousRegistryCellDep).

## 2026-04-20 (PR review follow-up)

- Registry identity: use CKB type script triple in lock args and SDK examples; remove redundant type-hash + args-hash pairing.
- Error codes: drop unused RegistryIdentityMismatch; renumber public constants 9–17.
- Emergency TTL: specify expires_at + median-time evaluation in lock spec and governance docs.
