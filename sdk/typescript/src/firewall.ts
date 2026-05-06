import { parseRegistryPayload, resolveRegistryDep } from "./blacklist";
import type { FirewallConfig, FirewallDecision, UnsignedTxLike } from "./types";

function normalize(hex: string): string {
  return hex.startsWith("0x") ? hex.toLowerCase() : `0x${hex.toLowerCase()}`;
}

function mapErrorToDecision(err: Error): FirewallDecision {
  switch (err.message) {
    case "MissingRegistryCellDep":
      return { ok: false, code: 8, reason: err.message };
    case "InvalidRegistryData":
      return { ok: false, code: 9, reason: err.message };
    case "RegistryNotSorted":
      return { ok: false, code: 10, reason: err.message };
    case "AmbiguousRegistryCellDep":
      return { ok: false, code: 17, reason: err.message };
    default:
      return { ok: false, code: 9, reason: "InvalidRegistryData" };
  }
}

export class TransactionFirewall {
  constructor(private readonly config: FirewallConfig) {}

  checkTransaction(tx: UnsignedTxLike): FirewallDecision {
    let registryIds: Set<string>;
    try {
      const dep = resolveRegistryDep(tx.cellDeps, this.config.registryScript);
      const payload = parseRegistryPayload(dep.data);
      registryIds = new Set(payload.entries.map((e) => normalize(e.identifier)));
    } catch (err) {
      return mapErrorToDecision(err as Error);
    }

    for (const out of tx.outputs) {
      if (registryIds.has(normalize(out.lockArgs))) {
        return { ok: false, code: 11, reason: "BlacklistedLockArgs" };
      }
      if (out.typeArgs && registryIds.has(normalize(out.typeArgs))) {
        return { ok: false, code: 12, reason: "BlacklistedTypeArgs" };
      }
    }

    return { ok: true };
  }
}
