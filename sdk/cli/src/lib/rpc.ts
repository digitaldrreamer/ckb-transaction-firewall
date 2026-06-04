import type { RegistrySpecLike } from "@ckb-firewall/sdk";

interface RpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

const DEFAULT_RPC_TIMEOUT_MS = 15_000;

function rpcTimeoutMs(): number {
  const raw = process.env.CKB_FIREWALL_RPC_TIMEOUT_MS;
  if (!raw) return DEFAULT_RPC_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RPC_TIMEOUT_MS;
}

function assertHttps(url: string, method: string): void {
  if (
    !url.startsWith("https://") &&
    !url.startsWith("http://localhost") &&
    !url.startsWith("http://127.0.0.1") &&
    !url.startsWith("http://[::1]")
  ) {
    throw new Error(
      `RPC ${method} requires HTTPS for remote URLs (got: ${url}). ` +
      "Registry data integrity cannot be guaranteed over plaintext HTTP. " +
      "Use an https:// URL or a local node (localhost / 127.0.0.1 / [::1]).",
    );
  }
}

async function call<T>(
  url: string,
  method: string,
  params: unknown[],
): Promise<T> {
  assertHttps(url, method);
  const timeoutMs = rpcTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`RPC ${method} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`RPC ${method} HTTP ${res.status} ${res.statusText}`.trim());
  }

  let json: RpcResponse<T>;
  try {
    json = (await res.json()) as RpcResponse<T>;
  } catch {
    throw new Error(`RPC ${method} returned invalid JSON`);
  }
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

export async function getLiveCellsByLock(
  rpcUrl: string,
  lock: { code_hash: string; hash_type: string; args: string },
  limit = 20,
): Promise<LiveCell[]> {
  const result = await call<{
    objects: Array<{
      out_point: { tx_hash: string; index: string };
      output_data: string;
      output: {
        capacity: string;
        lock: { code_hash: string; hash_type: string; args: string };
        type?: { code_hash: string; hash_type: string; args: string } | null;
      };
    }>;
  }>(rpcUrl, "get_cells", [
    {
      script: lock,
      script_type: "lock",
      filter: {
        output_data_len_range: ["0x0", "0x1"],
      },
    },
    "desc",
    `0x${limit.toString(16)}`,
  ]);

  return result.objects.map((obj) => ({
    txHash: obj.out_point.tx_hash,
    index: Number.parseInt(obj.out_point.index, 16),
    capacity: obj.output.capacity,
    data: obj.output_data,
    lock: obj.output.lock,
    type: obj.output.type ?? null,
  }));
}

// Finds the live registry cell by querying the indexer (requires CKB node with indexer enabled).
//
// Queries by codeHash + version prefix "0x02" so the result survives governance-lock
// upgrades — the governance code hash (bytes 1..33 of the type args) can change without
// affecting this lookup. Filters client-side by typeIdValue (bytes 34..66 of the 66-byte args).
export async function findLiveRegistryCell(
  rpcUrl: string,
  spec: RegistrySpecLike,
): Promise<{ txHash: string; index: number; data: string }> {
  const result = await call<{
    objects: Array<{
      out_point: { tx_hash: string; index: string };
      output_data: string;
      output: { type?: { args: string } | null };
    }>;
  }>(rpcUrl, "get_cells", [
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
  ]);

  // type args: version(1 byte=2 hex) + gov_code_hash(32=64) + gov_hash_type(1=2) + type_id_value(32=64)
  // total 132 hex chars; type_id_value starts at offset 68
  const typeIdClean = spec.typeIdValue.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(typeIdClean)) {
    throw new Error(`Invalid registry typeIdValue: expected 32 bytes hex, got "${spec.typeIdValue}"`);
  }
  const cell = result.objects.find((obj) => {
    const args = (obj.output?.type?.args ?? "").replace(/^0x/, "").toLowerCase();
    return args.length === 132 && args.slice(68, 132) === typeIdClean;
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
    data: cell.output_data,
  };
}
