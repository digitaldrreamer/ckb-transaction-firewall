import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseRegistryPayload, resolveRegistryDeps } from "../src/blacklist.js";
import { TransactionFirewall } from "../src/firewall.js";
import { FIREWALL_ERROR_CODES } from "../src/types.js";
import type { CellDepLike, RegistrySpecLike } from "../src/types.js";

interface TestnetRegistryFixture {
  registrySpec: RegistrySpecLike;
  canonicalRegistryCell: {
    typeArgs: string;
    data: string;
  };
}

// Minimal v2 governance header: 1 signer, threshold 1, zero validator set.
// 1 (gh_ver) + 1 (signer_count) + 1 (threshold) + 33 (pubkey) + 2 (validator_count) + 32 (merkle_root) = 70 bytes
const MINIMAL_GOV_HEADER = [
  0x01, // gh_version
  0x01, // signer_count = 1
  0x01, // threshold = 1
  // pubkey (33 bytes, testnet signer 0)
  0x03, 0x1b, 0x84, 0xc5, 0x56, 0x7b, 0x12, 0x64, 0x40, 0x99, 0x5d, 0x3e, 0xd5, 0xaa, 0xba, 0x05,
  0x65, 0xd7, 0x1e, 0x18, 0x34, 0x60, 0x48, 0x19, 0xff, 0x9c, 0x17, 0xf5, 0xe9, 0xd5, 0xdd, 0x07, 0x8f,
  0x00, 0x00, // validator_count = 0
  ...new Array(32).fill(0), // validator_merkle_root
];

