# Emergency Key Rotation Runbook (Phase 3)

## Trigger Conditions

- Signer key compromise suspected/confirmed
- Unauthorized signing event detected
- Governance directive to rotate signer set

## Immediate Actions

1. Freeze normal governance execution.
2. Publish incident notification to stakeholders.
3. Snapshot current registry and governance state.

## Rotation Procedure

1. Generate new 5-signer pubkey set offline.
2. Update signer set in `contracts/blacklist-registry/src/main.rs`.
3. Rebuild and verify:
   - `./scripts/phase3_repro_build.sh`
   - `./scripts/phase3_verify.sh`
4. Execute governance-approved migration transaction to new script identity.
5. Update SDK/indexer/operator config to new identity.
6. Validate post-rotation governance update path.

## Post-Rotation Checks

- No legacy compromised keys accepted
- Bootstrap/update governance flows still valid
- Audit log published with tx hashes and approvals

## Evidence Fields

- Incident ID:
- Rotation approval reference:
- New signer fingerprint summary:
- Migration tx hash:
- Post-rotation verification logs:
- Final operator sign-off:
