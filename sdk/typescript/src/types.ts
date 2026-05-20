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

export interface GovernanceHeader {
  version: number;
  signerCount: number;
  threshold: number;
  pubkeys: Uint8Array[];
  validatorCount: number;
  validatorMerkleRoot: Uint8Array;
}

export interface RegistryPayload {
  version: number;
  entries: RegistryEntry[];
  governanceHeader?: GovernanceHeader;
}

/// Identifies a registry cell dep by type_id_value (bytes 34..66 of the 66-byte
/// v2 registry type args). Survives governance-lock upgrades — the governance
/// code hash at bytes 1..33 can change without invalidating this spec.
export interface RegistrySpecLike {
  codeHash: string;
  hashType: HashType;
  typeIdValue: string; // 32-byte hex — bytes 34..66 of the v2 registry type args
  required: boolean;
}

export interface FirewallConfig {
  registries: RegistrySpecLike[];
}

/// On-chain location of a deployed cell.
export interface OutPointLike {
  txHash: string;
  index: number;
}

/// A cell dependency entry for inclusion in a CKB transaction.
export interface TransactionCellDep {
  outPoint: OutPointLike;
  depType: "code" | "dep_group";
}

/// Everything needed to build the cell deps for spending a firewall-protected cell.
/// The caller provides the deployed outpoints; the function assembles the list.
export interface FirewallSpendDepsConfig {
  /// Deployed firewall-lock code cell (the RISC-V binary).
  firewallLockOutPoint: OutPointLike;
  /// Deployed inner lock code cell (e.g. spawn-aware-secp256k1).
  /// Must match the innerCodeHash encoded in the firewall lock args.
  innerLockOutPoint: OutPointLike;
  /// Live registry data cell(s) — one per registry spec in the firewall lock args.
  /// These are the cells whose data contains the BLKL v2 payload the firewall reads.
  /// Their outpoints move after every governance update; fetch fresh values before building.
  registryOutPoints: OutPointLike[];
}

/// Full configuration for building a firewall lock script.
/// Encodes to the v2 FirewallLockArgs byte layout.
export interface FirewallLockConfig {
  /// The deployed firewall-lock code hash and hash type (for the output lock script).
  firewallCodeHash: string;
  firewallHashType: HashType;
  /// bit 0 = check output lock_args, bit 1 = check output type_args.
  /// Must have at least one bit set (0x00 is rejected on-chain).
  flags: number;
  /// Registry cells to enforce. Max 255 entries.
  registries: RegistrySpecLike[];
  /// The inner lock to delegate to after blacklist checking passes.
  innerCodeHash: string;
  innerHashType: HashType;
  innerArgs: string; // 0x-prefixed hex, max 65535 bytes
}
