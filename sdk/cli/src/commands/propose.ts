import chalk from "chalk";
import logSymbols from "log-symbols";
import inquirer from "inquirer";
import {
  computeProposalIdHash,
  computeVoteDigestHash,
  saveProposal,
  getProposalsDir,
  REVIEW_WINDOW_MS,
  type ProposalAction,
  type ThreatClass,
  type Severity,
} from "../lib/proposals.js";
import { strip0x } from "../lib/blkl.js";
import { printHints } from "../lib/hints.js";

export interface ProposeOptions {
  action?: string;
  lockArgs?: string;
  expiresAt?: string;
  evidence?: string;
  classification?: string;
  severity?: string;
  rationale?: string;
  proposer?: string;
  treasuryLockCodeHash?: string;
  treasuryLockHashType?: string;
  treasuryLockArgs?: string;
  /** Override the on-chain review delay in milliseconds. Testnet/drill use only. */
  reviewDelayMs?: string;
}

function isValidHex(v: string): boolean {
  const c = strip0x(v);
  return c.length > 0 && /^[0-9a-fA-F]+$/.test(c) && c.length % 2 === 0;
}

export async function proposeCommand(opts: ProposeOptions): Promise<void> {
  console.log();
  console.log(chalk.bold("New governance proposal"));
  console.log(chalk.dim("All fields are required and become part of the proposal hash.\n"));

  // ── action ───────────────────────────────────────────────────────────────

  let action: ProposalAction;
  if (opts.action === "add" || opts.action === "remove" || opts.action === "set-treasury") {
    action = opts.action;
  } else {
    const { chosen } = await inquirer.prompt<{ chosen: ProposalAction }>([
      {
        type: "list",
        name: "chosen",
        message: "Proposal type:",
        choices: [
          { name: "Add address to blacklist", value: "add" },
          { name: "Remove address from blacklist", value: "remove" },
          { name: "Set registry treasury lock", value: "set-treasury" },
        ],
      },
    ]);
    action = chosen;
  }

  // ── lock args ────────────────────────────────────────────────────────────

  let lockArgs = "0x";
  if (action === "set-treasury") {
    lockArgs = "0x";
  } else if (opts.lockArgs && isValidHex(opts.lockArgs)) {
    lockArgs = `0x${strip0x(opts.lockArgs).toLowerCase()}`;
  } else {
    const { hex } = await inquirer.prompt<{ hex: string }>([
      {
        type: "input",
        name: "hex",
        message: `Lock args to ${action} (0x-prefixed hex):`,
        validate: (v: string) => {
          if (!v.trim()) return "Required.";
          if (!isValidHex(v.trim())) return "Must be valid even-length hex.";
          return true;
        },
      },
    ]);
    lockArgs = `0x${strip0x(hex.trim()).toLowerCase()}`;
  }

  // ── expires at (add only) ────────────────────────────────────────────────

  let expiresAt = "0";
  if (action === "add") {
    if (opts.expiresAt !== undefined && opts.expiresAt !== "0") {
      expiresAt = opts.expiresAt;
    } else if (!opts.lockArgs) {
      const { choice } = await inquirer.prompt<{ choice: string }>([
        {
          type: "list",
          name: "choice",
          message: "Expiry:",
          choices: [
            { name: "Never (permanent)", value: "never" },
            { name: "Temporary — set expiry timestamp", value: "custom" },
          ],
        },
      ]);
      if (choice === "custom") {
        const { ts } = await inquirer.prompt<{ ts: string }>([
          {
            type: "input",
            name: "ts",
            message: "Expiry (unix timestamp in seconds):",
            validate: (v: string) => {
              const n = Number(v.trim());
              if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return "Enter a positive integer.";
              const now = Math.floor(Date.now() / 1000);
              if (n <= now) return "Expiry must be in the future.";
              if (n > now + 100 * 365 * 24 * 60 * 60) return "Expiry too far in the future (max 100 years).";
              return true;
            },
          },
        ]);
        expiresAt = ts.trim();
      }
    }
  }

  let treasuryLockScript: { code_hash: string; hash_type: string; args: string } | undefined;
  if (action === "set-treasury") {
    const codeHash = opts.treasuryLockCodeHash?.trim();
    const hashType = opts.treasuryLockHashType?.trim();
    const args = opts.treasuryLockArgs?.trim();
    if (codeHash && hashType && args !== undefined && isValidHex(codeHash) && isValidHex(args)) {
      treasuryLockScript = {
        code_hash: `0x${strip0x(codeHash).toLowerCase()}`,
        hash_type: hashType,
        args: `0x${strip0x(args).toLowerCase()}`,
      };
    } else {
      const answers = await inquirer.prompt<{
        codeHash: string;
        hashType: string;
        args: string;
      }>([
        {
          type: "input",
          name: "codeHash",
          message: "Treasury lock code hash:",
          validate: (v: string) => (isValidHex(v.trim()) && strip0x(v.trim()).length === 64) || "Must be a 32-byte hex string.",
        },
        {
          type: "list",
          name: "hashType",
          message: "Treasury lock hash type:",
          choices: ["type", "data1", "data"],
          default: "type",
        },
        {
          type: "input",
          name: "args",
          message: "Treasury lock args:",
          validate: (v: string) => isValidHex(v.trim()) || "Must be valid even-length hex.",
        },
      ]);
      treasuryLockScript = {
        code_hash: `0x${strip0x(answers.codeHash).toLowerCase()}`,
        hash_type: answers.hashType,
        args: `0x${strip0x(answers.args).toLowerCase()}`,
      };
    }
  }

  // ── evidence ─────────────────────────────────────────────────────────────

  let evidence: string;
  if (opts.evidence?.trim()) {
    evidence = opts.evidence.trim();
  } else {
    const { ev } = await inquirer.prompt<{ ev: string }>([
      {
        type: "input",
        name: "ev",
        message: "Evidence (URL, tx hash, or description):",
        validate: (v: string) => v.trim().length >= 10 || "Provide at least 10 characters of evidence.",
      },
    ]);
    evidence = ev.trim();
  }

  // ── classification ───────────────────────────────────────────────────────

  let classification: ThreatClass;
  if (["theft", "scam", "hack", "sanctions", "other"].includes(opts.classification ?? "")) {
    classification = opts.classification as ThreatClass;
  } else {
    const { cls } = await inquirer.prompt<{ cls: ThreatClass }>([
      {
        type: "list",
        name: "cls",
        message: "Threat classification:",
        choices: [
          { name: "Theft — direct fund theft", value: "theft" },
          { name: "Scam — fraudulent scheme", value: "scam" },
          { name: "Hack — exploit / contract breach", value: "hack" },
          { name: "Sanctions — regulatory / OFAC", value: "sanctions" },
          { name: "Other", value: "other" },
        ],
      },
    ]);
    classification = cls;
  }

  // ── severity ─────────────────────────────────────────────────────────────

  let severity: Severity;
  if (["critical", "high", "medium", "low"].includes(opts.severity ?? "")) {
    severity = opts.severity as Severity;
  } else {
    const { sev } = await inquirer.prompt<{ sev: Severity }>([
      {
        type: "list",
        name: "sev",
        message: "Severity:",
        choices: [
          { name: "Critical — active, ongoing, large-scale", value: "critical" },
          { name: "High — confirmed, significant impact", value: "high" },
          { name: "Medium — suspected or moderate impact", value: "medium" },
          { name: "Low — minor or historic", value: "low" },
        ],
      },
    ]);
    severity = sev;
  }

  // ── rationale ────────────────────────────────────────────────────────────

  let rationale: string;
  if (opts.rationale && opts.rationale.trim().length >= 20) {
    rationale = opts.rationale.trim();
  } else {
    const { rat } = await inquirer.prompt<{ rat: string }>([
      {
        type: "input",
        name: "rat",
        message: "Rationale and impact statement:",
        validate: (v: string) => v.trim().length >= 20 || "Provide at least 20 characters.",
      },
    ]);
    rationale = rat.trim();
  }

  // ── proposer ─────────────────────────────────────────────────────────────

  let proposer: string;
  if (opts.proposer?.trim()) {
    proposer = opts.proposer.trim();
  } else {
    const { prop } = await inquirer.prompt<{ prop: string }>([
      {
        type: "input",
        name: "prop",
        message: "Your name / identifier (proposer):",
        validate: (v: string) => v.trim().length > 0 || "Required.",
      },
    ]);
    proposer = prop.trim();
  }

  // ── create proposal ──────────────────────────────────────────────────────

  const submittedAt = new Date().toISOString();
  let effectiveReviewDelayMs = REVIEW_WINDOW_MS;
  if (opts.reviewDelayMs !== undefined) {
    const parsed = Number(opts.reviewDelayMs);
    if (!Number.isInteger(parsed) || parsed < 0) {
      console.error(logSymbols.error, chalk.red("--review-delay-ms must be a non-negative integer."));
      process.exit(1);
    }
    effectiveReviewDelayMs = parsed;
    if (parsed < REVIEW_WINDOW_MS) {
      console.log(logSymbols.warning, chalk.yellow(
        `Review delay set to ${parsed}ms — shorter than the production minimum of ${REVIEW_WINDOW_MS}ms. ` +
        "For testnet / drill use only.",
      ));
    }
  }
  const reviewWindowEndsAt = new Date(Date.now() + effectiveReviewDelayMs).toISOString();

  const proposalIdHash = computeProposalIdHash({
    action,
    lockArgs,
    expiresAt,
    evidence,
    classification,
    severity,
    rationale,
    proposer,
    submittedAt,
    ...(treasuryLockScript ? { treasuryLockScript } : {}),
  });

  const proposal = {
    id: proposalIdHash.slice(2, 14),
    proposalIdHash,
    action,
    lockArgs,
    expiresAt,
    evidence,
    classification,
    severity,
    rationale,
    proposer,
    submittedAt,
    reviewWindowEndsAt,
    status: "pending-review" as const,
    votes: [],
    voteDigestHash: computeVoteDigestHash([]),
    signatures: [],
    ...(opts.reviewDelayMs !== undefined ? { reviewDelayMs: String(effectiveReviewDelayMs) } : {}),
    ...(treasuryLockScript ? { treasuryLockScript } : {}),
  };

  saveProposal(proposal);

  // ── timing warnings ──────────────────────────────────────────────────────

  // Warn if a temporary entry would expire before the governance process can complete.
  // Minimum realistic timeline: 72h review + ~24h voting + ~24h signing = ~120h.
  const MIN_GOVERNANCE_SECONDS = 120 * 60 * 60;
  if (expiresAt !== "0") {
    const expiryUnix = Number(expiresAt);
    const nowUnix = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = expiryUnix - nowUnix;
    if (timeUntilExpiry < MIN_GOVERNANCE_SECONDS) {
      const hRemaining = Math.floor(timeUntilExpiry / 3600);
      console.log();
      console.log(logSymbols.warning, chalk.yellow(
        `Expiry warning: this entry expires in ~${hRemaining}h, but the full governance ` +
        `flow (72h review + voting + signing) takes at least 120h. ` +
        `The entry may expire before it can be executed.`,
      ));
    }
  }

  // ── IPFS hint ────────────────────────────────────────────────────────────

  const looksLikeUrl = /^https?:\/\//.test(evidence);
  const looksLikeTxHash = /^0x[0-9a-fA-F]{64}$/.test(evidence);
  if (!looksLikeUrl && !looksLikeTxHash) {
    console.log();
    console.log(chalk.dim(
      "  Tip: consider pinning your evidence to IPFS for decentralized, " +
      "tamper-evident archival:\n" +
      "  ipfs add <evidence-file>  →  include the resulting CID as evidence in future proposals.",
    ));
  }

  // ── output ───────────────────────────────────────────────────────────────

  console.log();
  console.log(logSymbols.success, chalk.green("Proposal created"));
  console.log();
  console.log(`  ID:           ${chalk.bold(proposal.id)}`);
  console.log(`  Hash:         ${chalk.dim(proposalIdHash)}`);
  console.log(`  Action:       ${action === "add" ? chalk.green("add") : chalk.red("remove")}  ${lockArgs}`);
  console.log(`  Class:        ${classification} / ${severity}`);
  console.log(`  Review ends:  ${reviewWindowEndsAt}`);
  console.log(`  Stored at:    ${getProposalsDir()}`);
  console.log();
  console.log(chalk.bold("Next steps:"));
  console.log(`  1. Export and share:  ${chalk.dim(`ckb-firewall export --proposal ${proposal.id} --out proposal-${proposal.id}.json`)}`);
  console.log(`  2. Collect votes:     ${chalk.dim(`ckb-firewall vote --proposal ${proposal.id}`)}`);
  console.log(`  3. Execute:           ${chalk.dim(`ckb-firewall execute --proposal ${proposal.id}`)}`);
  console.log();
  printHints("propose");
}
