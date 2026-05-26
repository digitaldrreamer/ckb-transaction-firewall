---
title: Private and Multi-Registry Deployments
description: Running your own blacklist registry, combining it with the community registry, and understanding the operational model.
---

The firewall lock supports multiple registries in a single lock script. You can point a wallet cell at the community registry, your own private registry, or both simultaneously.

## Why run a private registry

The community registry is governed by the community governance committee. Every adopter of that registry shares the same blacklist and is subject to the same governance decisions — if the committee blacklists an address, all users of that registry cannot send to it.

A private registry gives you:
- Your own blacklist criteria and governance keys
- Independent update timing and threshold policy
- No exposure to other adopters' governance decisions

## Multi-registry: community and private together

The v2 firewall lock can consult multiple registries in a single spend. The effective blacklist is the **union** of all active entries across all registries.

```ts
import { buildFirewallLockScript } from "@ckb-firewall/sdk";

const lock = buildFirewallLockScript({
  firewallCodeHash: "0x8192c9df809976ae9b093dd0d6b072a96101be8cffe61a7e9ac87c04e1f4dc54",
  firewallHashType: "type",
  flags: 0x03,
  registries: [
    // Community registry — required
    {
      codeHash:    "0x5812b3f0f68ded4d61e8f12117caa011f295dbe88a29c07b86c9caec14bd6c55",
      hashType:    "type",
      typeIdValue: "0xc70a072cdfb7d25a5e92d27a47f9c8a0f30513de683e56e16d55ae30775f3951",
      required:    true,
    },
    // Your private registry — required
    {
      codeHash:    "0x5812b3f0f68ded4d61e8f12117caa011f295dbe88a29c07b86c9caec14bd6c55",
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

Deploying a private registry requires:

1. A governance committee (secp256k1 keypairs, threshold, validator Merkle root)
2. A deployed `governance-lock` and `blacklist-registry` (or reuse the community contracts at different instances)
3. A bootstrapped registry cell with your governance header

### 1. Deploy the contracts

Use the existing deploy script with your own account:

```bash
./scripts/deploy.sh \
  --network testnet \
  --rpc-url https://testnet.ckb.dev \
  --from-address <your-address>
```

This deploys `firewall-lock` and `blacklist-registry` code cells. With `--strict-governance-lock` it also deploys `governance-lock`. The deployment info (Type IDs, tx hashes) is written to `deploy/info.json`.

If you want to reuse the community contract binaries (same code, different governance), you can skip redeployment and use the community Type IDs — but your registry instance will have its own Type ID computed from your bootstrap transaction.

### 2. Bootstrap the registry cell

The bootstrap transaction creates the first registry cell for your deployment. It must:

- Include your governance committee pubkeys and Merkle root in the BLKL governance header
- Set the registry type args with your governance-lock's Type ID and the new registry instance's Type ID
- Carry placeholder governance witnesses (the type script allows bootstrap with no input registry)

After bootstrap, your registry's `type_id_value` is determined by the bootstrap transaction's first input outpoint and the output index. This value is what goes in your firewall lock args.

### 3. Configure your firewall lock

Once you have the `type_id_value` for your registry:

```ts
const myRegistrySpec = {
  codeHash:    "<blacklist-registry type ID>",
  hashType:    "type",
  typeIdValue: "<your registry instance type_id_value>",
  required:    true,
};
```

### 4. Manage updates

Your governance committee runs the full governance flow (`propose` → `vote` → `sign` → `execute`) against your own registry cell. The CLI uses the outpoint from `defaults.ts` by default — override it with `--registry-tx` and `--registry-index` to point at your registry:

```bash
ckb-firewall inspect \
  --registry-tx <your-registry-tx-hash> \
  --registry-index 0

ckb-firewall execute \
  --proposal <id> \
  --registry-tx <your-registry-tx-hash> \
  --registry-index 0
```

## Operational considerations

**Address migration.** Adopting any version of the firewall lock — community or private — changes your lock script and therefore your CKB address. Existing UTXOs must be migrated (spent) to the new address. For a single-cell agent wallet this is one transaction. For a protocol with many UTXOs it is an operational project.

**Lock args are immutable.** If you later decide to change which registry you point to, you must migrate all wallet cells to a new lock script. There is no in-place reconfiguration. Emergency unwrapping (removing the firewall entirely) also requires cell migration.

**Registry update timing.** When your registry updates, any in-flight user transactions holding the old registry cell as a dep will fail. Coordinate updates at low-traffic periods.

**Only one update in-flight at a time.** The registry is a single cell. Two simultaneous governance transactions will race.
