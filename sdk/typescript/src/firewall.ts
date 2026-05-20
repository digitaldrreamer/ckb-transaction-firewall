import { parseRegistryPayload, resolveRegistryDeps } from "./blacklist.js";
import {
  AmbiguousRegistryCellDepError,
  InvalidRegistryDataError,
  MissingRegistryCellDepError,
  RegistryNotSortedError,
} from "./errors.js";
import type { FirewallConfig, FirewallDecision, UnsignedTxLike } from "./types.js";

function normalize(hex: string): string {
  return hex.startsWith("0x") ? hex.toLowerCase() : `0x${hex.toLowerCase()}`;
}

function mapUnknownToDecision(err: unknown): FirewallDecision {
  if (err instanceof MissingRegistryCellDepError) {
    return { ok: false, code: 8, reason: "MissingRegistryCellDep" };
  }
  if (err instanceof InvalidRegistryDataError) {
    return { ok: false, code: 9, reason: "InvalidRegistryData" };
  }
  if (err instanceof RegistryNotSortedError) {
    return { ok: false, code: 10, reason: "RegistryNotSorted" };
  }
  if (err instanceof AmbiguousRegistryCellDepError) {
    return { ok: false, code: 17, reason: "AmbiguousRegistryCellDep" };
  }
  return { ok: false, code: 9, reason: "InvalidRegistryData" };
}

export class TransactionFirewall {
  constructor(private readonly config: FirewallConfig) {}

  checkTransaction(tx: UnsignedTxLike): FirewallDecision {
    const registryIds = new Set<string>();
    try {
      const deps = resolveRegistryDeps(tx.cellDeps, this.config.registries);
      for (const dep of deps) {
        const payload = parseRegistryPayload(dep.data);
        for (const entry of payload.entries) {
          registryIds.add(normalize(entry.identifier));
        }
      }
    } catch (err: unknown) {
      return mapUnknownToDecision(err);
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
