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

The CLI prints the proposal ID (e.g. `abc123def456`) and a 72-hour countdown. No on-chain action yet.

---

## 2. Export and distribute

```bash
ckb-firewall export --proposal abc123def456 --out proposal-abc123.json
```

Send `proposal-abc123.json` to all governance participants. IPFS or a shared encrypted drive works well for an auditable trail.

---

## 3. Each participant imports

```bash
ckb-firewall import proposal-abc123.json
```

This validates the `proposalIdHash` integrity before saving. Re-running `import` after additional votes are collected merges rather than overwrites.

---

## 4. Validators vote

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

## 5. Check status

```bash
ckb-firewall proposals
```

Look for the proposal to reach `approved` status (3+ yes votes and review window passed).

---

## 6. Signers sign

After the review window passes and the vote threshold is met:

```bash
ckb-firewall sign --proposal abc123def456 --signer-index 0
# prompts for private key
```

Three signers must sign (indices 0–4, any combination). After signing, each signer exports and shares so others can import the accumulated signatures.

---

## 7. Execute

Any participant with all three signatures runs:

```bash
ckb-firewall execute --proposal abc123def456 --tx-out ./registry_update.json
```

This builds the transaction. To also submit it:

```bash
ckb-firewall execute --proposal abc123def456 --tx-out ./registry_update.json --sign \
  --from-account <governance-address>
```

Or submit manually:

```bash
ckb-cli wallet sign-txs --tx-file registry_update.json --from-account <address>
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

- The 72-hour review window is enforced by the CLI at execute time. `execute` will refuse to proceed until it passes.
- The minimum full timeline is approximately 120 hours. Set `--expires-at` accordingly for temporary entries.
- If a participant's local proposal file is out of sync, re-import the latest shared version to merge.
