import type {
  FirewallDecision,
  FirewallLockConfig,
  FirewallSpendDepsConfig,
  RegistryPayload,
  ScriptLike,
  TransactionCellDep,
  TxOutputLike,
} from "./types.js";

// ── encoding helpers ──────────────────────────────────────────────────────────

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = strip0x(hex);
  if (clean.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length hex (${clean.length} chars): "${hex.slice(0, 20)}"`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function hashTypeToU8(h: "data" | "type" | "data1"): number {
  if (h === "data") return 0x00;
  if (h === "type") return 0x01;
  return 0x02; // data1
}

function normalizeHex(hex: string): string {
  return `0x${strip0x(hex).toLowerCase()}`;
}

// ── P5-1: buildFirewallLockArgs ───────────────────────────────────────────────

// Encodes the v2 FirewallLockArgs byte layout:
// version(1)=0x02 | flags(1) | registry_count(1) |
// [code_hash(32) | hash_type(1) | type_id_value(32) | required(1)] × N |
// inner_code_hash(32) | inner_hash_type(1) | inner_args_len(2 LE) | inner_args(M)
export function buildFirewallLockArgs(config: FirewallLockConfig): Uint8Array {
  if (config.flags < 0 || config.flags > 0xff) {
    throw new RangeError("flags must be 0x00..0xff");
  }
  if ((config.flags & 0x03) === 0) {
    throw new Error("flags must have at least one check bit set (bit0=lock_args, bit1=type_args)");
  }
  if (config.registries.length > 255) {
    throw new RangeError("registries.length exceeds 255");
  }

  const innerArgsBytes = hexToBytes(config.innerArgs);
  if (innerArgsBytes.length > 0xffff) {
    throw new RangeError("innerArgs exceeds 65535 bytes");
  }

  const N = config.registries.length;
  const size = 3 + N * 66 + 32 + 1 + 2 + innerArgsBytes.length;
  const buf = new Uint8Array(size);
  let off = 0;

  buf[off++] = 0x02;
  buf[off++] = config.flags & 0xff;
  buf[off++] = N;

  for (const reg of config.registries) {
    const codeHash = hexToBytes(reg.codeHash);
    if (codeHash.length !== 32) throw new Error("registry codeHash must be 32 bytes");
    buf.set(codeHash, off); off += 32;
    buf[off++] = hashTypeToU8(reg.hashType);
    const typeId = hexToBytes(reg.typeIdValue);
    if (typeId.length !== 32) throw new Error("registry typeIdValue must be 32 bytes");
    buf.set(typeId, off); off += 32;
    buf[off++] = reg.required ? 1 : 0;
  }

  const innerCodeHash = hexToBytes(config.innerCodeHash);
  if (innerCodeHash.length !== 32) throw new Error("innerCodeHash must be 32 bytes");
  buf.set(innerCodeHash, off); off += 32;
  buf[off++] = hashTypeToU8(config.innerHashType);
  buf[off++] = innerArgsBytes.length & 0xff;
  buf[off++] = (innerArgsBytes.length >> 8) & 0xff;
  buf.set(innerArgsBytes, off);

  return buf;
}

// ── P5-2: buildFirewallLockScript ─────────────────────────────────────────────

export function buildFirewallLockScript(config: FirewallLockConfig): ScriptLike {
  return {
    codeHash: config.firewallCodeHash,
    hashType: config.firewallHashType,
    args: bytesToHex(buildFirewallLockArgs(config)),
  };
}

// ── P5-3: isBlacklisted / isTypeArgsBlacklisted ──────────────────────────────

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] as number) - (b[i] as number);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

// Binary-searches sorted entries for `target`. Returns true if found and active.
function searchEntries(entries: RegistryPayload["entries"], target: Uint8Array): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000));
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const entry = entries[mid]!;
    const cmp = compareBytes(hexToBytes(entry.identifier), target);
    if (cmp === 0) {
      return entry.expiresAt === 0n || entry.expiresAt > now;
    }
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

// Returns true if `lockArgs` is an active blacklist entry in any of the given registries.
export function isBlacklisted(lockArgs: string, registries: RegistryPayload[]): boolean {
  const target = hexToBytes(normalizeHex(lockArgs));
  return registries.some((reg) => searchEntries(reg.entries, target));
}

// Returns true if `typeArgs` is an active blacklist entry in any of the given registries.
export function isTypeArgsBlacklisted(typeArgs: string, registries: RegistryPayload[]): boolean {
  return isBlacklisted(typeArgs, registries);
}

// ── P5-5: preflightCheck ─────────────────────────────────────────────────────

// Checks all outputs against already-fetched registry payloads.
// No network call required — call fetchRegistryPayload first to get the payloads.
export function preflightCheck(
  outputs: TxOutputLike[],
  registries: RegistryPayload[],
): FirewallDecision {
  for (const out of outputs) {
    if (isBlacklisted(out.lockArgs, registries)) {
      return { ok: false, code: 11, reason: "BlacklistedLockArgs" };
    }
    if (out.typeArgs && isTypeArgsBlacklisted(out.typeArgs, registries)) {
      return { ok: false, code: 12, reason: "BlacklistedTypeArgs" };
    }
  }
  return { ok: true };
}

// ── P5-6: buildFirewallSpendCellDeps ─────────────────────────────────────────

// Returns the cell deps required for any CKB transaction that spends a cell
// protected by the firewall-lock.
//
// Required deps for a firewall-spend transaction:
//   1. firewall-lock code cell   — so the VM can load and execute the firewall
//   2. inner lock code cell      — so the firewall can spawn_cell the inner lock
//   3. registry data cell(s)     — the live BLKL v2 cells the firewall reads
//
// The registry outpoints move after each governance update. Always fetch fresh
// outpoints (e.g. via fetchRegistryPayload) before calling this function.
export function buildFirewallSpendCellDeps(
  config: FirewallSpendDepsConfig,
): TransactionCellDep[] {
  const deps: TransactionCellDep[] = [
    { outPoint: config.firewallLockOutPoint, depType: "code" },
    { outPoint: config.innerLockOutPoint,    depType: "code" },
  ];
  for (const outPoint of config.registryOutPoints) {
    deps.push({ outPoint, depType: "code" });
  }
  return deps;
}
