import { parseRegistryPayload, resolveRegistryDeps } from "./blacklist.js";
import { isBlacklisted, isTypeArgsBlacklisted } from "./builder.js";
import {
  AmbiguousRegistryCellDepError,
  InvalidRegistryDataError,
  MissingRegistryCellDepError,
  RegistryNotSortedError,
} from "./errors.js";
import type { FirewallConfig, FirewallDecision, RegistryPayload, UnsignedTxLike } from "./types.js";

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

  // Checks all outputs against the registry cell deps in the transaction.
  // Uses expiry-aware binary search — expired entries do not block transactions,
  // matching the behaviour of the on-chain firewall-lock contract.
  checkTransaction(tx: UnsignedTxLike): FirewallDecision {
    let payloads: RegistryPayload[];
    try {
      const deps = resolveRegistryDeps(tx.cellDeps, this.config.registries);
      payloads = deps.map((dep) => parseRegistryPayload(dep.data));
    } catch (err: unknown) {
      return mapUnknownToDecision(err);
    }

    for (const out of tx.outputs) {
      if (isBlacklisted(out.lockArgs, payloads)) {
        return { ok: false, code: 11, reason: "BlacklistedLockArgs" };
      }
      if (out.typeArgs && isTypeArgsBlacklisted(out.typeArgs, payloads)) {
        return { ok: false, code: 12, reason: "BlacklistedTypeArgs" };
      }
    }

    return { ok: true };
  }
}
