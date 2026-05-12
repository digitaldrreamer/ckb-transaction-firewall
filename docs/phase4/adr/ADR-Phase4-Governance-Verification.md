# ADR: Phase 4 On-Chain Governance Verification (VM-Safe)

## Status

Accepted (retroactively documented; implementation merged to `main`).

## Context

The blacklist registry type script enforces GOV1 witness rules and cryptographic signer checks for registry bootstrap and updates. Prior to Phase 4 remediation, live testnet execution surfaced CKB-VM `InvalidInstruction` failures during governance transactions. A temporary compatibility path reduced on-chain cryptographic assurance.

## Decision

1. **Remove CKB-VM-incompatible instruction patterns** from the hot governance verification path (for example decode/load sequences that lowered to unsupported atomics or runtime helpers on the deployment VM profile).
2. **Prefer explicit syscall-backed parsing and bounded manual decoding** for governance payload and witness handling where required for VM compatibility.
3. **Restore strict on-chain verification** for production governance: bootstrap requires 5-of-5 valid signatures; updates require threshold signatures with duplicate index and out-of-range rejection; root binding mismatches fail with stable error codes.
4. **Validate end-to-end on testnet** using real committed transaction hashes recorded in `tests/integration/governance_drill/latest.json`, verified by `scripts/phase4_governance_evidence_check.sh`.

## Consequences

- Positive: Governance authorization matches consensus-visible rules; evidence is chain-backed and CI-gated on `main`.
- Negative: Governance transaction construction remains operator-sensitive; live drills require `ckb-cli`, funded keys, and RPC access.

## References

- Merge history: PR #5 (phase3 verification hardening), PR #6 (post-merge follow-ups).
- Scripts: `scripts/check_registry_vm_compat.sh`, `scripts/phase4_governance_autorun_live.sh`, `scripts/phase4_governance_evidence_check.sh`.
- Tests: `tests/unit/tests/blacklist_registry_tests.rs`.
