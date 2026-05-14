import chalk from "chalk";
import logSymbols from "log-symbols";
import inquirer from "inquirer";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  loadProposal,
  saveProposal,
  listProposals,
  isReviewWindowPassed,
  isVoteApproved,
  signingMessage,
  SIG_THRESHOLD,
} from "../lib/proposals.js";
import { hexToBytes, bytesToHex, strip0x } from "../lib/blkl.js";
import { printHints } from "../lib/hints.js";

export interface SignOptions {
  proposal?: string;
  signerIndex?: string;
  key?: string;
}

// Deterministic dev key for testnet (NOT for production).
function devKey(index: number): Uint8Array {
  // Simple derivation: fixed prefix + index byte, then use it as-is.
  // In practice users should supply real keys; this is a testnet convenience.
  const seed = new Uint8Array(32);
  seed[0] = 0x01; // non-zero
  seed[31] = index;
  // Ensure valid secp256k1 scalar (must be 1 <= key <= n-1).
  seed[1] = 0x11;
  seed[2] = 0x22;
  seed[3] = 0x33;
  return seed;
}

function isValidPrivKey(hex: string): boolean {
  try {
    const bytes = hexToBytes(hex);
    if (bytes.length !== 32) return false;
    secp256k1.getPublicKey(bytes); // throws if invalid
    return true;
  } catch {
    return false;
  }
}

