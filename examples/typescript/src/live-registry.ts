import { findRegistryCell, parseRegistryPayload } from "@ckb-firewall/sdk";
import type { CellDepLike, RegistryPayload, RegistrySpecLike } from "@ckb-firewall/sdk";

export const TESTNET_RPC_URL = process.env.CKB_RPC_URL ?? "https://testnet.ckb.dev";

export const TESTNET_REGISTRY_SPEC: RegistrySpecLike = {
  codeHash: "0x493f1700508125b0e281b8fb1d168b03bd5ef71480399dd59221224901a9cd09",
  hashType: "type",
  typeIdValue: "0x9be0ad6e4e5039a64d9725ff037057c16ef59f126e3bdd9841b802f0e0a112fe",
  required: true,
};

// Governance key 0 address — not blacklisted, safe to use as clean recipient.
export const TESTNET_ACCOUNT_2_LOCK_ARGS =
  process.env.CANDIDATE_LOCK_ARGS ?? "0x331cdd72ff9f7f22c53f9710d6639ca46de3ac06";

type LiveCellResponse = {
  result?: {
    status?: string;
    cell?: {
      output?: {
        type?: {
          code_hash: string;
          hash_type: "data" | "type" | "data1";
          args: string;
        } | null;
      };
      data?: { content?: string };
    };
  };
  error?: { message: string };
};

export type LiveRegistry = {
  outpoint: { txHash: string; index: number };
  cellDep: CellDepLike;
  payload: RegistryPayload;
};

function toSdkCellDep(json: LiveCellResponse): CellDepLike {
  if (json.error) {
    throw new Error(`CKB RPC error: ${json.error.message}`);
  }
  if (json.result?.status !== "live") {
    throw new Error(`Registry cell is not live: ${json.result?.status ?? "unknown"}`);
  }

  const type = json.result.cell?.output?.type;
  const data = json.result.cell?.data?.content;
  if (!type || !data) {
    throw new Error("Registry cell response did not include type script and data");
  }

  return {
    type: {
      codeHash: type.code_hash,
      hashType: type.hash_type,
      args: type.args,
    },
    data,
  };
}

export async function fetchLiveRegistry(): Promise<LiveRegistry> {
  const outpoint = await findRegistryCell(TESTNET_RPC_URL, TESTNET_REGISTRY_SPEC);
  const response = await fetch(TESTNET_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "get_live_cell",
      params: [{ tx_hash: outpoint.txHash, index: `0x${outpoint.index.toString(16)}` }, true],
    }),
  });

  if (!response.ok) {
    throw new Error(`CKB RPC returned HTTP ${response.status}`);
  }

  const cellDep = toSdkCellDep((await response.json()) as LiveCellResponse);
  return {
    outpoint,
    cellDep,
    payload: parseRegistryPayload(cellDep.data),
  };
}

export function firstActiveEntry(payload: RegistryPayload): string | null {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const active = payload.entries.find((entry) => entry.expiresAt === 0n || entry.expiresAt > now);
  return active?.identifier ?? null;
}

export function summarizeRegistry(registry: LiveRegistry): string {
  const count = registry.payload.entries.length;
  return `registry ${registry.outpoint.txHash}:${registry.outpoint.index} (${count} entr${count === 1 ? "y" : "ies"})`;
}
