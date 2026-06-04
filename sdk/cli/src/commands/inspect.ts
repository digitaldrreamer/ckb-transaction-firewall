import chalk from "chalk";
import Table from "cli-table3";
import logSymbols from "log-symbols";
import ora from "ora";
import { parseRegistryPayload } from "@ckb-firewall/sdk";
import { getLiveCell } from "../lib/rpc.js";
import { resolveRegistryOutpoint } from "../lib/registry.js";
import {
  TESTNET_REGISTRY_CELL,
  TESTNET_RPC_URL,
} from "../lib/defaults.js";
import { printHints, printVotingCallout } from "../lib/hints.js";
import { listProposals } from "../lib/proposals.js";
import { extractGovernanceHeaderRaw, parseGovernanceHeader } from "../lib/blkl.js";
import {
  formatCkb,
  loadTreasuryStatus,
  TREASURY_DONATION_THRESHOLD_PERCENT,
} from "../lib/treasury-status.js";

interface InspectOptions {
  rpcUrl: string;
  registryTx: string;
  registryIndex: string;
}

export async function inspectCommand(opts: InspectOptions): Promise<void> {
  const rpcUrl = opts.rpcUrl;
  const configuredTx = opts.registryTx;
  const configuredIndex = Number.parseInt(opts.registryIndex, 10);
  if (!Number.isInteger(configuredIndex) || configuredIndex < 0) {
    console.error(logSymbols.error, chalk.red("--registry-index must be a non-negative integer."));
    process.exit(1);
  }

  const spinner = ora(`Fetching registry cell from ${rpcUrl}`).start();

  let cell: Awaited<ReturnType<typeof getLiveCell>>;
  let txHash = configuredTx;
  let index = configuredIndex;
  try {
    ({ txHash, index } = await resolveRegistryOutpoint(rpcUrl, configuredTx, configuredIndex));
    cell = await getLiveCell(rpcUrl, txHash, index);
    spinner.succeed("Registry cell loaded");
  } catch (err) {
    spinner.fail("Failed to fetch registry cell");
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(msg));
    process.exit(1);
  }

  let payload: ReturnType<typeof parseRegistryPayload>;
  try {
    payload = parseRegistryPayload(cell.data);
  } catch {
    console.error(logSymbols.error, chalk.red("Registry data failed to parse. The cell may not contain a valid BLKL payload."));
    process.exit(1);
  }

  const network = rpcUrl === TESTNET_RPC_URL ? "testnet" : rpcUrl;
  console.log();
  console.log(chalk.bold(`Registry on ${network}`));
  console.log(
    chalk.dim(`  Cell:  ${txHash}:${index}`),
  );
  console.log(chalk.dim(`  BLKL version: ${payload.version}`));
  const govHeaderRaw = extractGovernanceHeaderRaw(cell.data);
  const govHeader = govHeaderRaw ? parseGovernanceHeader(govHeaderRaw) : null;
  const treasuryStatus = await loadTreasuryStatus(rpcUrl, cell, govHeader);
  if (treasuryStatus) {
    const registryCapacity = BigInt(treasuryStatus.registryCapacityShannons);
    const registryOccupied = BigInt(treasuryStatus.registryOccupiedShannons);
    console.log(chalk.dim(`  Treasury lock hash: ${treasuryStatus.lockHash}`));
    if (treasuryStatus.lockScript) {
      console.log(chalk.dim(`  Treasury lock: ${JSON.stringify(treasuryStatus.lockScript)}`));
    }
    if (treasuryStatus.donationAddress) {
      console.log(chalk.dim(`  Treasury donation address: ${treasuryStatus.donationAddress}`));
    }
    console.log(chalk.dim(`  Registry capacity use: ${formatCkb(registryOccupied)} / ${formatCkb(registryCapacity)}`));
    if (treasuryStatus.error) {
      console.log(chalk.dim(`  Treasury balance: unavailable (${treasuryStatus.error})`));
    } else {
      const balance = BigInt(treasuryStatus.balanceShannons ?? "0");
      const poolCapacity = BigInt(treasuryStatus.poolCapacityShannons ?? treasuryStatus.registryCapacityShannons);
      console.log(chalk.dim(`  Treasury live cells: ${treasuryStatus.liveCellCount ?? 0}`));
      console.log(chalk.dim(`  Treasury balance: ${formatCkb(balance)} (${balance} shannons)`));
      console.log(chalk.dim(`  Blacklist pool use: ${treasuryStatus.poolUsedPercent?.toFixed(2) ?? "n/a"}% of ${formatCkb(poolCapacity)}`));
      if (treasuryStatus.donateRecommended) {
        console.log();
        console.log(
          logSymbols.warning,
          chalk.yellow(`Blacklist pool use is at least ${TREASURY_DONATION_THRESHOLD_PERCENT}%. Donate CKB to keep registry growth funded:`),
        );
        console.log(chalk.bold(`  ${treasuryStatus.donationAddress ?? treasuryStatus.lockHash}`));
      }
    }
  }
  console.log();

  if (payload.entries.length === 0) {
    console.log(chalk.yellow("  No entries — blacklist is empty."));
    console.log();
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan("Lock Args (identifier)"),
      chalk.cyan("Expires At"),
      chalk.cyan("Status"),
    ],
    style: { head: [], border: [] },
  });

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  let expiredCount = 0;

  for (const entry of payload.entries) {
    let expires: string;
    let status: string;
    if (entry.expiresAt === 0n) {
      expires = chalk.dim("never");
      status = chalk.green("active");
    } else if (entry.expiresAt <= nowSec) {
      expires = chalk.dim(new Date(Number(entry.expiresAt) * 1000).toISOString());
      status = chalk.red("EXPIRED");
      expiredCount++;
    } else {
      expires = new Date(Number(entry.expiresAt) * 1000).toISOString();
      status = chalk.green("active");
    }
    table.push([entry.identifier, expires, status]);
  }

  if (expiredCount > 0) {
    console.log(
      logSymbols.warning,
      chalk.yellow(`${expiredCount} expired ${expiredCount === 1 ? "entry" : "entries"} — submit a removal proposal to compact the registry.`),
    );
    console.log();
  }

  console.log(table.toString());
  console.log();
  console.log(
    `  ${logSymbols.info} ${chalk.bold(payload.entries.length)} ${payload.entries.length === 1 ? "entry" : "entries"}`,
  );
  console.log();

  const openCount = listProposals().filter(
    (p) => p.status === "pending-review" || p.status === "voting",
  ).length;
  printVotingCallout(openCount);
  printHints("inspect");
}

export function inspectDefaults(): InspectOptions {
  return {
    rpcUrl: TESTNET_RPC_URL,
    registryTx: TESTNET_REGISTRY_CELL.txHash,
    registryIndex: String(TESTNET_REGISTRY_CELL.index),
  };
}
