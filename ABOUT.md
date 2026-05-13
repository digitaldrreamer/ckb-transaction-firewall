# About CKB Transaction Firewall

CKB Transaction Firewall is a protocol-level safety primitive for software that spends Nervos CKB cells. It prevents protected cells from creating outputs whose lock or type args match a community-governed blacklist.

The motivating threat model is autonomous AI agents, but the same protection applies to wallets, dapps, custodial jobs, and any service that builds CKB transactions.

## Why It Exists

Application-only checks are easy to bypass when an agent runtime is compromised, prompt-injected, or instructed to skip simulation. The Firewall adds a second line of defense at consensus: if a protected cell uses the Firewall lock, CKB nodes reject spends to blacklisted destinations even when application code fails.

## Design

- **SDK preflight:** TypeScript and Rust SDKs parse caller-supplied registry cell data and reject unsafe outputs before signing.
- **Consensus enforcement:** the Firewall lock script reads the same registry cell through `cell_deps` and fails closed when the registry is missing, invalid, ambiguous, or matched.
- **Governed registry:** the blacklist registry type script enforces GOV1 witness rules and threshold signer authorization for updates.

The SDK is intentionally RPC-free in its core path. Callers choose how to fetch the live registry cell, then pass the exact data they intend to sign against.

## CKB Fit

CKB cells have programmable lock scripts, and transactions can reference read-only cells through `cell_deps`. That lets the Firewall apply a reusable spending policy to protected cells without redeploying wallet contracts or relying on an oracle.

The registry update model is also native to CKB: governance consumes the old registry cell and creates the next version. Operators should sequence registry updates carefully because transactions referencing an old registry cell can conflict with a replacement in the same mempool window.

## Scope

Protects against:

- known exploit contracts, drainer wallets, or compromised destinations,
- prompt-injected or compromised agents attempting to redirect funds,
- skipped or bypassed application-level preflight checks.

Does not protect against:

- destinations not yet on the blacklist,
- non-address exploit classes,
- governance key compromise beyond multisig/process mitigations,
- cells that do not use the Firewall lock.

## More Detail

- Quick start and build/test commands: [README.md](./README.md)
- Architecture and trust model: [docs/architecture.md](./docs/architecture.md)
- Lock script specification: [docs/lock-script-spec.md](./docs/lock-script-spec.md)
- Governance policy: [docs/governance.md](./docs/governance.md), [governance/voting.md](./governance/voting.md)
- Testnet deployment and SDK wiring: [docs/deployments/testnet.md](./docs/deployments/testnet.md)
