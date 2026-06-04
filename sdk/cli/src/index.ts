#!/usr/bin/env node
import { program } from "commander";
import cfonts from "cfonts";
import { inspectCommand, inspectDefaults } from "./commands/inspect.js";
import { proposeCommand } from "./commands/propose.js";
import { proposalsCommand } from "./commands/proposals.js";
import { voteCommand, voteDefaults } from "./commands/vote.js";
import { executeCommand, executeDefaults } from "./commands/execute.js";
import { exportCommand } from "./commands/export.js";
import { importCommand } from "./commands/import.js";
import { checkCommand, checkDefaults } from "./commands/check.js";
import { guiCommand } from "./commands/gui.js";
import { anchorCommand, anchorDefaults } from "./commands/anchor.js";
import { reclaimCommand, reclaimDefaults } from "./commands/reclaim.js";
import { configCommand } from "./commands/config.js";

function printBanner(): void {
  cfonts.say("CKB FIREWALL|CLI", {
    font: "block",
    align: "left",
    colors: ["cyan", "white"],
    background: "transparent",
    letterSpacing: 1,
    lineHeight: 1,
    space: false,
    maxLength: "0",
  });
}

program
  .name("ckb-firewall")
  .description("Manage the CKB Transaction Firewall blacklist registry")
  .version("0.5.0")
  .addHelpCommand(false);

// ── inspect ──────────────────────────────────────────────────────────────────

const inspectDefs = inspectDefaults();

program
  .command("inspect")
  .description("Display current blacklist registry entries")
  .option("--rpc-url <url>", "CKB node RPC URL", inspectDefs.rpcUrl)
  .option("--registry-tx <hash>", "Registry cell tx hash", inspectDefs.registryTx)
  .option("--registry-index <n>", "Registry cell output index", inspectDefs.registryIndex)
  .action(async (opts: { rpcUrl: string; registryTx: string; registryIndex: string }) => {
    await inspectCommand(opts);
  });

// ── check ─────────────────────────────────────────────────────────────────────

const checkDefs = checkDefaults();

program
  .command("check")
  .description("Test whether a lock-args identifier is currently blacklisted")
  .requiredOption("--lock-args <hex>", "Lock args to check (0x-prefixed hex)")
  .option("--rpc-url <url>", "CKB node RPC URL", checkDefs.rpcUrl)
  .option("--registry-tx <hash>", "Registry cell tx hash", checkDefs.registryTx)
  .option("--registry-index <n>", "Registry cell output index", checkDefs.registryIndex)
  .action(async (opts: { lockArgs: string; rpcUrl: string; registryTx: string; registryIndex: string }) => {
    await checkCommand(opts);
  });

// ── propose ───────────────────────────────────────────────────────────────────

program
  .command("propose")
  .description("Create a governance proposal (72h review + voting + signing + on-chain execution)")
  .option("--action <add|remove|set-treasury>", "Proposal action")
  .option("--lock-args <hex>", "Lock args to add or remove")
  .option("--expires-at <timestamp>", "Expiry timestamp (add only, 0 = never)")
  .option("--evidence <text>", "Evidence URL, tx hash, or description")
  .option("--classification <type>", "Threat classification: theft|scam|hack|sanctions|other")
  .option("--severity <level>", "Severity: critical|high|medium|low")
  .option("--rationale <text>", "Impact statement and rationale")
  .option("--proposer <name>", "Your name or identifier")
  .option("--treasury-lock-code-hash <hash>", "Treasury lock script code hash for set-treasury proposals")
  .option("--treasury-lock-hash-type <type>", "Treasury lock script hash type for set-treasury proposals")
  .option("--treasury-lock-args <hex>", "Treasury lock script args for set-treasury proposals")
  .option("--review-delay-ms <ms>", "Override the on-chain review delay in ms (testnet/drill only)")
  .action(async (opts: {
    action?: string;
    lockArgs?: string;
    expiresAt?: string;
    evidence?: string;
    classification?: string;
    severity?: string;
    rationale?: string;
    proposer?: string;
    treasuryLockCodeHash?: string;
    treasuryLockHashType?: string;
    treasuryLockArgs?: string;
    reviewDelayMs?: string;
  }) => {
    await proposeCommand(opts);
  });

// ── proposals (list) ──────────────────────────────────────────────────────────

program
  .command("proposals")
  .description("List governance proposals and their status")
  .option("--status <status>", "Filter by status: pending-review|voting|approved|executed|rejected")
  .action(async (opts: { status?: string }) => {
    await proposalsCommand(opts);
  });

// ── vote ──────────────────────────────────────────────────────────────────────

const voteDefs = voteDefaults();

