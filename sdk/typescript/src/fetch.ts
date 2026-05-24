import { parseRegistryPayload } from "./blacklist.js";
import type { RegistryPayload, RegistrySpecLike } from "./types.js";

// ── P5-4: fetchRegistryPayload ────────────────────────────────────────────────

// Fetches the live registry cell at a known outpoint and parses its BLKL payload.
// Uses the CKB node RPC `get_live_cell` method.
// Requires the global `fetch` API (Node.js >= 18 or browser).
//
// The registry cell moves on every governance update (consumed + recreated).
// Callers should track the current outpoint via an indexer or the CLI
// (`ckb-firewall inspect` shows the active cell outpoint).
const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchRegistryPayload(
  rpcUrl: string,
  txHash: string,
  outputIndex: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RegistryPayload> {
  const outpoint = { tx_hash: txHash, index: `0x${outputIndex.toString(16)}` };
  const body = JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "get_live_cell",
    params: [outpoint, true],
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new Error(`CKB RPC get_live_cell timed out after ${timeoutMs}ms`);
    }
    throw new Error(`CKB RPC unreachable at ${rpcUrl}: ${(cause as Error).message}`, { cause });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(`CKB RPC returned HTTP ${resp.status} for get_live_cell`);
  }

  type RpcResponse = {
    result?: { cell?: { data?: { content?: string } }; status?: string };
    error?: { message: string };
  };
  const json = (await resp.json()) as RpcResponse;

  if (json.error) {
    throw new Error(`CKB RPC error: ${json.error.message}`);
  }
  if (!json.result) {
    throw new Error("CKB RPC returned no result for get_live_cell");
  }

  const status = json.result.status;
  if (status !== "live") {
    throw new Error(
      `Registry cell ${txHash}:${outputIndex} is not live (status: "${status ?? "unknown"}"). ` +
      "The registry may have been updated — query the current outpoint via the indexer.",
    );
  }

  const content = json.result.cell?.data?.content;
  if (typeof content !== "string" || !content) {
    throw new Error(
      `Registry cell ${txHash}:${outputIndex} has no data. ` +
      "Ensure the RPC call was made with with_data=true.",
    );
  }

  return parseRegistryPayload(content);
}

// Finds the live registry cell outpoint by querying the CKB indexer (get_cells RPC).
//
// Queries by codeHash + version prefix "0x02" so the result survives governance-lock
// upgrades — the governance code hash at bytes 1..33 of the type args can rotate without
// invalidating the spec. Filters client-side by typeIdValue (bytes 34..66).
//
// Requires a CKB node with the built-in indexer enabled (CKB >= 0.109).
// Throws if no matching cell is found or if the RPC is unreachable.
export async function findRegistryCell(
  rpcUrl: string,
  spec: RegistrySpecLike,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ txHash: string; index: number }> {
  const body = JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "get_cells",
    params: [
      {
        script: {
          code_hash: spec.codeHash,
          hash_type: spec.hashType,
          args: "0x02",
        },
        script_type: "type",
      },
      "desc",
      "0x10",
    ],
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new Error(`CKB RPC get_cells timed out after ${timeoutMs}ms`);
    }
    throw new Error(`CKB RPC unreachable at ${rpcUrl}: ${(cause as Error).message}`, { cause });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(`CKB RPC returned HTTP ${resp.status} for get_cells`);
  }

  type GetCellsResponse = {
    result?: {
      objects: Array<{
        out_point: { tx_hash: string; index: string };
        output: { type?: { code_hash: string; hash_type: string; args: string } | null };
      }>;
    };
    error?: { message: string };
  };
  const json = (await resp.json()) as GetCellsResponse;

  if (json.error) {
    throw new Error(`CKB RPC error: ${json.error.message}`);
  }
  if (!json.result) {
    throw new Error("CKB RPC returned no result for get_cells");
  }

  // type args layout: version(1 byte) + gov_code_hash(32) + gov_hash_type(1) + type_id_value(32)
  // hex: 2 + 64 + 2 + 64 = 132 chars total; type_id_value starts at offset 68
  const typeIdClean = spec.typeIdValue.replace(/^0x/, "").toLowerCase();
  const cell = json.result.objects.find((obj) => {
    const args = (obj.output.type?.args ?? "").replace(/^0x/, "").toLowerCase();
    return args.length === 132 && args.slice(68) === typeIdClean;
  });

  if (!cell) {
    throw new Error(
      `No live registry cell found for typeIdValue ${spec.typeIdValue}. ` +
      "Ensure the CKB node has the built-in indexer enabled (required for get_cells).",
    );
  }

  return {
    txHash: cell.out_point.tx_hash,
    index: Number.parseInt(cell.out_point.index, 16),
  };
}
