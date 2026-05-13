export type HashType = "data" | "type" | "data1";

export interface ScriptLike {
  codeHash: string;
  hashType: HashType;
  args: string;
}

export interface CellDepLike {
  type?: ScriptLike | null;
  data: string;
}

export interface TxOutputLike {
  lockArgs: string;
  typeArgs?: string;
}

export interface UnsignedTxLike {
  cellDeps: CellDepLike[];
  outputs: TxOutputLike[];
}

export type FirewallReasonCode =
  | 8
  | 9
  | 10
  | 11
  | 12
  | 17;

export const FIREWALL_ERROR_CODES = {
  MissingRegistryCellDep: 8,
  InvalidRegistryData: 9,
  RegistryNotSorted: 10,
  BlacklistedLockArgs: 11,
  BlacklistedTypeArgs: 12,
  AmbiguousRegistryCellDep: 17,
} as const;

export type FirewallDecision =
  | { ok: true }
  | { ok: false; code: 8; reason: "MissingRegistryCellDep" }
  | { ok: false; code: 9; reason: "InvalidRegistryData" }
  | { ok: false; code: 10; reason: "RegistryNotSorted" }
  | { ok: false; code: 11; reason: "BlacklistedLockArgs" }
  | { ok: false; code: 12; reason: "BlacklistedTypeArgs" }
  | { ok: false; code: 17; reason: "AmbiguousRegistryCellDep" };

export interface RegistryEntry {
  identifier: string;
  expiresAt: bigint;
}

export interface RegistryPayload {
  version: number;
  entries: RegistryEntry[];
}

export interface FirewallConfig {
  registryScript: ScriptLike;
}
