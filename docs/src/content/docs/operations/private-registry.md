---
title: Private and Multi-Registry Deployments
description: Running your own blacklist registry, deploying its treasury, combining it with the community registry, and understanding the operational model.
---

The firewall lock supports multiple registries in a single lock script. You can point a wallet cell at the community registry, your own private registry, or both simultaneously.

## Why run a private registry

The community registry is governed by the community governance committee. Every adopter of that registry shares the same blacklist — if the committee blacklists an address, all users of that registry cannot send to it.

A private registry gives you:
- Your own blacklist criteria and validator committee
- Independent update timing and threshold policy
- No exposure to other adopters' governance decisions

## Multi-registry: community and private together

The firewall lock can consult multiple registries in a single spend. The effective blacklist is the **union** of all active entries across all registries.

```ts
import { buildFirewallLockScript } from "@ckb-firewall/sdk";

const lock = buildFirewallLockScript({
  firewallCodeHash: "0x8192c9df809976ae9b093dd0d6b072a96101be8cffe61a7e9ac87c04e1f4dc54",
  firewallHashType: "type",
  flags: 0x03,
  registries: [
    // Community registry
    {
      codeHash:    "0x493f1700508125b0e281b8fb1d168b03bd5ef71480399dd59221224901a9cd09",
      hashType:    "type",
      typeIdValue: "0x9be0ad6e4e5039a64d9725ff037057c16ef59f126e3bdd9841b802f0e0a112fe",
      required:    true,
    },
    // Your private registry
    {
      codeHash:    "0x493f1700508125b0e281b8fb1d168b03bd5ef71480399dd59221224901a9cd09",
      hashType:    "type",
      typeIdValue: "0x<your-type-id-value>",
      required:    true,
    },
  ],
  innerCodeHash: "0x9be62e0423d4278b15c071bb881a4ebf936f7e46b3df0f152de50ae416f54465",
  innerHashType: "type",
  innerArgs: "0x<pubkey-hash>",
});
```

Both registries must be present in every spending transaction's cell deps. An address blocked in either is blocked in both. Setting `required: false` on a registry makes it optional — the firewall checks it if present, skips it if absent.

## Deploying your own registry

A private deployment has five on-chain components:

| Component | Purpose |
|-----------|---------|
| `governance-lock` | Verifies validator ECDSA signatures and enforces the review window |
| `blacklist-registry` | Type script that validates registry payload updates |
| `proposal-anchor` | Locks a proposal cell on-chain for the review period |
| Registry cell | The live BLKL cell holding your blacklist entries and governance header |
| **Treasury-lock pool** | Autonomous CKB pool that funds proposal anchoring and execution — no private key required |

The treasury-lock is not optional. Without it, every anchor and execute operation requires someone to sign a fee-payment transaction with a private key. With it, the entire governance lifecycle after `vote` is permissionless.

### Step 1: Generate your validator committee

Each validator needs a secp256k1 keypair. Choose a threshold (e.g., 3-of-5) and record the compressed public keys (33 bytes each).

Keep private keys offline. Only public keys go on-chain.

### Step 2: Deploy the contracts

Use the deploy script with your funding account:

```bash
./scripts/deploy.sh \
  --network testnet \
  --rpc-url https://testnet.ckb.dev \
  --from-address <your-address>
```

This deploys `firewall-lock`, `blacklist-registry`, `governance-lock`, and `proposal-anchor` code cells and writes their Type IDs to `deploy/info.json`.

If you want to reuse the community contract binaries (same code, different governance), skip redeployment and use the community Type IDs — your registry instance still gets its own Type ID from your bootstrap transaction.

### Step 3: Deploy the treasury-lock

The treasury-lock is an **autonomous on-chain contract** that lets anyone anchor proposals and execute updates without holding a private key. Donations from any CKB holder fill the pool; the contract validates that funds can only be spent by creating a valid proposal-anchor cell or consuming one during execute.

The treasury-lock binary takes 64-byte args encoding your contracts' Type IDs:

```
args = governance_lock_type_id(32) | proposal_anchor_type_id(32)
```

Both values come from `deploy/info.json` after Step 2.

Deploy the binary as a plain data cell:

```bash
ckb-cli wallet transfer \
  --to-address <deployer-address> \
  --capacity 17000 \
  --to-data <treasury-lock-binary-hex> \
  --fee-rate 1000
```

Record the resulting `tx_hash:index` — that is your `TREASURY_LOCK_DEP` outpoint.

Your treasury-lock script address is:
- `code_hash` = CKB blake2b of the deployed binary (not standard blake2b — use `ckbBlake2b`)
- `hash_type` = `data1`
- `args` = `governance_lock_type_id(32) | proposal_anchor_type_id(32)`

### Step 4: Bootstrap the registry cell

The bootstrap transaction creates the first registry cell. The BLKL payload embeds your governance header (v3 format) with your validator Merkle root and the full treasury-lock script so the CLI can discover treasury cells automatically.

After bootstrap, your registry's `type_id_value` is fixed by the first input outpoint and output index. Record it — this is what goes in your firewall lock args.

### Step 5: Seed the treasury pool

Send CKB to your treasury-lock address to fund initial governance operations. Each proposal anchor needs ~300 CKB (returned to the treasury after execute). A seed of 10,000–50,000 CKB is typical.

```bash
# No private key needed to spend this later — the contract handles authorization
ckb-cli wallet transfer \
  --to-address <your-treasury-lock-address> \
  --capacity 10000 \
  --fee-rate 1000
```

Display the treasury address prominently — anyone can top it up at any time.

### Step 6: Configure your firewall lock

```ts
const myRegistrySpec = {
  codeHash:    "<blacklist-registry Type ID>",
  hashType:    "type",
  typeIdValue: "<your registry type_id_value>",
  required:    true,
};
```

### Step 7: Run governance

Override the default registry outpoint with `--registry-tx` and `--registry-index`:

```bash
# Propose and anchor — no key needed, treasury funds it
ckb-firewall propose --lock-args <address> \
  --registry-tx <your-tx> --registry-index 0
ckb-firewall anchor --proposal <id> \
  --registry-tx <your-tx> --registry-index 0

# Validators vote — validator key required here only
ckb-firewall vote --proposal <id> --privkey-path ./validator_1.pem

# Execute — no key needed, treasury funds it
ckb-firewall execute --proposal <id> \
  --registry-tx <your-tx> --registry-index 0
```

## Donating to the treasury

When `ckb-firewall inspect` shows treasury pool usage at 70% or above, top it up. The treasury address is printed by `inspect` and shown in the GUI pool banner.

Any plain CKB transfer to that address works:

```bash
ckb-cli wallet transfer \
  --to-address <treasury-address-from-inspect> \
  --capacity <amount-in-ckb> \
  --fee-rate 1000
```

## Operational considerations

**Address migration.** Adopting the firewall lock changes your lock script and therefore your CKB address. Existing UTXOs must be migrated to the new address before the old ones become unspendable under the new lock.

**Lock args are immutable.** Changing which registry you point to requires migrating all wallet cells to a new lock script. There is no in-place reconfiguration.

**Treasury-lock args are fixed at deploy time.** The args encode the governance-lock and proposal-anchor Type IDs. If you redeploy those contracts, you must redeploy and reseed the treasury-lock with updated args. Plan contract upgrades carefully to avoid stranding treasury funds.

**Only one governance update in-flight at a time.** The registry is a single cell. Two simultaneous governance transactions will race and one will fail.

**Registry update timing.** Transactions holding the old registry cell as a dep will fail if submitted after the registry updates. Coordinate updates at low-traffic periods.