function registryHex(ids: number[][]): string {
  const bytes: number[] = [];
  bytes.push(0x42, 0x4c, 0x4b, 0x4c); // BLKL
  bytes.push(0x02); // version 2
  // gov_header_len as LE u16
  const ghLen = MINIMAL_GOV_HEADER.length;
  bytes.push(ghLen & 0xff, (ghLen >> 8) & 0xff);
  bytes.push(...MINIMAL_GOV_HEADER);
  const count = ids.length;
  bytes.push(count & 0xff, (count >> 8) & 0xff, (count >> 16) & 0xff, (count >> 24) & 0xff);
  for (const id of ids) {
    if (id.length >= 256) {
      throw new Error("test helper supports id length < 256");
    }
    bytes.push(id.length);
    bytes.push(...id);
    bytes.push(0, 0, 0, 0, 0, 0, 0, 0); // expires_at
  }
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Build a RegistrySpecLike and a matching CellDepLike with proper 66-byte v2 type args.
 * `tag` is a 1-char hex digit used to fill code_hash and type_id_value.
 */
function makeSpecAndDep(tag: string, data: string): [RegistrySpecLike, CellDepLike] {
  const typeIdValue = `0x${tag.repeat(64)}`; // 32 bytes
  const spec: RegistrySpecLike = {
    codeHash: `0x${tag.repeat(64)}`,
    hashType: "type",
    typeIdValue,
    required: true,
  };
  // 66-byte v2 type args: version(1=0x02) + gov_code_hash(32=0x00) + gov_hash_type(1=0x00) + type_id_value(32)
  const typeArgs = `0x02${"00".repeat(33)}${tag.repeat(64)}`;
  const dep: CellDepLike = {
    type: { codeHash: spec.codeHash, hashType: "type", args: typeArgs },
    data,
  };
  return [spec, dep];
}

describe("blacklist parser", () => {
  test("parses BLKL v2 payload", () => {
    const parsed = parseRegistryPayload(registryHex([[0xaa, 0xbb]]));
    expect(parsed.version).toBe(2);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries).toEqual([expect.objectContaining({ identifier: "0xaabb" })]);
  });

  test("rejects v1 payload", () => {
    expect(() => parseRegistryPayload("0x424c4b4c010000000g")).toThrowError(
      "InvalidRegistryData",
    );
  });

  test("rejects truncated payload", () => {
    expect(() => parseRegistryPayload("0x424c4b4c0200000080")).toThrowError(
      "InvalidRegistryData",
    );
  });

  test("rejects duplicate entries", () => {
    expect(() => parseRegistryPayload(registryHex([[0xaa], [0xaa]]))).toThrowError(
      "RegistryNotSorted",
    );
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
    const [spec] = makeSpecAndDep("1", registryHex([[0x01]]));
    expect(() => resolveRegistryDeps([], [spec])).toThrowError("MissingRegistryCellDep");
  });

  test("errors on ambiguous deps", () => {
    const [spec, dep] = makeSpecAndDep("1", registryHex([[0x01]]));
    expect(() => resolveRegistryDeps([dep, dep], [spec])).toThrowError(
      "AmbiguousRegistryCellDep",
    );
  });

  test("resolves single registry", () => {
    const [spec, dep] = makeSpecAndDep("1", registryHex([[0x01]]));
    const result = resolveRegistryDeps([dep], [spec]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(dep);
  });

  test("resolves multiple registries from same dep list", () => {
    const [spec1, dep1] = makeSpecAndDep("1", registryHex([[0x11]]));
    const [spec2, dep2] = makeSpecAndDep("2", registryHex([[0x22]]));
    const result = resolveRegistryDeps([dep1, dep2], [spec1, spec2]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(dep1);
    expect(result[1]).toBe(dep2);
  });

  test("skips optional missing registry", () => {
    const [spec1, dep1] = makeSpecAndDep("1", registryHex([[0x11]]));
    const [spec2] = makeSpecAndDep("2", registryHex([[0x22]]));
    const optSpec2 = { ...spec2, required: false };
    const result = resolveRegistryDeps([dep1], [spec1, optSpec2]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(dep1);
  });

  test("does not match cell dep with short (non-v2) type args", () => {
    const [spec] = makeSpecAndDep("1", registryHex([[0x01]]));
    // Cell dep with short args (not 66-byte v2 format)
    const shortArgsDep: CellDepLike = {
      type: { codeHash: spec.codeHash, hashType: "type", args: "0x01" },
      data: registryHex([[0x01]]),
    };
    expect(() => resolveRegistryDeps([shortArgsDep], [spec])).toThrowError(
      "MissingRegistryCellDep",
    );
  });
});

describe("transaction firewall", () => {
  test("rejects blacklisted output lock args", () => {
    const [spec, dep] = makeSpecAndDep("1", registryHex([[0xaa, 0xbb]]));
    const fw = new TransactionFirewall({ registries: [spec] });
    const res = fw.checkTransaction({
      cellDeps: [dep],
      outputs: [{ lockArgs: "0xaabb" }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(FIREWALL_ERROR_CODES.BlacklistedLockArgs);
    }
  });

  test("passes non-blacklisted outputs", () => {
    const [spec, dep] = makeSpecAndDep("1", registryHex([[0xaa, 0xbb]]));
    const fw = new TransactionFirewall({ registries: [spec] });
    const res = fw.checkTransaction({
      cellDeps: [dep],
      outputs: [{ lockArgs: "0x1122", typeArgs: "0x3344" }],
    });
    expect(res).toEqual({ ok: true });
  });

  test("maps missing dep to code 8", () => {
    const [spec] = makeSpecAndDep("1", registryHex([[0x11]]));
    const fw = new TransactionFirewall({ registries: [spec] });
    const res = fw.checkTransaction({
      cellDeps: [],
      outputs: [{ lockArgs: "0x1122" }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(FIREWALL_ERROR_CODES.MissingRegistryCellDep);
    }
  });

  test("maps ambiguous deps to code 17", () => {
    const [spec, dep] = makeSpecAndDep("1", registryHex([[0x01]]));
    const fw = new TransactionFirewall({ registries: [spec] });
    const res = fw.checkTransaction({
      cellDeps: [dep, dep],
      outputs: [{ lockArgs: "0x1122" }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(FIREWALL_ERROR_CODES.AmbiguousRegistryCellDep);
    }
  });

  test("rejects blacklisted output type args with code 12", () => {
    const [spec, dep] = makeSpecAndDep("1", registryHex([[0x55, 0x66]]));
    const fw = new TransactionFirewall({ registries: [spec] });
    const res = fw.checkTransaction({
      cellDeps: [dep],
      outputs: [{ lockArgs: "0x1122", typeArgs: "0x5566" }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(FIREWALL_ERROR_CODES.BlacklistedTypeArgs);
    }
  });

  test("checks union of entries across multiple registries", () => {
    const [spec1, dep1] = makeSpecAndDep("1", registryHex([[0xaa, 0xbb]]));
    const [spec2, dep2] = makeSpecAndDep("2", registryHex([[0xcc, 0xdd]]));
    const fw = new TransactionFirewall({ registries: [spec1, spec2] });
    expect(
      fw.checkTransaction({ cellDeps: [dep1, dep2], outputs: [{ lockArgs: "0xaabb" }] }).ok,
    ).toBe(false);
    expect(
      fw.checkTransaction({ cellDeps: [dep1, dep2], outputs: [{ lockArgs: "0xccdd" }] }).ok,
    ).toBe(false);
    expect(
      fw.checkTransaction({ cellDeps: [dep1, dep2], outputs: [{ lockArgs: "0x1122" }] }).ok,
    ).toBe(true);
  });

  test("checks the canonical testnet registry fixture", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../../notes/deployments/testnet.registry.json", import.meta.url),
        "utf8",
      ),
    ) as TestnetRegistryFixture;

    // Verify the payload parses correctly against the v2 format.
    const parsed = parseRegistryPayload(fixture.canonicalRegistryCell.data);
    expect(parsed.version).toBe(2);
    expect(Array.isArray(parsed.entries)).toBe(true);

    // Verify the registry spec type args are 66 bytes (v2 format).
    expect((fixture.canonicalRegistryCell.typeArgs.length - 2) / 2).toBe(66);

    const fw = new TransactionFirewall({ registries: [fixture.registrySpec] });
    const cellDep: CellDepLike = {
      type: {
        codeHash: fixture.registrySpec.codeHash,
        hashType: fixture.registrySpec.hashType,
        args: fixture.canonicalRegistryCell.typeArgs,
      },
      data: fixture.canonicalRegistryCell.data,
    };

    if (parsed.entries.length > 0) {
      // When entries exist, verify they are correctly blocked.
      const blacklistedIdentifier = parsed.entries[0]!.identifier;
      const res = fw.checkTransaction({
        cellDeps: [cellDep],
        outputs: [{ lockArgs: blacklistedIdentifier }],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe(FIREWALL_ERROR_CODES.BlacklistedLockArgs);
    } else {
      // Empty registry (freshly bootstrapped): any address is allowed.
      const res = fw.checkTransaction({
        cellDeps: [cellDep],
        outputs: [{ lockArgs: "0xdeadbeef" }],
      });
      expect(res.ok).toBe(true);
    }
  });
});