export async function signCommand(opts: SignOptions): Promise<void> {
  // ── select proposal ──────────────────────────────────────────────────────

  let proposalId = opts.proposal?.trim() ?? "";
  if (!proposalId) {
    const signable = listProposals().filter(
      (p) =>
        (p.status === "approved" || p.status === "voting" || p.status === "pending-review") &&
        p.signatures.length < SIG_THRESHOLD,
    );
    if (signable.length === 0) {
      console.log(logSymbols.warning, chalk.yellow("No proposals are waiting for signatures."));
      process.exit(0);
    }
    const { chosen } = await inquirer.prompt<{ chosen: string }>([
      {
        type: "list",
        name: "chosen",
        message: "Select proposal to sign:",
        choices: signable.map((p) => ({
          name: `${chalk.bold(p.id)}  ${p.action} ${p.lockArgs.slice(0, 24)}…  (${p.signatures.length}/${SIG_THRESHOLD} sigs)`,
          value: p.id,
        })),
      },
    ]);
    proposalId = chosen;
  }

  const proposal = loadProposal(proposalId);

  // ── checks ───────────────────────────────────────────────────────────────

  if (proposal.status === "executed") {
    console.log(logSymbols.error, chalk.red("Proposal is already executed."));
    process.exit(1);
  }
  if (proposal.status === "rejected") {
    console.log(logSymbols.error, chalk.red("Proposal was rejected."));
    process.exit(1);
  }

  if (!isReviewWindowPassed(proposal)) {
    const endsAt = new Date(proposal.reviewWindowEndsAt);
    const ms = endsAt.getTime() - Date.now();
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    console.log(logSymbols.error, chalk.red(`Review window has not passed yet — ${h}h ${m}m remaining.`));
    console.log(chalk.dim(`  Window ends: ${proposal.reviewWindowEndsAt}`));
    process.exit(1);
  }

  if (!isVoteApproved(proposal)) {
    console.log(logSymbols.error, chalk.red("Vote threshold not met — cannot sign yet."));
    console.log(chalk.dim(`  Use: ckb-firewall vote --proposal ${proposal.id}`));
    process.exit(1);
  }

  // ── signer index ─────────────────────────────────────────────────────────

  let signerIndex: number;
  if (opts.signerIndex !== undefined) {
    signerIndex = Number.parseInt(opts.signerIndex, 10);
    if (signerIndex < 0 || signerIndex > 4) {
      console.error(logSymbols.error, chalk.red("--signer-index must be 0–4."));
      process.exit(1);
    }
  } else {
    const usedIndices = new Set(proposal.signatures.map((s) => s.signerIndex));
    const available = [0, 1, 2, 3, 4].filter((i) => !usedIndices.has(i));
    if (available.length === 0) {
      console.log(logSymbols.success, chalk.green("All 5 signers have already signed."));
      process.exit(0);
    }
    const { idx } = await inquirer.prompt<{ idx: number }>([
      {
        type: "list",
        name: "idx",
        message: "Your signer index:",
        choices: available.map((i) => ({ name: `Signer ${i}`, value: i })),
      },
    ]);
    signerIndex = idx;
  }

  // Check if this index already signed.
  if (proposal.signatures.some((s) => s.signerIndex === signerIndex)) {
    console.log(logSymbols.warning, chalk.yellow(`Signer ${signerIndex} has already signed this proposal.`));
    process.exit(0);
  }

  // ── private key ──────────────────────────────────────────────────────────

  let privateKeyBytes: Uint8Array;
  if (opts.key) {
    if (!isValidPrivKey(opts.key)) {
      console.error(logSymbols.error, chalk.red("Invalid private key — must be 32-byte hex."));
      process.exit(1);
    }
    privateKeyBytes = hexToBytes(opts.key);
  } else {
    console.log();
    console.log(chalk.dim("Tip: leave blank to use a deterministic testnet dev key for this signer index."));
    const { keyInput } = await inquirer.prompt<{ keyInput: string }>([
      {
        type: "password",
        name: "keyInput",
        message: `Private key for signer ${signerIndex} (32-byte hex, or blank for dev key):`,
        mask: "*",
      },
    ]);
    if (!keyInput.trim()) {
      privateKeyBytes = devKey(signerIndex);
      console.log(chalk.yellow("  Using deterministic dev key — testnet only."));
    } else if (!isValidPrivKey(keyInput.trim())) {
      console.error(logSymbols.error, chalk.red("Invalid private key."));
      process.exit(1);
    } else {
      privateKeyBytes = hexToBytes(keyInput.trim());
    }
  }

  // ── sign ─────────────────────────────────────────────────────────────────

  const msgHash = signingMessage(proposal);
  // @noble/curves v2 'recovered' format: [recovery_bit(1), r(32), s(32)].
  // CKB secp256k1 expects: [r(32), s(32), recovery_bit(1)].
  const recoveredSig = secp256k1.sign(msgHash, privateKeyBytes, { lowS: true, format: "recovered" });
  const sigBytes = new Uint8Array(65);
  sigBytes.set(recoveredSig.slice(1), 0); // r + s at bytes 0-63
  sigBytes[64] = recoveredSig[0]!;         // recovery bit at byte 64

  proposal.signatures.push({
    signerIndex,
    signature: bytesToHex(sigBytes),
    timestamp: new Date().toISOString(),
  });

  const sigCount = proposal.signatures.length;
  if (sigCount >= SIG_THRESHOLD) {
    proposal.status = "approved";
  }

  saveProposal(proposal);

  const pubKey = bytesToHex(new Uint8Array(secp256k1.getPublicKey(privateKeyBytes, true)));
  console.log();
  console.log(logSymbols.success, chalk.green(`Signed by signer ${signerIndex}`));
  console.log(`  Public key:  ${chalk.dim(pubKey)}`);
  console.log(`  Signature:   ${chalk.dim(bytesToHex(sigBytes).slice(0, 20) + "…")}`);
  console.log(`  Signatures:  ${sigCount}/${SIG_THRESHOLD} collected`);

  if (sigCount >= SIG_THRESHOLD) {
    console.log();
    console.log(logSymbols.success, chalk.green("Signature threshold met — ready to execute."));
    console.log(`  Next: ${chalk.dim(`ckb-firewall execute --proposal ${proposal.id}`)}`);
  } else {
    console.log(`  Need ${SIG_THRESHOLD - sigCount} more signature(s).`);
  }
  console.log();
  printHints("sign");
}
