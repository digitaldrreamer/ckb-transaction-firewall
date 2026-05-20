import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import logSymbols from "log-symbols";
import ora from "ora";
import inquirer from "inquirer";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { parseRegistryPayload } from "@ckb-firewall/sdk";
import { getLiveCell } from "../lib/rpc.js";
import { resolveRegistryOutpoint } from "../lib/registry.js";
import {
  loadProposal,
  saveProposal,
  listProposals,
  isReviewWindowPassed,
  isVoteApproved,
  isReadyToExecute,
  computeVoteDigestHash,
  voteSigningMessage,
  signingMessage,
  SIG_THRESHOLD,
} from "../lib/proposals.js";
import {
  encodeRegistryPayload,
  extractGovernanceHeaderRaw,
  parseGovernanceHeader,
  insertSorted,
  removeEntry,
  bytesToHex,
  hexToBytes,
  strip0x,
} from "../lib/blkl.js";
import { verifyMerkleProof } from "../lib/validator-set.js";
import {
  ckbBlake2b,
  buildGov1WitnessV2,
  buildGovernanceSigWitness,
  buildWitnessArgs,
} from "../lib/witness.js";
import {
  TESTNET_RPC_URL,
  TESTNET_REGISTRY_CELL,
  TESTNET_CONTRACT_OUTPOINTS,
  SECP256K1_DEP_GROUP,
} from "../lib/defaults.js";
import { printHints } from "../lib/hints.js";

export interface ExecuteOptions {
  proposal?: string;
  rpcUrl: string;
  registryTx: string;
  registryIndex: string;
  txOut: string;
  sign: boolean;
  fromAccount: string;
}

