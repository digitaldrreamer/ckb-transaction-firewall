# @ckb-firewall/cli

[![npm](https://img.shields.io/npm/v/@ckb-firewall/cli)](https://www.npmjs.com/package/@ckb-firewall/cli)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

Command-line tooling for inspecting and governing the [CKB Transaction Firewall](https://github.com/digitaldrreamer/ckb-transaction-firewall) blacklist registry.

Node 20+. ESM only.

## Install

```bash
npm install -g @ckb-firewall/cli
```

Or use the one-line installer (handles Node version checks and PATH setup):

```bash
curl -fsSL https://raw.githubusercontent.com/digitaldrreamer/ckb-transaction-firewall/main/scripts/install-cli.sh | bash
```

## Commands

### `ckb-firewall inspect`

Display the current blacklist entries from the live testnet registry cell.

```bash
ckb-firewall inspect
```

Options: `--rpc-url`, `--registry-tx`, `--registry-index` (defaults point at the canonical testnet cell).

---

### Quick path — testnet/dev

These commands produce a signed transaction file ready for `ckb-cli`. They use placeholder governance witnesses and are intended for testnet experimentation and development.

```bash
# Add a lock-args to the blacklist
ckb-firewall add --lock-args 0xabc123...

# Remove a lock-args from the blacklist
ckb-firewall remove --lock-args 0xabc123...
```

Both commands are interactive when flags are omitted. Both accept `--sign` to sign and submit in one step via `ckb-cli`.

---

### Full governance flow

The full flow creates an auditable, community-reviewed proposal with a 72-hour review window, validator voting, and 3-of-5 multisig signing before anything is executed on-chain.

**1. Create a proposal**

```bash
ckb-firewall propose
```

Prompts for action (add/remove), lock args, threat classification, severity, evidence, rationale, and proposer identity. Stores the proposal locally (`~/.ckb-firewall/proposals/`) and prints the proposal ID.

**2. Vote on proposals**

```bash
ckb-firewall vote --proposal <id> --vote yes --validator alice
```

Interactive when flags are omitted. Requires a minimum of 3 yes votes before signing is allowed.

**3. List proposals**

```bash
ckb-firewall proposals
ckb-firewall proposals --status voting
ckb-firewall proposals --status approved
```

Shows a table with status, vote tally, signature count, and review window countdown.

**4. Sign an approved proposal**

```bash
ckb-firewall sign --proposal <id> --signer-index 0
```

Prompts for a 32-byte secp256k1 private key (password-masked). Falls back to a deterministic dev key for testnet use. Signing is only allowed after the 72-hour review window has passed and the vote threshold is met.

**5. Execute on-chain**

```bash
ckb-firewall execute --proposal <id>
```

Builds and writes a governance transaction JSON file. Add `--sign` to sign and submit via `ckb-cli` in one step.

---

## Testnet defaults

All commands default to the canonical testnet registry cell. See [`docs/deployments/testnet.registry.json`](https://github.com/digitaldrreamer/ckb-transaction-firewall/blob/main/docs/deployments/testnet.registry.json) for the exact cell outpoint and script identity.

## More

- [CKB Transaction Firewall](https://github.com/digitaldrreamer/ckb-transaction-firewall) — contracts, TypeScript SDK, Rust SDK, governance docs, testnet deployment
- [Governance model](https://github.com/digitaldrreamer/ckb-transaction-firewall/blob/main/docs/governance.md)
- [Architecture and trust model](https://github.com/digitaldrreamer/ckb-transaction-firewall/blob/main/docs/architecture.md)
