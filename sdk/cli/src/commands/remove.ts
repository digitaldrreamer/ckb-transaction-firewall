import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import logSymbols from "log-symbols";
import ora from "ora";
import inquirer from "inquirer";
import { parseRegistryPayload } from "@ckb-firewall/sdk";
import { getLiveCell } from "../lib/rpc.js";
import {
  encodeRegistryPayload,
  removeEntry,
  bytesToHex,
  hexToBytes,
  strip0x,
} from "../lib/blkl.js";
import {
  ckbBlake2b,
  buildGov1Witness,
  buildWitnessArgs,
  placeholderSigners,
} from "../lib/witness.js";
import {
  TESTNET_RPC_URL,
  TESTNET_REGISTRY_CELL,
  TESTNET_CONTRACT_OUTPOINTS,
  SECP256K1_DEP_GROUP,
} from "../lib/defaults.js";
import { printHints } from "../lib/hints.js";

export interface RemoveOptions {
  lockArgs?: string;
  rpcUrl: string;
  registryTx: string;
  registryIndex: string;
  txOut: string;
  sign: boolean;
  fromAccount: string;
}

function isValidHex(value: string): boolean {
  const clean = strip0x(value);
  return clean.length > 0 && /^[0-9a-fA-F]+$/.test(clean) && clean.length % 2 === 0;
}

function normaliseHex(value: string): string {
  return `0x${strip0x(value).toLowerCase()}`;
}

async function promptLockArgs(entries: string[]): Promise<string> {
  if (entries.length > 0) {
    const { lockArgs } = await inquirer.prompt<{ lockArgs: string }>([
      {
        type: "list",
        name: "lockArgs",
        message: "Select the entry to remove:",
        choices: [
          ...entries.map((e) => ({ name: e, value: e })),
          new inquirer.Separator(),
          { name: "Enter manually", value: "__manual__" },
        ],
      },
    ]);
    if (lockArgs !== "__manual__") return lockArgs;
  }

  const { manual } = await inquirer.prompt<{ manual: string }>([
    {
      type: "input",
      name: "manual",
      message: "Lock args to remove (0x-prefixed hex):",
      validate(input: string) {
        if (!input.trim()) return "Lock args cannot be empty.";
        if (!isValidHex(input.trim()))
          return "Must be valid even-length hex (e.g. 0xabc123...).";
        return true;
      },
    },
  ]);
  return manual.trim();
}

