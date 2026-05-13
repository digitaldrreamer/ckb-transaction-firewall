# Internal documentation and milestone evidence

This directory holds release evidence that is not required to use the firewall as a library, but is required to reproduce builds, close Phase 3/4 gates, and trace governance verification.

| Path | Purpose |
|------|---------|
| [phase3_artifacts/](phase3_artifacts/) | Reproducible build manifests, verification logs, cycle reports, and `PHASE3_*` evidence snapshots produced by `scripts/phase3_repro_build.sh`, `scripts/phase3_verify.sh`, and CI. |
| [phase4_artifacts/](phase4_artifacts/) | Phase 4 governance-hardening milestone evidence (M1–M5), security sign-off, and CI gate transcripts. |

Public narrative for adopters starts at the root [README.md](../README.md) and [ABOUT.md](../ABOUT.md). Technical architecture and CKB rationale: [docs/architecture.md](../architecture.md). Phase runbooks: [docs/phase3/](../phase3/) and [docs/phase4/](../phase4/).
