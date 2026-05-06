import { describe, expect, test } from "vitest";
import { parseRegistryPayload, resolveRegistryDep } from "../src/blacklist.js";
import { TransactionFirewall } from "../src/firewall.js";
import type { CellDepLike, ScriptLike } from "../src/types.js";

function registryHex(ids: number[][]): string {
  const bytes: number[] = [];
  bytes.push(0x42, 0x4c, 0x4b, 0x4c); // BLKL
  bytes.push(0x01); // version
  const count = ids.length;
  bytes.push(count & 0xff, (count >> 8) & 0xff, (count >> 16) & 0xff, (count >> 24) & 0xff);
  for (const id of ids) {
    bytes.push(id.length);
    bytes.push(...id);
    bytes.push(0, 0, 0, 0, 0, 0, 0, 0); // expires_at
  }
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function script(tag: string): ScriptLike {
  return {
    codeHash: `0x${tag.repeat(64)}`,
    hashType: "type",
    args: "0x01",
  };
}

describe("blacklist parser", () => {
  test("parses BLKL payload", () => {
    const parsed = parseRegistryPayload(registryHex([[0xaa, 0xbb]]));
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].identifier).toBe("0xaabb");
  });

  test("rejects unsorted entries", () => {
    const hex = registryHex([
      [0xbb],
      [0xaa],
    ]);
    expect(() => parseRegistryPayload(hex)).toThrowError("RegistryNotSorted");
  });
});

describe("registry dep resolution", () => {
  test("errors on missing dep", () => {
    expect(() => resolveRegistryDep([], script("1"))).toThrowError("MissingRegistryCellDep");
  });

  test("errors on ambiguous deps", () => {
    const dep: CellDepLike = { type: script("1"), data: registryHex([[0x01]]) };
    expect(() => resolveRegistryDep([dep, dep], script("1"))).toThrowError(
      "AmbiguousRegistryCellDep",
    );
  });
});

describe("transaction firewall", () => {
  test("rejects blacklisted output lock args", () => {
    const fw = new TransactionFirewall({ registryScript: script("1") });
    const res = fw.checkTransaction({
      cellDeps: [{ type: script("1"), data: registryHex([[0xaa, 0xbb]]) }],
      outputs: [{ lockArgs: "0xaabb" }],
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(11);
  });

  test("passes non-blacklisted outputs", () => {
    const fw = new TransactionFirewall({ registryScript: script("1") });
    const res = fw.checkTransaction({
      cellDeps: [{ type: script("1"), data: registryHex([[0xaa, 0xbb]]) }],
      outputs: [{ lockArgs: "0x1122", typeArgs: "0x3344" }],
    });
    expect(res).toEqual({ ok: true });
  });
});