program
  .command("vote")
  .description("Record a cryptographically signed validator vote on a governance proposal")
  .option("--proposal <id>", "Proposal ID or hash")
  .option("--vote <choice>", "Vote: yes|no|abstain")
  .option("--rpc-url <url>", "CKB node RPC URL", voteDefs.rpcUrl)
  .option("--registry-tx <hash>", "Registry cell tx hash", voteDefs.registryTx)
  .option("--registry-index <n>", "Registry cell output index", voteDefs.registryIndex)
  .option("--private-key <hex>", "Validator private key hex (non-interactive use)")
  .action(async (opts: { proposal?: string; vote?: string; rpcUrl: string; registryTx: string; registryIndex: string; privateKey?: string }) => {
    await voteCommand(opts);
  });

// ── anchor proposal cell ─────────────────────────────────────────────────────

const anchorDefs = anchorDefaults();

program
  .command("anchor")
  .description("Build or submit the GOV1 v4 PBLK proposal cell")
  .requiredOption("--proposal <id>", "Proposal ID or hash")
  .option("--rpc-url <url>", "CKB node RPC URL", anchorDefs.rpcUrl)
  .option("--registry-tx <hash>", "Registry cell tx hash", anchorDefs.registryTx)
  .option("--registry-index <n>", "Registry cell output index", anchorDefs.registryIndex)
  .option("--to-address <address>", "Address that will receive and later spend the proposal cell")
  .option("--from-account <address>", "Funding account for ckb-cli wallet transfer")
  .option("--capacity <ckb>", "Proposal cell capacity in CKB", anchorDefs.capacity)
  .option("--fee-rate <shannons>", "ckb-cli transfer fee rate", anchorDefs.feeRate)
  .option("--privkey-path <file>", "Private key file for non-interactive ckb-cli transfer")
  .option("--output-index <n>", "Expected proposal-cell output index when submitting", "0")
  .option("--proposal-tx <hash>", "Already-submitted proposal cell tx hash to store on the proposal")
  .option("--proposal-index <n>", "Already-submitted proposal cell output index to store on the proposal")
  .option("--proposal-anchor-code-tx <hash>", "Proposal-anchor type script code cell tx hash for treasury-backed anchors", anchorDefs.proposalAnchorCodeTx)
  .option("--proposal-anchor-code-index <n>", "Proposal-anchor type script code cell output index for treasury-backed anchors", anchorDefs.proposalAnchorCodeIndex)
  .option("--treasury-cell <tx-hash:index>", "Treasury input cell for typed anchor creation; repeatable", (value, previous: string[]) => {
    previous.push(value);
    return previous;
  }, [])
  .option("--treasury-lock-dep <tx-hash:index[:code|dep_group]>", "Extra cell dep required by the treasury lock script; repeatable", (value, previous: string[]) => {
    previous.push(value);
    return previous;
  }, [])
  .option("--tx-out <file>", "Write typed treasury anchor tx JSON to this file", anchorDefs.txOut)
  .option("--submit", "Submit the anchor transaction instead of only printing/writing instructions")
  .action(async (opts: {
    proposal: string;
    rpcUrl: string;
    registryTx: string;
    registryIndex: string;
    toAddress?: string;
    fromAccount?: string;
    capacity: string;
    feeRate: string;
    privkeyPath?: string;
    outputIndex?: string;
    proposalTx?: string;
    proposalIndex?: string;
    proposalAnchorCodeTx?: string;
    proposalAnchorCodeIndex?: string;
    treasuryCell?: string[];
    treasuryLockDep?: string[];
    txOut: string;
    submit: boolean;
  }) => {
    await anchorCommand(opts);
  });

// ── execute ───────────────────────────────────────────────────────────────────

const execDefs = executeDefaults();

