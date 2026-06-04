---
title: The Autonomous Treasury Model
description: Why the governance system uses an autonomous treasury instead of a funded signer, how the keyless spend works, and what the v3 governance header adds.
---

Governance operations have on-chain costs. Creating a proposal anchor cell requires CKB for capacity. Adding entries to the registry may require additional cell capacity if the BLKL payload grows. Transaction fees must be paid.

The naive design is to designate a funded account held by a governance committee member who pays for these operations. The treasury model replaces that with an autonomous on-chain contract.

## Why not a funded signer

A funded signer creates operational friction and centralization risks:

**Key management.** The signer key must be kept available for governance operations, funded, and protected. If the key holder is unavailable, governance stalls. If the key is compromised, treasury funds are at risk.

**Permission asymmetry.** Validators who vote on proposals should not need to also manage a funded account to complete the governance lifecycle. The authority to vote should be separate from the authority to pay.

**Opacity.** Funds held in a private account are not auditable from chain state alone. Donations require knowing who to send to.

**Single point of failure.** If the signer key is lost or the account runs dry without notice, governance operations fail silently.

## How the treasury-lock works

The treasury-lock is a CKB contract deployed as a plain data cell. Its address is derived from the contract binary's code hash, hash type (`data1`), and a 64-byte args field that encodes two Type IDs:

```
args = governance_lock_type_id(32) | proposal_anchor_type_id(32)
```

CKB funds sent to this address accumulate as treasury pool cells. These cells can only be spent in ways the contract permits:

1. **Creating a typed proposal-anchor cell** — a cell whose data is a valid `PBLK` payload and whose type script is the `proposal-anchor` contract. The treasury-lock validates that the spend creates exactly this structure.

2. **Covering registry capacity growth** — when a governance update grows the BLKL payload, the output registry cell may need more capacity than the input had. The treasury-lock permits consuming treasury cells to cover the difference.

3. **Receiving returned anchor capacity** — when an execute or reclaim transaction consumes a proposal anchor, the remaining capacity must return to the treasury lock. The treasury-lock validates this return.

No private key is needed for any of these operations. The treasury-lock contract itself is the authorization mechanism — if the transaction structure matches what the contract permits, the spend is valid.

## The v3 governance header

Version 1 of the governance header embeds the validator Merkle root and threshold but says nothing about the treasury. Finding the treasury lock for a given registry requires knowing the treasury-lock address out-of-band.

Version 2 added a `treasury_lock_hash` — a blake2b hash of the treasury lock script. This lets clients verify that a given lock script is the correct treasury lock, but they still need the script itself to derive the address.

Version 3 added the full treasury lock script (`treasury_lock_script_len` + `treasury_lock_script` as Molecule `Script` bytes) directly in the governance header. A client that can read the registry cell can now:
- Derive the treasury address directly from chain state
- Enumerate live treasury cells using the indexer's `get_cells` with the treasury lock
- Display the current pool balance
- Show the donation address without any out-of-band configuration

The canonical testnet registry uses a v3 governance header. The CLI and GUI discover the treasury automatically from it. Private deployments that want self-service treasury discovery should also use v3.

## What the treasury does and does not protect

The treasury is an autonomous pool with constrained spending rules. It does not:

- Protect against vulnerabilities in the treasury-lock contract itself. If the contract has a bug that allows unauthorized spending, treasury funds are at risk.
- Protect against governance-lock upgrades that are malicious or erroneous. A governance update can change the `governance_code_hash` in the registry type args, which could alter what the treasury-lock accepts.
- Prevent treasury depletion. If governance operations consume funds faster than donations arrive, the pool runs dry and governance stalls.

The treasury-lock args are fixed at deploy time. If the governance-lock or proposal-anchor contracts are redeployed, the treasury-lock args must be updated — which means redeploying the treasury-lock with new args and migrating the pool. This is a significant operational event and should be planned carefully when upgrading contracts.

## Donating to the treasury

The treasury address for the canonical testnet registry is shown by `ckb-firewall inspect` and in the GUI pool banner. Any CKB holder can send to it. Donations increase the pool available for future governance operations.

When pool usage reaches 70% (`occupied capacity / total capacity`), the CLI and GUI warn and display the donation address prominently.

See [How to donate to the registry treasury](/how-to/donate-treasury/) for the transfer commands.

## See also

- [How to deploy the treasury](/how-to/deploy-treasury/) — deploy the treasury-lock binary and seed the pool
- [How to donate to the treasury](/how-to/donate-treasury/) — top up the pool
- [Proposal anchor contract](/reference/proposal-anchor/) — what the treasury-lock permits spending for
- [Registry operator tutorial, step 3](/get-started/operator/3-deploy-treasury/) — hands-on treasury setup
