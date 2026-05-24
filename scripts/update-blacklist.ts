#!/usr/bin/env node
/* eslint-disable no-console */

const { execSync, execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT_DIR = resolve(__dirname, "..");
const UPDATE_SCRIPT = resolve(ROOT_DIR, "scripts/phase3_governance_drill_update.sh");
const VALIDATE_SCRIPT = resolve(ROOT_DIR, "scripts/phase3_governance_drill_check.sh");
const LATEST_FILE = resolve(ROOT_DIR, "tests/integration/governance_drill/latest.json");

function usage() {
  console.log(`Usage:
  node scripts/update-blacklist.ts init
  node scripts/update-blacklist.ts run --id <scenario_id> --cmd "<your tx command>"
  node scripts/update-blacklist.ts validate

Scenario IDs:
  bootstrap_0_to_1
  update_1_to_1
  negative_invalid_signer_set
  negative_invalid_root_binding

Notes:
  - This script executes your provided tx command and extracts the first 0x-prefixed 64-byte hash.
  - It then records the hash into governance_drill/latest.json via phase3_governance_drill_update.sh.
  - It does not construct governance transactions itself; supply your proven tx command for each scenario.`);
}

function run(cmd) {
  // Split into program + args to avoid shell interpretation of metacharacters.
  // Note: supports basic quoted args only — does not handle escaped quotes,
  // shell variables ($VAR, $(cmd)), redirects, or pipes. Commands requiring
  // those features should be implemented as helper scripts invoked directly.
  const parts = cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  if (parts.length === 0) throw new Error(`Empty command string: ${JSON.stringify(cmd)}`);
  const [program, ...args] = parts.map((p) => p.replace(/^['"]|['"]$/g, ""));
  return execFileSync(program, args, { cwd: ROOT_DIR, stdio: "pipe", encoding: "utf8" });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v.startsWith("--")) {
      out[v.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function assertScenarioId(id) {
  const allowed = new Set([
    "bootstrap_0_to_1",
    "update_1_to_1",
    "negative_invalid_signer_set",
    "negative_invalid_root_binding",
  ]);
  if (!allowed.has(id)) {
    throw new Error(`Invalid --id: ${id}`);
  }
}

function extractTxHash(output) {
  const match = output.match(/0x[a-fA-F0-9]{64}/);
  if (!match) {
    throw new Error("Could not find tx hash (0x + 64 hex) in command output.");
  }
  return match[0];
}

function main() {
  const command = process.argv[2];
  if (!command || command === "-h" || command === "--help") {
    usage();
    process.exit(0);
  }

  if (!existsSync(UPDATE_SCRIPT)) {
    throw new Error(`Missing helper script: ${UPDATE_SCRIPT}`);
  }

  if (command === "init") {
    execSync(`${UPDATE_SCRIPT} init`, { cwd: ROOT_DIR, stdio: "inherit" });
    return;
  }

  if (command === "run") {
    const args = parseArgs(process.argv.slice(3));
    const id = args.id;
    const txCmd = args.cmd;
    if (!id || !txCmd) {
      throw new Error("run requires --id and --cmd");
    }
    assertScenarioId(id);

    if (!existsSync(LATEST_FILE)) {
      execSync(`${UPDATE_SCRIPT} init`, { cwd: ROOT_DIR, stdio: "inherit" });
    }

    console.log(`Executing scenario ${id}...`);
    const out = run(txCmd);
    process.stdout.write(out);
    const txHash = extractTxHash(out);
    console.log(`Detected tx hash: ${txHash}`);

    execSync(
      `${UPDATE_SCRIPT} set --id ${id} --status pass --tx-hash ${txHash}`,
      { cwd: ROOT_DIR, stdio: "inherit" },
    );
    return;
  }

  if (command === "validate") {
    execSync(`${UPDATE_SCRIPT} validate`, { cwd: ROOT_DIR, stdio: "inherit" });
    execSync(`${VALIDATE_SCRIPT} ${LATEST_FILE}`, { cwd: ROOT_DIR, stdio: "inherit" });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exit(1);
}
