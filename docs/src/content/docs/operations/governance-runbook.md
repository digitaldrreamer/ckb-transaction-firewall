---
title: Governance Runbook
description: Step-by-step guide for coordinating a blacklist update across multiple governance participants.
---

This page walks through a complete blacklist addition from first evidence to on-chain commit. Each step maps to a CLI command.

## Prerequisites

- All participants have `@ckb-firewall/cli` installed
- Validators know their private key (stored securely, never in plaintext on disk)
- Signers know their signer index (0–4) and private key
- At least one participant has access to the CKB testnet node (defaults point to `https://testnet.ckb.dev`)

---

## 1. Create the proposal

The proposer runs `propose` with the full context:

```bash
ckb-firewall propose \
  --action add \
  --lock-args 0xdeadbeef... \
  --evidence "https://testnet.explorer.nervos.org/transaction/0x..." \
  --classification theft \
  --severity high \
  --rationale "Address drained $2M from DeFi protocol on 2026-05-15. Linked to known exploit kit." \
  --proposer alice
```

The CLI prints the proposal ID (e.g. `abc123def456`) and a 72-hour countdown. No registry update has happened yet.

---

## 2. Anchor the proposal cell

Create the on-chain `PBLK` proposal cell:

```bash
ckb-firewall anchor --proposal abc123def456 --to-address <proposal-cell-owner-address>
```

To submit it directly with `ckb-cli`:

```bash
ckb-firewall anchor \
  --proposal abc123def456 \
  --to-address <proposal-cell-owner-address> \
  --from-account <funding-address> \
  --submit
```

If you used `--submit`, the CLI stores the resulting proposal-cell outpoint on the proposal JSON. If you created the cell with the printed `ckb-cli` command, record the accepted outpoint once:

```bash
ckb-firewall anchor --proposal abc123def456 --proposal-tx <anchor-tx-hash> --proposal-index <data-output-index>
```

---

## 3. Export and distribute

```bash
ckb-firewall export --proposal abc123def456 --out proposal-abc123.json
```

Send `proposal-abc123.json` to all governance participants. IPFS or a shared encrypted drive works well for an auditable trail.

---

## 4. Each participant imports

```bash
ckb-firewall import proposal-abc123.json
```

This validates the `proposalIdHash` integrity before saving. Re-running `import` after additional votes are collected merges rather than overwrites.

---

## 5. Validators vote

Each validator runs:

```bash
ckb-firewall vote --proposal abc123def456 --vote yes
# prompts for private key
```

The vote is signed with the validator's secp256k1 key and stored locally. After voting, the validator exports their updated proposal file and shares it back with the group so signers can see the accumulated votes.

```bash
ckb-firewall export --proposal abc123def456 --out proposal-abc123-voted.json
```

Other participants import this updated file to merge the votes:

```bash
ckb-firewall import proposal-abc123-voted.json
```

---

## 6. Check status

```bash
ckb-firewall proposals
```

Look for the proposal to reach `approved` status (3+ yes votes and review window passed).

---

## 7. Execute

After the review window passes and the validator vote threshold is met, any participant can build the execution transaction:

```bash
ckb-firewall execute \
  --proposal abc123def456 \
  --tx-out ./registry_update.json
```

This builds the transaction. To also submit it:

```bash
ckb-firewall execute \
  --proposal abc123def456 \
  --tx-out ./registry_update.json \
  --sign \
  --from-account <governance-address>
```

Or submit manually:

```bash
ckb-cli tx sign-inputs --tx-file registry_update.json --from-account <address> --add-signatures
ckb-cli wallet apply-txs --tx-file registry_update.json
```

---

## Verification

After the transaction lands:

```bash
ckb-firewall inspect
ckb-firewall check --lock-args 0xdeadbeef...
```

The entry should appear in the registry and `check` should print that it is blacklisted.

---

## Notes

- The 72-hour review window is enforced **on-chain** via the `since` field on the anchored `PBLK` proposal input. The transaction is invalid at consensus level until that input has aged by the required relative median-time-past delay — this cannot be bypassed by building the transaction manually.
- The minimum full timeline is approximately 120 hours. Set `--expires-at` accordingly for temporary entries.
- If a participant's local proposal file is out of sync, re-import the latest shared version to merge.
