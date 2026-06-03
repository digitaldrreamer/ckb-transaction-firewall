import chalk from "chalk";

type HintKey =
  | "inspect"
  | "add"
  | "remove"
  | "propose"
  | "proposals"
  | "vote"
  | "execute";

const HINTS: Record<HintKey, string[]> = {
  inspect: [
    `Cast a vote on open proposals: ${chalk.dim("ckb-firewall vote")}`,
    `Review all pending proposals: ${chalk.dim("ckb-firewall proposals --status voting")}`,
    `Create a new governance proposal: ${chalk.dim("ckb-firewall propose")}`,
  ],
  add: [
    `Track your change with a governance proposal: ${chalk.dim("ckb-firewall propose")}`,
    `Verify the registry was updated: ${chalk.dim("ckb-firewall inspect")}`,
    `List current blacklist entries: ${chalk.dim("ckb-firewall inspect")}`,
  ],
  remove: [
    `Track your change with a governance proposal: ${chalk.dim("ckb-firewall propose")}`,
    `Verify the registry was updated: ${chalk.dim("ckb-firewall inspect")}`,
    `See all governance proposals: ${chalk.dim("ckb-firewall proposals")}`,
  ],
  propose: [
    `Validators: help approve this proposal by voting: ${chalk.dim("ckb-firewall vote")}`,
    `Share the proposal ID with your community to gather votes faster`,
    `Track proposal progress: ${chalk.dim("ckb-firewall proposals")}`,
    `Need 3 yes votes before execution: ${chalk.dim("ckb-firewall proposals --status voting")}`,
  ],
  proposals: [
    `Vote on an open proposal: ${chalk.dim("ckb-firewall vote")}`,
    `Create a new governance proposal: ${chalk.dim("ckb-firewall propose")}`,
    `Execute an approved proposal: ${chalk.dim("ckb-firewall execute")}`,
  ],
  vote: [
    `Encourage others to vote — 3 yes votes required to approve`,
    `Check current vote tallies: ${chalk.dim("ckb-firewall proposals")}`,
    `Once approved, execute the proposal: ${chalk.dim("ckb-firewall execute")}`,
  ],
  execute: [
    `Verify the updated registry: ${chalk.dim("ckb-firewall inspect")}`,
    `Help govern the registry — vote on open proposals: ${chalk.dim("ckb-firewall vote")}`,
    `Create a new governance proposal: ${chalk.dim("ckb-firewall propose")}`,
  ],
};

/** Print 2 contextual hints after a command. */
export function printHints(command: HintKey): void {
  const pool = HINTS[command];
  const chosen = pool.slice(0, 2);
  if (chosen.length === 0) return;
  console.log(chalk.dim("─".repeat(52)));
  console.log(chalk.dim("Tips:"));
  for (const hint of chosen) {
    console.log(chalk.dim("  •"), hint);
  }
  console.log();
}

/** Print a targeted "contribute by voting" callout (more prominent). */
export function printVotingCallout(openCount: number): void {
  if (openCount === 0) return;
  console.log(
    chalk.cyan("⬡"),
    chalk.bold(`${openCount} proposal${openCount === 1 ? "" : "s"} open for voting — your vote shapes the registry.`),
  );
  console.log(
    `  Cast yours: ${chalk.dim("ckb-firewall vote")}`,
  );
  console.log();
}
