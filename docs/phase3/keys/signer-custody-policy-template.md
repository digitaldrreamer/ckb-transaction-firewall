# Signer Custody and Operations Policy (Template)

## Scope

- Applies to 5 governance signers used by `blacklist-registry`.
- Covers key generation, storage, signing operations, and incident handling.

## Key Generation

1. Generate signer keys on offline devices.
2. Record signer fingerprints and ownership attestations.
3. Verify pubkey set against contract source before release.

## Custody Controls

- Hardware-backed key storage preferred.
- No plaintext private keys on shared hosts.
- Dual-control access for production signing sessions.
- Periodic access review cadence: every 30 days.

## Signing Procedure

1. Validate proposal and expected state transition.
2. Verify `GOV1` witness binding inputs.
3. Perform independent tx review by at least two operators.
4. Sign only after governance approval threshold is met.

## Logging and Audit

- Log signer index usage, timestamp, proposal reference, tx hash.
- Retain evidence in immutable audit storage.

## Emergency Protocol

- Trigger: suspected key compromise.
- Immediate freeze of non-emergency updates.
- Invoke key rotation runbook.

## Approval

- Policy owner:
- Approved by:
- Effective date:
- Next review date:
