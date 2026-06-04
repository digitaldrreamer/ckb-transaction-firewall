---
title: Governance Design
description: Why the governance system works the way it does — on-chain anchors, consensus-enforced review windows, validator Merkle trees, and the keyless treasury model.
---

Every change to the blacklist goes through a governance process that is deliberately slow, auditable, and resistant to unilateral action. The design choices behind it are worth understanding — they explain constraints that would otherwise seem arbitrary.

## Why proposals need an on-chain anchor

A proposal that exists only as a JSON file on someone's laptop can be forged, backdated, or silently modified. The signature scheme prevents forgery, but timing cannot be proven from a local file.

The governance system requires each proposal to be committed on-chain as a [`PBLK` cell](/reference/pblk-cell/) before it can be executed. This cell is a real CKB cell — it has a creation block, an on-chain hash, and a capacity that someone paid for. Its existence is provable from chain state.

More importantly, the execute transaction spends that cell with a relative [`since`](/reference/glossary/#since) delay — a CKB mechanism that prevents a transaction from being included in a block until the referenced input cell has aged by at least a specified amount of time. CKB consensus enforces this: a node will not include the execute transaction until the proposal cell is old enough, measured in [median block time](/reference/glossary/#median-block-time-mtp).

This means the 72-hour review window is not a CLI rule. It is not enforced by a timer that could be manipulated or bypassed by submitting the execute transaction directly without going through the CLI. It is enforced by every CKB node on every attempt to mine the execute transaction.

## Why the review window is 72 hours

72 hours gives governance committee members time to notice a proposal that should not be executed and coordinate an objection before it confirms. The window is long enough to be meaningful across time zones and weekend schedules, and short enough that urgent additions (a live exploit draining funds) can still reach the chain in a reasonable operational timeframe.

The 72-hour window can be overridden for testnet drills and non-production deployments via `--review-delay-ms`. On the canonical community registry, it cannot.

## Why validator votes instead of multisig signers

Earlier versions of this system used a multisig model: a fixed set of secp256k1 public keys were embedded in the governance header, and execution required threshold-of-N signatures from that set.

The current system uses a different model: a [validator Merkle root](/reference/glossary/#validator-merkle-root) commits to the set of authorized validators, and each vote is a standalone signature accompanied by a Merkle membership proof. The [`governance-lock`](/reference/glossary/#governance-lock) verifies the membership proofs and signature on each vote at execution time.

The Merkle approach has several properties the multisig approach does not:

**The validator set can be large without bloating the registry cell.** A Merkle root is 32 bytes regardless of whether the validator set has 5 members or 500. A multisig approach embeds every pubkey in the cell, growing it linearly.

**Validator rotation is a governance proposal, not a contract upgrade.** Rotating the validator set means publishing a new registry cell with a new Merkle root via the normal governance flow. The governance-lock contract itself does not change.

**Individual vote accountability is stronger.** Each vote is a signed message with a timestamp and a Merkle proof of membership. The execute transaction carries the full set of yes-votes in `WitnessArgs.lock`. An on-chain observer can reconstruct exactly who voted yes and verify every signature.

**Non-voting is visible.** Because the Merkle tree commits to a count of validators, not just a list of who signed, it is possible to see when fewer than the full committee voted — even if the threshold was met.

## Why the keyless treasury model

In the earlier governance model, someone had to pay for proposal anchor cells and for the capacity increase when the registry cell grew with new entries. This created a friction point: someone had to hold a funded private key and actively service governance operations.

The [`treasury-lock`](/reference/glossary/#treasury-lock) is an autonomous on-chain contract. Anyone can send CKB to the treasury address. The treasury-lock contract validates that funds leaving the treasury are used specifically for governance operations — creating typed [`proposal-anchor`](/reference/proposal-anchor/) cells or covering registry capacity growth. No private key is needed to spend treasury funds for these purposes; the contract itself enforces the constraints.

This design means:
- Any community member can donate to fund governance operations
- Proposal anchoring and execution require no funded signer after the treasury is seeded
- The audit trail for treasury spending is entirely on-chain

The tradeoff: the treasury is an on-chain pool, not a controlled account. If the governance-lock or proposal-anchor contract has a vulnerability, treasury funds could be at risk. The contract boundaries are explicitly designed to limit what treasury funds can do.

## Why one registry cell, not a list

A natural question: why not maintain multiple smaller cells that can be updated independently, avoiding the single-cell bottleneck?

The single-cell design provides a property that multi-cell designs cannot easily provide: **the [firewall lock](/reference/glossary/#firewall-lock) can require exactly one matching [cell dep](/reference/glossary/#cell-dep)**. If a transaction includes two registry cells that both match the configured identity, the firewall rejects with [`AmbiguousRegistryCellDep`](/reference/error-codes/#firewall-lock) (code 17). This eliminates the possibility of an attacker injecting a manipulated registry alongside the real one.

With multiple cells, the firewall would need to union all matching deps — and the question of which cells count as authoritative becomes harder to answer from within a lock script without additional coordination overhead.

See [Registry design](/concepts/registry-design/) for the full discussion of the single-cell model.

## What the governance-lock actually enforces

At execution time, the governance-lock script verifies:

1. The proposal input's [`since`](/reference/glossary/#since) field encodes a relative [median-time-past](/reference/glossary/#median-block-time-mtp) delay ≥ `review_delay_ms` from the [GOV1 v4 witness](/reference/gov1-witness/)
2. The number of valid validator yes-votes meets the threshold stored in the registry's [governance header](/reference/glossary/#governance-header)
3. Each yes-vote's ECDSA signature recovers to the claimed validator pubkey
4. Each validator pubkey has a valid Merkle membership proof against the [`validatorMerkleRoot`](/reference/glossary/#validator-merkle-root) in the governance header

The CLI's `execute` command also verifies vote signatures and Merkle proofs before building the transaction — but the on-chain governance-lock is the authoritative check. Building the transaction manually without going through the CLI does not circumvent it.

## See also

- [Governance validator tutorial](/get-started/validator/) — hands-on: import a proposal, vote, and share
- [How to create a proposal](/how-to/create-proposal/) — proposer side: add, remove, or set-treasury
- [How to anchor a proposal](/how-to/anchor-proposal/) — create the on-chain PBLK cell
- [How to execute an approved proposal](/how-to/execute-proposal/) — after the window and threshold are met
- [GOV1 v4 Witness reference](/reference/gov1-witness/) — exact byte layout of the governance witness
- [PBLK Proposal Cell reference](/reference/pblk-cell/) — proposal cell data layouts for v1 and v2
