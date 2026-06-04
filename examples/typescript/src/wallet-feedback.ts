import { TransactionFirewall } from "@ckb-firewall/sdk";
import type { FirewallDecision, TxOutputLike } from "@ckb-firewall/sdk";
import {
  fetchLiveRegistry,
  firstActiveEntry,
  summarizeRegistry,
  TESTNET_ACCOUNT_2_LOCK_ARGS,
  TESTNET_REGISTRY_SPEC,
} from "./live-registry.js";

type SendState =
  | { status: "blocked"; message: string; code: number }
  | { status: "signing"; message: string };

function renderFirewallFeedback(decision: FirewallDecision): SendState {
  if (decision.ok) {
    return {
      status: "signing",
      message: "Firewall check passed against the live registry. Continue to wallet signature.",
    };
  }

  const messages: Record<Exclude<FirewallDecision, { ok: true }>["reason"], string> = {
    MissingRegistryCellDep: "The transaction is missing the current firewall registry cell.",
    InvalidRegistryData: "The registry cell data is malformed or unsupported.",
    RegistryNotSorted: "The registry cell failed integrity checks.",
    BlacklistedLockArgs: "This recipient is blocked by the transaction firewall.",
    BlacklistedTypeArgs: "This output type is blocked by the transaction firewall.",
    AmbiguousRegistryCellDep: "The transaction contains more than one matching registry cell.",
  };

  return {
    status: "blocked",
    message: messages[decision.reason],
    code: decision.code,
  };
}

const registry = await fetchLiveRegistry();
const firewall = new TransactionFirewall({ registries: [TESTNET_REGISTRY_SPEC] });

function prepareSend(outputs: TxOutputLike[]): SendState {
  const decision = firewall.checkTransaction({ cellDeps: [registry.cellDep], outputs });
  return renderFirewallFeedback(decision);
}

console.log(`Loaded ${summarizeRegistry(registry)}`);
console.log("Candidate send:", prepareSend([{ lockArgs: TESTNET_ACCOUNT_2_LOCK_ARGS }]));

const activeEntry = firstActiveEntry(registry.payload);
if (activeEntry) {
  console.log("Blacklisted send:", prepareSend([{ lockArgs: activeEntry }]));
} else {
  console.log("Blacklisted send: unavailable because the live testnet registry has no active entries.");
}

console.log(
  "Missing dep:",
  renderFirewallFeedback(
    firewall.checkTransaction({
      cellDeps: [],
      outputs: [{ lockArgs: TESTNET_ACCOUNT_2_LOCK_ARGS }],
    }),
  ),
);
