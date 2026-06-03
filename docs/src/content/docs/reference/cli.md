---
title: CLI Reference
description: Command and option reference for @ckb-firewall/cli.
---

This is the command surface for [@ckb-firewall/cli](https://www.npmjs.com/package/@ckb-firewall/cli).

## Global behavior

- Node 20+ required
- ESM only
- Defaults point to the canonical testnet registry cell and contracts
- Registry-touching commands fetch live cell data through the CKB RPC before building anything
- `inspect`, `check`, and `execute` auto-discover the current registry cell outpoint via the CKB indexer (`get_cells`) when using testnet defaults, so they keep working after governance updates without requiring `--registry-tx` overrides. Falls back silently to the configured outpoint if the indexer is unavailable.

## Commands

### `inspect`

Show the current registry entries with their expiry status.

```bash
ckb-firewall inspect
ckb-firewall inspect --rpc-url https://testnet.ckb.dev
```

Options: `--rpc-url`, `--registry-tx`, `--registry-index`

---

### `check`

Test whether a specific lock args is currently blacklisted.

```bash
ckb-firewall check --lock-args 0xabc123...
```

Options: `--lock-args` (required), `--rpc-url`, `--registry-tx`, `--registry-index`

---

### `propose`

Create a governance proposal. All fields are hashed together into a canonical `proposalIdHash` — every field is immutable after creation.

```bash
ckb-firewall propose \
  --action add \
  --lock-args 0xabc123... \
  --evidence https://evidence.example/... \
  --classification theft \
  --severity high \
  --rationale "Drained 50k CKB from multiple wallets in a single transaction." \
  --proposer alice
```

To activate or rotate the registry treasury metadata, create a metadata proposal:

```bash
ckb-firewall propose \
  --action set-treasury \
  --treasury-lock-code-hash 0x... \
  --treasury-lock-hash-type type \
  --treasury-lock-args 0x... \
  --evidence https://evidence.example/treasury \
  --classification other \
  --severity high \
  --rationale "Activate the public registry treasury for proposal anchors and growth." \
  --proposer alice
```

Options: `--action`, `--lock-args`, `--expires-at`, `--evidence`, `--classification`, `--severity`, `--rationale`, `--proposer`, `--treasury-lock-code-hash`, `--treasury-lock-hash-type`, `--treasury-lock-args`

Classifications: `theft`, `scam`, `hack`, `sanctions`, `other`  
Severities: `critical`, `high`, `medium`, `low`

Proposal actions: `add`, `remove`, `set-treasury`. `set-treasury` creates a `PBLK` v2 proposal cell that binds the target treasury lock hash. It keeps the blacklist entries unchanged and updates only the governance header treasury metadata.

After creation the CLI prints an export command. Share the exported JSON with other governance participants via `export` / `import`.

---

### `proposals`

List proposals and their current status.

```bash
ckb-firewall proposals
ckb-firewall proposals --status voting
```

Options: `--status` (`pending-review`, `voting`, `approved`, `executed`, `rejected`)

---

### `vote`

Record a cryptographically signed validator vote on a proposal.

```bash
ckb-firewall vote --proposal abc123 --vote yes
# prompts for private key
```

Options: `--proposal`, `--vote` (`yes`, `no`, `abstain`), `--rpc-url`, `--registry-tx`, `--registry-index`

The CLI prompts for the validator private key with masked input.

**What this command does:**
1. Derives the compressed public key from the provided private key
2. Checks the pubkey is in the authorized validator set (Merkle membership proof against the on-chain `validatorMerkleRoot` in the BLKL governance header)
3. Rejects the vote if the key is not an authorized validator
4. Signs the vote: `blake2b({domain:"ckb-firewall:vote", proposalIdHash, vote, timestamp, pubkey})`
5. Stores the vote locally with signature and Merkle proof
6. Updates the `voteDigestHash` — a commitment to the full set of votes cast so far

Votes are local until `execute`. Export and share the updated proposal so other participants can import your vote.

---

### `anchor`

Build or submit the on-chain `PBLK` proposal cell used by GOV1 v4 execution.

```bash
ckb-firewall anchor --proposal abc123 --to-address ckt1...

ckb-firewall anchor \
  --proposal abc123 \
  --to-address ckt1... \
  --from-account ckt1... \
  --submit

ckb-firewall anchor \
  --proposal abc123 \
  --proposal-tx 0x... \
  --proposal-index 0
```

Options: `--proposal` (required), `--rpc-url`, `--registry-tx`, `--registry-index`, `--to-address`, `--from-account`, `--capacity`, `--fee-rate`, `--privkey-path`, `--output-index`, `--proposal-tx`, `--proposal-index`, `--proposal-anchor-code-tx`, `--proposal-anchor-code-index`, `--treasury-cell`, `--treasury-lock-dep`, `--tx-out`, `--submit`

For non-treasury registries, without `--submit`, the command prints the exact `ckb-cli wallet transfer --to-data ...` command. With `--submit`, it runs `ckb-cli`, submits the proposal cell transfer, and stores the resulting proposal-cell outpoint on the proposal JSON.

For treasury-backed registries, `anchor` builds a real typed `proposal-anchor` transaction funded by treasury cells:

```bash
ckb-firewall anchor \
  --proposal abc123 \
  --tx-out gov_anchor_tx.json
```

On canonical testnet, the deployed `proposal-anchor` code outpoint is used by default. For private deployments, override it with `--proposal-anchor-code-tx` and `--proposal-anchor-code-index`. Add `--treasury-cell <tx-hash>:<index>` one or more times to select treasury inputs manually; otherwise the CLI discovers plain treasury cells by the treasury lock script in the registry. Add `--treasury-lock-dep <tx-hash>:<index>[:code|dep_group]` for any extra cell deps required by a custom treasury lock. Add `--submit --from-account <treasury-address>` to sign and submit with `ckb-cli`.

If you create the cell separately, run `anchor` again with `--proposal-tx` and `--proposal-index` to record the outpoint.

After the outpoint is stored, execute can infer it:

```bash
ckb-firewall execute --proposal abc123
```

---

### `execute`

Build the registry update transaction from an approved validator-voted proposal. Verifies vote signatures and Merkle proofs before building a witness that the on-chain governance lock verifies again.

```bash
ckb-firewall execute \
  --proposal abc123 \
  --tx-out ./gov_tx.json
```

Options: `--proposal`, `--rpc-url`, `--registry-tx`, `--registry-index`, `--proposal-tx`, `--proposal-index`, `--proposal-anchor-code-tx`, `--proposal-anchor-code-index`, `--treasury-cell`, `--treasury-lock-dep`, `--tx-out`, `--sign`, `--from-account`

`--proposal-tx` and `--proposal-index` override the stored live `PBLK` proposal-cell outpoint when needed. The generated transaction spends that proposal cell with a relative timestamp `since` delay and returns its remaining capacity as change.

For registries with treasury metadata, `execute` also enforces the treasury funding model:

- the `PBLK` proposal cell must be locked to the registry treasury
- the `PBLK` proposal cell must carry the `proposal-anchor` type args for this registry treasury and reclaim delay
- pruned registry capacity is returned to the treasury
- if the new registry payload needs more capacity, pass one or more `--treasury-cell <tx-hash>:<index>` inputs
- on canonical testnet, the deployed `proposal-anchor` code outpoint is included by default; private deployments can override it with `--proposal-anchor-code-tx` and `--proposal-anchor-code-index`
- pass `--treasury-lock-dep <tx-hash>:<index>[:code|dep_group]` if the treasury lock needs custom cell deps

```bash
ckb-firewall execute \
  --proposal abc123 \
  --treasury-lock-dep 0x...:0:code \
  --treasury-cell 0x...:0 \
  --treasury-cell 0x...:1
```

---

### `reclaim`

Build a transaction that reclaims a rejected or abandoned treasury-funded proposal anchor without changing the registry.

```bash
ckb-firewall reclaim \
  --proposal abc123 \
  --tx-out ./gov_reclaim_tx.json
```

Options: `--proposal`, `--rpc-url`, `--registry-tx`, `--registry-index`, `--proposal-tx`, `--proposal-index`, `--proposal-anchor-code-tx`, `--proposal-anchor-code-index`, `--treasury-lock-dep`, `--tx-out`, `--sign`, `--from-account`, `--force`

`reclaim` verifies the live `PBLK` cell data against the local proposal and current registry type ID, checks that the anchor is locked to the registry treasury, checks that the anchor carries the `proposal-anchor` type args, sets the same relative timestamp `since` delay used by execution, and returns the remaining capacity to the treasury lock. On canonical testnet, the deployed `proposal-anchor` code outpoint is used by default. Use `--treasury-lock-dep` for any extra cell deps required by a custom treasury lock.

By default, reclaim refuses proposals that are still in their review window or that appear executable. Use `--force` only after governance has decided not to execute the proposal.

---

### `gui`

Launch the browser-based governance dashboard.

```bash
ckb-firewall gui
ckb-firewall gui --port 8080
ckb-firewall gui --no-open
```

Options:

| Option | Default | Description |
|---|---|---|
| `--port` | `7979` | Port for the local app server |
| `--no-open` | — | Start the server without opening a browser tab |

The command attempts to bind port 80 and serve the dashboard at `http://ckb-firewall.localhost` (no port in the URL). If port 80 is unavailable it falls back to `http://ckb-firewall.localhost:<port>`. To get the portless URL without `sudo`, grant Node the capability to bind low ports:

```bash
# Linux
sudo setcap cap_net_bind_service+eip $(which node)

# macOS
sudo ckb-firewall gui

# Windows (run terminal as Administrator)
ckb-firewall gui
```

Press `Ctrl+C` to stop the server. The server uses the same `--rpc-url` and registry defaults as `inspect`.

For a walkthrough of the GUI interface see [GUI mode](/guides/cli-gui/).

---

### `export`

Export a proposal to a shareable JSON file for multi-party governance coordination.

```bash
ckb-firewall export --proposal abc123 --out proposal-abc123.json
ckb-firewall export --proposal abc123   # prints to stdout
```

Options: `--proposal`, `--out`

---

### `import`

Import a proposal shared by another governance participant. Validates `proposalIdHash` and `voteDigestHash` integrity before saving. If the proposal already exists locally, votes are merged rather than overwritten.

```bash
ckb-firewall import proposal-abc123.json
ckb-firewall import proposal-abc123.json --force
```

Arguments: `<file>` (required)  
Options: `--force` (skip overwrite confirmation)

---

## Full governance flow

All registry changes go through governance. The proposal is a local JSON file until `execute` submits it on-chain. No private key is required for `anchor` or `execute` — the autonomous treasury-lock funds both operations.

```text
propose → anchor → export → [share] → import → vote → export → [share] → import → execute
```

1. Any participant runs `propose` to create the proposal file, then `anchor` to lock it on-chain (funded by the treasury pool — no key needed)
2. The JSON is exported and shared out-of-band (email, Signal, IPFS, etc.)
3. Each validator runs `import` to receive it, then `vote` with their validator key
4. After the review window and vote threshold are met, any participant runs `execute` — also funded by the treasury pool, no key needed

There is no `sign` command. Validator vote signatures are collected during `vote` and embedded in the execute witness by `execute` itself.

The minimum timeline is approximately 96 hours (72h review window + time for validators to vote). The CLI warns if a temporary entry's `expiresAt` falls within this window.
