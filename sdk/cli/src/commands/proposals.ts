import chalk from "chalk";
import Table from "cli-table3";
import logSymbols from "log-symbols";
import {
  listProposals,
  isReviewWindowPassed,
  isVoteApproved,
  isReadyToExecute,
  countYes,
  VOTE_THRESHOLD,
  SIG_THRESHOLD,
  type ProposalStatus,
} from "../lib/proposals.js";
import { printHints, printVotingCallout } from "../lib/hints.js";

function statusBadge(status: ProposalStatus, ready: boolean): string {
  if (ready) return chalk.green("ready to execute");
  switch (status) {
    case "pending-review": return chalk.yellow("pending review");
    case "voting":         return chalk.cyan("voting");
    case "approved":       return chalk.green("approved");
    case "rejected":       return chalk.red("rejected");
    case "executed":       return chalk.dim("executed");
  }
}

function reviewCountdown(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return chalk.green("✔ window passed");
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return chalk.yellow(`${h}h ${m}m remaining`);
}

export async function proposalsCommand(opts: { status?: string }): Promise<void> {
  const all = listProposals();

  const filtered = opts.status
    ? all.filter((p) => p.status === opts.status)
    : all;

  if (filtered.length === 0) {
    console.log();
    if (all.length === 0) {
      console.log(logSymbols.info, "No proposals found. Create one with:", chalk.dim("ckb-firewall propose"));
    } else {
      console.log(logSymbols.info, `No proposals with status "${opts.status ?? "any"}".`);
    }
    console.log();
    return;
  }

  console.log();
  const table = new Table({
    head: [
      chalk.cyan("ID"),
      chalk.cyan("Action"),
      chalk.cyan("Lock Args"),
      chalk.cyan("Status"),
      chalk.cyan("Votes"),
      chalk.cyan("Sigs"),
      chalk.cyan("Review window"),
    ],
    style: { head: [], border: [] },
    colWidths: [14, 8, 36, 22, 8, 6, 22],
    wordWrap: true,
  });

  for (const p of filtered) {
    const ready = isReadyToExecute(p);
    const yesVotes = countYes(p.votes);
    table.push([
      chalk.bold(p.id),
      p.action === "add" ? chalk.green("add") : chalk.red("remove"),
      chalk.dim(p.lockArgs.slice(0, 20) + (p.lockArgs.length > 20 ? "…" : "")),
      statusBadge(p.status, ready),
      `${yesVotes}/${VOTE_THRESHOLD}`,
      `${p.signatures.length}/${SIG_THRESHOLD}`,
      reviewCountdown(p.reviewWindowEndsAt),
    ]);
  }

  console.log(table.toString());
  console.log();
  console.log(chalk.dim(`${filtered.length} proposal${filtered.length === 1 ? "" : "s"} — stored in ~/.ckb-firewall/proposals/`));
  console.log();

  const openCount = filtered.filter(
    (p) => p.status === "pending-review" || p.status === "voting",
  ).length;
  printVotingCallout(openCount);
  printHints("proposals");
}