export async function removeCommand(opts: RemoveOptions): Promise<void> {
  const rpcUrl = opts.rpcUrl;
  const txHash = opts.registryTx;
  const index = Number.parseInt(opts.registryIndex, 10);

  // ── fetch registry first so we can show the list interactively ──────────

  const spinner = ora("Fetching current registry cell").start();
  let cell: Awaited<ReturnType<typeof getLiveCell>>;
  try {
    cell = await getLiveCell(rpcUrl, txHash, index);
    spinner.succeed("Registry cell loaded");
  } catch (err) {
    spinner.fail("Could not fetch the registry cell");
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`\n  ${msg}`));
    console.error(chalk.dim("  Check that your RPC node is reachable and the cell outpoint is correct."));
    process.exit(1);
  }

  let currentPayload: ReturnType<typeof parseRegistryPayload>;
  try {
    currentPayload = parseRegistryPayload(cell.data);
  } catch {
    console.error(
      logSymbols.error,
      chalk.red("The registry cell does not contain a valid BLKL v1 payload."),
    );
    console.error(chalk.dim("  Pass --registry-tx and --registry-index to point at the correct cell."));
    process.exit(1);
  }

  if (currentPayload.entries.length === 0) {
    console.log(logSymbols.warning, chalk.yellow("The registry is empty — nothing to remove."));
    process.exit(0);
  }

  // ── interactive prompts when args are missing ────────────────────────────

  let rawLockArgs = opts.lockArgs?.trim() ?? "";
  if (!rawLockArgs) {
    console.log();
    rawLockArgs = await promptLockArgs(currentPayload.entries.map((e) => e.identifier));
  } else if (!isValidHex(rawLockArgs)) {
    console.error(
      logSymbols.error,
      chalk.red(`Invalid --lock-args: "${rawLockArgs}". Must be even-length hex (e.g. 0xabc123...).`),
    );
    process.exit(1);
  }

  const lockArgs = normaliseHex(rawLockArgs);

  // ── existence check ──────────────────────────────────────────────────────

  const exists = currentPayload.entries.some(
    (e) => strip0x(e.identifier).toLowerCase() === strip0x(lockArgs).toLowerCase(),
  );
  if (!exists) {
    console.log();
    console.log(logSymbols.warning, chalk.yellow(`${lockArgs} is not in the registry.`));
    console.log();
    console.log("Current entries:");
    if (currentPayload.entries.length === 0) {
      console.log(chalk.dim("  (empty)"));
    } else {
      for (const e of currentPayload.entries) {
        console.log(`  ${chalk.dim("•")} ${e.identifier}`);
      }
    }
    console.log();
    process.exit(0);
  }

  // ── build new payload ────────────────────────────────────────────────────

  const newEntries = removeEntry(currentPayload.entries, lockArgs);
  const newPayload = { version: currentPayload.version, entries: newEntries };
  const newBlkl = encodeRegistryPayload(newPayload);
  const oldBlkl = hexToBytes(cell.data);

  console.log();
  console.log(chalk.bold("Proposed change:"));
  console.log(`  ${logSymbols.error} Remove  ${chalk.red(lockArgs)}`);
  console.log(`  Registry size: ${currentPayload.entries.length} → ${newEntries.length} entries`);
  console.log();

  // ── build governance witness ─────────────────────────────────────────────

  const proposalData = new TextEncoder().encode(`remove:${lockArgs}:${Date.now()}`);
  const proposalIdHash = ckbBlake2b(proposalData);
  const voteDigestHash = ckbBlake2b(proposalIdHash);
  const oldRoot = ckbBlake2b(oldBlkl);
  const newRoot = ckbBlake2b(newBlkl);

  const gov1 = buildGov1Witness({
    proposalIdHash,
    voteDigestHash,
    oldRoot,
    newRoot,
    signers: placeholderSigners(3),
  });

  const witnessBytes = buildWitnessArgs({
    lock: new Uint8Array(65),
    inputType: gov1,
  });

  // ── build transaction ────────────────────────────────────────────────────

  const txJson = {
    transaction: {
      version: "0x0",
      cell_deps: [
        { out_point: { tx_hash: SECP256K1_DEP_GROUP.txHash, index: "0x0" }, dep_type: "dep_group" },
        {
          out_point: {
            tx_hash: TESTNET_CONTRACT_OUTPOINTS.blacklistRegistry.txHash,
            index: `0x${TESTNET_CONTRACT_OUTPOINTS.blacklistRegistry.index.toString(16)}`,
          },
          dep_type: "code",
        },
      ],
      header_deps: [],
      inputs: [
        { since: "0x0", previous_output: { tx_hash: cell.txHash, index: `0x${cell.index.toString(16)}` } },
      ],
      outputs: [{ capacity: cell.capacity, lock: cell.lock, type: cell.type }],
      outputs_data: [bytesToHex(newBlkl)],
      witnesses: [bytesToHex(witnessBytes)],
    },
    multisig_configs: {},
    signatures: {},
  };

  const txOut = opts.txOut;
  writeFileSync(txOut, JSON.stringify(txJson, null, 2) + "\n");
  console.log(logSymbols.success, `Transaction written to ${chalk.bold(txOut)}`);
  console.log();

  // ── sign / submit ────────────────────────────────────────────────────────

  if (!opts.sign) {
    console.log("Sign and submit with ckb-cli:");
    console.log(
      chalk.dim(
        `  ckb-cli wallet sign-txs --tx-file ${txOut} --from-account <your-address>\n` +
        `  ckb-cli wallet apply-txs --tx-file ${txOut}`,
      ),
    );
    console.log();
    printHints("remove");
    return;
  }

  let fromAccount = opts.fromAccount;
  if (!fromAccount && process.stdin.isTTY) {
    const { account } = await inquirer.prompt<{ account: string }>([
      {
        type: "input",
        name: "account",
        message: "Governance account address (ckb-cli --from-account):",
        validate: (v: string) => v.trim().length > 0 || "Account address is required.",
      },
    ]);
    fromAccount = account.trim();
  }
  if (!fromAccount) {
    console.error(logSymbols.error, chalk.red("--from-account is required when using --sign."));
    process.exit(1);
  }

  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: "confirm",
      name: "proceed",
      message: `Sign and submit the transaction using account ${fromAccount}?`,
      default: false,
    },
  ]);
  if (!proceed) { console.log("Aborted."); return; }

  const signSpinner = ora("Signing with ckb-cli").start();
  try {
    execFileSync("ckb-cli", ["wallet", "sign-txs", "--tx-file", txOut, "--from-account", fromAccount], { stdio: "inherit" });
    signSpinner.succeed("Signed");
    const submitSpinner = ora("Submitting").start();
    execFileSync("ckb-cli", ["wallet", "apply-txs", "--tx-file", txOut], { stdio: "inherit" });
    submitSpinner.succeed("Submitted");
    printHints("remove");
  } catch (err) {
    signSpinner.fail("ckb-cli failed");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    console.error(chalk.dim(`  You can sign manually: ckb-cli wallet sign-txs --tx-file ${txOut} --from-account ${fromAccount}`));
    process.exit(1);
  }
}

export function removeDefaults(): Partial<RemoveOptions> {
  return {
    rpcUrl: TESTNET_RPC_URL,
    registryTx: TESTNET_REGISTRY_CELL.txHash,
    registryIndex: String(TESTNET_REGISTRY_CELL.index),
    txOut: "gov_remove_tx.json",
    sign: false,
    fromAccount: "",
  };
}
