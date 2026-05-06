# Governance Deep Dive

This document describes how blacklist entries are added, removed, and audited without centralized control.

## Governance Principles

- Decentralized control over blacklist state transitions.
- Deliberate review before impactful changes.
- Transparent and auditable lifecycle for every update.
- High friction for malicious or accidental censorship attempts.

## Roles

- **Proposer**: submits add/remove request with evidence.
- **Reviewer**: performs open technical and risk review.
- **Validator**: votes according to governance rules.
- **Multisig Signer**: executes approved updates on-chain.
- **Observer**: any community member who audits process integrity.

## Proposal Types

- `add_entry`: add a malicious destination identifier.
- `remove_entry`: remove a previously flagged identifier.
- `metadata_update`: non-policy metadata/documentation changes (optional future type).

## Proposal Requirements

Every proposal should include:

- unique identifier and timestamp,
- destination identifier(s) in canonical encoding,
- threat classification and severity,
- reproducible evidence links,
- proposer rationale and impact statement.

Schema is tracked in `governance/proposal-schema.json`.

## Lifecycle

1. **Submission**: proposal is published and indexed.
2. **Validation**: schema and formatting checks pass.
3. **Review Window**: minimum 72-hour public discussion period.
4. **Voting**: validator set votes within fixed voting epoch.
5. **Execution**: successful proposal becomes signed registry replacement transaction.
6. **Finalization**: new registry cell is live and linked to proposal id.

## Voting Policy (v1)

- Validator set: 9 active validators, plus up to 3 standby validators.
- Voting legitimacy rule: one validator equals one vote.
- Execution legitimacy is separate: multisig is settlement-only for passed proposals.

### Thresholds (normative)

| Proposal type | Rule |
|---|---|
| Ordinary `add_entry` | quorum 6, pass >= 5 yes and yes > no, 72h review, immediate post-pass execution via 3-of-5 multisig |
| Ordinary `remove_entry` | quorum 7, pass >= 6 yes and yes > no, 72h review, immediate post-pass execution via 3-of-5 multisig |
| Meta-governance / script changes | quorum 7, pass >= 6 yes and yes > no, 7-day review, 48h execution delay, then 3-of-5 multisig |
| Validator onboarding/removal | quorum 6, pass >= 5 yes and yes > no, 7-day review, effective next rotation window |

## Multisig Execution

- Approved ordinary proposals are executed by 3-of-5 signer threshold.
- Execution transaction replaces registry cell atomically.
- Witness payload references approved proposal id and vote result digest.

### On-chain binding (registry type script)

The registry replacement transaction is protected by the **Blacklist Registry type script** (`contracts/blacklist-registry`).

At consensus, the type script enforces:

- exactly one input + one output registry cell using the same registry type script identity,
- both registry cells are locked by the configured governance lock script identity,
- the registry data is well-formed (`BLKL` v1 format and sorted entries),
- a `GOV1` governance witness payload is present in `WitnessArgs.input_type` (preferred; `lock` accepted for backward compatibility) for the registry input cell and binds:
  - `proposal_id_hash` + `vote_digest_hash`
  - the exact `old_registry_root` → `new_registry_root` transition, where each root is `blake2b_256` over the full registry cell data (personalization `ckb-default-hash`).
- strict signer structure/threshold authorization is verified in-script:
  - witness includes `signer_count` plus repeated `{signer_index, signature[65]}` entries,
  - signer indexes must be unique and in range `[0,4]`,
  - at least 3 signer entries (or 5 for bootstrap) are required and validated structurally.
- bootstrap support:
  - first registry creation is allowed as `0 registry inputs -> 1 registry output`,
  - bootstrap enforces `old_root = 0x00..00`,
  - bootstrap requires 5 signer entries with valid structural constraints.

### Signer key rotation policy (v1)

- Because signer pubkeys are compiled into the registry type script, key rotation requires deploying a new script binary (new code hash) and governance-led migration.
- Emergency compromise handling must include:
  - immediate governance notice and temporary execution freeze,
  - audited replacement binary with rotated signer set,
  - migration to the new type script identity and off-chain config update (SDK/indexers/operators).

## Validator Lifecycle Policy

- Validator pool: 9 active validators plus up to 3 standby validators.
- Onboarding: public application, 7-day review, validator-change vote threshold.
- Rotation cadence: every 90 days.
- Participation triggers for replacement review:
  - less than 80% participation over rolling 90-day window, or
  - 3 consecutive missed votes.
- Compromised-key suspension is allowed under emergency policy, with follow-up ordinary governance for permanent action.

## Risk Controls

- Mandatory cool-down/review window for normal proposals.
- Temporary-add-only scope for emergency response; no emergency path for removals, validator seats, quorum, or script upgrades.
- Thresholds for emergency actions: 6/9 validator yes, 4/5 multisig signatures, minimum 6-hour vote window.
- For temporary rows, registry data carries `expires_at`; the firewall lock drops them from enforcement after median chain time passes that timestamp (see `docs/lock-script-spec.md`). A follow-up registry cell SHOULD still delete expired rows for audit trail and cell size.
- Conflict checks to prevent contradictory concurrent updates.
- Clear appeal/removal process for false positives.

## Auditability

- Each registry version links to governance decision context.
- Historical registry states remain reconstructable from chain data.
- All proposal artifacts are public and reproducible.

## Open decisions (v2 refinements)

Baseline validator lifecycle is frozen above (onboarding, rotation cadence, participation triggers). The following are **non-blocking** elaborations for a later revision:

- Deeper operational playbook for validator onboarding and rotation (templates, public registry format).
- Stronger anti-sybil and independence attestation mechanics (beyond the baseline rules in `governance/voting.md`).

## Open decisions

- Formal dispute resolution and appeal SLAs.
