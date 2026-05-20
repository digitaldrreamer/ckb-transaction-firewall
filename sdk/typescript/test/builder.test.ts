import { describe, expect, test } from "vitest";
import {
  buildFirewallLockArgs,
  buildFirewallLockScript,
  isBlacklisted,
  isTypeArgsBlacklisted,
  preflightCheck,
  buildFirewallSpendCellDeps,
} from "../src/builder.js";
import type { FirewallLockConfig, FirewallSpendDepsConfig, RegistryPayload } from "../src/types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const ZERO_32 = "0x" + "00".repeat(32);
const ONE_32  = "0x" + "01".repeat(32);
const TWO_32  = "0x" + "02".repeat(32);

const BASE_CONFIG: FirewallLockConfig = {
  firewallCodeHash: ONE_32,
  firewallHashType: "type",
  flags: 0x03, // check lock_args + type_args
  registries: [
    { codeHash: TWO_32, hashType: "type", typeIdValue: ZERO_32, required: true },
  ],
  innerCodeHash: ONE_32,
  innerHashType: "type",
  innerArgs: "0xdeadbeef",
};

function makeRegistry(identifiers: string[], expiresAt = 0n): RegistryPayload {
  return {
    version: 2,
    entries: identifiers.map((id) => ({ identifier: id, expiresAt })),
  };
}

// ── buildFirewallLockArgs ─────────────────────────────────────────────────────

describe("buildFirewallLockArgs", () => {
  test("produces correct byte length for 1 registry", () => {
    const args = buildFirewallLockArgs(BASE_CONFIG);
    // 3 + 1*66 + 32 + 1 + 2 + 2 (0xdeadbeef is 4 bytes → 2 is wrong, it's 4)
    // innerArgs = "0xdeadbeef" = 4 bytes
    // size = 3 + 66 + 32 + 1 + 2 + 4 = 108
    expect(args.length).toBe(108);
  });

  test("byte 0 is always 0x02 (version)", () => {
    expect(buildFirewallLockArgs(BASE_CONFIG)[0]).toBe(0x02);
  });

  test("byte 1 encodes flags", () => {
    const args = buildFirewallLockArgs({ ...BASE_CONFIG, flags: 0x01 });
    expect(args[1]).toBe(0x01);
  });

  test("byte 2 encodes registry count", () => {
    const args0 = buildFirewallLockArgs({ ...BASE_CONFIG, registries: [] });
    // But flags 0x03 with 0 registries is valid args-wise (just no registries to check)
    expect(args0[2]).toBe(0);

    const args1 = buildFirewallLockArgs(BASE_CONFIG);
    expect(args1[2]).toBe(1);
  });

  test("registry required byte 0 = optional, 1 = required", () => {
    const optConfig: FirewallLockConfig = {
      ...BASE_CONFIG,
      registries: [{ ...BASE_CONFIG.registries[0]!, required: false }],
    };
    const argsReq = buildFirewallLockArgs(BASE_CONFIG);
    const argsOpt = buildFirewallLockArgs(optConfig);
    // required byte is at offset 3 + 32 + 1 + 32 = 68 (0-indexed)
    expect(argsReq[3 + 65]).toBe(1);
    expect(argsOpt[3 + 65]).toBe(0);
  });

  test("inner_hash_type byte encodes 'data'=0, 'type'=1, 'data1'=2", () => {
    const typeArgs = buildFirewallLockArgs(BASE_CONFIG);
    const dataArgs = buildFirewallLockArgs({ ...BASE_CONFIG, innerHashType: "data" });
    const data1Args = buildFirewallLockArgs({ ...BASE_CONFIG, innerHashType: "data1" });
    // inner_hash_type is at 3 + 66 + 32 = 101
    expect(typeArgs[101]).toBe(1);
    expect(dataArgs[101]).toBe(0);
    expect(data1Args[101]).toBe(2);
  });

  test("inner_args_len is little-endian at bytes 102..103", () => {
    const args = buildFirewallLockArgs(BASE_CONFIG); // innerArgs = "0xdeadbeef" = 4 bytes
    expect(args[102]).toBe(4); // low byte
    expect(args[103]).toBe(0); // high byte
  });

  test("rejects flags=0x00", () => {
    expect(() => buildFirewallLockArgs({ ...BASE_CONFIG, flags: 0x00 })).toThrow();
  });

  test("rejects registries.length > 255", () => {
    const tooMany = Array.from({ length: 256 }, () => BASE_CONFIG.registries[0]!);
    expect(() => buildFirewallLockArgs({ ...BASE_CONFIG, registries: tooMany })).toThrow(RangeError);
  });

  test("rejects odd-length hex in innerArgs", () => {
    expect(() => buildFirewallLockArgs({ ...BASE_CONFIG, innerArgs: "0xabc" })).toThrow();
  });

  test("is deterministic for identical config", () => {
    const a = buildFirewallLockArgs(BASE_CONFIG);
    const b = buildFirewallLockArgs(BASE_CONFIG);
    expect(a).toEqual(b);
  });
});

