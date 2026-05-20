import { readFileSync, existsSync } from "node:fs";
import chalk from "chalk";
import logSymbols from "log-symbols";
import inquirer from "inquirer";
import {
  saveProposal,
  loadProposal,
  getProposalsDir,
  computeProposalIdHash,
  computeVoteDigestHash,
  type Proposal,
  type ThreatClass,
  type Severity,
} from "../lib/proposals.js";
import { join } from "node:path";

export interface ImportOptions {
  file: string;
  force?: boolean;
}

function validateAndRepair(raw: unknown): Proposal {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Not a valid proposal object.");
  }
  const p = raw as Record<string, unknown>;

  const requiredStrings: string[] = [
    "id", "proposalIdHash", "action", "lockArgs", "expiresAt",
    "evidence", "classification", "severity", "rationale", "proposer",
    "submittedAt", "reviewWindowEndsAt", "status", "voteDigestHash",
  ];
  for (const key of requiredStrings) {
    if (typeof p[key] !== "string") {
      throw new Error(`Missing or invalid field: "${key}"`);
    }
  }
  if (!Array.isArray(p.votes) || !Array.isArray(p.signatures)) {
    throw new Error("Fields 'votes' and 'signatures' must be arrays.");
  }

  if (p.action !== "add" && p.action !== "remove") {
    throw new Error(`Invalid action: "${p.action}"`);
  }

  // Recompute proposalIdHash to verify integrity.
  const computed = computeProposalIdHash({
    action: p.action as "add" | "remove",
    lockArgs: p.lockArgs as string,
    expiresAt: p.expiresAt as string,
    evidence: p.evidence as string,
    classification: p.classification as ThreatClass,
    severity: p.severity as Severity,
    rationale: p.rationale as string,
    proposer: p.proposer as string,
    submittedAt: p.submittedAt as string,
  });
  if (computed !== p.proposalIdHash) {
    throw new Error(
      `proposalIdHash integrity check failed.\n  File:     ${p.proposalIdHash}\n  Expected: ${computed}`,
    );
  }

  // Recompute voteDigestHash to verify vote integrity.
  const recomputedDigest = computeVoteDigestHash(p.votes as Proposal["votes"]);
  if (recomputedDigest !== p.voteDigestHash) {
    throw new Error(
      `voteDigestHash integrity check failed — votes may have been tampered.\n  File:     ${p.voteDigestHash}\n  Expected: ${recomputedDigest}`,
    );
  }

  return raw as Proposal;
}

export async function importCommand(opts: ImportOptions): Promise<void> {
  // ── read and parse ───────────────────────────────────────────────────────

  if (!existsSync(opts.file)) {
    console.error(logSymbols.error, chalk.red(`File not found: ${opts.file}`));
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(opts.file, "utf8"));
  } catch {
    console.error(logSymbols.error, chalk.red(`Could not parse JSON from ${opts.file}`));
    process.exit(1);
  }

  let proposal: Proposal;
  try {
    proposal = validateAndRepair(raw);
  } catch (err) {
    console.error(logSymbols.error, chalk.red("Proposal file is invalid:"));
    console.error(chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  // ── conflict check ───────────────────────────────────────────────────────

  const dir = getProposalsDir();
  const destPath = join(dir, `${proposal.id}.json`);
  if (existsSync(destPath) && !opts.force) {
    let existing: Proposal;
    try {
      existing = loadProposal(proposal.id);
    } catch {
      // File exists but can't be loaded — overwrite.
      existing = proposal;
    }

    if (existing.proposalIdHash === proposal.proposalIdHash) {
      // Same proposal. Merge votes and signatures (take union, prefer incoming if newer).
      const mergedVotes = [...existing.votes];
      for (const v of proposal.votes) {
        if (!mergedVotes.some((ev) => ev.pubkey.toLowerCase() === v.pubkey.toLowerCase())) {
          mergedVotes.push(v);
        }
      }
      const mergedSigs = [...existing.signatures];
      for (const s of proposal.signatures) {
        if (!mergedSigs.some((es) => es.signerIndex === s.signerIndex)) {
          mergedSigs.push(s);
        }
      }

      const mergedVoteDigest = computeVoteDigestHash(mergedVotes);
      const merged: Proposal = {
        ...proposal,
        votes: mergedVotes,
        voteDigestHash: mergedVoteDigest,
        signatures: mergedSigs,
        // Keep the more advanced status.
        status: rankStatus(existing.status) >= rankStatus(proposal.status)
          ? existing.status
          : proposal.status,
      };

      saveProposal(merged);
      console.log();
      console.log(logSymbols.success, `Proposal ${chalk.bold(proposal.id)} merged.`);
      console.log(`  Votes:      ${mergedVotes.length} (${proposal.votes.length - existing.votes.length} new)`);
      console.log(`  Signatures: ${mergedSigs.length} (${proposal.signatures.length - existing.signatures.length} new)`);
      console.log();
      return;
    }

    // Different proposal, same short ID (collision) — ask the user.
    console.log(logSymbols.warning, chalk.yellow(`A different proposal with ID ${chalk.bold(proposal.id)} already exists locally.`));
    const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
      { type: "confirm", name: "overwrite", message: "Overwrite it?", default: false },
    ]);
    if (!overwrite) {
      console.log("Import cancelled.");
      return;
    }
  }

  saveProposal(proposal);

  console.log();
  console.log(logSymbols.success, `Proposal ${chalk.bold(proposal.id)} imported.`);
  console.log(`  Action: ${proposal.action} ${chalk.dim(proposal.lockArgs.slice(0, 36))}${proposal.lockArgs.length > 36 ? "…" : ""}`);
  console.log(`  Status: ${proposal.status}`);
  console.log(`  Votes:  ${proposal.votes.length}  Signatures: ${proposal.signatures.length}`);
  console.log();
  console.log(chalk.dim("  Next steps:"));
  if (proposal.status === "pending-review" || proposal.status === "voting") {
    console.log(chalk.dim(`    ckb-firewall vote --proposal ${proposal.id}`));
  }
  if (proposal.status === "approved") {
    console.log(chalk.dim(`    ckb-firewall sign --proposal ${proposal.id}`));
  }
  console.log();
}

function rankStatus(status: Proposal["status"]): number {
  const order = ["pending-review", "voting", "approved", "rejected", "executed"];
  return order.indexOf(status);
}
