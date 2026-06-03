import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import chalk from "chalk";
import logSymbols from "log-symbols";
import ora from "ora";
import { getLiveCell, getLiveCellsByLock } from "../lib/rpc.js";
import { resolveRegistryOutpoint } from "../lib/registry.js";
import {
  bytesToHex,
  extractGovernanceHeaderRaw,
  governanceTreasuryLockHash,
  hexToBytes,
  parseGovernanceHeader,
  scriptToMoleculeBytes,
} from "../lib/blkl.js";
import {
  assertProposalCellMatches,
  assertProposalAnchorTypeMatches,
  encodeProposalAnchorTypeArgs,
  encodeProposalCellData,
  parseRegistryTypeIdValue,
  proposalCellDataHash,
} from "../lib/governance-v4.js";
import { loadProposal, saveProposal, REVIEW_WINDOW_MS } from "../lib/proposals.js";
import { SECP256K1_DEP_GROUP, TESTNET_CONTRACT_OUTPOINTS, TESTNET_GOVERNANCE_LOCK_SCRIPT, TESTNET_REGISTRY_CELL, TESTNET_RPC_URL, TESTNET_TREASURY_LOCK_DEP, TESTNET_TREASURY_LOCK_SCRIPT } from "../lib/defaults.js";
import { buildWitnessArgs, ckbBlake2b } from "../lib/witness.js";
import { hexCapacity, occupiedCapacityShannons, parseCapacity } from "../lib/capacity.js";
import { parseCellDepList, type CellDepJson } from "../lib/tx-deps.js";

const DEFAULT_FEE_SHANNONS = 100_000n;

export interface AnchorOptions {
  proposal?: string;
  rpcUrl: string;
  registryTx: string;
  registryIndex: string;
  toAddress?: string;
  fromAccount?: string;
  capacity: string;
  feeRate: string;
  submit: boolean;
  privkeyPath?: string;
  outputIndex?: string;
  proposalTx?: string;
  proposalIndex?: string;
  proposalAnchorCodeTx?: string;
  proposalAnchorCodeIndex?: string;
  treasuryCell?: string[];
  treasuryLockDep?: string[];
  txOut: string;
}

export function anchorDefaults(): Partial<AnchorOptions> {
  return {
    rpcUrl: TESTNET_RPC_URL,
    registryTx: TESTNET_REGISTRY_CELL.txHash,
    registryIndex: String(TESTNET_REGISTRY_CELL.index),
    capacity: "auto",
    feeRate: "1000",
    proposalAnchorCodeTx: TESTNET_CONTRACT_OUTPOINTS.proposalAnchor.txHash,
    proposalAnchorCodeIndex: String(TESTNET_CONTRACT_OUTPOINTS.proposalAnchor.index),
    submit: false,
    txOut: "gov_anchor_tx.json",
  };
}

function requireProposalId(id: string | undefined): string {
  const trimmed = id?.trim();
  if (!trimmed) throw new Error("--proposal is required.");
  return trimmed;
}

function parseRegistryIndex(value: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error("--registry-index must be a non-negative integer.");
  return Number.parseInt(value.trim(), 10);
}

