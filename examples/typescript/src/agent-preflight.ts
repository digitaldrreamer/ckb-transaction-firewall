import { mistral } from "@ai-sdk/mistral";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { TransactionFirewall } from "@ckb-firewall/sdk";
import {
  fetchLiveRegistry,
  firstActiveEntry,
  summarizeRegistry,
  TESTNET_ACCOUNT_2_LOCK_ARGS,
  TESTNET_REGISTRY_SPEC,
} from "./live-registry.js";

if (!process.env.MISTRAL_API_KEY) {
  throw new Error("MISTRAL_API_KEY is required to run the AI agent demo.");
}

const registry = await fetchLiveRegistry();
const firewall = new TransactionFirewall({ registries: [TESTNET_REGISTRY_SPEC] });
const activeEntry = firstActiveEntry(registry.payload);

console.log(`Loaded ${summarizeRegistry(registry)}`);

const result = await generateText({
  model: mistral("mistral-large-latest"),
  stopWhen: stepCountIs(3),
  system:
    "You are a CKB payment agent. You must call proposePayment before claiming a payment can be signed. " +
    "Never ask for private keys, passwords, seed phrases, or wallet credentials.",
  prompt:
    "Prepare a testnet payment to the ckb-cli account 2 recipient. " +
    (activeEntry
      ? "Then also attempt a separate payment to the known active blacklist entry so the safety layer can block it."
      : "The live registry currently has no active blacklist entries, so only test the normal recipient."),
  tools: {
    proposePayment: tool({
      description:
        "Propose an unsigned CKB payment. The transaction firewall checks the output before it can be signed.",
      inputSchema: z.object({
        memo: z.string(),
        lockArgs: z
          .string()
          .regex(/^0x[0-9a-fA-F]+$/)
          .describe("Recipient lock args as 0x-prefixed hex"),
      }),
      execute: async ({ memo, lockArgs }) => {
        const decision = firewall.checkTransaction({
          cellDeps: [registry.cellDep],
          outputs: [{ lockArgs }],
        });

        if (decision.ok) {
          return {
            memo,
            lockArgs,
            status: "approved_for_signing",
          };
        }

        return {
          memo,
          lockArgs,
          status: "blocked_before_signing",
          reason: decision.reason,
          code: decision.code,
        };
      },
    }),
    getCandidateRecipients: tool({
      description: "Return the candidate recipients available to this demo.",
      inputSchema: z.object({}),
      execute: async () => ({
        cleanRecipient: TESTNET_ACCOUNT_2_LOCK_ARGS,
        activeBlacklistedRecipient: activeEntry,
      }),
    }),
  },
});

console.log(result.text);
for (const step of result.steps) {
  for (const toolResult of step.toolResults) {
    console.log(JSON.stringify(toolResult.output, null, 2));
  }
}

const failClosed = firewall.checkTransaction({
  cellDeps: [],
  outputs: [{ lockArgs: TESTNET_ACCOUNT_2_LOCK_ARGS }],
});
if (!failClosed.ok) {
  console.log(`missing-registry-dep: rejected fail-closed - ${failClosed.reason} (${failClosed.code})`);
}

if (!activeEntry) {
  console.log("No active blacklist entries are present on testnet, so no live blacklisted-output case is available.");
}
