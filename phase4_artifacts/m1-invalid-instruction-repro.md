# M1: InvalidInstruction repro (archived)

## Summary

Live governance transactions on CKB testnet failed VM validation with `InvalidInstruction` when executing the blacklist registry script prior to the Phase 4 remediation. The failure correlated with instruction sequences emitted from prior decode paths that were not supported on the target CKB-VM profile used by testnet nodes.

## Evidence pointers

- Root-cause analysis and remediation are captured in repository history leading to PR #5 and PR #6 (VM-safe parsing, removal of incompatible runtime decode paths).
- VM compatibility preflight: `scripts/check_registry_vm_compat.sh`.

## Resolution

The registry contract was rewritten to avoid the incompatible instruction lowering; governance drills were re-executed on-chain with committed transaction hashes (see `tests/integration/governance_drill/latest.json`).
