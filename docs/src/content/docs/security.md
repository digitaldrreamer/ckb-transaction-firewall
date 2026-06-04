---
title: Security
description: How to report security vulnerabilities in the CKB Transaction Firewall contracts, SDKs, and CLI.
---

## Reporting a vulnerability

If you discover a security vulnerability in the CKB Transaction Firewall contracts, SDKs, or CLI, please report it responsibly.

**Do not open a public GitHub issue.** Public disclosure before a fix is available could put users at risk.

**Email:** [durojaye@saturncloud.io](mailto:durojaye@saturncloud.io)

Include in your report:
- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept (if possible)
- The component affected: firewall-lock, blacklist-registry, governance-lock, proposal-anchor, TypeScript SDK, Rust SDK, or CLI

We will acknowledge your report within 48 hours and aim to provide a remediation timeline within 7 days.

## Scope

In-scope:
- On-chain contract logic (firewall-lock, blacklist-registry, governance-lock, proposal-anchor, spawn-aware-secp256k1)
- TypeScript SDK (`@ckb-firewall/sdk`)
- Rust SDK (`ckb-transaction-firewall-sdk`)
- CLI (`@ckb-firewall/cli`)

Out-of-scope:
- CKB node or consensus layer vulnerabilities (report to Nervos Foundation)
- Third-party dependencies (report to their respective maintainers)
- Social engineering or phishing

## Security properties

For a full description of the system's security guarantees, trust assumptions, and what governance key compromise means, see [Trust model and guarantees](/concepts/trust-model-and-guarantees/).

For the security boundaries — what the system protects against and what it does not — see [Security model](/concepts/security-model/).

## Known issues

See the [security findings tracker](https://github.com/digitaldrreamer/ckb-transaction-firewall/blob/main/notes/internal/phase4/security/findings-tracker.md) in the repository for tracked findings and their remediation status. The system is currently testnet-only; mainnet deployment is pending completion of the security review.
