import chalk from "chalk";
import logSymbols from "log-symbols";
import ora from "ora";
import { parseRegistryPayload } from "@ckb-firewall/sdk";
import { getLiveCell } from "../lib/rpc.js";
import { resolveRegistryOutpoint } from "../lib/registry.js";
import { hexToBytes, strip0x } from "../lib/blkl.js";
import {
  TESTNET_REGISTRY_CELL,
  TESTNET_RPC_URL,
} from "../lib/defaults.js";

export interface CheckOptions {
  lockArgs: string;
  rpcUrl: string;
  registryTx: string;
  registryIndex: string;
}

export async function checkCommand(opts: CheckOptions): Promise<void> {
  const lockArgs = opts.lockArgs?.trim();
  if (!lockArgs) {
    console.error(logSymbols.error, chalk.red("--lock-args is required."));
    process.exit(1);
  }

  const normalized = strip0x(lockArgs);
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    console.error(logSymbols.error, chalk.red("--lock-args must be a valid even-length hex string (0x-prefixed or bare)."));
    process.exit(1);
  }

  const configuredIndex = Number.parseInt(opts.registryIndex, 10);
  if (!Number.isInteger(configuredIndex) || configuredIndex < 0) {
    console.error(logSymbols.error, chalk.red("--registry-index must be a non-negative integer."));
    process.exit(1);
  }

  const spinner = ora("Fetching registry cell").start();
  let cell: Awaited<ReturnType<typeof getLiveCell>>;
  let registryTx = opts.registryTx;
  let registryIndex = configuredIndex;
  try {
    ({ txHash: registryTx, index: registryIndex } = await resolveRegistryOutpoint(opts.rpcUrl, opts.registryTx, configuredIndex));
    cell = await getLiveCell(opts.rpcUrl, registryTx, registryIndex);
    spinner.succeed("Registry cell loaded");
  } catch (err) {
    spinner.fail("Failed to fetch registry cell");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  let payload: ReturnType<typeof parseRegistryPayload>;
  try {
    payload = parseRegistryPayload(cell.data);
  } catch {
    console.error(logSymbols.error, chalk.red("Registry cell does not contain a valid BLKL payload."));
    process.exit(1);
  }

  const identifierBytes = hexToBytes(lockArgs);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  // Binary search on the sorted registry (O(log n) instead of O(n)).
  let lo = 0;
  let hi = payload.entries.length - 1;
  let match: (typeof payload.entries)[0] | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const entry = payload.entries[mid]!;
    const eBytes = hexToBytes(entry.identifier);
    let cmp = 0;
    const len = Math.min(eBytes.length, identifierBytes.length);
    for (let i = 0; i < len; i++) {
      cmp = (eBytes[i] as number) - (identifierBytes[i] as number);
      if (cmp !== 0) break;
    }
    if (cmp === 0) cmp = eBytes.length - identifierBytes.length;
    if (cmp === 0) { match = entry; break; }
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }

  console.log();
  if (!match) {
    console.log(logSymbols.success, chalk.green(`Not blacklisted: ${chalk.bold(lockArgs)}`));
    console.log(chalk.dim(`  Registry: ${registryTx}:${registryIndex}  (${payload.entries.length} entries)`));
    process.exit(0);
  }

  const isPermanent = match.expiresAt === 0n;
  const isExpired = !isPermanent && match.expiresAt <= nowSec;

  if (isExpired) {
    console.log(
      logSymbols.warning,
      chalk.yellow(`Entry exists but is EXPIRED: ${chalk.bold(lockArgs)}`),
    );
    console.log(chalk.dim(`  Expired: ${new Date(Number(match.expiresAt) * 1000).toISOString()}`));
    console.log(chalk.dim("  An expired entry does not block transactions — only active entries do."));
    process.exit(0);
  }

  const expiry = isPermanent
    ? "permanent"
    : `expires ${new Date(Number(match.expiresAt) * 1000).toISOString()}`;

  console.log(logSymbols.error, chalk.red(`BLACKLISTED: ${chalk.bold(lockArgs)}`));
  console.log(chalk.dim(`  Status:   ${expiry}`));
  console.log(chalk.dim(`  Registry: ${registryTx}:${registryIndex}`));
  process.exit(2);
}

export function checkDefaults(): Partial<CheckOptions> {
  return {
    rpcUrl: TESTNET_RPC_URL,
    registryTx: TESTNET_REGISTRY_CELL.txHash,
    registryIndex: String(TESTNET_REGISTRY_CELL.index),
  };
}
