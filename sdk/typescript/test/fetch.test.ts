import { afterEach, describe, expect, test } from "vitest";
import { findRegistryCell } from "../src/fetch.js";
import type { RegistrySpecLike } from "../src/types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// 66-byte v2 type args: version(0x02) + gov_code_hash(32 bytes) + gov_hash_type(0x01) + type_id_value(32 bytes)
// hex layout: "02" + "00"*32 + "01" + typeIdValue(64 hex chars) = 132 chars total
function makeTypeArgs(typeIdValue: string): string {
  const tid = typeIdValue.replace(/^0x/, "").padStart(64, "0");
  return `0x02${"00".repeat(32)}01${tid}`;
}

const SPEC: RegistrySpecLike = {
  codeHash: "0xbbfbcf51b88c57c9c1d6414de4a7e4f9dae133625dfab71588c8bc5d05b71096",
  hashType: "type",
  typeIdValue: "0xcd5d844661356e465c27b7d693e84f20e884da63153d2f6f40381ceb0807761c",
  required: true,
};

function mockFetch(body: unknown, status = 200): void {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

describe("findRegistryCell", () => {
  test("returns outpoint of matching cell", async () => {
    const typeArgs = makeTypeArgs(SPEC.typeIdValue);
    mockFetch({
      result: {
        objects: [
          {
            out_point: { tx_hash: "0xabc123", index: "0x0" },
            output: { type: { code_hash: SPEC.codeHash, hash_type: "type", args: typeArgs } },
          },
        ],
      },
    });

    const result = await findRegistryCell("https://testnet.ckb.dev", SPEC);
    expect(result).toEqual({ txHash: "0xabc123", index: 0 });
  });

  test("skips cells whose typeIdValue does not match", async () => {
    const wrongTypeArgs = makeTypeArgs("0x" + "ff".repeat(32));
    const correctTypeArgs = makeTypeArgs(SPEC.typeIdValue);
    mockFetch({
      result: {
        objects: [
          {
            out_point: { tx_hash: "0xwrong", index: "0x0" },
            output: { type: { code_hash: SPEC.codeHash, hash_type: "type", args: wrongTypeArgs } },
          },
          {
            out_point: { tx_hash: "0xcorrect", index: "0x1" },
            output: { type: { code_hash: SPEC.codeHash, hash_type: "type", args: correctTypeArgs } },
          },
        ],
      },
    });

    const result = await findRegistryCell("https://testnet.ckb.dev", SPEC);
    expect(result).toEqual({ txHash: "0xcorrect", index: 1 });
  });

  test("parses hex index correctly", async () => {
    const typeArgs = makeTypeArgs(SPEC.typeIdValue);
    mockFetch({
      result: {
        objects: [
          {
            out_point: { tx_hash: "0xabc", index: "0x3" },
            output: { type: { code_hash: SPEC.codeHash, hash_type: "type", args: typeArgs } },
          },
        ],
      },
    });

    const result = await findRegistryCell("https://testnet.ckb.dev", SPEC);
    expect(result.index).toBe(3);
  });

  test("throws when no cell matches typeIdValue", async () => {
    mockFetch({
      result: {
        objects: [
          {
            out_point: { tx_hash: "0xnomatch", index: "0x0" },
            output: { type: { code_hash: SPEC.codeHash, hash_type: "type", args: makeTypeArgs("0x" + "ee".repeat(32)) } },
          },
        ],
      },
    });

    await expect(findRegistryCell("https://testnet.ckb.dev", SPEC)).rejects.toThrow(
      /No live registry cell found for typeIdValue/,
    );
  });

  test("throws when result objects is empty", async () => {
    mockFetch({ result: { objects: [] } });

    await expect(findRegistryCell("https://testnet.ckb.dev", SPEC)).rejects.toThrow(
      /No live registry cell found for typeIdValue/,
    );
  });

  test("throws on HTTP error", async () => {
    globalThis.fetch = async () => new Response("bad gateway", { status: 502 });

    await expect(findRegistryCell("https://testnet.ckb.dev", SPEC)).rejects.toThrow(
      /HTTP 502/,
    );
  });

  test("throws on RPC error response", async () => {
    mockFetch({ error: { message: "method not found" } });

    await expect(findRegistryCell("https://testnet.ckb.dev", SPEC)).rejects.toThrow(
      /method not found/,
    );
  });

  test("throws on network failure", async () => {
    globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };

    await expect(findRegistryCell("https://testnet.ckb.dev", SPEC)).rejects.toThrow(
      /CKB RPC unreachable/,
    );
  });

  test("ignores cells with short (non-v2) type args", async () => {
    const shortArgs = "0x02" + "aa".repeat(10); // 22 hex chars, not 132
    const correctTypeArgs = makeTypeArgs(SPEC.typeIdValue);
    mockFetch({
      result: {
        objects: [
          {
            out_point: { tx_hash: "0xshort", index: "0x0" },
            output: { type: { code_hash: SPEC.codeHash, hash_type: "type", args: shortArgs } },
          },
          {
            out_point: { tx_hash: "0xgood", index: "0x0" },
            output: { type: { code_hash: SPEC.codeHash, hash_type: "type", args: correctTypeArgs } },
          },
        ],
      },
    });

    const result = await findRegistryCell("https://testnet.ckb.dev", SPEC);
    expect(result.txHash).toBe("0xgood");
  });
});