// ── buildFirewallLockScript ───────────────────────────────────────────────────

describe("buildFirewallLockScript", () => {
  test("returns ScriptLike with correct codeHash and hashType", () => {
    const script = buildFirewallLockScript(BASE_CONFIG);
    expect(script.codeHash.toLowerCase()).toBe(BASE_CONFIG.firewallCodeHash.toLowerCase());
    expect(script.hashType).toBe(BASE_CONFIG.firewallHashType);
  });

  test("args is 0x-prefixed hex encoding of buildFirewallLockArgs output", () => {
    const script = buildFirewallLockScript(BASE_CONFIG);
    const raw = buildFirewallLockArgs(BASE_CONFIG);
    const expected = `0x${Array.from(raw).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    expect(script.args.toLowerCase()).toBe(expected.toLowerCase());
  });
});

// ── isBlacklisted ─────────────────────────────────────────────────────────────

describe("isBlacklisted", () => {
  test("returns false for empty registries", () => {
    expect(isBlacklisted("0xaabbcc", [])).toBe(false);
  });

  test("returns true for exact match in single registry", () => {
    const reg = makeRegistry(["0xaabbcc"]);
    expect(isBlacklisted("0xaabbcc", [reg])).toBe(true);
  });

  test("returns false when entry does not match", () => {
    const reg = makeRegistry(["0xaabbcc"]);
    expect(isBlacklisted("0xaabb00", [reg])).toBe(false);
  });

  test("returns true if match exists in any registry (multi-registry)", () => {
    const reg1 = makeRegistry(["0xaabb"]);
    const reg2 = makeRegistry(["0xccdd"]);
    expect(isBlacklisted("0xccdd", [reg1, reg2])).toBe(true);
  });

  test("returns false for expired entry", () => {
    const pastExpiry = 1n; // Unix epoch 1s — definitely past
    const reg = makeRegistry(["0xaabbcc"], pastExpiry);
    expect(isBlacklisted("0xaabbcc", [reg])).toBe(false);
  });

  test("returns true for entry with expiresAt=0 (never expires)", () => {
    const reg = makeRegistry(["0xaabbcc"], 0n);
    expect(isBlacklisted("0xaabbcc", [reg])).toBe(true);
  });

  test("returns true for future-expiring entry", () => {
    const farFuture = BigInt(Math.floor(Date.now() / 1000) + 100_000);
    const reg = makeRegistry(["0xaabbcc"], farFuture);
    expect(isBlacklisted("0xaabbcc", [reg])).toBe(true);
  });

  test("is case-insensitive and 0x-prefix-agnostic", () => {
    const reg = makeRegistry(["0xAABBCC"]);
    expect(isBlacklisted("0xaabbcc", [reg])).toBe(true);
    expect(isBlacklisted("aabbcc", [reg])).toBe(true);
  });

  test("handles multiple entries via binary search", () => {
    const reg = makeRegistry(["0x01", "0x02", "0x03", "0x04", "0x05"]);
    expect(isBlacklisted("0x03", [reg])).toBe(true);
    expect(isBlacklisted("0x06", [reg])).toBe(false);
    expect(isBlacklisted("0x01", [reg])).toBe(true);
    expect(isBlacklisted("0x05", [reg])).toBe(true);
  });
});

// ── preflightCheck ────────────────────────────────────────────────────────────

describe("preflightCheck", () => {
  const reg = makeRegistry(["0xbad1", "0xbad2"]);

  test("returns ok=true when no output is blacklisted", () => {
    const result = preflightCheck(
      [{ lockArgs: "0x1111" }, { lockArgs: "0x2222" }],
      [reg],
    );
    expect(result.ok).toBe(true);
  });

  test("returns BlacklistedLockArgs when lockArgs matches", () => {
    const result = preflightCheck([{ lockArgs: "0xbad1" }], [reg]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("BlacklistedLockArgs");
      expect(result.code).toBe(11);
    }
  });

  test("returns BlacklistedTypeArgs when typeArgs matches", () => {
    const result = preflightCheck([{ lockArgs: "0x1111", typeArgs: "0xbad2" }], [reg]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("BlacklistedTypeArgs");
      expect(result.code).toBe(12);
    }
  });

  test("checks all outputs — first blacklisted wins", () => {
    const result = preflightCheck(
      [{ lockArgs: "0x1111" }, { lockArgs: "0xbad1" }, { lockArgs: "0xbad2" }],
      [reg],
    );
    expect(result.ok).toBe(false);
  });

  test("returns ok=true with empty registry", () => {
    const result = preflightCheck([{ lockArgs: "0x1234" }], []);
    expect(result.ok).toBe(true);
  });

  test("checks typeArgs only when present", () => {
    const result = preflightCheck([{ lockArgs: "0x1111" }], [reg]);
    expect(result.ok).toBe(true);
  });
});

// ── buildFirewallSpendCellDeps ────────────────────────────────────────────────

describe("buildFirewallSpendCellDeps", () => {
  const config: FirewallSpendDepsConfig = {
    firewallLockOutPoint: { txHash: "0x" + "aa".repeat(32), index: 0 },
    innerLockOutPoint:    { txHash: "0x" + "bb".repeat(32), index: 0 },
    registryOutPoints: [
      { txHash: "0x" + "cc".repeat(32), index: 0 },
    ],
  };

  test("returns firewall + inner + registry deps", () => {
    const deps = buildFirewallSpendCellDeps(config);
    expect(deps).toHaveLength(3);
  });

  test("all deps have depType code", () => {
    const deps = buildFirewallSpendCellDeps(config);
    expect(deps.every((d) => d.depType === "code")).toBe(true);
  });

  test("first dep is the firewall-lock", () => {
    const deps = buildFirewallSpendCellDeps(config);
    expect(deps[0]?.outPoint).toEqual(config.firewallLockOutPoint);
  });

  test("second dep is the inner lock", () => {
    const deps = buildFirewallSpendCellDeps(config);
    expect(deps[1]?.outPoint).toEqual(config.innerLockOutPoint);
  });

  test("remaining deps are registry cells in order", () => {
    const multiReg: FirewallSpendDepsConfig = {
      ...config,
      registryOutPoints: [
        { txHash: "0x" + "cc".repeat(32), index: 0 },
        { txHash: "0x" + "dd".repeat(32), index: 1 },
      ],
    };
    const deps = buildFirewallSpendCellDeps(multiReg);
    expect(deps).toHaveLength(4);
    expect(deps[2]?.outPoint).toEqual(multiReg.registryOutPoints[0]);
    expect(deps[3]?.outPoint).toEqual(multiReg.registryOutPoints[1]);
  });

  test("zero registry outpoints produces two deps", () => {
    const noReg: FirewallSpendDepsConfig = { ...config, registryOutPoints: [] };
    expect(buildFirewallSpendCellDeps(noReg)).toHaveLength(2);
  });
});
