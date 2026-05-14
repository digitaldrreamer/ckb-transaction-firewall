import chalk from "chalk";
import logSymbols from "log-symbols";
import inquirer from "inquirer";
import {
  loadProposal,
  saveProposal,
  listProposals,
  computeVoteDigestHash,
  isVoteApproved,
  countYes,
  VOTE_THRESHOLD,
  type VoteChoice,
} from "../lib/proposals.js";
import { printHints } from "../lib/hints.js";

export interface VoteOptions {
  proposal?: string;
  vote?: string;
  validator?: string;
}

export async function voteCommand(opts: VoteOptions): Promise<void> {
  // ── select proposal ──────────────────────────────────────────────────────

  let proposalId = opts.proposal?.trim() ?? "";
  if (!proposalId) {
    const open = listProposals().filter(
      (p) => p.status === "pending-review" || p.status === "voting",
    );
    if (open.length === 0) {
      console.log(logSymbols.warning, chalk.yellow("No proposals are open for voting."));
      console.log(chalk.dim("  Create one with: ckb-firewall propose"));
      process.exit(0);
    }
    const { chosen } = await inquirer.prompt<{ chosen: string }>([
      {
        type: "list",
        name: "chosen",
        message: "Select proposal to vote on:",
        choices: open.map((p) => ({
          name: `${chalk.bold(p.id)}  ${p.action === "add" ? "add" : "remove"} ${p.lockArgs.slice(0, 24)}…  (${countYes(p.votes)}/${VOTE_THRESHOLD} yes)`,
          value: p.id,
        })),
      },
    ]);
    proposalId = chosen;
  }

  const proposal = loadProposal(proposalId);

  if (proposal.status === "executed") {
    console.log(logSymbols.error, chalk.red("Proposal is already executed."));
    process.exit(1);
  }
  if (proposal.status === "rejected") {
    console.log(logSymbols.error, chalk.red("Proposal was rejected."));
    process.exit(1);
  }

  // ── validator id ─────────────────────────────────────────────────────────

  let validatorId = opts.validator?.trim() ?? "";
  if (!validatorId) {
    const { vid } = await inquirer.prompt<{ vid: string }>([
      {
        type: "input",
        name: "vid",
        message: "Your validator ID (name or identifier):",
        validate: (v: string) => v.trim().length > 0 || "Required.",
      },
    ]);
    validatorId = vid.trim();
  }

  // Check duplicate vote.
  if (proposal.votes.some((v) => v.validatorId.toLowerCase() === validatorId.toLowerCase())) {
    console.log(logSymbols.warning, chalk.yellow(`Validator "${validatorId}" has already voted on this proposal.`));
    process.exit(0);
  }

  // ── vote ─────────────────────────────────────────────────────────────────

  let vote: VoteChoice;
  if (opts.vote === "yes" || opts.vote === "no" || opts.vote === "abstain") {
    vote = opts.vote;
  } else {
    console.log();
    console.log(chalk.bold("Proposal:"), proposal.id);
    console.log(`  Action:         ${proposal.action} ${proposal.lockArgs}`);
    console.log(`  Classification: ${proposal.classification} / ${proposal.severity}`);
    console.log(`  Evidence:       ${proposal.evidence}`);
    console.log(`  Rationale:      ${proposal.rationale}`);
    console.log();

    const { chosen } = await inquirer.prompt<{ chosen: VoteChoice }>([
      {
        type: "list",
        name: "chosen",
        message: "Your vote:",
        choices: [
          { name: "Yes — approve this proposal", value: "yes" },
          { name: "No — reject this proposal", value: "no" },
          { name: "Abstain", value: "abstain" },
        ],
      },
    ]);
    vote = chosen;
  }

  // ── record vote ──────────────────────────────────────────────────────────

  proposal.votes.push({ validatorId, vote, timestamp: new Date().toISOString() });
  proposal.voteDigestHash = computeVoteDigestHash(proposal.votes);

  const yesCount = countYes(proposal.votes);
  const approved = isVoteApproved(proposal);

  if (proposal.status === "pending-review" || proposal.status === "voting") {
    proposal.status = approved ? "approved" : "voting";
  }

  saveProposal(proposal);

  console.log();
  console.log(logSymbols.success, `Vote recorded: ${chalk.bold(vote)} by ${validatorId}`);
  console.log(`  Yes votes: ${yesCount}/${VOTE_THRESHOLD} required`);

  if (approved) {
    console.log();
    console.log(logSymbols.success, chalk.green("Vote threshold met — proposal approved for signing."));
    console.log(`  Next: ${chalk.dim(`ckb-firewall sign --proposal ${proposal.id}`)}`);
  } else {
    console.log(`  Need ${VOTE_THRESHOLD - yesCount} more yes vote(s).`);
  }
  console.log();
  printHints("vote");
}
