# @ckb-firewall/cli

<p align="center">
  <img src="https://raw.githubusercontent.com/digitaldrreamer/ckb-transaction-firewall/main/assets/logo.png" alt="CKB Transaction Firewall" width="100" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/digitaldrreamer/ckb-transaction-firewall/main/assets/cli-screenshot.png" alt="ckb-firewall CLI" width="720" />
</p>

[![npm](https://img.shields.io/npm/v/@ckb-firewall/cli)](https://www.npmjs.com/package/@ckb-firewall/cli)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

CLI for inspecting and governing the [CKB Transaction Firewall](https://github.com/digitaldrreamer/ckb-transaction-firewall) blacklist registry.

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

### Inspect and check

```bash
# Show all current entries with status
ckb-firewall inspect

# Check whether a specific address is blacklisted
ckb-firewall check --lock-args 0xabc123...
```

### Governance flow

The auditable path — cryptographically signed votes, 72-hour review window, and on-chain multisig execution.

```bash
# 1. Create a proposal
ckb-firewall propose

# 2. Export and share with other participants
ckb-firewall export --proposal <id> --out proposal.json

# 3. Each participant imports
ckb-firewall import proposal.json

# 4. Each validator votes with their private key
ckb-firewall vote --proposal <id> --vote yes
#   (prompts for 32-byte private key)

# 5. Track status
ckb-firewall proposals

# 6. Sign after 72h review window and vote threshold
ckb-firewall sign --proposal <id> --signer-index 0
#   (prompts for 32-byte private key)

# 7. Execute on-chain
ckb-firewall execute --proposal <id> --tx-out gov_tx.json
```

Proposal state lives in `~/.ckb-firewall/proposals/`. Use `export`/`import` to share between participants — `import` merges rather than overwrites.

## Full reference

[https://ckb-firewall.drreamer.digital/reference/cli/](https://ckb-firewall.drreamer.digital/reference/cli/)
