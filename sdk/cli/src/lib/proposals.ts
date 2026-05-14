import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ckbBlake2b } from "./witness.js";
import { hexToBytes, bytesToHex } from "./blkl.js";

export type ProposalAction = "add" | "remove";
export type ProposalStatus =
  | "pending-review"
  | "voting"
  | "approved"
  | "rejected"
  | "executed";
export type VoteChoice = "yes" | "no" | "abstain";
export type ThreatClass =
  | "theft"
  | "scam"
  | "hack"
  | "sanctions"
  | "other";
export type Severity = "critical" | "high" | "medium" | "low";

export interface ProposalVote {
  validatorId: string;
  vote: VoteChoice;
  timestamp: string;
}

export interface ProposalSignature {
  signerIndex: number;
  signature: string; // 0x-prefixed hex, 65 bytes (64 sig + 1 recovery id)
  timestamp: string;
}

export interface Proposal {
  id: string;           // 12-char hex (6 bytes) from proposalIdHash, excluding 0x prefix (display only)
  proposalIdHash: string;
  action: ProposalAction;
  lockArgs: string;
  expiresAt: string;    // "0" = never
  evidence: string;
  classification: ThreatClass;
  severity: Severity;
  rationale: string;
  proposer: string;
  submittedAt: string;
  reviewWindowEndsAt: string;
  status: ProposalStatus;
  votes: ProposalVote[];
  voteDigestHash: string;
  signatures: ProposalSignature[];
  txHash?: string;
}

// Threshold rules (simplified for testnet: 5 governance participants, need 3-of-5).
export const VOTE_THRESHOLD = 3;
export const SIG_THRESHOLD = 3;
export const REVIEW_WINDOW_MS = 72 * 60 * 60 * 1000; // 72 hours

export function getProposalsDir(): string {
  const dir = join(homedir(), ".ckb-firewall", "proposals");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function proposalPath(dir: string, proposalIdHash: string): string {
  return join(dir, `${proposalIdHash.slice(2, 14)}.json`);
}

export function saveProposal(proposal: Proposal): void {
  const dir = getProposalsDir();
  writeFileSync(
    proposalPath(dir, proposal.proposalIdHash),
    JSON.stringify(proposal, null, 2) + "\n",
    "utf8",
  );
}

export function loadProposal(id: string): Proposal {
  const dir = getProposalsDir();
  // Accept full hash (0x...) or short display id.
  const short = id.startsWith("0x") ? id.slice(2, 14) : id.slice(0, 12);
  const file = join(dir, `${short}.json`);
  if (!existsSync(file)) {
    throw new Error(`Proposal "${id}" not found in ${dir}`);
  }
  return JSON.parse(readFileSync(file, "utf8")) as Proposal;
}

export function listProposals(): Proposal[] {
  const dir = getProposalsDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Proposal)
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

// Canonical representation used as input to proposalIdHash.
function proposalCanonical(fields: {
  action: ProposalAction;
  lockArgs: string;
  expiresAt: string;
  evidence: string;
  classification: ThreatClass;
  severity: Severity;
  rationale: string;
  proposer: string;
  submittedAt: string;
}): Uint8Array {
  const str = JSON.stringify({
    action: fields.action,
    lockArgs: fields.lockArgs.toLowerCase(),
    expiresAt: fields.expiresAt,
    evidence: fields.evidence,
    classification: fields.classification,
    severity: fields.severity,
    rationale: fields.rationale,
    proposer: fields.proposer,
    submittedAt: fields.submittedAt,
  });
  return new TextEncoder().encode(str);
}

export function computeProposalIdHash(fields: Parameters<typeof proposalCanonical>[0]): string {
  const hash = ckbBlake2b(proposalCanonical(fields));
  return bytesToHex(hash);
}

export function computeVoteDigestHash(votes: ProposalVote[]): string {
  const str = JSON.stringify(
    votes
      .slice()
      .sort((a, b) => a.validatorId.localeCompare(b.validatorId))
      .map((v) => ({ validatorId: v.validatorId, vote: v.vote, timestamp: v.timestamp })),
  );
  const hash = ckbBlake2b(new TextEncoder().encode(str));
  return bytesToHex(hash);
}

export function countYes(votes: ProposalVote[]): number {
  return votes.filter((v) => v.vote === "yes").length;
}

export function isReviewWindowPassed(proposal: Proposal): boolean {
  return Date.now() >= new Date(proposal.reviewWindowEndsAt).getTime();
}

export function isVoteApproved(proposal: Proposal): boolean {
  return countYes(proposal.votes) >= VOTE_THRESHOLD;
}

export function isReadyToExecute(proposal: Proposal): boolean {
  return (
    isReviewWindowPassed(proposal) &&
    isVoteApproved(proposal) &&
    proposal.signatures.length >= SIG_THRESHOLD
  );
}

// The message each governance signer signs (domain-separated, 64 bytes input).
export function signingMessage(proposal: Proposal): Uint8Array {
  const proposalBytes = hexToBytes(proposal.proposalIdHash);
  const voteBytes = hexToBytes(proposal.voteDigestHash);
  const combined = new Uint8Array(proposalBytes.length + voteBytes.length);
  combined.set(proposalBytes, 0);
  combined.set(voteBytes, proposalBytes.length);
  return ckbBlake2b(combined);
}
