import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import chalk from "chalk";
import logSymbols from "log-symbols";
import ora from "ora";
import inquirer from "inquirer";
import { parseRegistryPayload } from "@ckb-firewall/sdk";
import { getLiveCell } from "../lib/rpc.js";
import {
  loadProposal,
  saveProposal,
  listProposals,
  isReviewWindowPassed,
  isVoteApproved,
  isReadyToExecute,
  SIG_THRESHOLD,
} from "../lib/proposals.js";
import {
  encodeRegistryPayload,
  insertSorted,
  removeEntry,
  bytesToHex,
  hexToBytes,
  strip0x,
} from "../lib/blkl.js";
import {
  ckbBlake2b,
  buildGov1Witness,
  buildWitnessArgs,
} from "../lib/witness.js";
import {
  TESTNET_RPC_URL,
  TESTNET_REGISTRY_CELL,
  TESTNET_CONTRACT_OUTPOINTS,
  SECP256K1_DEP_GROUP,
} from "../lib/defaults.js";
import { printHints } from "../lib/hints.js";

export interface ExecuteOptions {
  proposal?: string;
  rpcUrl: string;
  registryTx: string;
  registryIndex: string;
  txOut: string;
  sign: boolean;
  fromAccount: string;
}

export async function executeCommand(opts: ExecuteOptions): Promise<void> {
  // ── select proposal ──────────────────────────────────────────────────────

  let proposalId = opts.proposal?.trim() ?? "";
  if (!proposalId) {
    const ready = listProposals().filter(isReadyToExecute);
    if (ready.length === 0) {
      console.log(logSymbols.warning, chalk.yellow("No proposals are ready to execute."));
      console.log(chalk.dim("  A proposal needs: review window passed + vote threshold + 3 signatures."));
      process.exit(0);
    }
    const { chosen } = await inquirer.prompt<{ chosen: string }>([
      {
        type: "list",
        name: "chosen",
        message: "Select proposal to execute:",
        choices: ready.map((p) => ({
          name: `${chalk.bold(p.id)}  ${p.action} ${p.lockArgs.slice(0, 24)}…`,
          value: p.id,
        })),
      },
    ]);
    proposalId = chosen;
  }

  const proposal = loadProposal(proposalId);

  // ── checks ───────────────────────────────────────────────────────────────

  if (proposal.status === "executed") {
    console.log(logSymbols.success, chalk.green(`Already executed — tx: ${proposal.txHash ?? "unknown"}`));
    process.exit(0);
  }
  if (!isReviewWindowPassed(proposal)) {
    const ms = new Date(proposal.reviewWindowEndsAt).getTime() - Date.now();
    const h = Math.floor(ms / 3_600_000);
    console.log(logSymbols.error, chalk.red(`Review window not passed — ${h}h remaining.`));
    process.exit(1);
  }
  if (!isVoteApproved(proposal)) {
    console.log(logSymbols.error, chalk.red("Vote threshold not met."));
    console.log(chalk.dim(`  Use: ckb-firewall vote --proposal ${proposal.id}`));
    process.exit(1);
  }
  if (proposal.signatures.length < SIG_THRESHOLD) {
    console.log(
      logSymbols.error,
      chalk.red(`Only ${proposal.signatures.length}/${SIG_THRESHOLD} signatures — need more.`),
    );
    console.log(chalk.dim(`  Use: ckb-firewall sign --proposal ${proposal.id}`));
    process.exit(1);
  }

  // ── fetch current registry cell ──────────────────────────────────────────

  const spinner = ora("Fetching current registry cell").start();
  let cell: Awaited<ReturnType<typeof getLiveCell>>;
  try {
    cell = await getLiveCell(opts.rpcUrl, opts.registryTx, Number.parseInt(opts.registryIndex, 10));
    spinner.succeed("Registry cell loaded");
  } catch (err) {
    spinner.fail("Could not fetch registry cell");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  let currentPayload: ReturnType<typeof parseRegistryPayload>;
  try {
    currentPayload = parseRegistryPayload(cell.data);
  } catch {
    console.error(logSymbols.error, chalk.red("Registry cell does not contain a valid BLKL payload."));
    process.exit(1);
  }

  // ── build new BLKL payload ────────────────────────────────────────────────

  const oldBlkl = hexToBytes(cell.data);
  let newEntries;

  if (proposal.action === "add") {
    if (currentPayload.entries.some((e) => strip0x(e.identifier).toLowerCase() === strip0x(proposal.lockArgs).toLowerCase())) {
      console.log(logSymbols.warning, chalk.yellow(`${proposal.lockArgs} is already in the registry.`));
      process.exit(0);
    }
    newEntries = insertSorted(currentPayload.entries, {
      identifier: proposal.lockArgs,
      expiresAt: BigInt(proposal.expiresAt),
    });
  } else {
    newEntries = removeEntry(currentPayload.entries, proposal.lockArgs);
    if (newEntries.length === currentPayload.entries.length) {
      console.log(logSymbols.warning, chalk.yellow(`${proposal.lockArgs} is not in the registry.`));
      process.exit(0);
    }
  }

  const newPayload = { version: currentPayload.version, entries: newEntries };
  const newBlkl = encodeRegistryPayload(newPayload);

  // ── build GOV1 witness with real signatures ───────────────────────────────

  const proposalIdBytes = hexToBytes(proposal.proposalIdHash);
  const voteDigestBytes = hexToBytes(proposal.voteDigestHash);
  const oldRoot = ckbBlake2b(oldBlkl);
  const newRoot = ckbBlake2b(newBlkl);

  const signers = proposal.signatures.slice(0, SIG_THRESHOLD).map((s) => ({
    index: s.signerIndex,
    sig: hexToBytes(s.signature),
  }));

  const gov1 = buildGov1Witness({
    proposalIdHash: proposalIdBytes,
    voteDigestHash: voteDigestBytes,
    oldRoot,
    newRoot,
    signers,
  });

  const witnessBytes = buildWitnessArgs({
    lock: new Uint8Array(65),
    inputType: gov1,
  });

  // ── summary ───────────────────────────────────────────────────────────────

  console.log();
  console.log(chalk.bold("Executing proposal:"), proposal.id);
  console.log(`  Action:     ${proposal.action === "add" ? chalk.green("add") : chalk.red("remove")} ${proposal.lockArgs}`);
  console.log(`  Proposer:   ${proposal.proposer}`);
  console.log(`  Signers:    ${signers.map((s) => `#${s.index}`).join(", ")}`);
  console.log(`  Old → new:  ${currentPayload.entries.length} → ${newEntries.length} entries`);
  console.log();

  // ── build tx JSON ────────────────────────────────────────────────────────

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
    console.log(chalk.dim(
      `  ckb-cli wallet sign-txs --tx-file ${txOut} --from-account <address>\n` +
      `  ckb-cli wallet apply-txs --tx-file ${txOut}`,
    ));
    console.log();
    printHints("execute");
    return;
  }

  let fromAccount = opts.fromAccount;
  if (!fromAccount && process.stdin.isTTY) {
    const { account } = await inquirer.prompt<{ account: string }>([
      {
        type: "input",
        name: "account",
        message: "Governance account address (ckb-cli --from-account):",
        validate: (v: string) => v.trim().length > 0 || "Required.",
      },
    ]);
    fromAccount = account.trim();
  }
  if (!fromAccount) {
    console.error(logSymbols.error, chalk.red("--from-account is required when using --sign."));
    process.exit(1);
  }

  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    { type: "confirm", name: "proceed", message: "Sign and submit?", default: false },
  ]);
  if (!proceed) { console.log("Aborted."); return; }

  const signSpinner = ora("Signing with ckb-cli").start();
  try {
    execSync(`ckb-cli wallet sign-txs --tx-file ${txOut} --from-account ${fromAccount}`, { stdio: "inherit" });
    signSpinner.succeed("Signed");

    const submitSpinner = ora("Submitting").start();
    const output = execSync(`ckb-cli wallet apply-txs --tx-file ${txOut}`, { encoding: "utf8" });
    submitSpinner.succeed("Submitted");

    const txHash = output.match(/0x[a-fA-F0-9]{64}/)?.[0];
    if (txHash) {
      proposal.status = "executed";
      proposal.txHash = txHash;
      saveProposal(proposal);
      console.log();
      console.log(logSymbols.success, chalk.green("Registry updated on-chain."));
      console.log(`  Tx: ${chalk.bold(txHash)}`);
      printHints("execute");
    }
  } catch (err) {
    signSpinner.fail("ckb-cli failed");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

export function executeDefaults(): Partial<ExecuteOptions> {
  return {
    rpcUrl: TESTNET_RPC_URL,
    registryTx: TESTNET_REGISTRY_CELL.txHash,
    registryIndex: String(TESTNET_REGISTRY_CELL.index),
    txOut: "gov_execute_tx.json",
    sign: false,
    fromAccount: "",
  };
}
