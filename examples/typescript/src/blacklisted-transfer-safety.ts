import { TransactionFirewall } from "@ckb-firewall/sdk";
import {
  fetchLiveRegistry,
  firstActiveEntry,
  summarizeRegistry,
  TESTNET_REGISTRY_SPEC,
} from "./live-registry.js";

const registry = await fetchLiveRegistry();
const firewall = new TransactionFirewall({ registries: [TESTNET_REGISTRY_SPEC] });
const destination = process.env.BLACKLISTED_LOCK_ARGS ?? firstActiveEntry(registry.payload);

console.log(`Loaded ${summarizeRegistry(registry)}`);

if (!destination) {
  console.log(
    "No active blacklisted destination is available in the live registry. " +
      "Set BLACKLISTED_LOCK_ARGS after governance adds an active entry.",
  );
  process.exit(0);
}

const decision = firewall.checkTransaction({
  cellDeps: [registry.cellDep],
  outputs: [{ lockArgs: destination }],
});

if (decision.ok) {
  console.error(
    `Refusing to call this a blacklisted-transfer test: ${destination} is not active in the live registry.`,
  );
  process.exit(1);
}

console.log(`Transfer candidate to ${destination} was blocked before signing.`);
console.log(`Reason: ${decision.reason} (${decision.code})`);
console.log("No ckb-cli password, private key, or signing command was requested.");
