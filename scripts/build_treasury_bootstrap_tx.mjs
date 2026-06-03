#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  bytesToHex,
  encodeGovernanceHeader,
  encodeRegistryPayload,
  hexToBytes,
  scriptToMoleculeBytes,
} from "../sdk/cli/dist/lib/blkl.js";
import { TESTNET_GOVERNANCE_PUBKEYS } from "../sdk/cli/dist/lib/defaults.js";
import { computeMerkleRoot } from "../sdk/cli/dist/lib/validator-set.js";
import { buildGov1WitnessV4, buildWitnessArgs, ckbBlake2b } from "../sdk/cli/dist/lib/witness.js";

const RPC_URL = process.env.CKB_RPC_URL ?? "https://testnet.ckb.dev";
const OUT = process.argv[2] ?? "deploy/treasury-bootstrap-20260531.json";
const META_OUT = `${OUT}.metadata.json`;

const SECP_DEP_GROUP = {
  txHash: "0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37",
  index: 0,
};
const SECP_LOCK = {
  code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
  hash_type: "type",
  args: "0x9888a8a74df4e0ce82e7a4604f8fd403fd4622ca",
};
const CHANGE_LOCK = {
  code_hash: SECP_LOCK.code_hash,
  hash_type: SECP_LOCK.hash_type,
  args: process.env.CHANGE_LOCK_ARGS ?? SECP_LOCK.args,
};
const GOVERNANCE_LOCK = {
  code_hash: "0x95d5e88dabf32ef59bc292d1f925df2f17948f7845daa4e52f34b81fb2711c40",
  hash_type: "type",
  args: "0x01",
};

const REGISTRY_CAPACITY = 50_000_000_000n;
const TREASURY_SEED_CAPACITY = 100_000_000_000n;
const FEE = 100_000n;

function hex(value) {
  return `0x${value.toString(16)}`;
}

function strip0x(s) {
  return s.startsWith("0x") ? s.slice(2) : s;
}

function u32Le(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, Number(value), true);
  return out;
}

