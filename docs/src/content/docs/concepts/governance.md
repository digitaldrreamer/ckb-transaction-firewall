---
title: Governance
description: The proposal, review, vote, sign, and execute lifecycle for blacklist updates.
---

This is the update path for the blacklist.

The flow is meant to be auditable and reviewable, not fast.

## Lifecycle

1. A proposer submits a change request.
2. Reviewers inspect the evidence and impact.
3. Validators vote.
4. Signers produce the execution witness.
5. The registry update transaction lands on-chain.

## Public tooling

- `ckb-firewall propose`
- `ckb-firewall vote`
- `ckb-firewall proposals`
- `ckb-firewall sign`
- `ckb-firewall execute`

## On-chain validation

The registry type script validates topology, witness structure, signer counts, and registry roots. The CLI and fixtures implement the signing and authorization path around that validation.

## Operational rule

Treat governance updates like releases. They affect every wallet cell that relies on the firewall lock.
