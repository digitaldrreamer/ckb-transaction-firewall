#!/usr/bin/env node
import { program } from "commander";
import cfonts from "cfonts";
import { inspectCommand, inspectDefaults } from "./commands/inspect.js";
import { proposeCommand } from "./commands/propose.js";
import { proposalsCommand } from "./commands/proposals.js";
import { voteCommand, voteDefaults } from "./commands/vote.js";
import { signCommand, signDefaults } from "./commands/sign.js";
import { executeCommand, executeDefaults } from "./commands/execute.js";
import { exportCommand } from "./commands/export.js";
import { importCommand } from "./commands/import.js";
import { checkCommand, checkDefaults } from "./commands/check.js";
import { guiCommand } from "./commands/gui.js";

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
  .version("0.3.1")
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
  .option("--action <add|remove>", "Proposal action")
  .option("--lock-args <hex>", "Lock args to add or remove")
  .option("--expires-at <timestamp>", "Expiry timestamp (add only, 0 = never)")
  .option("--evidence <text>", "Evidence URL, tx hash, or description")
  .option("--classification <type>", "Threat classification: theft|scam|hack|sanctions|other")
  .option("--severity <level>", "Severity: critical|high|medium|low")
  .option("--rationale <text>", "Impact statement and rationale")
  .option("--proposer <name>", "Your name or identifier")
  .action(async (opts: {
    action?: string;
    lockArgs?: string;
    expiresAt?: string;
    evidence?: string;
    classification?: string;
    severity?: string;
    rationale?: string;
    proposer?: string;
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
  .action(async (opts: { proposal?: string; vote?: string; rpcUrl: string; registryTx: string; registryIndex: string }) => {
    await voteCommand(opts);
  });

// ── sign ──────────────────────────────────────────────────────────────────────

const signDefs = signDefaults();

program
  .command("sign")
  .description("Sign an approved proposal as a governance signer (secp256k1)")
  .option("--proposal <id>", "Proposal ID or hash")
  .option("--signer-index <n>", "Your signer index in the governance set")
  .option("--rpc-url <url>", "CKB node RPC URL", signDefs.rpcUrl)
  .option("--registry-tx <hash>", "Registry cell tx hash", signDefs.registryTx)
  .option("--registry-index <n>", "Registry cell output index", signDefs.registryIndex)
  .action(async (opts: { proposal?: string; signerIndex?: string; rpcUrl: string; registryTx: string; registryIndex: string }) => {
    await signCommand(opts);
  });

// ── execute ───────────────────────────────────────────────────────────────────

const execDefs = executeDefaults();

program
  .command("execute")
  .description("Execute an approved, signed proposal — builds and submits the governance tx")
  .option("--proposal <id>", "Proposal ID or hash")
  .option("--rpc-url <url>", "CKB node RPC URL", execDefs.rpcUrl)
  .option("--registry-tx <hash>", "Registry cell tx hash", execDefs.registryTx)
  .option("--registry-index <n>", "Registry cell output index", execDefs.registryIndex)
  .option("--tx-out <file>", "Write tx JSON to this file", execDefs.txOut)
  .option("--sign", "Sign and submit via ckb-cli")
  .option("--from-account <address>", "Governance account for ckb-cli signing", execDefs.fromAccount)
  .action(async (opts: {
    proposal?: string;
    rpcUrl: string;
    registryTx: string;
    registryIndex: string;
    txOut: string;
    sign: boolean;
    fromAccount: string;
  }) => {
    await executeCommand(opts);
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
  .description("Open the governance dashboard in a browser (read-only explorer)")
  .option("--port <n>", "Local port to listen on", "7979")
  .option("--no-open", "Print the URL but don't auto-open the browser")
  .action(async (opts: { port?: string; noOpen?: boolean }) => {
    await guiCommand(opts);
  });

// Show banner on bare invocation before help prints.
if (process.argv.length <= 2) printBanner();

program.parse(process.argv);
