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

## Lifecycle

1. **Submission**: proposal is published and indexed.
2. **Validation**: schema and formatting checks pass.
3. **Review Window**: minimum 72-hour public discussion period.
4. **Voting**: validator set votes within fixed voting epoch.
5. **Execution**: successful proposal becomes signed registry replacement transaction.
6. **Finalization**: new registry cell is live and linked to proposal id.

### CLI tooling

The `@ckb-firewall/cli` package implements the full lifecycle as interactive commands:

```bash
npm install -g @ckb-firewall/cli

ckb-firewall propose          # submit a proposal (step 1)
ckb-firewall vote             # record a validator vote (step 4)
ckb-firewall proposals        # inspect status and countdown (steps 2–4)
ckb-firewall sign             # add a multisig signature (step 5)
ckb-firewall execute          # build and submit the governance tx (step 5–6)
```

All commands are interactive when run without flags. See [`sdk/cli/README.md`](../sdk/cli/README.md) for full option reference.

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

At consensus, the type script enforces:

- exactly one output registry cell; zero (bootstrap) or one (update) input registry cell,
- input and output registry cells use the same `type_id_value` (bytes 34..66 of the 66-byte v2 type args),
- both registry cells are locked by the configured governance lock script identity (args = `[0x01]`),
- the registry data is well-formed (`BLKL` v2 format with governance header and sorted entries),
- a `GOV1` v2 governance witness binding (133 bytes) is present in `WitnessArgs.input_type` for the registry input cell and contains:
  - `proposal_id_hash` (non-zero 32 bytes) + `vote_digest_hash` (non-zero 32 bytes)
  - the exact `old_registry_root` → `new_registry_root` transition, where each root is `blake2b_256` over the full registry cell data (personalization `ckb-default-hash`),
  - for bootstrap: `old_root` MUST be `0x00..00`,
- signer signature verification is delegated entirely to the governance-lock script, which reads signer entries from `WitnessArgs.lock` and verifies them against the committee pubkeys embedded in the `BLKL` v2 governance header.
- bootstrap Type ID enforcement: for the first registry creation, `type_id_value` in the output type args MUST equal `blake2b_256(inputs[0].previous_output(36 bytes) || output_index(8 bytes LE))`.

### Signer key rotation policy (v2)

- In v2, signer pubkeys are embedded in the `BLKL` governance header of the registry cell, not compiled into the contract binary. Key rotation is a governance update that produces a new registry cell with an updated governance header — no contract redeployment required.
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
- For temporary rows, registry data carries `expires_at`; the firewall lock drops them from enforcement after median chain time passes that timestamp (see [Firewall lock args](https://ckb-firewall.drreamer.digital/reference/firewall-lock-args/) and [lock-script-spec.md](lock-script-spec.md)). A follow-up registry cell SHOULD still delete expired rows for audit trail and cell size.
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
