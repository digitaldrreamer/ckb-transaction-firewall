import chalk from "chalk";
import Table from "cli-table3";
import logSymbols from "log-symbols";
import ora from "ora";
import { parseRegistryPayload } from "@ckb-firewall/sdk";
import { getLiveCell } from "../lib/rpc.js";
import {
  TESTNET_REGISTRY_CELL,
  TESTNET_RPC_URL,
} from "../lib/defaults.js";
import { printHints, printVotingCallout } from "../lib/hints.js";
import { listProposals } from "../lib/proposals.js";

interface InspectOptions {
  rpcUrl: string;
  registryTx: string;
  registryIndex: string;
}

export async function inspectCommand(opts: InspectOptions): Promise<void> {
  const rpcUrl = opts.rpcUrl;
  const txHash = opts.registryTx;
  const index = Number.parseInt(opts.registryIndex, 10);

  const spinner = ora(`Fetching registry cell from ${rpcUrl}`).start();

  let cell: Awaited<ReturnType<typeof getLiveCell>>;
  try {
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
    ],
    style: { head: [], border: [] },
  });

  for (const entry of payload.entries) {
    const expires =
      entry.expiresAt === 0n
        ? chalk.dim("never")
        : new Date(Number(entry.expiresAt) * 1000).toISOString();
    table.push([entry.identifier, expires]);
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
