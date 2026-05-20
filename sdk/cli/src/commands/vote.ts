import chalk from "chalk";
import logSymbols from "log-symbols";
import inquirer from "inquirer";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  loadProposal,
  saveProposal,
  listProposals,
  computeVoteDigestHash,
  voteSigningMessage,
  isVoteApproved,
  countYes,
  VOTE_THRESHOLD,
  type VoteChoice,
} from "../lib/proposals.js";
import { hexToBytes, bytesToHex } from "../lib/blkl.js";
import { computeMerkleProof } from "../lib/validator-set.js";
import { TESTNET_GOVERNANCE_PUBKEYS } from "../lib/defaults.js";
import { printHints } from "../lib/hints.js";

export interface VoteOptions {
  proposal?: string;
  vote?: string;
  key?: string;
}

function isValidPrivKey(hex: string): boolean {
  try {
    const bytes = hexToBytes(hex);
    if (bytes.length !== 32) return false;
    secp256k1.getPublicKey(bytes);
    return true;
  } catch {
    return false;
  }
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

  // ── private key → pubkey ─────────────────────────────────────────────────

  let privateKeyBytes: Uint8Array;
  if (opts.key) {
    if (!isValidPrivKey(opts.key)) {
      console.error(logSymbols.error, chalk.red("Invalid private key — must be 32-byte hex."));
      process.exit(1);
    }
    privateKeyBytes = hexToBytes(opts.key);
  } else {
    console.log();
    const { keyInput } = await inquirer.prompt<{ keyInput: string }>([
      {
        type: "password",
        name: "keyInput",
        message: "Validator private key (32-byte hex):",
        mask: "*",
      },
    ]);
    if (!keyInput.trim()) {
      console.error(logSymbols.error, chalk.red("A private key is required. Pass --key <hex> or enter it at the prompt."));
      process.exit(1);
    }
    if (!isValidPrivKey(keyInput.trim())) {
      console.error(logSymbols.error, chalk.red("Invalid private key — must be 32-byte hex."));
      process.exit(1);
    }
    privateKeyBytes = hexToBytes(keyInput.trim());
  }

  const pubkeyBytes = secp256k1.getPublicKey(privateKeyBytes, true); // 33 bytes compressed
  const pubkey = bytesToHex(new Uint8Array(pubkeyBytes));

  // Verify this pubkey is in the authorized validator set.
  const validatorSet = TESTNET_GOVERNANCE_PUBKEYS.map(bytesToHex);
  const merkleResult = computeMerkleProof(validatorSet, pubkey);
  if (merkleResult === null) {
    console.error(logSymbols.error, chalk.red("This key is not an authorized validator."));
    console.error(chalk.dim(`  Pubkey: ${pubkey}`));
    privateKeyBytes.fill(0);
    process.exit(1);
  }
  const { proof: merkleProof, leafIndex: merkleLeafIndex } = merkleResult;

  // Duplicate check by pubkey.
  if (proposal.votes.some((v) => v.pubkey.toLowerCase() === pubkey.toLowerCase())) {
    console.log(logSymbols.warning, chalk.yellow(`Validator pubkey ${pubkey.slice(0, 14)}… has already voted on this proposal.`));
    privateKeyBytes.fill(0);
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

  // ── sign vote ────────────────────────────────────────────────────────────

  const timestamp = new Date().toISOString();
  const msgHash = voteSigningMessage(proposal.proposalIdHash, vote, timestamp, pubkey);

  // format:"recovered" returns Uint8Array[recovery_id(1), r(32), s(32)]
  const sigRaw = secp256k1.sign(msgHash, privateKeyBytes, { lowS: true, format: "recovered" });
  // Store as [r(32), s(32), recovery_id(1)] — matches ProposalSignature convention
  const sigBytes = new Uint8Array(65);
  sigBytes.set(sigRaw.slice(1), 0);
  sigBytes[64] = sigRaw[0] ?? 0;
  privateKeyBytes.fill(0); // zero key material immediately after use

  const signature = bytesToHex(sigBytes);

  // ── record vote ──────────────────────────────────────────────────────────

  proposal.votes.push({ pubkey, vote, timestamp, signature, merkleLeafIndex, merkleProof });
  proposal.voteDigestHash = computeVoteDigestHash(proposal.votes);

  const yesCount = countYes(proposal.votes);
  const approved = isVoteApproved(proposal);

  if (proposal.status === "pending-review" || proposal.status === "voting") {
    proposal.status = approved ? "approved" : "voting";
  }

  saveProposal(proposal);

  console.log();
  console.log(logSymbols.success, `Vote recorded: ${chalk.bold(vote)} by ${pubkey.slice(0, 14)}…`);
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
