import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import logSymbols from "log-symbols";
import ora from "ora";
import inquirer from "inquirer";
import { getLiveCell } from "../lib/rpc.js";
import { resolveRegistryOutpoint } from "../lib/registry.js";
import {
  bytesToHex,
  extractGovernanceHeaderRaw,
  governanceTreasuryLockHash,
  parseGovernanceHeader,
  scriptToMoleculeBytes,
} from "../lib/blkl.js";
import {
  assertProposalAnchorTypeMatches,
  parseRegistryTypeIdValue,
  assertProposalCellMatches,
  reviewDelayMs,
} from "../lib/governance-v4.js";
import { isReviewWindowPassed, isVoteApproved, loadProposal, saveProposal } from "../lib/proposals.js";
import { buildWitnessArgs, ckbBlake2b, encodeRelativeTimestampSince } from "../lib/witness.js";
import { SECP256K1_DEP_GROUP, TESTNET_CONTRACT_OUTPOINTS, TESTNET_REGISTRY_CELL, TESTNET_RPC_URL } from "../lib/defaults.js";
import { hexCapacity, occupiedCapacityShannons, parseCapacity } from "../lib/capacity.js";
import { parseCellDepList, type CellDepJson } from "../lib/tx-deps.js";

const DEFAULT_FEE_SHANNONS = 100_000n;

export interface ReclaimOptions {
  proposal?: string;
  rpcUrl: string;
  registryTx: string;
  registryIndex: string;
  proposalTx?: string;
  proposalIndex?: string;
  proposalAnchorCodeTx?: string;
  proposalAnchorCodeIndex?: string;
  treasuryLockDep?: string[];
  txOut: string;
  sign: boolean;
  fromAccount: string;
  force: boolean;
}

export function reclaimDefaults(): Partial<ReclaimOptions> {
  return {
    rpcUrl: TESTNET_RPC_URL,
    registryTx: TESTNET_REGISTRY_CELL.txHash,
    registryIndex: String(TESTNET_REGISTRY_CELL.index),
    proposalAnchorCodeTx: TESTNET_CONTRACT_OUTPOINTS.proposalAnchor.txHash,
    proposalAnchorCodeIndex: String(TESTNET_CONTRACT_OUTPOINTS.proposalAnchor.index),
    txOut: "gov_reclaim_tx.json",
    sign: false,
    fromAccount: "",
    force: false,
  };
}

function parseOutputIndex(value: string, name: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return Number.parseInt(value.trim(), 10);
}

