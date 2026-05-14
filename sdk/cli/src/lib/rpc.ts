import type { ScriptLike } from "@ckb-firewall/sdk";

interface RpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

async function call<T>(
  url: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = (await res.json()) as RpcResponse<T>;
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  if (json.result === undefined)
    throw new Error(`RPC ${method} returned no result`);
  return json.result;
}

export interface LiveCell {
  txHash: string;
  index: number;
  capacity: string;
  data: string;
  lock: { code_hash: string; hash_type: string; args: string };
  type: { code_hash: string; hash_type: string; args: string } | null;
}

export async function getLiveCell(
  rpcUrl: string,
  txHash: string,
  index: number,
): Promise<LiveCell> {
  const result = await call<{
    cell: {
      data: { content: string };
      output: {
        capacity: string;
        lock: { code_hash: string; hash_type: string; args: string };
        type?: { code_hash: string; hash_type: string; args: string } | null;
      };
    };
    status: string;
  }>(rpcUrl, "get_live_cell", [
    { tx_hash: txHash, index: `0x${index.toString(16)}` },
    true,
  ]);

  if (result.status !== "live") {
    throw new Error(
      `Cell ${txHash}:${index} is not live (status: ${result.status}). ` +
        "The registry cell may have moved after a governance update — pass --registry-tx and --registry-index.",
    );
  }

  return {
    txHash,
    index,
    capacity: result.cell.output.capacity,
    data: result.cell.data.content,
    lock: result.cell.output.lock,
    type: result.cell.output.type ?? null,
  };
}

// Finds the live registry cell by querying the indexer (requires CKB node with indexer enabled).
export async function findLiveRegistryCell(
  rpcUrl: string,
  registryScript: ScriptLike,
): Promise<{ txHash: string; index: number; data: string }> {
  const result = await call<{
    objects: Array<{
      out_point: { tx_hash: string; index: string };
      output_data: string;
    }>;
  }>(rpcUrl, "get_cells", [
    {
      script: {
        code_hash: registryScript.codeHash,
        hash_type: registryScript.hashType,
        args: registryScript.args,
      },
      script_type: "type",
    },
    "asc",
    "0x1",
  ]);

  const cell = result.objects[0];
  if (!cell) throw new Error("No live registry cell found for the registry script.");

  return {
    txHash: cell.out_point.tx_hash,
    index: Number.parseInt(cell.out_point.index, 16),
    data: cell.output_data,
  };
}
