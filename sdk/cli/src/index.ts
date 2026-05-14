#!/usr/bin/env node
import { program } from "commander";
import cfonts from "cfonts";
import { inspectCommand, inspectDefaults } from "./commands/inspect.js";
import { addCommand, addDefaults } from "./commands/add.js";
import { removeCommand, removeDefaults } from "./commands/remove.js";
import { proposeCommand } from "./commands/propose.js";
import { proposalsCommand } from "./commands/proposals.js";
import { voteCommand } from "./commands/vote.js";
import { signCommand } from "./commands/sign.js";
import { executeCommand, executeDefaults } from "./commands/execute.js";

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
  .version("0.1.0")
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

// ── add (quick path) ──────────────────────────────────────────────────────────

const addDefs = addDefaults();

program
  .command("add")
  .description("Quick: add a lock-args to the blacklist with placeholder governance (testnet/dev)")
  .option("--lock-args <hex>", "Lock args to blacklist (0x-prefixed hex)")
  .option("--expires-at <timestamp>", "Unix timestamp when entry expires (0 = never)", addDefs.expiresAt)
  .option("--rpc-url <url>", "CKB node RPC URL", addDefs.rpcUrl)
  .option("--registry-tx <hash>", "Registry cell tx hash", addDefs.registryTx)
  .option("--registry-index <n>", "Registry cell output index", addDefs.registryIndex)
  .option("--tx-out <file>", "Write unsigned tx JSON to this file", addDefs.txOut)
  .option("--sign", "Sign and submit via ckb-cli after generating the tx file")
  .option("--from-account <address>", "Governance account address for ckb-cli signing", addDefs.fromAccount)
  .action(async (opts: {
    lockArgs?: string;
    expiresAt: string;
    rpcUrl: string;
    registryTx: string;
    registryIndex: string;
    txOut: string;
    sign: boolean;
    fromAccount: string;
  }) => {
    await addCommand(opts);
  });

// ── remove (quick path) ───────────────────────────────────────────────────────

const removeDefs = removeDefaults();

program
  .command("remove")
  .description("Quick: remove a lock-args from the blacklist with placeholder governance (testnet/dev)")
  .option("--lock-args <hex>", "Lock args to remove (0x-prefixed hex)")
  .option("--rpc-url <url>", "CKB node RPC URL", removeDefs.rpcUrl)
  .option("--registry-tx <hash>", "Registry cell tx hash", removeDefs.registryTx)
  .option("--registry-index <n>", "Registry cell output index", removeDefs.registryIndex)
  .option("--tx-out <file>", "Write unsigned tx JSON to this file", removeDefs.txOut)
  .option("--sign", "Sign and submit via ckb-cli after generating the tx file")
  .option("--from-account <address>", "Governance account address for ckb-cli signing", removeDefs.fromAccount)
  .action(async (opts: {
    lockArgs?: string;
    rpcUrl: string;
    registryTx: string;
    registryIndex: string;
    txOut: string;
    sign: boolean;
    fromAccount: string;
  }) => {
    await removeCommand(opts);
  });

// ── propose ───────────────────────────────────────────────────────────────────

program
  .command("propose")
  .description("Create a governance proposal (full flow with 72h review + voting + signing)")
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

program
  .command("vote")
  .description("Record a validator vote on a governance proposal")
  .option("--proposal <id>", "Proposal ID or hash")
  .option("--vote <choice>", "Vote: yes|no|abstain")
  .option("--validator <id>", "Your validator name or identifier")
  .action(async (opts: { proposal?: string; vote?: string; validator?: string }) => {
    await voteCommand(opts);
  });

// ── sign ──────────────────────────────────────────────────────────────────────

program
  .command("sign")
  .description("Sign an approved proposal as a governance signer (secp256k1)")
  .option("--proposal <id>", "Proposal ID or hash")
  .option("--signer-index <0-4>", "Your signer index in the governance set")
  .option("--key <hex>", "32-byte private key in hex (prompted if omitted)")
  .action(async (opts: { proposal?: string; signerIndex?: string; key?: string }) => {
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

// Show banner on bare invocation before help prints.
if (process.argv.length <= 2) printBanner();

program.parse(process.argv);