export async function reclaimCommand(opts: ReclaimOptions): Promise<void> {
  const proposalId = opts.proposal?.trim();
  if (!proposalId) {
    console.error(logSymbols.error, chalk.red("--proposal is required for anchor reclaim."));
    process.exit(1);
  }

  const proposal = loadProposal(proposalId);
  const proposalCellTx = opts.proposalTx?.trim() || proposal.proposalCellTxHash?.trim();
  const proposalIndexRaw = opts.proposalIndex ?? (
    proposal.proposalCellIndex === undefined ? undefined : String(proposal.proposalCellIndex)
  );
  if (!proposalCellTx || proposalIndexRaw === undefined) {
    console.error(logSymbols.error, chalk.red("Proposal cell outpoint is required."));
    process.exit(1);
  }

  let registryIndex: number;
  let proposalIndex: number;
  let proposalAnchorCodeIndex: number | undefined;
  let treasuryLockDeps: CellDepJson[];
  try {
    registryIndex = parseOutputIndex(opts.registryIndex, "--registry-index");
    proposalIndex = parseOutputIndex(proposalIndexRaw, "--proposal-index");
    proposalAnchorCodeIndex = opts.proposalAnchorCodeIndex === undefined
      ? undefined
      : parseOutputIndex(opts.proposalAnchorCodeIndex, "--proposal-anchor-code-index");
    treasuryLockDeps = parseCellDepList(opts.treasuryLockDep, "--treasury-lock-dep");
  } catch (err) {
    console.error(logSymbols.error, chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  if (proposal.status === "executed") {
    console.error(logSymbols.error, chalk.red("Executed proposals cannot be reclaimed; their anchor was consumed by execution."));
    process.exit(1);
  }
  if (!opts.force) {
    if (!isReviewWindowPassed(proposal)) {
      console.error(logSymbols.error, chalk.red("Review window has not passed. Refusing to reclaim a live proposal anchor."));
      process.exit(1);
    }
    if (isVoteApproved(proposal) && proposal.status !== "rejected") {
      console.error(logSymbols.error, chalk.red("Proposal reached vote threshold. Use execute, or pass --force if governance has abandoned it."));
      process.exit(1);
    }
  }

  const spinner = ora("Building proposal-anchor reclaim transaction").start();
  let returnCapacity: bigint;
  let proposalCell: Awaited<ReturnType<typeof getLiveCell>>;
  let since: string;
  let proposalAnchorCellDep: { out_point: { tx_hash: string; index: string }; dep_type: "code" };
  try {
    const { txHash, index } = await resolveRegistryOutpoint(opts.rpcUrl, opts.registryTx, registryIndex);
    const registryCell = await getLiveCell(opts.rpcUrl, txHash, index);
    if (!registryCell.type) throw new Error("Registry cell has no type script.");
    const registryTypeIdValue = parseRegistryTypeIdValue(registryCell.type.args);
    const govHeaderRaw = extractGovernanceHeaderRaw(registryCell.data);
    const govHeader = govHeaderRaw ? parseGovernanceHeader(govHeaderRaw) : null;
    const treasuryLockHash = governanceTreasuryLockHash(govHeader);
    if (!treasuryLockHash) {
      throw new Error("Registry does not declare a treasury; anchor reclaim is only supported for treasury registries.");
    }

    proposalCell = await getLiveCell(opts.rpcUrl, proposalCellTx, proposalIndex);
    assertProposalCellMatches(proposal, proposalCell.data, registryTypeIdValue);
    const delayMs = reviewDelayMs(proposal);
    assertProposalAnchorTypeMatches({
      proposalCellType: proposalCell.type,
      registryTypeIdValue,
      governanceHeader: govHeader,
      reclaimDelayMs: delayMs,
    });
    if (!opts.proposalAnchorCodeTx || proposalAnchorCodeIndex === undefined) {
      throw new Error(
        "Typed proposal anchors require --proposal-anchor-code-tx and --proposal-anchor-code-index so the transaction can include the anchor type script cell_dep.",
      );
    }
    proposalAnchorCellDep = {
      out_point: { tx_hash: opts.proposalAnchorCodeTx, index: `0x${proposalAnchorCodeIndex.toString(16)}` },
      dep_type: "code",
    };
    const proposalLockHash = ckbBlake2b(scriptToMoleculeBytes(proposalCell.lock));
    if (bytesToHex(proposalLockHash) !== bytesToHex(treasuryLockHash)) {
      throw new Error("Proposal cell is not locked to the registry treasury.");
    }

    const proposalCapacity = parseCapacity(proposalCell.capacity);
    returnCapacity = proposalCapacity - DEFAULT_FEE_SHANNONS;
    const minReturnCapacity = occupiedCapacityShannons({ lock: proposalCell.lock, type: null, data: "0x" });
    if (returnCapacity < minReturnCapacity) {
      throw new Error(
        `Proposal cell capacity ${proposalCapacity} shannons is too small to reclaim after fee. ` +
        `Need at least ${minReturnCapacity + DEFAULT_FEE_SHANNONS} shannons.`,
      );
    }
    since = encodeRelativeTimestampSince(delayMs);
    spinner.succeed("Proposal-anchor reclaim transaction verified");
  } catch (err) {
    spinner.fail("Could not build reclaim transaction");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  const txJson = {
    transaction: {
      version: "0x0",
      cell_deps: [
        { out_point: { tx_hash: SECP256K1_DEP_GROUP.txHash, index: "0x0" }, dep_type: "dep_group" },
        ...treasuryLockDeps,
        proposalAnchorCellDep,
      ],
      // The `since` MTP delay is enforced by CKB consensus, not by scripts
      // calling load_header() — so no header_deps are needed.
      header_deps: [],
      inputs: [
        {
          since,
          previous_output: { tx_hash: proposalCellTx, index: `0x${proposalIndex.toString(16)}` },
        },
      ],
      outputs: [
        { capacity: hexCapacity(returnCapacity), lock: proposalCell.lock, type: null },
      ],
      outputs_data: ["0x"],
      witnesses: [bytesToHex(buildWitnessArgs({}))],
    },
    multisig_configs: {},
    signatures: {},
  };

  writeFileSync(opts.txOut, JSON.stringify(txJson, null, 2) + "\n");
  saveProposal(proposal);

  console.log();
  console.log(logSymbols.success, chalk.green(`Reclaim transaction written to ${opts.txOut}`));
  console.log(`  Proposal:       ${proposal.id}`);
  console.log(`  Proposal cell:  ${proposalCellTx}:${proposalIndex}`);
  console.log(`  Return:         ${returnCapacity} shannons`);
  console.log(`  Since delay:    ${since}`);
  console.log();

  if (!opts.sign) {
    console.log("Sign and submit with ckb-cli:");
    console.log(chalk.dim(
      `  ckb-cli wallet sign-txs --tx-file ${opts.txOut} --from-account <treasury-address>\n` +
      `  ckb-cli wallet apply-txs --tx-file ${opts.txOut}`,
    ));
    return;
  }

  let fromAccount = opts.fromAccount;
  if (!fromAccount && process.stdin.isTTY) {
    const { account } = await inquirer.prompt<{ account: string }>([
      {
        type: "input",
        name: "account",
        message: "Treasury account address for ckb-cli:",
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
    { type: "confirm", name: "proceed", message: "Sign and submit reclaim transaction?", default: false },
  ]);
  if (!proceed) {
    console.log("Aborted.");
    return;
  }

  const signSpinner = ora("Signing with ckb-cli").start();
  try {
    execFileSync("ckb-cli", ["wallet", "sign-txs", "--tx-file", opts.txOut, "--from-account", fromAccount], { stdio: "inherit" });
    signSpinner.succeed("Signed");

    const submitSpinner = ora("Submitting").start();
    const output = execFileSync("ckb-cli", ["wallet", "apply-txs", "--tx-file", opts.txOut], { encoding: "utf8" });
    submitSpinner.succeed("Submitted");
    const txHash = output.match(/0x[a-fA-F0-9]{64}/)?.[0];
    if (txHash) {
      console.log(`  Tx hash: ${txHash}`);
    } else {
      console.log(output);
    }
  } catch (err) {
    signSpinner.fail("ckb-cli signing/submission failed");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
