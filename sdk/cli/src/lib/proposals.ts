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
  pubkey: string;           // 0x-prefixed hex, 33 bytes compressed secp256k1
  vote: VoteChoice;
  timestamp: string;
  signature: string;        // 0x-prefixed hex, 65 bytes (r[32] || s[32] || recovery_id[1])
  merkleLeafIndex: number;  // position in the ordered validator set
  merkleProof: string[];    // sibling hashes (32 bytes each) leaf→root in the validator Merkle tree
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
  const short = proposalIdHash.startsWith("0x")
    ? proposalIdHash.slice(2, 14)
    : proposalIdHash.slice(0, 12);
  if (!/^[0-9a-f]{12}$/i.test(short)) {
    throw new Error(`Invalid proposalIdHash format: "${proposalIdHash}" — expected 0x-prefixed hex.`);
  }
  return join(dir, `${short}.json`);
}

export function saveProposal(proposal: Proposal): void {
  const dir = getProposalsDir();
  writeFileSync(
    proposalPath(dir, proposal.proposalIdHash),
    JSON.stringify(proposal, null, 2) + "\n",
    "utf8",
  );
}

function validateProposalSchema(data: unknown): Proposal {
  if (typeof data !== "object" || data === null) {
    throw new Error("Proposal file is not a valid object.");
  }
  const p = data as Record<string, unknown>;
  const requiredStrings: (keyof Proposal)[] = [
    "id", "proposalIdHash", "action", "lockArgs", "expiresAt",
    "evidence", "classification", "severity", "rationale", "proposer",
    "submittedAt", "reviewWindowEndsAt", "status", "voteDigestHash",
  ];
  for (const key of requiredStrings) {
    if (typeof p[key] !== "string") {
      throw new Error(`Proposal file is missing or has invalid field: "${key}"`);
    }
  }
  if (!Array.isArray(p.votes) || !Array.isArray(p.signatures)) {
    throw new Error("Proposal file: votes and signatures must be arrays.");
  }
  return data as Proposal;
}

export function loadProposal(id: string): Proposal {
  const dir = getProposalsDir();
  // Accept full hash (0x...) or short display id.
  const short = id.startsWith("0x") ? id.slice(2, 14) : id.slice(0, 12);
  if (!/^[0-9a-f]{12}$/i.test(short)) {
    throw new Error(`Invalid proposal ID "${id}": expected a 12-character hex string.`);
  }
  const file = join(dir, `${short}.json`);
  if (!existsSync(file)) {
    throw new Error(`Proposal "${id}" not found in ${dir}`);
  }
  return validateProposalSchema(JSON.parse(readFileSync(file, "utf8")));
}

export function listProposals(): Proposal[] {
  const dir = getProposalsDir();
  const results: Proposal[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const p = validateProposalSchema(JSON.parse(readFileSync(join(dir, f), "utf8")));
      // Auto-reject proposals whose review window has passed without reaching the vote threshold.
      if ((p.status === "pending-review" || p.status === "voting") &&
          isReviewWindowPassed(p) && !isVoteApproved(p)) {
        p.status = "rejected";
        saveProposal(p);
      }
      results.push(p);
    } catch {
      process.stderr.write(`Warning: skipping malformed proposal file: ${f}\n`);
    }
  }
  return results.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
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

// The message each validator signs for their vote (domain-separated, prevents cross-proposal replay).
export function voteSigningMessage(
  proposalIdHash: string,
  vote: VoteChoice,
  timestamp: string,
  pubkey: string,
): Uint8Array {
  const canonical = JSON.stringify({
    domain: "ckb-firewall:vote",
    proposalIdHash,
    vote,
    timestamp,
    pubkey,
  });
  return ckbBlake2b(new TextEncoder().encode(canonical));
}

export function computeVoteDigestHash(votes: ProposalVote[]): string {
  const str = JSON.stringify(
    votes
      .slice()
      .sort((a, b) => a.pubkey.localeCompare(b.pubkey))
      .map((v) => ({ pubkey: v.pubkey, vote: v.vote, timestamp: v.timestamp, signature: v.signature })),
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

// The message each governance signer signs (GOV1 v3, 136-byte preimage).
// proposal_id_hash(32) || vote_digest_hash(32) || old_root(32) || new_root(32) || review_window_end_ms(8 LE u64)
export function signingMessage(
  proposal: Proposal,
  oldRoot: Uint8Array,
  newRoot: Uint8Array,
  reviewWindowEndMs: bigint,
): Uint8Array {
  if (oldRoot.length !== 32) throw new Error(`oldRoot must be 32 bytes, got ${oldRoot.length}`);
  if (newRoot.length !== 32) throw new Error(`newRoot must be 32 bytes, got ${newRoot.length}`);
  const proposalBytes = hexToBytes(proposal.proposalIdHash);
  const voteBytes = hexToBytes(proposal.voteDigestHash);
  const combined = new Uint8Array(136);
  combined.set(proposalBytes, 0);
  combined.set(voteBytes, 32);
  combined.set(oldRoot, 64);
  combined.set(newRoot, 96);
  let ms = reviewWindowEndMs;
  for (let i = 0; i < 8; i++) {
    combined[128 + i] = Number(ms & 0xffn);
    ms >>= 8n;
  }
  return ckbBlake2b(combined);
}