export async function executeCommand(opts: ExecuteOptions): Promise<void> {
  // ── select proposal ──────────────────────────────────────────────────────

  let proposalId = opts.proposal?.trim() ?? "";
  if (!proposalId) {
    const ready = listProposals().filter(isReadyToExecute);
    if (ready.length === 0) {
      console.log(logSymbols.warning, chalk.yellow("No proposals are ready to execute."));
      console.log(chalk.dim("  A proposal needs: review window passed + vote threshold + 3 signatures."));
      process.exit(0);
    }
    const { chosen } = await inquirer.prompt<{ chosen: string }>([
      {
        type: "list",
        name: "chosen",
        message: "Select proposal to execute:",
        choices: ready.map((p) => ({
          name: `${chalk.bold(p.id)}  ${p.action} ${p.lockArgs.slice(0, 24)}…`,
          value: p.id,
        })),
      },
    ]);
    proposalId = chosen;
  }

  const proposal = loadProposal(proposalId);

  // ── checks ───────────────────────────────────────────────────────────────

  if (proposal.status === "executed") {
    console.log(logSymbols.success, chalk.green(`Already executed — tx: ${proposal.txHash ?? "unknown"}`));
    process.exit(0);
  }
  if (!isReviewWindowPassed(proposal)) {
    const ms = new Date(proposal.reviewWindowEndsAt).getTime() - Date.now();
    const h = Math.floor(ms / 3_600_000);
    console.log(logSymbols.error, chalk.red(`Review window not passed — ${h}h remaining.`));
    process.exit(1);
  }
  if (!isVoteApproved(proposal)) {
    console.log(logSymbols.error, chalk.red("Vote threshold not met."));
    console.log(chalk.dim(`  Use: ckb-firewall vote --proposal ${proposal.id}`));
    process.exit(1);
  }
  if (proposal.signatures.length < SIG_THRESHOLD) {
    console.log(
      logSymbols.error,
      chalk.red(`Only ${proposal.signatures.length}/${SIG_THRESHOLD} signatures — need more.`),
    );
    console.log(chalk.dim(`  Use: ckb-firewall sign --proposal ${proposal.id}`));
    process.exit(1);
  }

  // P0-8: reject if the proposal's expiry has already passed.
  if (proposal.expiresAt !== "0") {
    const expiryMs = Number(proposal.expiresAt) * 1000;
    if (Date.now() >= expiryMs) {
      console.log(logSymbols.error, chalk.red(`Proposal "${proposal.id}" has already expired (${new Date(expiryMs).toISOString()}).`));
      console.log(chalk.dim("  A new proposal must be created for this blacklist entry."));
      process.exit(1);
    }
  }

  // P4-3: verify every vote carries a valid signature from its claimed pubkey.
  for (const v of proposal.votes) {
    const sigBytes = hexToBytes(v.signature);
    if (sigBytes.length !== 65) {
      console.error(logSymbols.error, chalk.red(`Vote from ${v.pubkey.slice(0, 14)}… has invalid signature length.`));
      process.exit(1);
    }
    const msgHash = voteSigningMessage(proposal.proposalIdHash, v.vote, v.timestamp, v.pubkey);
    // Rebuild [recovery_id, r, s] from stored [r, s, recovery_id].
    const sig65 = new Uint8Array(65);
    sig65[0] = sigBytes[64] ?? 0;
    sig65.set(sigBytes.slice(0, 64), 1);
    let recoveredPubkey: string;
    try {
      recoveredPubkey = bytesToHex(new Uint8Array(secp256k1.recoverPublicKey(sig65, msgHash)));
    } catch {
      console.error(logSymbols.error, chalk.red(`Vote from ${v.pubkey.slice(0, 14)}… has unrecoverable signature — proposal may have been tampered.`));
      process.exit(1);
    }
    if (recoveredPubkey !== v.pubkey) {
      console.error(logSymbols.error, chalk.red(`Vote signature does not match pubkey ${v.pubkey.slice(0, 14)}… — proposal may have been tampered.`));
      process.exit(1);
    }
  }

  // ── fetch current registry cell ──────────────────────────────────────────

  const registryIndex = Number.parseInt(opts.registryIndex, 10);
  if (!Number.isInteger(registryIndex) || registryIndex < 0) {
    console.error(logSymbols.error, chalk.red("--registry-index must be a non-negative integer."));
    process.exit(1);
  }

  const spinner = ora("Fetching current registry cell").start();
  let cell: Awaited<ReturnType<typeof getLiveCell>>;
  try {
    const { txHash, index } = await resolveRegistryOutpoint(opts.rpcUrl, opts.registryTx, registryIndex);
    cell = await getLiveCell(opts.rpcUrl, txHash, index);
    spinner.succeed("Registry cell loaded");
  } catch (err) {
    spinner.fail("Could not fetch registry cell");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  let currentPayload: ReturnType<typeof parseRegistryPayload>;
  try {
    currentPayload = parseRegistryPayload(cell.data);
  } catch {
    console.error(logSymbols.error, chalk.red("Registry cell does not contain a valid BLKL payload."));
    process.exit(1);
  }

  // ── verify vote Merkle proofs against on-chain validator set ─────────────

  const oldBlkl = hexToBytes(cell.data);
  const govHeaderRaw = extractGovernanceHeaderRaw(cell.data);
  const govHeader = govHeaderRaw ? parseGovernanceHeader(govHeaderRaw) : null;

  if (govHeader && govHeader.validatorCount > 0) {
    const rootHex = bytesToHex(govHeader.validatorMerkleRoot);
    for (const v of proposal.votes) {
      if (!Array.isArray(v.merkleProof) || typeof v.merkleLeafIndex !== "number") {
        console.error(logSymbols.error, chalk.red(`Vote from ${v.pubkey.slice(0, 14)}… is missing a Merkle proof — re-cast the vote with the current CLI.`));
        process.exit(1);
      }
      const valid = verifyMerkleProof(rootHex, v.pubkey, v.merkleProof, v.merkleLeafIndex);
      if (!valid) {
        console.error(logSymbols.error, chalk.red(`Vote from ${v.pubkey.slice(0, 14)}… is not in the on-chain validator set.`));
        process.exit(1);
      }
    }
  }

  // C-4: verify governance signer signatures against on-chain pubkeys from governance header.
  if (govHeader && govHeader.pubkeys.length > 0) {
    const msgHash = signingMessage(proposal, oldRoot, newRoot);
    for (const s of proposal.signatures) {
      if (s.signerIndex >= govHeader.pubkeys.length) {
        console.error(logSymbols.error, chalk.red(`Signer index ${s.signerIndex} is out of range for the on-chain governance committee (${govHeader.pubkeys.length} signers).`));
        process.exit(1);
      }
      const sigBytes = hexToBytes(s.signature);
      if (sigBytes.length !== 65) {
        console.error(logSymbols.error, chalk.red(`Governance signature from signer ${s.signerIndex} has invalid length.`));
        process.exit(1);
      }
      // Rebuild [recovery_id, r, s] from stored [r, s, recovery_id].
      const sig65 = new Uint8Array(65);
      sig65[0] = sigBytes[64] ?? 0;
      sig65.set(sigBytes.slice(0, 64), 1);
      let recoveredPubkey: string;
      try {
        recoveredPubkey = bytesToHex(new Uint8Array(secp256k1.recoverPublicKey(sig65, msgHash)));
      } catch {
        console.error(logSymbols.error, chalk.red(`Governance signature from signer ${s.signerIndex} is unrecoverable.`));
        process.exit(1);
      }
      const expectedPubkey = bytesToHex(govHeader.pubkeys[s.signerIndex]!);
      if (recoveredPubkey !== expectedPubkey) {
        console.error(logSymbols.error, chalk.red(`Governance signature from signer ${s.signerIndex} does not match the on-chain pubkey — proposal may have been tampered.`));
        process.exit(1);
      }
    }
  }

  // ── build new BLKL payload ────────────────────────────────────────────────
  let newEntries;

  if (proposal.action === "add") {
    if (currentPayload.entries.some((e) => strip0x(e.identifier).toLowerCase() === strip0x(proposal.lockArgs).toLowerCase())) {
      console.log(logSymbols.warning, chalk.yellow(`${proposal.lockArgs} is already in the registry.`));
      process.exit(0);
    }
    newEntries = insertSorted(currentPayload.entries, {
      identifier: proposal.lockArgs,
      expiresAt: BigInt(proposal.expiresAt),
    });
  } else {
    newEntries = removeEntry(currentPayload.entries, proposal.lockArgs);
    if (newEntries.length === currentPayload.entries.length) {
      console.log(logSymbols.warning, chalk.yellow(`${proposal.lockArgs} is not in the registry.`));
      process.exit(0);
    }
  }

  const newPayload = { version: currentPayload.version, entries: newEntries };
  const newBlkl = encodeRegistryPayload(newPayload, govHeaderRaw ?? undefined);

  // ── build GOV1 witness with real signatures ───────────────────────────────

  // P0-2: recompute voteDigestHash from votes and verify it matches the stored value.
  const recomputedVoteDigest = computeVoteDigestHash(proposal.votes);
  if (recomputedVoteDigest !== proposal.voteDigestHash) {
    console.error(logSymbols.error, chalk.red("Vote digest hash mismatch — proposal votes may have been tampered."));
    console.error(chalk.dim(`  Stored:     ${proposal.voteDigestHash}`));
    console.error(chalk.dim(`  Recomputed: ${recomputedVoteDigest}`));
    process.exit(1);
  }

  const proposalIdBytes = hexToBytes(proposal.proposalIdHash);
  const voteDigestBytes = hexToBytes(proposal.voteDigestHash);
  const oldRoot = ckbBlake2b(oldBlkl);
  const newRoot = ckbBlake2b(newBlkl);

  const signers = proposal.signatures.slice(0, SIG_THRESHOLD).map((s) => ({
    index: s.signerIndex,
    sig: hexToBytes(s.signature),
  }));

  // v2: GOV1 binding in input_type, signer entries in lock field.
  const gov1 = buildGov1WitnessV2({ proposalIdHash: proposalIdBytes, voteDigestHash: voteDigestBytes, oldRoot, newRoot });
  const sigWitness = buildGovernanceSigWitness(signers);
  const witnessBytes = buildWitnessArgs({ lock: sigWitness, inputType: gov1 });

  // ── summary ───────────────────────────────────────────────────────────────

  console.log();
  console.log(chalk.bold("Executing proposal:"), proposal.id);
  console.log(`  Action:     ${proposal.action === "add" ? chalk.green("add") : chalk.red("remove")} ${proposal.lockArgs}`);
  console.log(`  Proposer:   ${proposal.proposer}`);
  console.log(`  Signers:    ${signers.map((s) => `#${s.index}`).join(", ")}`);
  console.log(`  Old → new:  ${currentPayload.entries.length} → ${newEntries.length} entries`);
  console.log();

  // ── build tx JSON ────────────────────────────────────────────────────────

  const txJson = {
    transaction: {
      version: "0x0",
      cell_deps: [
        { out_point: { tx_hash: SECP256K1_DEP_GROUP.txHash, index: "0x0" }, dep_type: "dep_group" },
        {
          out_point: {
            tx_hash: TESTNET_CONTRACT_OUTPOINTS.blacklistRegistry.txHash,
            index: `0x${TESTNET_CONTRACT_OUTPOINTS.blacklistRegistry.index.toString(16)}`,
          },
          dep_type: "code",
        },
        {
          out_point: {
            tx_hash: TESTNET_CONTRACT_OUTPOINTS.governanceLock.txHash,
            index: `0x${TESTNET_CONTRACT_OUTPOINTS.governanceLock.index.toString(16)}`,
          },
          dep_type: "code",
        },
      ],
      header_deps: [],
      inputs: [
        { since: "0x0", previous_output: { tx_hash: cell.txHash, index: `0x${cell.index.toString(16)}` } },
      ],
      outputs: [{ capacity: cell.capacity, lock: cell.lock, type: cell.type }],
      outputs_data: [bytesToHex(newBlkl)],
      witnesses: [bytesToHex(witnessBytes)],
    },
    multisig_configs: {},
    signatures: {},
  };

  const txOut = opts.txOut;
  writeFileSync(txOut, JSON.stringify(txJson, null, 2) + "\n");
  console.log(logSymbols.success, `Transaction written to ${chalk.bold(txOut)}`);
  console.log();

  // ── sign / submit ────────────────────────────────────────────────────────

  if (!opts.sign) {
    console.log("Sign and submit with ckb-cli:");
    console.log(chalk.dim(
      `  ckb-cli wallet sign-txs --tx-file ${txOut} --from-account <address>\n` +
      `  ckb-cli wallet apply-txs --tx-file ${txOut}`,
    ));
    console.log();
    printHints("execute");
    return;
  }

  let fromAccount = opts.fromAccount;
  if (!fromAccount && process.stdin.isTTY) {
    const { account } = await inquirer.prompt<{ account: string }>([
      {
        type: "input",
        name: "account",
        message: "Governance account address (ckb-cli --from-account):",
        validate: (v: string) => v.trim().length > 0 || "Required.",
      },
    ]);
    fromAccount = account.trim();
  }
  if (!fromAccount) {
    console.error(logSymbols.error, chalk.red("--from-account is required when using --sign."));
    process.exit(1);
  }

  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    { type: "confirm", name: "proceed", message: "Sign and submit?", default: false },
  ]);
  if (!proceed) { console.log("Aborted."); return; }

  const signSpinner = ora("Signing with ckb-cli").start();
  try {
    execFileSync("ckb-cli", ["wallet", "sign-txs", "--tx-file", txOut, "--from-account", fromAccount], { stdio: "inherit" });
    signSpinner.succeed("Signed");

    const submitSpinner = ora("Submitting").start();
    const output = execFileSync("ckb-cli", ["wallet", "apply-txs", "--tx-file", txOut], { encoding: "utf8" });
    submitSpinner.succeed("Submitted");

    const txHash = output.match(/0x[a-fA-F0-9]{64}/)?.[0];
    if (txHash) {
      proposal.status = "executed";
      proposal.txHash = txHash;
      saveProposal(proposal);
      console.log();
      console.log(logSymbols.success, chalk.green("Registry updated on-chain."));
      console.log(`  Tx: ${chalk.bold(txHash)}`);
      printHints("execute");
    }
  } catch (err) {
    signSpinner.fail("ckb-cli failed");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

export function executeDefaults(): Partial<ExecuteOptions> {
  return {
    rpcUrl: TESTNET_RPC_URL,
    registryTx: TESTNET_REGISTRY_CELL.txHash,
    registryIndex: String(TESTNET_REGISTRY_CELL.index),
    txOut: "gov_execute_tx.json",
    sign: false,
    fromAccount: "",
  };
}
