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

export interface FirewallDecision {
  ok: boolean;
  code?: FirewallReasonCode;
  reason?: string;
}

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
