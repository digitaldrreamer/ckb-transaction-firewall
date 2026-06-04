---
title: Trust Model and Guarantees
description: What the firewall actually guarantees, what it does not, the trust assumptions it rests on, and what governance key compromise means in practice.
---

This page is written for a technical audience evaluating whether to depend on this system in a production context — auditors, security reviewers, architects. It states the guarantees flatly, including their boundaries and the trust assumptions underneath them.

## What the system guarantees

**Consensus enforcement for cells that use the firewall lock.** Any transaction that tries to spend a cell locked by the firewall lock and that creates an output whose lock or type args appear in the current registry will be rejected by every CKB full node. This guarantee holds regardless of what the transaction builder did or did not do in application code.

**Fail-closed on missing or malformed registry data.** A transaction that omits the registry dep, includes a malformed BLKL payload, or includes an ambiguous registry dep is rejected. The firewall does not fall back to "allow."

**Governance updates require on-chain evidence.** A registry change cannot be confirmed without a proposal cell that has aged on-chain for at least `review_delay_ms` (default 72 hours, measured in median block time) and a witness containing threshold-of-N validator yes-votes with valid signatures and Merkle proofs. Bypassing the CLI does not bypass this — the governance-lock enforces it at consensus.

**Entry integrity and sort order.** The registry type script rejects any update that produces a BLKL payload with invalid structure, duplicate entries, or entries not in strict ascending byte order. The SDK's parser enforces the same rules off-chain.

## What the system does not guarantee

**Coverage of unlisted addresses.** The firewall can only block addresses that are on the registry at the time a spend is attempted. An attacker using a new address not yet listed will not be blocked.

**Cells that do not use the firewall lock.** The firewall lock is opt-in per cell. Cells using any other lock script — including the standard secp256k1 lock — are not subject to the firewall's blacklist check.

**Incoming transfers from blacklisted addresses.** The firewall checks outputs produced by the spending transaction, not inputs or counterparties. A blacklisted entity can send CKB to a firewall-protected address freely.

**Attack vectors that do not produce a blacklisted output.** The firewall blocks a specific action: creating an output at a blacklisted address. Attacks that involve other mechanisms — exploiting a smart contract vulnerability, governance manipulation, fee extraction — are not in scope.

## Trust assumptions

**The CKB consensus mechanism is sound.** The firewall's guarantees rest on CKB nodes enforcing lock scripts correctly and honestly. A 51% attack or a consensus protocol bug could undermine these guarantees, as it would for any CKB-based system.

**The governance-lock contract is correct.** The enforcement of the review window, validator Merkle proofs, and signature verification happens in the governance-lock contract code. A vulnerability in that code could allow a governance update to bypass the intended constraints.

**The blacklist-registry type script is correct.** Payload structure validation, sort order enforcement, and GOV1 witness binding happen in the blacklist-registry contract. A vulnerability there could allow a malformed or unauthorized registry update.

**The validator Merkle root in the registry is accurate.** The governance-lock verifies each yes-vote's membership against the `validatorMerkleRoot` embedded in the BLKL governance header. If that root is incorrect (due to a bootstrap error or a successful malicious update), the wrong validator set is authorized.

**The treasury-lock contract is correct.** The autonomous treasury's spending constraints are enforced by contract code. A vulnerability could allow treasury funds to be extracted for non-governance purposes.

## What governance key compromise means

The validator private keys are used to sign vote records. A compromised validator key allows an attacker to cast votes as that validator.

**With one compromised key (assuming 3-of-5 threshold):** An attacker who controls one validator key gains one fraudulent vote. They still need two more legitimate yes-votes from real validators to reach the threshold. One key compromise does not allow unilateral registry changes.

**With threshold-many compromised keys (3 of 5):** An attacker who controls three validator keys can, after the 72-hour on-chain review window, submit a governance transaction that adds or removes any entry. The review window is enforced at consensus and cannot be shortened by the attacker. But after 72 hours, the attacker can make the registry change.

This is the critical failure mode: compromise of a threshold-majority of validator keys allows unauthorized registry modifications after a 72-hour delay. The attacker cannot bypass the delay, but they cannot be stopped from using it either.

**Mitigations for key compromise:** Validators who notice a proposal they did not author should coordinate to object during the review window. The window exists specifically for this. If a registry change is pending that no one authorized, governance participants can use the review period to coordinate a response (key rotation via a counter-proposal, communication with the broader community).

**What key compromise does not allow:** An attacker cannot bypass the review window. An attacker with compromised validator keys cannot change the registry in less than 72 hours. An attacker cannot prevent legitimate governance by holding keys — they can only cast fraudulent votes, not block legitimate ones from reaching threshold.

## Points of centralization

**The validator committee.** The canonical testnet registry uses 5 validators with a 3-of-5 threshold. These are a specific set of keys, controlled by specific people or organizations. The decentralization of this system is bounded by the decentralization of this committee.

**The registry operator.** For private registries, the operator controls the validator set entirely. The on-chain mechanism enforces threshold signing and the review window, but it does not prevent a colluding committee from blacklisting arbitrary addresses.

**Contract deployment.** The governance-lock, blacklist-registry, proposal-anchor, and treasury-lock contracts are deployed at specific outpoints by specific parties. If the deployed binaries differ from the published source, the guarantees described here may not hold for the deployed versions.

## Auditability

The following are verifiable from CKB chain state:

- The current BLKL payload and all its entries
- The validator Merkle root and threshold
- Every governance transaction that has ever updated the registry, with the GOV1 binding and all vote signatures
- The proposal cell that authorized each update, with its creation block time
- The treasury pool balance and all inflows/outflows
- The code hash of every contract cell referenced in the system

The following require off-chain information:

- Mapping validator pubkeys to real-world identities
- Verifying that deployed contract binaries match the published source code
- The reasoning behind specific blacklist entries (stored as an evidence hash, not the evidence itself)

## See also

- [Security model](/concepts/security-model/) — the boundary in operational terms
- [Before you adopt the firewall lock](/concepts/before-you-adopt/) — irreversible consequences before committing
- [Governance design](/concepts/governance-design/) — why the review window and Merkle tree are at consensus
- [Proposal anchor contract](/reference/proposal-anchor/) — the on-chain enforcement mechanism for treasury spending
