# Post-Deploy Verification Report (Template)

## Deployment Context

- Date/time (UTC):
- Network:
- Deployment commit/tag:
- Firewall script identity:
- Registry script identity:

## Verification Matrix

| Check | Expected | Observed | Status | Evidence |
|---|---|---|---|---|
| Safe tx path | pass | pass/fail | pass/fail | tx hash/log |
| Blacklisted destination | reject | pass/fail | pass/fail | tx hash/log |
| Registry update flow | pass | pass/fail | pass/fail | tx hash/log |
| SDK/on-chain parity | matched | matched/mismatch | pass/fail | logs |
| Cycle regression | within budget | value | pass/fail | cycle report |

## Incidents

- Incident ID:
- Summary:
- Severity:
- Resolution:

## Final Assessment

- Rollout health: `healthy` / `degraded`
- Residual risk:
- Sign-off:
