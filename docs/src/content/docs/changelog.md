---
title: What's New
description: User-facing release notes for the CKB Transaction Firewall — what changed and what you need to do.
---

This page describes changes that affect adopters, integrators, and operators. For the internal development history, see [`CHANGELOG.md`](https://github.com/digitaldrreamer/ckb-transaction-firewall/blob/main/CHANGELOG.md) in the repository.

---

## 2026-06-04 — `@ckb-firewall/cli` v0.5.0 and Rust SDK v0.3.1

**What changed:**

- **`ckb-firewall config`** is a new command that saves your default proposer name to `~/.ckb-firewall/config.json`. Set it once with `ckb-firewall config --proposer yourname`; the `propose` command and the GUI New Proposal form will prefill from it automatically.
- The CLI's displayed version and `--version` output now read directly from `package.json` — no more stale hardcoded strings.
- Rust SDK bumped to v0.3.1 with a minor registry parsing fix.

**What you need to do:**

- **CLI users:** No breaking changes. Run `ckb-firewall config --proposer <yourname>` once if you want to stop being prompted every time you create a proposal.
- **SDK users (Rust):** Update `ckb-transaction-firewall-sdk` to `"0.3"` — the semver range already covers v0.3.1.

---

## 2026-06-03 — `@ckb-firewall/cli` v0.4.x, GOV1 v4, and keyless anchoring

**What changed:** The governance workflow is now fully keyless end-to-end. Two new on-chain contracts (`treasury-lock` and `proposal-anchor`) and a protocol upgrade to GOV1 v4 remove all private key requirements from the anchor and execute paths.

**What you need to do:**

- **CLI users:** Update to the latest CLI. The workflow changes from `propose → anchor → vote → sign → execute` to `propose → anchor → vote → execute`. The `sign` command no longer exists.
- **New commands:** `ckb-firewall anchor`, `ckb-firewall reclaim`, `ckb-firewall treasury-status`.
- **SDK users:** No action required. The registry spec is unchanged.

---

## 2026-05-28 — `@ckb-firewall/cli` v0.4.0 and `ckb-firewall gui`

**What changed:** The CLI ships a browser-based governance dashboard. `ckb-firewall gui` serves it locally at `http://ckb-firewall.localhost` (portless, port 80) or `http://localhost:7979` (fallback). The dashboard shows the live registry, treasury pool, proposal list, and inline forms for all governance operations.

**What you need to do:**

- **CLI users:** `npm install -g @ckb-firewall/cli` to update. Run `ckb-firewall gui` to open the dashboard.

---

## 2026-05-31 — Treasury-enabled registry deployment

**What changed:** The canonical testnet registry was re-bootstrapped with a v3 governance header embedding the full treasury lock script. Governance operations (anchoring and executing proposals) are now keyless — the autonomous treasury-lock funds both operations.

**What you need to do:**

- **SDK users:** No action required. The registry spec (`codeHash`, `hashType`, `typeIdValue`) is unchanged. If you hardcoded the registry cell outpoint, update to `0xa3dcb46fdeb92735e7f9f0393811a8541b71e275e8f713e62ea35f59746c78a8:0` or switch to `findRegistryCell`.
- **CLI users:** No action required. The CLI auto-discovers the current registry cell.
- **Governance validators:** No action required. The validator set is unchanged.

**New capabilities:** `ckb-firewall anchor` and `ckb-firewall execute` are now keyless for treasury-backed registries. `ckb-firewall reclaim` is new — it reclaims capacity from rejected or abandoned proposal anchors.

---

## 2026-05-20 — GOV1 v4 governance lock deployment

**What changed:** The governance-lock contract was upgraded to GOV1 v4, which replaces the multisig signer model with validator Merkle tree verification. The `sign` command was removed from the CLI; validator votes are now collected during `vote` and embedded in the execute witness.

**What you need to do:**

- **CLI users who used `ckb-firewall sign`:** Remove it from your workflow. The new flow is: `propose → anchor → vote → execute`. Signing is embedded in `vote`.
- **SDK users:** No action required.

---

## 2026-05-14 — `@ckb-firewall/cli` v0.1.0 published

Initial npm publication. Commands available: `inspect`, `check`, `propose`, `proposals`, `vote`, `export`, `import`, `anchor`, `execute`, `reclaim`, `gui`.

Install: `npm install -g @ckb-firewall/cli`
