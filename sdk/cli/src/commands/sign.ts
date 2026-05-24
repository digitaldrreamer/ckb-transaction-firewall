import chalk from "chalk";
import logSymbols from "log-symbols";
import ora from "ora";
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
import { hexToBytes, bytesToHex, strip0x, encodeRegistryPayload, extractGovernanceHeaderRaw, parseGovernanceHeader, insertSorted, removeEntry } from "../lib/blkl.js";
import { parseRegistryPayload } from "@ckb-firewall/sdk";
import { getLiveCell } from "../lib/rpc.js";
import { resolveRegistryOutpoint } from "../lib/registry.js";
import { ckbBlake2b } from "../lib/witness.js";
import { printHints } from "../lib/hints.js";
import { TESTNET_RPC_URL, TESTNET_REGISTRY_CELL } from "../lib/defaults.js";

export interface SignOptions {
  proposal?: string;
  signerIndex?: string;
  rpcUrl: string;
  registryTx: string;
  registryIndex: string;
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

export function parseSignerIndex(value: string, maxExclusive = 5): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number.parseInt(value.trim(), 10);
  if (n < 0 || n >= maxExclusive) return null;
  return n;
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
    const parsed = parseSignerIndex(opts.signerIndex, Number.MAX_SAFE_INTEGER);
    if (parsed === null) {
      console.error(logSymbols.error, chalk.red("--signer-index must be a non-negative integer."));
      process.exit(1);
    }
    signerIndex = parsed as number;
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

  console.log();
  const { keyInput } = await inquirer.prompt<{ keyInput: string }>([
    {
      type: "password",
      name: "keyInput",
      message: `Private key for signer ${signerIndex} (32-byte hex):`,
      mask: "*",
    },
  ]);
  if (!keyInput.trim()) {
    console.error(logSymbols.error, chalk.red("A private key is required."));
    process.exit(1);
  } else if (!isValidPrivKey(keyInput.trim())) {
    console.error(logSymbols.error, chalk.red("Invalid private key — must be 32-byte hex."));
    process.exit(1);
  }
  const privateKeyBytes = hexToBytes(keyInput.trim());

  // ── compute old_root / new_root ──────────────────────────────────────────
  // Signers must commit to the exact state transition (old_root → new_root)
  // so that signatures cannot be replayed against a different registry output.

  const registryIndexInt = Number.parseInt(opts.registryIndex, 10);
  const spinner = ora("Fetching current registry cell to compute signing roots").start();
  let oldRoot: Uint8Array;
  let newRoot: Uint8Array;
  try {
    const { txHash, index } = await resolveRegistryOutpoint(opts.rpcUrl, opts.registryTx, registryIndexInt);
    const cell = await getLiveCell(opts.rpcUrl, txHash, index);
    const currentPayload = parseRegistryPayload(cell.data);
    const govHeaderRaw = extractGovernanceHeaderRaw(cell.data);
    const govHeader = govHeaderRaw ? parseGovernanceHeader(govHeaderRaw) : null;
    if (govHeader && signerIndex >= govHeader.pubkeys.length) {
      throw new Error(`Signer index ${signerIndex} is out of range — on-chain committee has ${govHeader.pubkeys.length} signers (0–${govHeader.pubkeys.length - 1}).`);
    }
    const oldBlkl = hexToBytes(cell.data);

    let newEntries;
    if (proposal.action === "add") {
      newEntries = insertSorted(currentPayload.entries, {
        identifier: proposal.lockArgs,
        expiresAt: BigInt(proposal.expiresAt),
      });
    } else {
      newEntries = removeEntry(currentPayload.entries, proposal.lockArgs);
    }
    const newBlkl = encodeRegistryPayload({ version: currentPayload.version, entries: newEntries }, govHeaderRaw ?? undefined);

    oldRoot = ckbBlake2b(oldBlkl);
    newRoot = ckbBlake2b(newBlkl);
    spinner.succeed("Registry roots computed");
  } catch (err) {
    spinner.fail("Could not fetch registry cell");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  // ── sign ─────────────────────────────────────────────────────────────────

  // Derive pubkey before zeroing key material.
  const pubKey = bytesToHex(new Uint8Array(secp256k1.getPublicKey(privateKeyBytes, true)));

  const msgHash = signingMessage(proposal, oldRoot!, newRoot!);
  // @noble/curves v2 'recovered' format: [recovery_bit(1), r(32), s(32)].
  // CKB secp256k1 expects: [r(32), s(32), recovery_bit(1)].
  const recoveredSig = secp256k1.sign(msgHash, privateKeyBytes, { lowS: true, format: "recovered" });
  const sigBytes = new Uint8Array(65);
  sigBytes.set(recoveredSig.slice(1), 0); // r + s at bytes 0-63
  sigBytes[64] = recoveredSig[0] ?? 0;    // recovery bit at byte 64
  privateKeyBytes.fill(0);                // zero key material immediately after use

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
