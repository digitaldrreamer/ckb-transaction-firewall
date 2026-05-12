# Internal documentation and milestone evidence

This directory holds **operator-facing and audit-facing material** that is not required to *use* the firewall as a library, but is required to **reproduce builds**, close Phase 3/4 gates, and trace governance verification.

| Path | Purpose |
|------|---------|
| [phase3-plan.md](phase3-plan.md) | Archived Phase 3 program plan (historical context). |
| [phase3_artifacts/](phase3_artifacts/) | Reproducible build manifests, verification logs, cycle reports, and `PHASE3_*` evidence snapshots produced by `scripts/phase3_repro_build.sh`, `scripts/phase3_verify.sh`, and CI. |
| [phase4_artifacts/](phase4_artifacts/) | Phase 4 governance-hardening milestone evidence (M1–M5), security sign-off, and CI gate transcripts. |

Public narrative and architecture for developers start at the root [README.md](../README.md) and [docs/architecture.md](../architecture.md). Phase runbooks live under [docs/phase3/](../phase3/) and [docs/phase4/](../phase4/).
