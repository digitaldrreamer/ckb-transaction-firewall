# CKB Transaction Firewall documentation

Starlight site for integrators and operators. **Published:** https://ckb-firewall.drreamer.digital

Internal design notes live under [`../notes/`](../notes/).

## Local development

```bash
npm install
npm run dev
```

Dev server: http://localhost:4321/

```bash
npm run build
npm run preview
```

## Published routes

| Topic | URL |
|-------|-----|
| Home | https://ckb-firewall.drreamer.digital/ |
| Tutorial | https://ckb-firewall.drreamer.digital/getting-started/tutorial/ |
| Choose your path | https://ckb-firewall.drreamer.digital/getting-started/choose-your-path/ |
| How to use (integration cookbook) | https://ckb-firewall.drreamer.digital/guides/governance-how-to-use/ |
| Pre-flight check (TypeScript) | https://ckb-firewall.drreamer.digital/guides/typescript-preflight/ |
| Wallet integration | https://ckb-firewall.drreamer.digital/guides/typescript-wallet-integration/ |
| Pre-flight check (Rust) | https://ckb-firewall.drreamer.digital/guides/rust-preflight/ |
| CLI walkthrough | https://ckb-firewall.drreamer.digital/guides/cli-walkthrough/ |
| GUI mode | https://ckb-firewall.drreamer.digital/guides/cli-gui/ |
| Blacklisting an address | https://ckb-firewall.drreamer.digital/guides/governance-blacklist/ |
| Overview | https://ckb-firewall.drreamer.digital/concepts/overview/ |
| Why this exists | https://ckb-firewall.drreamer.digital/concepts/why-this-exists/ |
| Architecture | https://ckb-firewall.drreamer.digital/concepts/architecture/ |
| Firewall lock | https://ckb-firewall.drreamer.digital/concepts/firewall-lock/ |
| Blacklist registry | https://ckb-firewall.drreamer.digital/concepts/blacklist-registry/ |
| Governance | https://ckb-firewall.drreamer.digital/concepts/governance/ |
| Security model | https://ckb-firewall.drreamer.digital/concepts/security-model/ |
| TypeScript SDK API | https://ckb-firewall.drreamer.digital/reference/sdk-api/ |
| Rust SDK API | https://ckb-firewall.drreamer.digital/reference/rust-sdk-api/ |
| CLI reference | https://ckb-firewall.drreamer.digital/reference/cli/ |
| BLKL format | https://ckb-firewall.drreamer.digital/reference/blkl-format/ |
| Firewall lock args | https://ckb-firewall.drreamer.digital/reference/firewall-lock-args/ |
| GOV1 witness | https://ckb-firewall.drreamer.digital/reference/gov1-witness/ |
| Error codes | https://ckb-firewall.drreamer.digital/reference/error-codes/ |
| Testnet deployment | https://ckb-firewall.drreamer.digital/operations/testnet-deployment/ |
| Troubleshooting | https://ckb-firewall.drreamer.digital/operations/troubleshooting/ |

Source files: `src/content/docs/`. Canonical testnet fixture JSON: [`../notes/deployments/testnet.registry.json`](../notes/deployments/testnet.registry.json).
