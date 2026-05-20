import { TESTNET_REGISTRY_CELL, TESTNET_REGISTRY_SPEC, TESTNET_RPC_URL } from "./defaults.js";
import { findLiveRegistryCell } from "./rpc.js";

// Resolves the current live registry cell outpoint.
//
// When the configured rpcUrl and registryTx match the testnet defaults, tries auto-discovery
// via the CKB indexer (get_cells) first — this keeps commands working after governance updates
// without requiring a manual --registry-tx override. Falls back silently to the configured
// outpoint if the indexer is unavailable or returns no match.
//
// For custom registries, callers always pass an explicit --registry-tx and this falls through
// to the configured outpoint immediately.
export async function resolveRegistryOutpoint(
  rpcUrl: string,
  registryTx: string,
  registryIndex: number,
): Promise<{ txHash: string; index: number }> {
  if (rpcUrl === TESTNET_RPC_URL && registryTx === TESTNET_REGISTRY_CELL.txHash) {
    try {
      const found = await findLiveRegistryCell(rpcUrl, TESTNET_REGISTRY_SPEC);
      return { txHash: found.txHash, index: found.index };
    } catch {
      // Indexer unavailable or no match — fall through to configured outpoint
    }
  }
  return { txHash: registryTx, index: registryIndex };
}
