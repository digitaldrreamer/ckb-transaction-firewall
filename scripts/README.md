# Scripts

Operational automation for deployment and governance workflows.

## Script Inventory

### `deploy.sh`

Purpose:

- Build and deploy contract artifacts.
- Print deployed code hashes and outpoints.
- Validate deployment prerequisites before broadcast.

Expected capabilities:

- environment selection (`testnet`, `mainnet`),
- dry-run mode,
- idempotent output handling,
- machine-readable output option for CI pipelines.

### `update-blacklist.ts`

Purpose:

- Validate governance update payloads.
- Build registry replacement transaction inputs.
- Prepare signer payloads and submission metadata.

Expected capabilities:

- add/remove entry actions,
- proposal id linkage,
- schema validation prior to tx build,
- optional `--submit` toggle (build-only by default),
- emergency temporary-add path with enforced TTL metadata fields.

## CLI Recommendation

Yes, a CLI is needed. Governance and deployment are operational workflows that should be reproducible, scriptable, and auditable across environments and operators.
