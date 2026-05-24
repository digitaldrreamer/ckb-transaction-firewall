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

  const allowedStatuses = new Set(["pending-review", "voting", "approved", "rejected", "executed"]);
  if (!allowedStatuses.has(p.status as string)) {
    throw new Error(`Invalid status: "${p.status}"`);
  }

  for (const v of p.votes as unknown[]) {
    if (typeof v !== "object" || v === null) throw new Error("Invalid vote entry: not an object.");
    const vv = v as Record<string, unknown>;
    if (typeof vv.pubkey !== "string" || typeof vv.vote !== "string" || typeof vv.signature !== "string" || typeof vv.timestamp !== "string") {
      throw new Error("Vote entries must have string fields: pubkey, vote, signature, timestamp.");
    }
  }

  for (const s of p.signatures as unknown[]) {
    if (typeof s !== "object" || s === null) throw new Error("Invalid signature entry: not an object.");
    const ss = s as Record<string, unknown>;
    if (typeof ss.signerIndex !== "number" || typeof ss.signature !== "string") {
      throw new Error("Signature entries must have signerIndex (number) and signature (string).");
    }
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
      // Signatures freeze the vote digest — once signing has begun, votes must not change
      // or existing signatures become invalid for the new voteDigestHash.
      const signingStarted = existing.signatures.length > 0 || proposal.signatures.length > 0;

      let mergedVotes: typeof existing.votes;
      let mergedVoteDigest: string;
      if (signingStarted) {
        // Preserve whichever side has signatures; don't alter its vote set.
        mergedVotes = existing.signatures.length > 0 ? existing.votes : proposal.votes;
        mergedVoteDigest = existing.signatures.length > 0 ? existing.voteDigestHash : proposal.voteDigestHash;
        if (existing.votes.length !== proposal.votes.length) {
          process.stderr.write(
            `Note: votes not merged for proposal ${proposal.id} — signing has already begun and the vote digest is frozen.\n`,
          );
        }
      } else {
        // No signatures yet — merge votes freely, preferring the newer entry per validator.
        const votesByPubkey = new Map(existing.votes.map((v) => [v.pubkey.toLowerCase(), v]));
        for (const v of proposal.votes) {
          const key = v.pubkey.toLowerCase();
          const prev = votesByPubkey.get(key);
          if (!prev || v.timestamp > prev.timestamp) {
            votesByPubkey.set(key, v);
          }
        }
        mergedVotes = [...votesByPubkey.values()];
        mergedVoteDigest = computeVoteDigestHash(mergedVotes);
      }

      // Incoming signature always replaces existing for the same signer index.
      const sigBySigner = new Map(existing.signatures.map((s) => [s.signerIndex, s]));
      for (const s of proposal.signatures) {
        sigBySigner.set(s.signerIndex, s);
      }
      const mergedSigs = [...sigBySigner.values()];

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
      const votesNote = signingStarted ? "frozen — signing started" : `${mergedVotes.length - existing.votes.length} new`;
      console.log(`  Votes:      ${mergedVotes.length} (${votesNote})`);
      console.log(`  Signatures: ${mergedSigs.length} (${mergedSigs.length - existing.signatures.length} new)`);
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
