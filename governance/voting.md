# Governance Voting Process

This document defines the operational voting workflow for blacklist updates.

## Scope

- Adding blacklist entries.
- Removing blacklist entries.
- Tracking vote outcomes and execution references.

## Validator and Signer Model (v1)

- Active validator seats: 9.
- Standby validator seats: up to 3.
- Voting rule: one validator equals one vote.
- Multisig execution set: 5 signers, threshold 3 for ordinary execution, threshold 4 for emergency temporary adds.
- Multisig executes decisions but does not replace validator vote legitimacy.

### Validator lifecycle rules

- Standby onboarding requires 7-day public review and successful `validator_change` proposal.
- Active validator performance is reviewed on a 90-day cadence.
- Validators are flagged for replacement review if participation drops below 80% over rolling 90 days or if 3 consecutive votes are missed.
- Emergency suspension can be applied for clearly compromised validator keys, followed by ordinary governance resolution.

## Inputs

- Proposal payload conforming to `governance/proposal-schema.json`.
- Evidence package (transaction traces, incident reports, security analysis).
- Canonical destination identifiers to update.

## Phase 1: Proposal Submission

1. Proposer submits signed proposal artifact.
2. Proposal is assigned immutable proposal id.
3. Initial validation checks:
   - schema compliance,
   - canonical encoding,
   - duplicate/conflict detection.

Invalid proposals are rejected with clear reason codes.

## Phase 2: Review Window

- Ordinary add/remove minimum duration: 72 hours.
- Meta-governance and validator-seat proposals minimum duration: 7 days.
- Activities:
  - technical verification of evidence,
  - impact assessment for false-positive risk,
  - community feedback and challenge period.

No execution is allowed before window completion in normal mode.

## Phase 3: Voting

- Eligible validator set: governance-registered validators at snapshot height.
- Vote options:
  - `approve`
  - `reject`
  - `abstain`
- Vote payload should include validator signature and optional rationale.

### Pass Criteria (v1)

- `add_entry`: quorum >= 6, yes >= 5, and yes > no.
- `remove_entry`: quorum >= 7, yes >= 6, and yes > no.
- `meta_change`: quorum >= 7, yes >= 6, and yes > no.
- `validator_change`: quorum >= 6, yes >= 5, and yes > no.
- No execution-blocking governance invariants violated.

If pass criteria fail, proposal status becomes `rejected` or `expired`.

## Phase 4: Execution

For approved proposals:

1. Build registry replacement transaction.
2. Include governance reference metadata in witness/data.
3. Collect multisig signatures (3-of-5 for ordinary flows).
4. Broadcast and confirm on-chain.

Execution failure returns proposal to `approved_pending_execution` until retried or superseded.

For `meta_change`, execution MUST wait an additional 48-hour delay after vote passage.

## Phase 5: Finalization and Record

- Mark proposal `executed` with tx hash/outpoint.
- Publish resulting registry version hash.
- Store machine-readable audit record for indexers and SDK tooling.

## Emergency Mode (v1)

For active exploitation scenarios:

- scope is temporary blacklist adds only,
- minimum emergency voting window is 6 hours,
- pass threshold is 6-of-9 validator yes votes,
- execution threshold is 4-of-5 multisig signatures,
- each emergency action requires at least two independent evidence sources,
- each temporary entry MUST include `expires_at` (uint64 LE Unix seconds), normally set to creation median time + 72 hours,
- on-chain enforcement: the Firewall lock script evaluates blacklist membership using median chain time; when `median_time >= expires_at`, the temporary entry is ignored (same effect as removal for enforcement). Ratification by ordinary governance MAY extend or replace the entry; if ratification fails, enforcement still ends at `expires_at` without requiring a housekeeping transaction.

Emergency mode MUST NOT be used for removals, validator changes, quorum changes, or script upgrades.

### Operational housekeeping

Execution multisig SHOULD broadcast a registry replacement soon after expiry that deletes expired temporary rows so indexers and auditors see a clear on-chain trail. Failure to do so does not extend enforcement past `expires_at`.

## Reversal and Appeal

- Any entry can be challenged via `remove_entry` proposal.
- Appeals require evidence of misclassification or risk remediation.
- Reversal follows full governance lifecycle unless emergency de-escalation policy applies.