function parseOutputIndex(value: string | undefined, name: string): number {
  const raw = value?.trim() || "0";
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer.`);
  return Number.parseInt(raw, 10);
}

function parseTxHash(value: string | undefined, name: string): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error(`${name} must be a 0x-prefixed 32-byte transaction hash.`);
  return raw;
}

function parseOutpointList(values: string[] | undefined, name: string): Array<{ txHash: string; index: number }> {
  return (values ?? []).map((value) => {
    const raw = value.trim();
    const match = /^(0x[0-9a-fA-F]{64})(?::|#)(\d+)$/.exec(raw);
    if (!match) {
      throw new Error(`${name} must be formatted as <tx-hash>:<index>. Got "${value}".`);
    }
    return { txHash: match[1]!, index: Number.parseInt(match[2]!, 10) };
  });
}

function parseCkbToShannons(value: string): bigint {
  const raw = value.trim();
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(raw);
  if (!match) {
    throw new Error("--capacity must be a non-negative CKB amount with at most 8 decimal places.");
  }
  const whole = BigInt(match[1]!);
  const fraction = (match[2] ?? "").padEnd(8, "0");
  return whole * 100_000_000n + BigInt(fraction || "0");
}

function scriptHash(script: { code_hash: string; hash_type: string; args: string }): string {
  return bytesToHex(ckbBlake2b(scriptToMoleculeBytes(script)));
}

function codeScriptFromLiveCell(cell: Awaited<ReturnType<typeof getLiveCell>>): { code_hash: string; hash_type: string } {
  if (cell.type) {
    return { code_hash: scriptHash(cell.type), hash_type: "type" };
  }
  return { code_hash: bytesToHex(ckbBlake2b(hexToBytes(cell.data))), hash_type: "data1" };
}

export async function anchorCommand(opts: AnchorOptions): Promise<void> {
  let proposalId: string;
  let registryIndex: number;
  let outputIndex: number;
  let providedProposalTx: string | undefined;
  let providedProposalIndex: number | undefined;
  let proposalAnchorCodeIndex: number | undefined;
  let anchorCapacity: bigint;
  let treasuryLockDeps: CellDepJson[];
  try {
    proposalId = requireProposalId(opts.proposal);
    registryIndex = parseRegistryIndex(opts.registryIndex);
    outputIndex = parseOutputIndex(opts.outputIndex, "--output-index");
    providedProposalTx = parseTxHash(opts.proposalTx, "--proposal-tx");
    providedProposalIndex = opts.proposalIndex === undefined ? undefined : parseOutputIndex(opts.proposalIndex, "--proposal-index");
    proposalAnchorCodeIndex = opts.proposalAnchorCodeIndex === undefined
      ? undefined
      : parseOutputIndex(opts.proposalAnchorCodeIndex, "--proposal-anchor-code-index");
    anchorCapacity = opts.capacity === "auto" ? 0n : parseCkbToShannons(opts.capacity);
    treasuryLockDeps = parseCellDepList(opts.treasuryLockDep, "--treasury-lock-dep");
    if ((providedProposalTx && providedProposalIndex === undefined) || (!providedProposalTx && providedProposalIndex !== undefined)) {
      throw new Error("--proposal-tx and --proposal-index must be provided together.");
    }
  } catch (err) {
    console.error(logSymbols.error, chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  const proposal = loadProposal(proposalId);
  const spinner = ora("Building PBLK proposal cell data").start();
  let proposalDataHex: string;
  let proposalDataHashHex: string;
  let treasuryLockHash: Uint8Array | undefined;
  let treasuryLockScript: { code_hash: string; hash_type: string; args: string } | undefined;
  let registryTypeIdValue: Uint8Array;
  try {
    const { txHash, index } = await resolveRegistryOutpoint(opts.rpcUrl, opts.registryTx, registryIndex);
    const registryCell = await getLiveCell(opts.rpcUrl, txHash, index);
    if (!registryCell.type) throw new Error("Registry cell has no type script.");
    registryTypeIdValue = parseRegistryTypeIdValue(registryCell.type.args);
    const governanceHeaderRaw = extractGovernanceHeaderRaw(registryCell.data);
    const governanceHeader = governanceHeaderRaw ? parseGovernanceHeader(governanceHeaderRaw) : null;
    treasuryLockHash = governanceTreasuryLockHash(governanceHeader);
    treasuryLockScript = governanceHeader?.treasuryLockScript;
    if (treasuryLockHash && !treasuryLockScript) {
      throw new Error(
        "Registry treasury lock script is missing from the governance header. " +
        "A full treasury lock script (v3 header) is required to safely route change capacity."
      );
    }
    const proposalData = encodeProposalCellData(proposal, registryTypeIdValue);
    proposalDataHex = bytesToHex(proposalData);
    proposalDataHashHex = bytesToHex(proposalCellDataHash(proposal, registryTypeIdValue));
    proposal.proposalDataHash = proposalDataHashHex;
    proposal.reviewDelayMs = proposal.reviewDelayMs ?? String(REVIEW_WINDOW_MS);
    if (providedProposalTx) {
      const proposalCell = await getLiveCell(opts.rpcUrl, providedProposalTx, providedProposalIndex!);
      assertProposalCellMatches(proposal, proposalCell.data, registryTypeIdValue);
      assertProposalAnchorTypeMatches({
        proposalCellType: proposalCell.type,
        registryTypeIdValue,
        governanceHeader,
        reclaimDelayMs: BigInt(proposal.reviewDelayMs),
      });
      // Proposal cells now use governance-lock (not treasury secp256k1), so no lock check here.
      proposal.proposalCellTxHash = providedProposalTx;
      proposal.proposalCellIndex = providedProposalIndex!;
    }
    saveProposal(proposal);
    spinner.succeed("PBLK proposal cell data built");
  } catch (err) {
    spinner.fail("Could not build PBLK proposal cell data");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  console.log();
  console.log(chalk.bold("Proposal cell"));
  console.log(`  Proposal:        ${proposal.id}`);
  console.log(`  Data hash:       ${proposalDataHashHex}`);
  console.log(`  Review delay ms: ${proposal.reviewDelayMs}`);
  if (proposal.proposalCellTxHash) {
    console.log(`  Stored outpoint:  ${proposal.proposalCellTxHash}:${proposal.proposalCellIndex ?? 0}`);
  }
  console.log(`  Data:            ${chalk.dim(proposalDataHex)}`);
  console.log();

  if (providedProposalTx) {
    console.log(chalk.green(`Stored proposal cell outpoint. Execute can now use: ckb-firewall execute --proposal ${proposal.id}`));
    return;
  }

  if (treasuryLockHash) {
    if (!treasuryLockScript) {
      console.error(logSymbols.error, chalk.red("This registry declares only a treasury lock hash, not a full treasury lock script."));
      console.error(chalk.dim("Typed anchor creation needs BLKL governance header v3 so the CLI can build the treasury-locked output."));
      process.exit(1);
    }
    if (!opts.proposalAnchorCodeTx || proposalAnchorCodeIndex === undefined) {
      console.error(logSymbols.error, chalk.red("--proposal-anchor-code-tx and --proposal-anchor-code-index are required for treasury-backed anchors."));
      process.exit(1);
    }

    const typedSpinner = ora("Building keyless treasury anchor transaction").start();
    let selectedTreasuryCells: Array<Awaited<ReturnType<typeof getLiveCell>>>;
    let totalInput = 0n;
    let anchorType: { code_hash: string; hash_type: string; args: string };
    try {
      const codeCell = await getLiveCell(opts.rpcUrl, opts.proposalAnchorCodeTx, proposalAnchorCodeIndex);
      const codeScript = codeScriptFromLiveCell(codeCell);
      anchorType = {
        code_hash: codeScript.code_hash,
        hash_type: codeScript.hash_type,
        args: bytesToHex(encodeProposalAnchorTypeArgs({
          registryTypeIdValue,
          treasuryLockHash,
          reclaimDelayMs: BigInt(proposal.reviewDelayMs),
        })),
      };
      const minAnchorCapacity = occupiedCapacityShannons({
        lock: TESTNET_GOVERNANCE_LOCK_SCRIPT,
        type: anchorType,
        data: proposalDataHex,
      });
      if (opts.capacity === "auto") {
        anchorCapacity = minAnchorCapacity;
      } else if (anchorCapacity < minAnchorCapacity) {
        throw new Error(
          `--capacity ${opts.capacity} CKB is too small for this typed anchor. ` +
          `Need at least ${minAnchorCapacity} shannons (${minAnchorCapacity / 100_000_000n} CKB).`,
        );
      }

      // Use treasury-lock cells as inputs — no private key needed to spend them.
      // The treasury-lock script validates the TX structure (anchor output + capacity return).
      const rawOutpoints = parseOutpointList(opts.treasuryCell, "--treasury-cell");
      const explicitOutpoints = Array.from(
        new Map(rawOutpoints.map((op) => [`${op.txHash}:${op.index}`, op])).values()
      );
      selectedTreasuryCells = explicitOutpoints.length
        ? await Promise.all(explicitOutpoints.map((op) => getLiveCell(opts.rpcUrl, op.txHash, op.index)))
        : [];
      for (const cell of selectedTreasuryCells) {
        if (cell.type) throw new Error(`Treasury cell ${cell.txHash}:${cell.index} has a type script; use plain treasury cells.`);
        if (cell.data !== "0x") throw new Error(`Treasury cell ${cell.txHash}:${cell.index} has data; use empty treasury cells.`);
        totalInput += parseCapacity(cell.capacity);
      }

      if (!explicitOutpoints.length) {
        // Auto-discover treasury-lock cells from chain.
        const candidates = await getLiveCellsByLock(opts.rpcUrl, treasuryLockScript!, 100);
        for (const cell of candidates) {
          if (cell.type || cell.data !== "0x") continue;
          selectedTreasuryCells.push(cell);
          totalInput += parseCapacity(cell.capacity);
          if (totalInput >= anchorCapacity + DEFAULT_FEE_SHANNONS) break;
        }
      }
      if (totalInput < anchorCapacity + DEFAULT_FEE_SHANNONS) {
        throw new Error(
          `Treasury pool has ${totalInput / 100_000_000n} CKB but anchor needs ` +
          `${(anchorCapacity + DEFAULT_FEE_SHANNONS) / 100_000_000n} CKB. ` +
          "Donate CKB to the treasury: ckb-firewall donate",
        );
      }
      typedSpinner.succeed("Keyless treasury anchor transaction built");
    } catch (err) {
      typedSpinner.fail("Could not build anchor transaction");
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }

    const changeCapacity = totalInput - anchorCapacity - DEFAULT_FEE_SHANNONS;
    const txJson = {
      transaction: {
        version: "0x0",
        cell_deps: [
          // treasury-lock code cell dep (validates the TX structure, no signature needed)
          {
            out_point: { tx_hash: TESTNET_TREASURY_LOCK_DEP.txHash, index: `0x${TESTNET_TREASURY_LOCK_DEP.index.toString(16)}` },
            dep_type: "code",
          },
          ...treasuryLockDeps,
          {
            out_point: {
              tx_hash: opts.proposalAnchorCodeTx,
              index: `0x${proposalAnchorCodeIndex.toString(16)}`,
            },
            dep_type: "code",
          },
          // governance-lock code cell dep (needed for proposal cell output lock validation at creation)
          {
            out_point: {
              tx_hash: TESTNET_CONTRACT_OUTPOINTS.governanceLock.txHash,
              index: `0x${TESTNET_CONTRACT_OUTPOINTS.governanceLock.index.toString(16)}`,
            },
            dep_type: "code",
          },
        ],
        header_deps: [],
        inputs: selectedTreasuryCells.map((cell) => ({
          since: "0x0",
          previous_output: { tx_hash: cell.txHash, index: `0x${cell.index.toString(16)}` },
        })),
        outputs: [
          { capacity: hexCapacity(anchorCapacity), lock: TESTNET_GOVERNANCE_LOCK_SCRIPT, type: anchorType },
          ...(changeCapacity > 0n
            ? [{ capacity: hexCapacity(changeCapacity), lock: treasuryLockScript!, type: null }]
            : []),
        ],
        outputs_data: [
          proposalDataHex,
          ...(changeCapacity > 0n ? ["0x"] : []),
        ],
        // No signatures needed — treasury-lock validates TX structure, not a key.
        witnesses: selectedTreasuryCells.map(() => "0x"),
      },
      multisig_configs: {},
      signatures: {},
    };

    writeFileSync(opts.txOut, JSON.stringify(txJson, null, 2) + "\n");
    proposal.proposalCellIndex = 0;
    saveProposal(proposal);

    console.log();
    console.log(logSymbols.success, chalk.green(`Typed proposal-anchor transaction written to ${opts.txOut}`));
    console.log(`  Proposal:       ${proposal.id}`);
    console.log(`  Anchor output:  output #0`);
    console.log(`  Anchor capacity:${anchorCapacity} shannons`);
    console.log(`  Change:         ${changeCapacity} shannons`);
    console.log();

    if (!opts.submit) {
      console.log("Submit keylessly — no signing required:");
      console.log(chalk.dim(
        `  ckb-cli tx send --tx-file ${opts.txOut} --skip-check\n` +
        `  ckb-firewall anchor --proposal ${proposal.id} --proposal-tx <tx-hash> --proposal-index 0`,
      ));
      console.log();
      console.log(chalk.dim("Or pass --submit to send automatically."));
      return;
    }

    // No signing step — treasury-lock is validated by script logic, not a key.
    const submitSpinner = ora("Submitting keyless anchor transaction").start();
    try {
      const output = execFileSync("ckb-cli", [
        "--url", opts.rpcUrl,
        "tx", "send",
        "--tx-file", opts.txOut,
        "--skip-check",
      ], { encoding: "utf8" });
      submitSpinner.succeed("Submitted");
      const txHash = output.trim().match(/0x[a-fA-F0-9]{64}/)?.[0];
      if (txHash) {
        proposal.proposalCellTxHash = txHash;
        proposal.proposalCellIndex = 0;
        saveProposal(proposal);
        console.log();
        console.log(logSymbols.success, chalk.green(`Proposal anchored: ${txHash}:0`));
        console.log(chalk.dim(`  Ready to execute after the review window: ckb-firewall execute --proposal ${proposal.id}`));
      } else {
        console.log(chalk.yellow("Submitted — tx hash not parsed from output."));
        console.log(chalk.dim(output.trim()));
      }
    } catch (err) {
      submitSpinner.fail("Submission failed");
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
    return;
  }

  if (!opts.submit) {
    if (!opts.toAddress) {
      console.log(chalk.yellow("Pass --to-address to print a ready ckb-cli wallet transfer command."));
      return;
    }
    const cmd = [
      "ckb-cli",
      "--url", opts.rpcUrl,
      "wallet", "transfer",
      "--to-address", opts.toAddress,
      "--capacity", opts.capacity,
      "--to-data", proposalDataHex,
      "--fee-rate", opts.feeRate,
      "--output-format", "json",
      ...(opts.fromAccount ? ["--from-account", opts.fromAccount] : []),
      ...(opts.privkeyPath ? ["--privkey-path", opts.privkeyPath] : []),
    ];
    console.log("Create the proposal cell with:");
    console.log(chalk.dim(`  ${cmd.map((p) => (/\s/.test(p) ? JSON.stringify(p) : p)).join(" ")}`));
    console.log(chalk.dim(
      `  After it is accepted: ckb-firewall anchor --proposal ${proposal.id} --proposal-tx <tx-hash> --proposal-index ${outputIndex}`,
    ));
    return;
  }

  if (!opts.toAddress) {
    console.error(logSymbols.error, chalk.red("--to-address is required with --submit."));
    process.exit(1);
  }

  const args = [
    "--url", opts.rpcUrl,
    "wallet", "transfer",
    "--to-address", opts.toAddress,
    "--capacity", opts.capacity,
    "--to-data", proposalDataHex,
    "--fee-rate", opts.feeRate,
    "--output-format", "json",
  ];
  if (opts.fromAccount) args.push("--from-account", opts.fromAccount);
  if (opts.privkeyPath) args.push("--privkey-path", opts.privkeyPath);

  const submitSpinner = ora("Submitting proposal cell transfer with ckb-cli").start();
  try {
    const output = execFileSync("ckb-cli", args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
    submitSpinner.succeed("Proposal cell transfer submitted");
    const txHash = output.match(/0x[a-fA-F0-9]{64}/)?.[0];
    if (txHash) {
      proposal.proposalCellTxHash = txHash;
      proposal.proposalCellIndex = outputIndex;
      saveProposal(proposal);
      console.log(`  Tx hash: ${txHash}`);
      console.log(`  Stored proposal cell: ${txHash}:${outputIndex}`);
      console.log(chalk.dim(`  Execute with: ckb-firewall execute --proposal ${proposal.id}`));
    } else {
      console.log(output);
    }
  } catch (err) {
    submitSpinner.fail("ckb-cli wallet transfer failed");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