program
  .command("execute")
  .description("Execute an approved validator-voted proposal — builds and submits the governance tx")
  .option("--proposal <id>", "Proposal ID or hash")
  .option("--ready", "Find and execute all proposals with votes complete and review window passed")
  .option("--rpc-url <url>", "CKB node RPC URL", execDefs.rpcUrl)
  .option("--registry-tx <hash>", "Registry cell tx hash", execDefs.registryTx)
  .option("--registry-index <n>", "Registry cell output index", execDefs.registryIndex)
  .option("--proposal-tx <hash>", "PBLK proposal cell tx hash")
  .option("--proposal-index <n>", "PBLK proposal cell output index")
  .option("--proposal-anchor-code-tx <hash>", "Proposal-anchor type script code cell tx hash", execDefs.proposalAnchorCodeTx)
  .option("--proposal-anchor-code-index <n>", "Proposal-anchor type script code cell output index", execDefs.proposalAnchorCodeIndex)
  .option("--treasury-cell <tx-hash:index>", "Treasury input cell for registry growth; repeatable", (value, previous: string[]) => {
    previous.push(value);
    return previous;
  }, [])
  .option("--treasury-lock-dep <tx-hash:index[:code|dep_group]>", "Extra cell dep required by the treasury lock script; repeatable", (value, previous: string[]) => {
    previous.push(value);
    return previous;
  }, [])
  .option("--tx-out <file>", "Write tx JSON to this file", execDefs.txOut)
  .option("--sign", "Sign and submit interactively via ckb-cli wallet")
  .option("--privkey-path <file>", "Treasury private key file for non-interactive signing and submission")
  .option("--from-account <address>", "Fee-payer/proposal-cell owner account for ckb-cli signing", execDefs.fromAccount)
  .action(async (opts: {
    proposal?: string;
    ready?: boolean;
    rpcUrl: string;
    registryTx: string;
    registryIndex: string;
    proposalTx?: string;
    proposalIndex?: string;
    proposalAnchorCodeTx?: string;
    proposalAnchorCodeIndex?: string;
    treasuryCell?: string[];
    treasuryLockDep?: string[];
    txOut: string;
    sign: boolean;
    fromAccount: string;
    privkeyPath?: string;
  }) => {
    await executeCommand(opts);
  });

// ── reclaim proposal anchor ──────────────────────────────────────────────────

const reclaimDefs = reclaimDefaults();

program
  .command("reclaim")
  .description("Reclaim a rejected or abandoned treasury-funded PBLK proposal anchor")
  .requiredOption("--proposal <id>", "Proposal ID or hash")
  .option("--rpc-url <url>", "CKB node RPC URL", reclaimDefs.rpcUrl)
  .option("--registry-tx <hash>", "Registry cell tx hash", reclaimDefs.registryTx)
  .option("--registry-index <n>", "Registry cell output index", reclaimDefs.registryIndex)
  .option("--proposal-tx <hash>", "PBLK proposal cell tx hash")
  .option("--proposal-index <n>", "PBLK proposal cell output index")
  .option("--proposal-anchor-code-tx <hash>", "Proposal-anchor type script code cell tx hash", reclaimDefs.proposalAnchorCodeTx)
  .option("--proposal-anchor-code-index <n>", "Proposal-anchor type script code cell output index", reclaimDefs.proposalAnchorCodeIndex)
  .option("--treasury-lock-dep <tx-hash:index[:code|dep_group]>", "Extra cell dep required by the treasury lock script; repeatable", (value, previous: string[]) => {
    previous.push(value);
    return previous;
  }, [])
  .option("--tx-out <file>", "Write tx JSON to this file", reclaimDefs.txOut)
  .option("--sign", "Sign and submit via ckb-cli")
  .option("--from-account <address>", "Treasury account for ckb-cli signing", reclaimDefs.fromAccount)
  .option("--force", "Allow reclaim even if the local proposal status is still executable")
  .action(async (opts: {
    proposal: string;
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
  }) => {
    await reclaimCommand(opts);
  });

// ── export ────────────────────────────────────────────────────────────────────

program
  .command("export")
  .description("Export a proposal to a shareable JSON file")
  .option("--proposal <id>", "Proposal ID or hash")
  .option("--out <file>", "Output file path (prints to stdout if omitted)")
  .action(async (opts: { proposal?: string; out?: string }) => {
    await exportCommand(opts);
  });

// ── import ────────────────────────────────────────────────────────────────────

program
  .command("import")
  .description("Import a proposal shared by another governance participant")
  .argument("<file>", "Path to the exported proposal JSON")
  .option("--force", "Overwrite an existing proposal without prompting")
  .action(async (file: string, opts: { force?: boolean }) => {
    await importCommand({ file, ...opts });
  });

// ── gui ───────────────────────────────────────────────────────────────────────

program
  .command("gui")
  .description("Open the governance dashboard in a browser (propose, vote, sign, execute)")
  .option("--port <n>", "Local port to listen on", "7979")
  .option("--no-open", "Print the URL but don't auto-open the browser")
  .action(async (opts: { port?: string; noOpen?: boolean }) => {
    await guiCommand(opts);
  });

// ── config ────────────────────────────────────────────────────────────────────

program
  .command("config")
  .description("View or set persistent CLI defaults (proposer name, etc.)")
  .option("--proposer <name>", "Set default proposer name for governance proposals")
  .action(async (opts: { proposer?: string }) => {
    await configCommand(opts);
  });

// Show banner on bare invocation before help prints.
if (process.argv.length <= 2) printBanner();

program.parse(process.argv);
