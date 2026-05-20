import { writeFileSync } from "node:fs";
import chalk from "chalk";
import logSymbols from "log-symbols";
import inquirer from "inquirer";
import { loadProposal, listProposals } from "../lib/proposals.js";

export interface ExportOptions {
  proposal?: string;
  out?: string;
}

export async function exportCommand(opts: ExportOptions): Promise<void> {
  // ── select proposal ──────────────────────────────────────────────────────

  let proposalId = opts.proposal?.trim() ?? "";
  if (!proposalId) {
    const all = listProposals();
    if (all.length === 0) {
      console.log(logSymbols.warning, chalk.yellow("No proposals found. Create one with: ckb-firewall propose"));
      process.exit(0);
    }
    const { chosen } = await inquirer.prompt<{ chosen: string }>([
      {
        type: "list",
        name: "chosen",
        message: "Select proposal to export:",
        choices: all.map((p) => ({
          name: `${chalk.bold(p.id)}  ${p.action} ${p.lockArgs.slice(0, 24)}…  [${p.status}]`,
          value: p.id,
        })),
      },
    ]);
    proposalId = chosen;
  }

  const proposal = loadProposal(proposalId);
  const json = JSON.stringify(proposal, null, 2) + "\n";

  // ── write output ─────────────────────────────────────────────────────────

  if (opts.out) {
    writeFileSync(opts.out, json, "utf8");
    console.log(logSymbols.success, `Proposal exported to ${chalk.bold(opts.out)}`);
    console.log(chalk.dim("  Share this file with other governance participants."));
    console.log(chalk.dim(`  They can import it with: ckb-firewall import ${opts.out}`));
  } else {
    process.stdout.write(json);
  }
}
