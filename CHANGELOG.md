# Changelog

## 2026-06-04

### `@ckb-firewall/cli` v0.5.0

- **`ckb-firewall config`** — new command that reads and writes `~/.ckb-firewall/config.json`. `--proposer <name>` sets the default proposer name non-interactively; running without flags shows current config and opens an interactive menu.
- `propose` uses the saved proposer name as the prompt default and offers to save a new name on first use. A failed config write is a non-fatal warning — proposal creation continues.
- GUI `TFW_META` now includes `proposerName` from config; the New Proposal form prefills the Proposer field accordingly.
- `program.version` and the GUI version label now read from `package.json` at runtime instead of hardcoded literals.
- `loadConfig` guards against array-shaped JSON with `Array.isArray` check.
- `saveConfig` wraps FS operations in try-catch and throws a descriptive error including the file path.

### `ckb-transaction-firewall-sdk` (Rust) v0.3.1

- Minor `registry.rs` fix (trailing-data consistency guard).

### Docs site

- `preview.js` expanded: 20 new CODE_INDEX entries (`TransactionFirewall`, `HashType`, `ScriptLike`, `OutPointLike`, `RegistryEntry`, `TransactionCellDep`, `FIREWALL_ERROR_CODES`, all four `FirewallSdkError` subclasses, `isFirewallSdkError`, `resolveRegistryDeps`, `firstActiveEntry`, Rust SDK `is_blacklisted`, `preflight_check`, `build_firewall_lock_args/script/spend_cell_deps`, `encode_governance_header`).
- Four new TERMS: `treasury`, `live cell`, `Merkle proof`, `RegistryEntry`.
- FILE_PATH_RE extended to include `examples/*` so Location lines in example docs trigger GitHub link panels.
- `examples/rust/src/bin/preflight_service.rs`: "1 entries" → "1 entry / N entries" pluralisation fix.

---

## 2026-06-03

### `@ckb-firewall/cli` v0.4.x (PR #31 — feat/keyless-governance-lifecycle)

- **Fully keyless governance**: `anchor` and `execute` no longer require any private key; the treasury-lock contract authorises spends autonomously.
- **`ckb-firewall anchor`** — builds and submits a treasury-funded PBLK proposal anchor cell.
- **`ckb-firewall reclaim`** — reclaims a rejected or abandoned proposal anchor after the review window.
- **`ckb-firewall treasury-status`** — reports treasury pool usage and donation address.
- `sign` command removed; signing is no longer a workflow step.
- `inspect` shows treasury pool balance and donation address.
- GUI: treasury banner, sign step removed from proposal flow.
- TypeScript and Rust SDK examples scaffolded under `examples/` with root README, lockfile, and helper scripts.

### New contracts

- **`contracts/treasury-lock`** — autonomous CKB type script holding governance capacity. Args: `governance_lock_type_id(32) | proposal_anchor_type_id(32)`. Capacity may only leave via a transaction that includes a valid `proposal-anchor` input.
- **`contracts/proposal-anchor`** — type script protecting PBLK anchor cells. Enforces PBLK payload validity on creation, treasury lock on the anchor cell, minimum relative `since` delay (MTP metric) on consumption, and capacity return to treasury.

### GOV1 v4 protocol

- Witness expanded to 173 bytes (up from 141). Extra 32 bytes carry the proposal anchor type hash used by `governance-lock` to verify an anchor input is present in the execute transaction.
- Workflow: `propose → anchor → export/import → vote → execute`.

### Security / correctness fixes (Gemini review rounds)

