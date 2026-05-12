# M5: Security sign-off (Phase 4 governance)

## Scope

On-chain governance authorization for the blacklist registry: GOV1 witness handling, secp256k1 signer verification, threshold enforcement, and governance lock identity binding.

## Findings status

- **Phase 4 tracker:** [docs/phase4/security/findings-tracker.md](../docs/phase4/security/findings-tracker.md); zero open Critical / High for governance scope at closure.
- **Phase 3 tracker (continuity):** [docs/phase3/security/findings-tracker.md](../docs/phase3/security/findings-tracker.md); zero open Critical / High.

## Sign-off

| Role | Name | Date (UTC) | Outcome |
|------|------|------------|---------|
| Maintainer / security reviewer | Repository maintainers | 2026-05-11 | **Accept** Phase 4 governance hardening for testnet evidence posture as documented |

## Residual risk (accepted)

- Testnet RPC availability and rate limits can cause CI flakiness; mitigated by committed tx hashes and retry policy for operators.
- Governance bypass resistance relies on correct signer custody and lock identity configuration outside this repository.
