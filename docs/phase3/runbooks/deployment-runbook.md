# Deployment Runbook (Phase 3)

## Scope

- Environment: `testnet` / `mainnet`
- Contracts: `firewall-lock`, `blacklist-registry`
- Operators: Governance/Ops

## Preconditions

- Reproducible manifest present (`docs/internal/phase3_artifacts/ARTIFACT_MANIFEST_LATEST.md`)
- Phase 3 verification report present (`docs/internal/phase3_artifacts/PHASE3_EVIDENCE_LATEST.md`)
- Governance lock preflight passed (`scripts/phase3_governance_lock_preflight.sh`, supports P4-DEPLOY-001 evidence)
- Governance approvals complete
- Signer keys available and verified

## Procedure

1. Verify current git SHA and tag to deploy.
2. Verify artifact hashes against manifest.
3. Confirm target network RPC endpoint and chain tip.
4. Deploy `firewall-lock`; capture tx hash and outpoint.
5. Deploy `blacklist-registry`; capture tx hash and outpoint.
6. Verify on-chain script identities match expected values.
7. Execute smoke transactions:
   - run `scripts/phase3_governance_drill_check.sh tests/integration/governance_drill/latest.json`
   - safe transaction should pass
   - blacklisted transaction should fail
8. Record evidence and publish deployment summary.

## Rollback

1. Halt new governance updates.
2. Repoint dependent services to prior known-good script identities from the previous deployment evidence record:
   - previous `firewall tx hash/outpoint`
   - previous `registry tx hash/outpoint`
   - pinned release manifest/tag reference.
3. Execute emergency communication protocol.
4. Open incident record with timeline and impact.

## Evidence Fields

- Deployment date/time (UTC):
- Git commit/tag:
- Network:
- Firewall tx hash/outpoint:
- Registry tx hash/outpoint:
- Smoke test results:
- Operator sign-off:
