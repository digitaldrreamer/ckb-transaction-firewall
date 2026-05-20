import assert from "node:assert/strict";
import test from "node:test";

import { getLiveCell, findLiveRegistryCell } from "../dist/lib/rpc.js";

const originalFetch = globalThis.fetch;
const originalTimeout = process.env.CKB_FIREWALL_RPC_TIMEOUT_MS;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalTimeout === undefined) {
    delete process.env.CKB_FIREWALL_RPC_TIMEOUT_MS;
  } else {
    process.env.CKB_FIREWALL_RPC_TIMEOUT_MS = originalTimeout;
  }
});

test("getLiveCell rejects non-OK HTTP responses", async () => {
  globalThis.fetch = async () =>
    new Response("not found", {
      status: 503,
      statusText: "Service Unavailable",
    });

  await assert.rejects(
    getLiveCell("https://example.invalid", "0x1234", 0),
    /RPC get_live_cell HTTP 503 Service Unavailable/,
  );
});

test("getLiveCell rejects invalid JSON responses", async () => {
  globalThis.fetch = async () => new Response("not json", { status: 200 });

  await assert.rejects(
    getLiveCell("https://example.invalid", "0x1234", 0),
    /RPC get_live_cell returned invalid JSON/,
  );
});

test("getLiveCell aborts stalled RPC calls", async () => {
  process.env.CKB_FIREWALL_RPC_TIMEOUT_MS = "5";
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });

  await assert.rejects(
    getLiveCell("https://example.invalid", "0x1234", 0),
    /RPC get_live_cell timed out after 5ms/,
  );
});

// ── findLiveRegistryCell ────────────────────────────────────────────────────────

// 66-byte v2 type args: version(0x02) + gov_code_hash(32) + gov_hash_type(0x01) + type_id_value(32)
// hex: "02" + "00"*32 + "01" + tid(64 chars) = 132 chars total
function makeTypeArgs(typeIdValueHex) {
  const tid = typeIdValueHex.replace(/^0x/, "").padStart(64, "0");
  return `0x02${"00".repeat(32)}01${tid}`;
}

const REGISTRY_SPEC = {
  codeHash: "0xbbfbcf51b88c57c9c1d6414de4a7e4f9dae133625dfab71588c8bc5d05b71096",
  hashType: "type",
  typeIdValue: "0xcd5d844661356e465c27b7d693e84f20e884da63153d2f6f40381ceb0807761c",
  required: true,
};

function mockGetCells(objects) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ result: { objects } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

test("findLiveRegistryCell returns outpoint and data for matching cell", async () => {
  const typeArgs = makeTypeArgs(REGISTRY_SPEC.typeIdValue);
  mockGetCells([
    {
      out_point: { tx_hash: "0xdeadbeef", index: "0x0" },
      output_data: "0x424c4b4c",
      output: { type: { code_hash: REGISTRY_SPEC.codeHash, hash_type: "type", args: typeArgs } },
    },
  ]);

  const result = await findLiveRegistryCell("https://testnet.ckb.dev", REGISTRY_SPEC);
  assert.equal(result.txHash, "0xdeadbeef");
  assert.equal(result.index, 0);
  assert.equal(result.data, "0x424c4b4c");
});

test("findLiveRegistryCell skips cells with non-matching typeIdValue", async () => {
  const wrongTypeArgs = makeTypeArgs("0x" + "ff".repeat(32));
  const correctTypeArgs = makeTypeArgs(REGISTRY_SPEC.typeIdValue);
  mockGetCells([
    {
      out_point: { tx_hash: "0xwrong", index: "0x0" },
      output_data: "0x01",
      output: { type: { code_hash: REGISTRY_SPEC.codeHash, hash_type: "type", args: wrongTypeArgs } },
    },
    {
      out_point: { tx_hash: "0xcorrect", index: "0x2" },
      output_data: "0x424c4b4c",
      output: { type: { code_hash: REGISTRY_SPEC.codeHash, hash_type: "type", args: correctTypeArgs } },
    },
  ]);

  const result = await findLiveRegistryCell("https://testnet.ckb.dev", REGISTRY_SPEC);
  assert.equal(result.txHash, "0xcorrect");
  assert.equal(result.index, 2);
});

test("findLiveRegistryCell throws when no cell matches typeIdValue", async () => {
  const wrongTypeArgs = makeTypeArgs("0x" + "aa".repeat(32));
  mockGetCells([
    {
      out_point: { tx_hash: "0xnomatch", index: "0x0" },
      output_data: "0x00",
      output: { type: { code_hash: REGISTRY_SPEC.codeHash, hash_type: "type", args: wrongTypeArgs } },
    },
  ]);

  await assert.rejects(
    findLiveRegistryCell("https://testnet.ckb.dev", REGISTRY_SPEC),
    /No live registry cell found/,
  );
});

test("findLiveRegistryCell throws when result objects is empty", async () => {
  mockGetCells([]);

  await assert.rejects(
    findLiveRegistryCell("https://testnet.ckb.dev", REGISTRY_SPEC),
    /No live registry cell found/,
  );
});

test("findLiveRegistryCell throws on HTTP error", async () => {
  globalThis.fetch = async () =>
    new Response("bad gateway", { status: 502, statusText: "Bad Gateway" });

  await assert.rejects(
    findLiveRegistryCell("https://testnet.ckb.dev", REGISTRY_SPEC),
    /RPC get_cells HTTP 502/,
  );
});

test("findLiveRegistryCell throws on RPC-level error response", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "method not found" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  await assert.rejects(
    findLiveRegistryCell("https://testnet.ckb.dev", REGISTRY_SPEC),
    /method not found/,
  );
});

test("findLiveRegistryCell ignores cells with short (non-v2) type args", async () => {
  const shortArgs = "0x02" + "aa".repeat(10);
  const correctTypeArgs = makeTypeArgs(REGISTRY_SPEC.typeIdValue);
  mockGetCells([
    {
      out_point: { tx_hash: "0xshort", index: "0x0" },
      output_data: "0x00",
      output: { type: { code_hash: REGISTRY_SPEC.codeHash, hash_type: "type", args: shortArgs } },
    },
    {
      out_point: { tx_hash: "0xgood", index: "0x0" },
      output_data: "0x424c4b4c",
      output: { type: { code_hash: REGISTRY_SPEC.codeHash, hash_type: "type", args: correctTypeArgs } },
    },
  ]);

  const result = await findLiveRegistryCell("https://testnet.ckb.dev", REGISTRY_SPEC);
  assert.equal(result.txHash, "0xgood");
});