- All bare `+` on `usize` values from on-chain bytes replaced with `checked_add`.
- `treasury-lock` molecule Script offset validation in `is_anchor_type_for_treasury`.
- Registry growth always drawn from treasury, not proposal cell surplus.
- Anchor cell locked to treasury-lock (not governance-lock).
- `since` MTP metric validation: bit 63 (relative flag) checked separately; bits 62:61 must be exactly `0b10` via `(since & 0x6000_0000_0000_0000) == 0x4000_0000_0000_0000`.
- Dust treasury change absorbed into fee rather than creating sub-threshold output.
- Treasury-lock script always discovered from cell deps, not from hardcoded testnet constants.
- `proposal-anchor` `args_off + 4` overflow fixed with `checked_add` (PR #31 review comment `#discussion_r3354905455`).

---

## 2026-06-02

### Security (pre-PR #31 groundwork)

- Proposal cells moved to governance-lock as their lock script; treasury key no longer required at execute time.
- `prehash: false` signing fix — CLI was wrapping governance payload in SHA-256 before secp256k1; governance-lock signs the raw blake2b digest directly.
- `since` field encoding corrected in `proposal-anchor` unit tests (block-number metric → MTP).

---

## 2026-06-01

### Security

- GOV-004 closed: vote authorisation hardened.
- NEW-004 closed: execute authorisation hardened.
- Signer layer artifacts removed; VM blocker eliminated. Proposal cells now correctly lock to governance-lock rather than the treasury key.

---

## 2026-05-28

### `@ckb-firewall/cli` v0.4.0

- **`ckb-firewall gui`** — browser-based governance dashboard served over loopback. Tries port 80 (portless URL `http://ckb-firewall.localhost`), falls back to `:7979`. Security hardening: loopback enforcement at handler level, `safeJson()` XSS guard, `spawn()` for browser launch (no shell), path traversal guard on proposal import, body-size abort, SHA-256 integrity checks on CDN vendor scripts.
- Install script shows version diff on upgrade.

### Docs site (Diátaxis restructure — PRs #29, #30)

- Site restructured around the Diátaxis framework: tutorials, how-to guides, reference, explanations.
- Getting-started slimmed to a tutorial entry and choose-your-path router.
- Guides section added (task-oriented how-to articles).
- Rust SDK API reference added as a formal reference entry.
- Sidebar and all internal cross-links rebuilt.
- GUI mode page added with real screenshot.
- Main README quick-start rewritten; doc table expanded.

---

## 2026-05-26

### `@ckb-firewall/cli` v0.3.1

- Bumped for GOV1 v3 compatibility.

### `ckb-transaction-firewall-sdk` (Rust)

- `serde` feature flag fixed (broken since v0.3.0 modularisation).

---

## 2026-05-14

### Published `@ckb-firewall/cli@0.1.0` to npm

- https://www.npmjs.com/package/@ckb-firewall/cli
- Install: `npm install -g @ckb-firewall/cli`

### CLI (`@ckb-firewall/cli` v0.1.0)

- Scaffolded `sdk/cli/` as a standalone npm package (`@ckb-firewall/cli`) with commander, chalk, ora, cli-table3, inquirer, log-symbols, and cfonts.
- Implemented eight commands covering inspect, quick-path add/remove (testnet/dev), and the full governance lifecycle: `propose`, `vote`, `proposals`, `sign`, `execute`.
- **Governance flow**: propose → 72-hour review window → validator voting (3-of-5 threshold) → secp256k1 multisig signing → on-chain execution via `ckb-cli`. Proposals are stored under `~/.ckb-firewall/proposals/`.
- **`sign` command**: uses `@noble/curves` v2 `format: 'recovered'` to produce correct secp256k1 65-byte signatures `[r(32)|s(32)|recovery_bit(1)]` matching the CKB secp256k1 convention.
- **Hints system**: each command prints 2 contextual next-step hints. `inspect` and `proposals` additionally show a voting callout when open proposals are present.
- **Interactive UX**: all commands prompt for missing arguments; `remove` shows a pick-list of current registry entries.
- Added `sdk/cli/README.md`, `sdk/cli/LICENSE` (MIT), and `files` field in `package.json` for publish-ready tarball.
- Updated root `README.md` CLI section with full governance flow examples.
- Updated `notes/governance.md` with CLI tooling reference and command list.
- Updated `notes/internal/scripts.md` with CLI commands section.

## 2026-05-13

### Release readiness

- Prepared `@ckb-firewall/sdk` for npm publishing: public scoped package config, package metadata, ESM build outputs, tarball validation, and type compatibility checks.
- Published the canonical CKB testnet BLKL registry cell in [notes/deployments/testnet.registry.json](notes/deployments/testnet.registry.json) and aligned the SDK/testnet docs around caller-supplied `cellDeps`.
- Hardened governance tx preparation for slow indexers and wallet top-ups: capacity filtering, committed top-up polling, merged tx outputs, explicit sender selection, and safer prompt handling.

## 2026-04-26

### Phase 1: Firewall Lock Script Implementation

**Core Implementation (Completed)**:
- Implemented complete firewall lock script in Rust using ckb-std
- Lock args parsing with frozen v1 layout (72 + N + M bytes)
- Registry cell dep selection with exactly-one-match rule
- Blacklist membership checking with binary search (O(log n))
- Temporary entry expiry using median time calculation
- Inner lock delegation via spawn syscall
- Comprehensive error handling (codes 5-17)
- 24 unit tests covering all major code paths

**Technical Details**:
- Added `Cargo.toml` with optimized release profile
- Implemented `FirewallLockArgs::parse()` with layout validation
- Implemented `RegistryPayload::parse()` with magic/version checks
- Implemented `find_registry_cell_dep()` for deterministic registry selection
- Implemented `get_median_time()` using header_deps timestamps
- Implemented `delegate_to_inner_lock()` using spawn_cell
- All frozen v1 error codes properly implemented

**Testing**:
- 24 comprehensive unit tests (all passing)
- 10 `ckb-testtool` integration tests run against the real compiled contract binary
- Integration coverage includes invalid args/version/flags, missing/invalid/unsorted/ambiguous registry deps, blacklisted output lock/type args, and a non-blacklisted happy path

**Documentation**:
- Documented all public APIs and error codes
- Added inline documentation throughout

**Remaining Work**:
- Binary compilation (needs Rust + capsule environment)
- Complete integration tests with compiled binary
- Cycle profiling and optimization
- Registry type script implementation
- Production deployment testing

### Integration + profiling follow-up

- Extended `ckb-testtool` integration suite to 10 passing tests, adding:
  - `AmbiguousRegistryCellDep` (`17`) rejection case
  - non-blacklisted happy-path pass case
- Added cycle profiling scaffold:
  - `contracts/firewall-lock/CYCLE_REPORT.md`
  - `contracts/firewall-lock/profile-cycles.sh`
- Added automated happy-path cycle probe:
  - `test_cycle_probe_happy_path_lock_only` emits `CYCLE_PROBE_HAPPY_PATH_LOCK_ONLY=<n>`
  - `test_cycle_probe_happy_path_type_only` emits `CYCLE_PROBE_HAPPY_PATH_TYPE_ONLY=<n>`
  - `test_cycle_probe_happy_path_both_checks` emits `CYCLE_PROBE_HAPPY_PATH_BOTH_CHECKS=<n>`
  - `test_cycle_probe_happy_path_large_registry_both_checks` emits `CYCLE_PROBE_HAPPY_PATH_LARGE_REGISTRY_BOTH_CHECKS=<n>`
  - `test_cycle_probe_happy_path_very_large_registry_both_checks` emits `CYCLE_PROBE_HAPPY_PATH_VERY_LARGE_REGISTRY_BOTH_CHECKS=<n>`
  - `profile-cycles.sh` runs all probes and auto-updates report
- Updated phase-status docs to reflect binary build success and integration pass rate.

## 2026-04-20

### Scaffold

- Scaffolded repository structure from `README.md` with core folders and markdown placeholders.

### Docs enrichment

- Expanded architecture, lock script spec, and governance docs with v1-ready detail.
- Expanded tests, integration scope, and scripts documentation including CLI direction.
- Expanded contract and SDK module READMEs with responsibilities and security properties.

### Policy freeze pass

- Frozen governance voting model to 9 active validators with one-validator-one-vote and explicit per-proposal thresholds.
- Added emergency temporary-add-only policy with 6-hour minimum vote window, 72-hour TTL, and ratification requirement.
- Switched lock spec to stable registry identity matching with exact dep uniqueness rule (zero/multiple matches fail).
- Frozen V1 lock args layout and public custom error constants starting at code 5.

### Full consistency pass

- Updated remaining docs to align with stable registry identity + exactly-one dep-selection rule.
- Replaced residual outdated wording and aligned validator lifecycle policy details.
- Synced SDK/contract/script/test docs to canonical error semantics (including `AmbiguousRegistryCellDep`).

### PR review follow-up

- Registry identity: use CKB type script triple in lock args and SDK examples; remove redundant type-hash + args-hash pairing.
- Error codes: drop unused `RegistryIdentityMismatch`; renumber public constants 9–17.
- Emergency TTL: specify `expires_at` + median-time evaluation in lock spec and governance docs.

### CodeRabbit nitpick pass

- README: normative governance tables moved to `governance/voting.md` / `notes/governance.md` only.
- Integration tests: local devnet as default for CI; testnet for periodic smoke.
- Module READMEs: emergency scope + registry dep-selection invariants; pinned public error codes in unit test doc.
- `CHANGELOG` consolidated under one date; scripts README wording tweak.
- `notes/governance.md`: split frozen lifecycle vs v2 refinement items to avoid contradictory "open decisions" list.

### CI

- Added GitHub Actions workflow `.github/workflows/tests.yml` to run firewall lock unit tests, build the RISC-V release binary, and run integration tests on push/PR.

### PR #2 review follow-up

- Added defensive registry entry-count bound check before `Vec::with_capacity` allocation in registry parser.
- Optimized registry dep scanning to avoid loading full dep cell data when only type-script identity matching is needed.
## 2026-05-06

### Build + integration milestone

- Built `contracts/firewall-lock` RISC-V release binary (`firewall-lock`) successfully (23K).
- Ran firewall lock unit tests (24/24 passing).
- Ran `ckb-testtool` integration tests in `tests/unit` (27/27 passing: 15 firewall + 12 blacklist-registry).
- Recorded happy-path cycle probe results in `contracts/firewall-lock/CYCLE_REPORT.md` via `profile-cycles.sh`.
- Fixed `contracts/firewall-lock/profile-cycles.sh` report update logic to work with non-empty Notes column.

### Phase 2: Blacklist Registry Type Script (Completed)

- Implemented `contracts/blacklist-registry` type script contract:
  - Enforces exactly-one input/output registry cell topology for updates
  - Enforces `BLKL` v1 registry payload invariants (magic, version, sorted entries)
  - Enforces governance authorization via a configured governance lock script identity encoded in type args
  - Binds update transactions to a governance context witness payload (`GOV1` v1) committed by sighash-all locks
- Added `ckb-testtool` integration tests:
  - `tests/unit/tests/blacklist_registry_tests.rs` (12 tests passing)
  - Wired into `tests/unit/Cargo.toml`
- Added hashing dependency for tests (`blake2b-ref`) and aligned personalization with CKB default hash

### Phase 2 follow-up: strict governance multisig

- Upgraded `contracts/blacklist-registry` to strict in-script governance verification:
  - Added fixed 5-signer secp256k1 pubkey set in contract code.
  - Extended `GOV1` witness layout with `signer_count` and repeated `{signer_index, signature[65]}` entries.
  - Added digest binding `blake2b(proposal_id_hash || vote_digest_hash || old_root || new_root)`.
  - Enforced 3-of-5 signer threshold with signer index bounds + duplicate checks + signature verification.
- Extended integration coverage:
  - `tests/unit/tests/blacklist_registry_tests.rs` now signs governance payloads with deterministic keys and validates strict signature paths (12 passing tests, including bootstrap and stricter signer failure paths).
- Applied PR #3 documentation consistency fixes:
  - Unified firewall binary naming to `firewall-lock` in build notes/snippets.
  - Removed developer-specific absolute paths in setup docs.
  - Aligned capsule-free build instructions (`cargo build --release --target=...`) with current workflow.

## 2026-05-07

### Phase 3 closeout: strict mode-2 evidence finalized

- Completed strict mode-2 governance drill recording and validation:
  - `tests/integration/governance_drill/latest.json`
  - `tests/integration/governance_drill/mode2_signer_state.json`
- Refreshed phase3 verification and closeout artifacts via:
  - `scripts/phase3_verify.sh`
  - `scripts/phase3_closeout_check.sh`
- Confirmed closeout gates pass for:
  - contract builds and tests
  - cycle report refresh
  - governance drill evidence integrity
  - runbook/template completeness

### Phase 4: live governance hardening (sequenced)

- Added chain-backed evidence gate and closeout hook:
  - `scripts/phase4_governance_evidence_check.sh`
  - `scripts/phase4_governance_tx_status.sh`
- Added one-command live autorun flow:
  - `scripts/phase4_governance_autorun_live.sh`
- Added auto tx-file mode and scenario tx preparation:
  - `scripts/phase4_prepare_tx_files.sh`
  - `scripts/phase4_submit_tx.sh`
- Hardened execution reliability:
  - auto-prepare missing tx files
  - auto-topup when lock-only input inventory is low
  - atomic write/recovery for prepared tx files
  - forced full refresh of scenario tx inputs before execution
  - idempotent replay behavior with rerun for unknown/non-resolvable hashes

### VM/runtime compatibility remediation

- Removed atomic runtime instruction path from on-chain `blacklist-registry`:
  - rewrote critical decode/load paths to raw syscall/manual parsing where needed
  - avoided runtime paths that emitted unsupported LR/SC/AMO instructions in CKB VM
- Added VM compatibility preflight:
  - `scripts/check_registry_vm_compat.sh`
  - integrated into live autorun and deploy hardening checks

### Phase 4 live execution outcome

- Fixed live bootstrap witness-root mismatch by rewriting GOV1 roots from generated tx payload during tx preparation.
- Completed end-to-end chain-backed live autorun successfully:
  - all four governance scenarios executed/re-recorded with chain-resolvable tx hashes
  - chain status artifact produced:
    - `tests/integration/governance_drill/chain_status_latest.json`
  - final evidence gate passed:
    - `scripts/phase4_governance_evidence_check.sh`

## 2026-05-11

### Phase 4 program closure (governance hardening)

- Enforced chain-backed governance evidence on `main` and PRs to `main`: `REAL_GOV_EVIDENCE_REQUIRED=1` in `phase3_closeout_check.sh` CI step; pinned `ckb-cli` via `scripts/ci/install_ckb_cli.sh` in `.github/workflows/tests.yml`.
- Hardened `phase4_governance_tx_status.sh` to poll until `committed` or `rejected`; closeout requires all `chain_status_latest.json` scenarios `committed` when Phase 4 gate is on.
- Refreshed `tests/integration/governance_drill/chain_status_latest.json` against testnet.
- Added Phase 4 milestone artifacts under `phase4_artifacts/`, ADR `notes/internal/phase4/adr/ADR-Phase4-Governance-Verification.md`, runbook `notes/internal/phase4/runbooks/governance-drill-live-execution.md`, Phase 4 security tracker, go/no-go record, and `notes/internal/phase4/verification-status.md` linked from the verification matrix.
- Added `contracts/blacklist-registry/CYCLE_REPORT.md` for registry governance cycle posture.
- Updated `scripts/README.md`, `notes/governance.md`, and governance incident playbook cross-links.

### CI

- Mark `scripts/ci/install_ckb_cli.sh` executable in git; invoke installer with `bash` in `.github/workflows/tests.yml`.
- Run blocking Phase 3 closeout only after prior steps succeed (`success()`), so a failed install does not surface as a false governance-evidence failure.
- Added `deploy/` to `.gitignore` for local deployment and chain-run outputs.

### Hardening (review follow-up)

- Added `curl --retry` and `--connect-timeout` to `scripts/ci/install_ckb_cli.sh` for transient download failures.
- Replaced `id.len() as u8` with `u8::try_from` in `firewall_lock_tests.rs` registry payload helpers to avoid silent truncation.

### Firewall lock integration depth

- Added median-time / `header_dep` VM tests for temporary blacklist expiry vs active paths and even-count median.
- Added inner-lock spawn coverage: missing inner cell dep (error 13) and `always_failure` fixture inner lock (error 15).
- Added 256-entry registry stress happy-path test; fixture `tests/unit/fixtures/always_failure_lock` with README attribution.
- Extended `build_tx_with_firewall_lock` to attach `header_deps`; `insert_test_headers` helper for ckb-testtool.

### Firewall lock header matrix integration tests

- Added permutation, nine-header median grid, no-header zero-median, duplicate-timestamp boundary, and single-header median VM tests (`firewall_lock_tests.rs`).
- Expanded `tests/unit/fixtures/README.md` with third-party testdata explanation.
- Documented SHA-256 and byte size for `always_failure_lock` in `tests/unit/fixtures/README.md` (matches `ckb-script` 0.118.0 `testdata/always_failure`).
- Added explicit "Replacing this fixture" checklist to `tests/unit/fixtures/README.md` (update size, SHA-256, `ckb-script` version line, run tests, changelog).

## 2026-05-12

### TypeScript SDK (publish-ready)

- Added ESM build (`tsconfig.build.json`, `dist/`), `package.json` `exports`, `types`, `files`, MIT `LICENSE`, repository metadata, and `engines` (Node >=20).
- Tightened compiler options (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`).
- Introduced typed `FirewallSdkError` subclasses and a discriminated `FirewallDecision` union with literal failure reasons.
- CI: build, tarball checks for `dist/index.js` and `dist/index.d.ts`, Node ESM smoke import, `@arethetypeswrong/cli` with `--profile esm-only`.
- Documented npm install, Node 20+, and ESM-only usage in README files.
- Simplified root README TypeScript section (install-first, no publish-metadata framing); aligned `sdk/typescript/README.md` module/types section.

## 2026-05-15

### Repository layout

- Renamed `docs/` to `notes/` and updated scripts, SDK READMEs, tests, and cross-links to the new path.

## 2026-05-15

### Documentation site (`docs/`)

- Added Astro Starlight site with sidebar topics (Getting Started, Concepts, Reference, Operations), Rapide theme, and topic schema for section landing pages.
- Published reader-facing guides aligned to v1 testnet contracts, fixtures, SDK, and CLI behavior, including **Why this exists** and MDX pages for integration walkthroughs.
- Moved prior internal markdown under `notes/` so `docs/` is reserved for the public site; updated repository links and phase-3 scripts accordingly.


## 2026-05-15

### Documentation site

- Favicon and apple-touch icon generated from project logo; Starlight `favicon` configured.

- Removed GitHub Pages deployment workflow, `docs/public/CNAME`, and Pages setup docs.

## 2026-05-25

### `@ckb-firewall/sdk` v0.3.2

- Multi-registry support: `FirewallConfig.registries` replaces single `registryScript`; each entry is a `RegistrySpecLike` with `codeHash`, `hashType`, `typeIdValue`, and `required` flag.
- Registry dep matching now uses `typeIdValue` (bytes 34–66 of the 66-byte v2 type args) — survives governance-lock upgrades without reconfiguration.
- `preflightCheck` accepts an array of pre-fetched `RegistryPayload` objects and an explicit `nowSecs` parameter for time-based expiry evaluation.
- `fetchRegistryPayload(rpcUrl, txHash, index)` added as a convenience RPC helper.
- Dropped BLKL v1 support — only BLKL v2 payloads accepted, matching the on-chain contracts.
- GOV1 witness version bumped to v3; v2 no longer accepted by the `blacklist-registry` type script.

### `@ckb-firewall/cli` v0.2.3

- Updated to use `FirewallConfig.registries` API throughout governance and inspect commands.
- `inspect` command now prints `typeIdValue` alongside registry entries.
- `check` command accepts `--registry-type-id` flag as an alternative to a full registry spec.
- Added `export` and `import` subcommands for sharing proposal JSON between governance participants.
- Fixed signing preimage to include `oldRoot`, `newRoot`, and `reviewWindowEndMs` (5-field 136-byte preimage).

### `ckb-transaction-firewall-sdk` (Rust) v0.3.0

- Modular rewrite: flat `lib.rs` split into `errors`, `types`, `registry`, `builder`, `firewall`, and `testnet` modules. All public symbols re-exported from the crate root for ergonomic `use`.
- Multi-registry: `FirewallConfig { registries: Vec<RegistrySpec> }`. `RegistrySpec` identifies a registry cell dep by `code_hash`, `hash_type`, and `type_id_value` (bytes 34–66 of the 66-byte v2 registry type args) — survives governance-lock upgrades. Required/optional flag per spec.
- `check_transaction(cfg, tx, now_secs)`: full pre-flight against live cell deps in an `UnsignedTxLike`.
- `preflight_check(outputs, payloads, now_secs)`: check against already-parsed `RegistryPayload` slices.
- `is_blacklisted(target, payloads, now_secs)`: point check, returns `bool`.
- `parse_registry_payload(data)`: now public; BLKL v2 only (v1 hard-rejected, matching the contract and TypeScript SDK).
- `encode_registry_payload(payload)` and `encode_governance_header(gh)`: public encoding helpers. `encode_registry_payload` returns `Result` and validates identifier length ≤ 255 before encoding.
- Builder module: `build_firewall_lock_args(config)`, `build_firewall_lock_script(config)`, `build_firewall_spend_cell_deps(config)` — encode the v2 `FirewallLockArgs` byte layout and assemble cell deps for spending firewall-protected cells.
- `error_codes` module: all 13 on-chain codes (5–17) as `pub const i8`, names matching the frozen v1 contract mapping (`InvalidArgsLayout=5`, `UnsupportedVersion=6`, `UnsupportedFlags=7`, `MissingRegistryCellDep=8` … `MissingInnerLockCellDep=13`, `InvalidInnerLockScript=14`, `InnerLockRejected=15`, `OutputScriptParseFailed=16`, `AmbiguousRegistryCellDep=17`).
- `FirewallError` implements `Display` and `std::error::Error`.
- Optional `serde` feature: derives `Serialize`/`Deserialize` on all public types.
- Optional `testnet` feature: exposes `testnet` module with `RPC_URL`, governance constants, and placeholder contract outpoints.
- Dep-matching uses exact 66-byte type args length (not `>= 66`), matching the on-chain resolver.
- `parse_entries` bounds-checks entry count against remaining buffer before `Vec::with_capacity` to prevent OOM on malicious input.
- Governance header parsing bounded within `[offset, offset + gov_len)` so a malformed `gov_header_len` cannot read into the entry section.
- 20+ unit tests; new `error_code_values_match_contract` test pins all 13 constants against the contract source.
- Crate metadata: `description`, `repository`, `keywords`, `categories` for crates.io publication.

### Docs site

- All "GOV1 v2" references updated to "GOV1 v3" across architecture, blacklist-registry, and governance pages; GOV1 v2 is no longer accepted by the on-chain contracts.
- Signing preimage corrected to the 5-field 136-byte blake2b preimage (`proposalIdHash || voteDigestHash || oldRoot || newRoot || reviewWindowEndMs`) in two locations.
- `rust-sdk.md` rewritten from a "coming soon" stub to full v0.3.0 API reference covering all public functions, feature flags, and error codes.
- Overview page Rust tab updated from placeholder to a working `check_transaction` snippet.
- CHANGELOG entries added for `@ckb-firewall/sdk` v0.3.2, `@ckb-firewall/cli` v0.2.3, and `ckb-transaction-firewall-sdk` v0.3.0.
- Stale JSON key names in testnet deployment notes fixed (`registryScript` → `registrySpec`, `blacklistRegistryTypeScriptDeployOutPoint` → `blacklistRegistryDeployOutPoint`).
- Governance-lock tx hash suffix in testnet-deployment page corrected.
- **Glossary page** added under Reference: 37 terms covering binary formats (BLKL, GOV1, FirewallLockArgs), contracts, architecture concepts, SDK types, and governance vocabulary.
- **Interactive preview system**: all docs pages now auto-mark the first occurrence of each glossary term with a dotted underline. Hovering (desktop) shows a definition popover; tapping (mobile) shows a bottom sheet. Extended to inline `<code>` symbols (TypeScript SDK types/functions, Rust SDK types, contract entry points) which show actual source snippets on hover/tap. File-path references show a file-location panel. Self-contained TypeScript and Rust syntax highlighter with no CDN dependency.

## 2026-05-15

### Version bump and docs npm links

- Bump `@ckb-firewall/cli` to 0.1.2 and `@ckb-firewall/sdk` to 0.2.5.
- Add npm package links to Starlight getting-started and CLI reference pages.
