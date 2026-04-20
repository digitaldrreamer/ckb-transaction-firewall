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
- Emergency path scope is temporary adds only.
- Emergency path MUST NOT be used for removals, validator changes, quorum changes, or script upgrades.
- Emergency thresholds: 6/9 validator yes, 4/5 multisig signatures, minimum 6-hour vote window.
- Emergency entries include `expires_at` in registry data; the firewall lock ignores expired temporaries using median chain time (see `docs/lock-script-spec.md`). Governance SHOULD still remove expired rows in a follow-up registry cell for audit trail and size.
- Conflict checks to prevent contradictory concurrent updates.
- Clear appeal/removal process for false positives.

## Auditability

- Each registry version links to governance decision context.
- Historical registry states remain reconstructable from chain data.
- All proposal artifacts are public and reproducible.

## Open Decisions to Finalize

- Validator onboarding and rotation policy.
- Anti-sybil and independence attestation model for validators/signers.
- Formal dispute resolution and appeal SLAs.