function u64Le(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function normalizeIndex(index) {
  return typeof index === "number" ? hex(BigInt(index)) : index;
}

function typeIdFromFirstInput(input, outputIndex) {
  const raw = concat(
    hexToBytes(input.out_point.tx_hash),
    u32Le(BigInt(input.out_point.index)),
    u64Le(BigInt(outputIndex)),
  );
  return ckbBlake2b(raw);
}

async function selectFundingCells() {
  const result = await rpc("get_cells", [
    {
      script: SECP_LOCK,
      script_type: "lock",
      script_search_mode: "exact",
      filter: {
        output_data_len_range: ["0x0", "0x1"],
        script_len_range: ["0x0", "0x1"],
      },
      with_data: false,
    },
    "desc",
    "0x20",
  ]);
  const cells = result.objects ?? [];
  const need = REGISTRY_CAPACITY + TREASURY_SEED_CAPACITY + FEE;
  const allCandidates = cells
    .filter((cell) => cell.output.type == null)
    .map((cell) => ({
      ...cell,
      capacity: BigInt(cell.output.capacity),
    }))
    .sort((a, b) => (a.capacity > b.capacity ? -1 : a.capacity < b.capacity ? 1 : 0));
  const candidates = allCandidates.filter((cell) => cell.capacity > need + 6_100_000_000n);
  if (candidates.length === 0) {
    throw new Error(`No plain secp funding cell found with at least ${need} shannons plus change.`);
  }
  if (process.env.SWEEP_FUNDING === "1") {
    const selected = allCandidates;
    const total = selected.reduce((sum, cell) => sum + cell.capacity, 0n);
    if (total > need + 6_100_000_000n) return selected;
    throw new Error(`Funding sweep found only ${total} shannons, need ${need} plus change.`);
  }
  return [candidates[0]];
}

async function main() {
  const deployInfo = JSON.parse(await readFile("deploy/treasury-registry-20260531.info.json", "utf8"));
  const registryRecipe = deployInfo.new_recipe.cell_recipes.find((c) => c.name === "blacklist_registry");
  if (!registryRecipe) throw new Error("blacklist_registry recipe not found in deploy info");

  const funding = await selectFundingCells();
  const inputCapacity = funding.reduce((sum, cell) => sum + cell.capacity, 0n);
  const typeIdValue = typeIdFromFirstInput(funding[0], 0);
  const validatorRoot = hexToBytes(
    computeMerkleRoot(TESTNET_GOVERNANCE_PUBKEYS.map((pk) => bytesToHex(pk))),
  );
  const governanceHeader = encodeGovernanceHeader({
    signerCount: TESTNET_GOVERNANCE_PUBKEYS.length,
    threshold: 3,
    pubkeys: TESTNET_GOVERNANCE_PUBKEYS,
    validatorCount: TESTNET_GOVERNANCE_PUBKEYS.length,
    validatorMerkleRoot: validatorRoot,
    treasuryLockScript: SECP_LOCK,
  });
  const registryData = encodeRegistryPayload({ version: 2, entries: [] }, governanceHeader);
  const registryRoot = ckbBlake2b(registryData);
  const proposalIdHash = ckbBlake2b(new TextEncoder().encode("ckb-firewall:testnet-treasury-bootstrap:2026-05-31"));
  const voteDigestHash = ckbBlake2b(new TextEncoder().encode("ckb-firewall:testnet-treasury-bootstrap:votes:2026-05-31"));
  const proposalDataHash = ckbBlake2b(new TextEncoder().encode("ckb-firewall:testnet-treasury-bootstrap:proposal-data"));
  const gov1 = buildGov1WitnessV4({
    proposalIdHash,
    voteDigestHash,
    oldRoot: new Uint8Array(32),
    newRoot: registryRoot,
    proposalDataHash,
    reviewDelayMs: 259_200_000n,
  });
  const emptyLock = new Uint8Array(65);
  const witness = buildWitnessArgs({ lock: emptyLock, inputType: gov1 });
  const change = inputCapacity - REGISTRY_CAPACITY - TREASURY_SEED_CAPACITY - FEE;
  const registryTypeArgs = bytesToHex(concat(
    new Uint8Array([0x02]),
    hexToBytes(GOVERNANCE_LOCK.code_hash),
    new Uint8Array([0x01]),
    typeIdValue,
  ));

  const tx = {
    version: "0x0",
    cell_deps: [
      {
        out_point: { tx_hash: SECP_DEP_GROUP.txHash, index: hex(BigInt(SECP_DEP_GROUP.index)) },
        dep_type: "dep_group",
      },
      {
        out_point: { tx_hash: registryRecipe.tx_hash, index: hex(BigInt(registryRecipe.index)) },
        dep_type: "code",
      },
    ],
    header_deps: [],
    inputs: funding.map((cell) => ({
        since: "0x0",
        previous_output: {
          tx_hash: cell.out_point.tx_hash,
          index: normalizeIndex(cell.out_point.index),
        },
      })),
    outputs: [
      {
        capacity: hex(REGISTRY_CAPACITY),
        lock: GOVERNANCE_LOCK,
        type: {
          code_hash: registryRecipe.type_id,
          hash_type: "type",
          args: registryTypeArgs,
        },
      },
      {
        capacity: hex(TREASURY_SEED_CAPACITY),
        lock: SECP_LOCK,
        type: null,
      },
      {
        capacity: hex(change),
        lock: CHANGE_LOCK,
        type: null,
      },
    ],
    outputs_data: [bytesToHex(registryData), "0x", "0x"],
    witnesses: [bytesToHex(witness), ...funding.slice(1).map(() => "0x")],
  };

  const metadata = {
    rpcUrl: RPC_URL,
    fundingInputs: funding.map((cell) => ({
      txHash: cell.out_point.tx_hash,
      index: normalizeIndex(cell.out_point.index),
      capacity: hex(cell.capacity),
    })),
    registryCell: {
      outputIndex: 0,
      capacity: hex(REGISTRY_CAPACITY),
      codeHash: registryRecipe.type_id,
      typeIdValue: bytesToHex(typeIdValue),
      typeArgs: registryTypeArgs,
      dataHash: bytesToHex(registryRoot),
      dataSize: registryData.length,
    },
    treasury: {
      outputIndex: 1,
      seedCapacity: hex(TREASURY_SEED_CAPACITY),
      lock: SECP_LOCK,
      lockHash: bytesToHex(ckbBlake2b(scriptToMoleculeBytes(SECP_LOCK))),
    },
    change: {
      outputIndex: 2,
      capacity: hex(change),
      lock: CHANGE_LOCK,
    },
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({ transaction: tx, multisig_configs: {}, signatures: {} }, null, 2)}\n`);
  await writeFile(META_OUT, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`wrote ${OUT}`);
  console.log(`wrote ${META_OUT}`);
  console.log(JSON.stringify(metadata, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
