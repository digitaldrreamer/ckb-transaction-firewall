# Scripts

Operational automation for deployment and governance workflows.

## Script Inventory

### `phase3_repro_build.sh`

Purpose:

- Execute two clean RISC-V release builds for both contracts.
- Fail on hash/size drift between rounds (determinism gate).
- Emit timestamped and latest artifact manifests under `phase3_artifacts/`.

Expected capabilities:

- reproducibility check across clean rounds,
- markdown + JSON manifest generation,
- bounded artifact retention via `MAX_ARTIFACT_SETS`.

### `phase3_verify.sh`

Purpose:

- Run Phase 3 correctness/performance safety checks.
- Enforce cycle budgets and registry size gate.
- Emit timestamped and latest Phase 3 evidence reports under `phase3_artifacts/`.

Expected capabilities:

- production guard validation for blacklist-registry,
- unit/integration + cycle probe execution,
- configurable cycle thresholds via env vars,
- bounded artifact retention via `MAX_ARTIFACT_SETS`.

### `phase3_compat_check.sh`

Purpose:

- Enforce frozen v1 contract/spec compatibility invariants.
- Detect drift between on-chain firewall error codes and `docs/lock-script-spec.md`.
- Verify required version/magic markers (`0x01`, `BLKL`, `GOV1`) remain aligned across contracts/docs.

Expected capabilities:

- fail-fast on error-code mapping mismatch,
- fail-fast on missing format/version markers in contract or docs,
- CI-safe deterministic checks (no network dependency).

### `phase3_governance_drill_check.sh`

Purpose:

- Validate governance drill evidence format from testnet execution.
- Ensure required scenarios and tx hash fields are present.
- Enforce pass/fail/pending status constraints for Phase 3 governance gates.

Expected capabilities:

- schema-style checks using `jq`,
- fail on missing required scenario IDs,
- fail when any scenario is still `pending`,
- fail when any scenario is `fail`.

### `phase3_governance_mode2.sh`

Purpose:

- Execute governance drill evidence in strict separated-signer mode (option 2).

Implemented capabilities:

- validates signer-index policy per scenario (bootstrap 5/5; update >=3/5),
- executes operator-provided tx commands and records tx hashes,
- stores signer-separation evidence at `tests/integration/governance_drill/mode2_signer_state.json`,
- validates both scenario completion and mode2 signer rules.

### `phase3_governance_drill_update.sh`

Purpose:

- Initialize and update `tests/integration/governance_drill/latest.json` during live testnet execution.
- Record per-scenario tx hashes/outcomes in a normalized format.
- Trigger gate validation after scenario updates.

Expected capabilities:

- `init` command to create `latest.json` from template,
- `set` command for scenario status + tx hash + notes,
- `validate` command delegating to `phase3_governance_drill_check.sh`.

### `phase3_governance_prereq_check.sh`

Purpose:

- Validate local prerequisites before attempting live testnet governance drills.
- Check `ckb-cli` binary presence, testnet RPC connectivity, and local signer account availability.

Expected capabilities:

- fail fast if `ckb-cli` is missing,
- fail fast if RPC is unreachable,
- fail fast if no local accounts are configured.

### `phase3_closeout_check.sh`

Purpose:

- Report Phase 3 closeout readiness across governance evidence, artifacts, security docs, and runbooks.
- Provide a single pass/fail summary for remaining release gates.

Expected capabilities:

- validate governance drill artifact when present,
- verify required evidence/runbook/security/go-no-go/soak/integration files exist,
- verify required signer custody and SDK parity template files exist,
- validate G1 summary critical/high counts from findings tracker,
- exit non-zero when closeout is incomplete.

### `phase3_status_report.sh`

Purpose:

- Generate a timestamped markdown snapshot of current Phase 3 closeout status.
- Persist latest status report in `phase3_artifacts/` for CI artifact review.

Expected capabilities:

- execute `phase3_closeout_check.sh`,
- capture output + exit code in markdown report,
- write both timestamped and `PHASE3_STATUS_LATEST.md` files.

### `deploy.sh`

Purpose:

- Build and deploy contract artifacts.
- Print deployed code hashes and outpoints.
- Validate deployment prerequisites before broadcast.

Implemented capabilities:

- environment selection (`testnet`, `mainnet`) and RPC override,
- optional build step for both contracts,
- deployment config generation for `ckb-cli deploy gen-txs`,
- dry-run mode (generate txs and print sign/apply commands),
- sign/apply execution path via `ckb-cli`.

### `update-blacklist.ts`

Purpose:

- Validate governance update payloads.
- Build registry replacement transaction inputs.
- Prepare signer payloads and submission metadata.

Implemented capabilities:

- initialize governance drill artifact file,
- execute scenario-specific operator-provided tx command,
- auto-extract first tx hash (`0x` + 64 hex) from command output,
- write scenario result to `tests/integration/governance_drill/latest.json`,
- validate artifact using existing phase3 governance drill checks.

## CLI Recommendation

Yes, a CLI is needed. Governance and deployment are operational workflows that should be reproducible, scriptable, and auditable across environments and operators.
