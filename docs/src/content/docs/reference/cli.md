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

Options: `--action`, `--lock-args`, `--expires-at`, `--evidence`, `--classification`, `--severity`, `--rationale`, `--proposer`

Classifications: `theft`, `scam`, `hack`, `sanctions`, `other`  
Severities: `critical`, `high`, `medium`, `low`

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

### `sign`

Add a governance signer signature after the vote threshold is met and the 72-hour review window has passed.

```bash
ckb-firewall sign --proposal abc123 --signer-index 0
# prompts for private key
```

Options: `--proposal`, `--signer-index`, `--rpc-url`, `--registry-tx`, `--registry-index`

The CLI prompts for the signer private key with masked input.

---

### `execute`

Build the registry update transaction from an approved, fully-signed proposal. Verifies all vote signatures and Merkle proofs against the on-chain validator set before building the witness.

```bash
ckb-firewall execute --proposal abc123 --tx-out ./gov_tx.json
```

Options: `--proposal`, `--rpc-url`, `--registry-tx`, `--registry-index`, `--tx-out`, `--sign`, `--from-account`

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

# macOS / Windows
sudo ckb-firewall gui
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

Import a proposal shared by another governance participant. Validates `proposalIdHash` and `voteDigestHash` integrity before saving. If the proposal already exists locally, votes and signatures are merged rather than overwritten.

```bash
ckb-firewall import proposal-abc123.json
ckb-firewall import proposal-abc123.json --force
```

Arguments: `<file>` (required)  
Options: `--force` (skip overwrite confirmation)

---

## Full governance flow

All registry changes go through governance. The proposal is a local JSON file until `execute` submits it on-chain.

```
propose → export → [share] → import → vote → export → [share] → import → sign → execute
```

1. One participant runs `propose` and `export`
2. The JSON is shared out-of-band (email, Signal, IPFS, etc.)
3. Each participant runs `import` to receive it
4. Each validator runs `vote` with their private key
5. Each signer runs `sign` after the 72h review window and vote threshold are met
6. Any participant runs `execute` to build and submit the transaction

The minimum timeline is approximately 120 hours (72h review + voting + signing). The CLI warns if a temporary entry's `expiresAt` falls within this window.
