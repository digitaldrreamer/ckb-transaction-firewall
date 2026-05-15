---
title: GOV1 Witness
description: Governance witness layout used to bind registry updates to proposal and vote context.
---

`GOV1` is the governance witness payload used when preparing registry update transactions.

## The code path

The CLI builds this witness from the proposal hash, vote hash, old registry root, new registry root, and the signer list:

```ts
const gov1 = buildGov1Witness({
  proposalIdHash,
  voteDigestHash,
  oldRoot,
  newRoot,
  signers: [
    { index: 0, sig: signature0 },
    { index: 1, sig: signature1 },
    { index: 2, sig: signature2 },
  ],
});

const witnessArgs = buildWitnessArgs({
  lock: new Uint8Array(65),
  inputType: gov1,
});
```

That is the shape to follow if you are building your own governance tooling.

## Layout

- `magic` - 4 bytes, ASCII `GOV1`
- `version` - 1 byte, currently `0x01`
- `proposal_id_hash` - 32 bytes
- `vote_digest_hash` - 32 bytes
- `old_root` - 32 bytes, hash of the input registry data
- `new_root` - 32 bytes, hash of the output registry data
- `signer_count` - 1 byte
- `signers` - repeated signer entries

Each signer entry is:

- `signer_index` - 1 byte
- `signature` - 65 bytes

## Practical use

The CLI and test fixtures build this witness when they prepare governance transactions. The witness binds the update to a specific proposal, vote digest, and registry transition.

## On-chain validation scope

The registry type script validates witness structure, signer count, signer index constraints, and registry roots. It does not enforce guarantees beyond that validation.
