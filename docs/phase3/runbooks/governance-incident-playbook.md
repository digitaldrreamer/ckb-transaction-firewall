# Governance Incident Response Playbook (Phase 3)

Phase 4 live governance drill procedures and chain-backed evidence checks: `docs/phase4/runbooks/governance-drill-live-execution.md`, `docs/phase4/verification-status.md`.

## Incident Classes

- Malicious/invalid proposal execution attempt
- Registry integrity mismatch
- Unauthorized signer behavior
- Governance process failure (quorum/threshold violations)

## Response Steps

1. Triage and classify severity (`critical`, `high`, `medium`, `low`).
2. Freeze execution path if integrity risk is active.
3. Collect forensic artifacts:
   - tx hashes
   - witness payloads
   - signer metadata
4. Validate against `GOV1`/`BLKL` invariants.
5. Decide remediation path:
   - revert/replace registry update
   - rotate keys
   - policy/process correction
6. Publish incident report and stakeholder update.

## Communications

- Internal governance channel:
- Public status page/forum:
- Escalation owner:

## Closure Criteria

- Root cause identified
- Corrective action executed
- Residual risk documented
- Preventive controls added/updated

## Evidence Fields

- Incident ID:
- Timeline (UTC):
- Affected transactions:
- Root cause:
- Corrective actions:
- Residual risks:
- Approval/sign-off:
