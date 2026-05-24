import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { RegistrySpecLike } from "@ckb-firewall/sdk";

export const TESTNET_RPC_URL = "https://testnet.ckb.dev";

// v2 registry spec: matches registry cell dep by type_id_value (bytes 34..66 of 66-byte v2 type args).
// Survives governance-lock upgrades — update only typeIdValue if the registry cell is re-bootstrapped.
export const TESTNET_REGISTRY_SPEC: RegistrySpecLike = {
  codeHash:
    "0xbbfbcf51b88c57c9c1d6414de4a7e4f9dae133625dfab71588c8bc5d05b71096",
  hashType: "type",
  typeIdValue:
    "0xcd5d844661356e465c27b7d693e84f20e884da63153d2f6f40381ceb0807761c",
  required: true,
};

// Live registry cell outpoint on testnet. Moves after each governance update.
export const TESTNET_REGISTRY_CELL = {
  txHash:
    "0x0e96b7c0bd201654b854cf4d1937e1c51b9f9802e961d637d4ea61cd5b46efb3",
  index: 0,
};

// Deployed contract binary cells (2026-05-20 deployment).
export const TESTNET_CONTRACT_OUTPOINTS = {
  firewallLock: {
    txHash:
      "0x128193cc2d547b224ccf10a6e299cb0749c633c5f9354ff5a9a5fd3e894318d2",
    index: 0,
  },
  blacklistRegistry: {
    txHash:
      "0x128193cc2d547b224ccf10a6e299cb0749c633c5f9354ff5a9a5fd3e894318d2",
    index: 1,
  },
  governanceLock: {
    txHash:
      "0xe2129b256b7dd73606a33945000dcd7f1111bb9d1f8d58a21e4b8277d1187f8e",
    index: 0,
  },
  spawnAwareSecp256k1: {
    txHash:
      "0x0fe5d47662724a3620c002683d8c3f38103359c7e1ca697196b39442317c709e",
    index: 0,
  },
};

// secp256k1 dep group used by ckb-cli for fee-payer signing.
export const SECP256K1_DEP_GROUP = {
  txHash:
    "0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37",
  index: 0,
};

// Governance committee — 5 compressed secp256k1 pubkeys (33 bytes each).
// WARNING: These are TESTNET-ONLY keys. NEVER use them for mainnet or any
// deployment with real value. Rotate to fresh keys before any production use.
export const TESTNET_GOVERNANCE_PUBKEYS: Uint8Array[] = [
  new Uint8Array([0x03, 0x1b, 0x84, 0xc5, 0x56, 0x7b, 0x12, 0x64, 0x40, 0x99, 0x5d, 0x3e, 0xd5, 0xaa, 0xba, 0x05, 0x65, 0xd7, 0x1e, 0x18, 0x34, 0x60, 0x48, 0x19, 0xff, 0x9c, 0x17, 0xf5, 0xe9, 0xd5, 0xdd, 0x07, 0x8f]),
  new Uint8Array([0x02, 0x4d, 0x4b, 0x6c, 0xd1, 0x36, 0x10, 0x32, 0xca, 0x9b, 0xd2, 0xae, 0xb9, 0xd9, 0x00, 0xaa, 0x4d, 0x45, 0xd9, 0xea, 0xd8, 0x0a, 0xc9, 0x42, 0x33, 0x74, 0xc4, 0x51, 0xa7, 0x25, 0x4d, 0x07, 0x66]),
  new Uint8Array([0x02, 0x53, 0x1f, 0xe6, 0x06, 0x81, 0x34, 0x50, 0x3d, 0x27, 0x23, 0x13, 0x32, 0x27, 0xc8, 0x67, 0xac, 0x8f, 0xa6, 0xc8, 0x3c, 0x53, 0x7e, 0x9a, 0x44, 0xc3, 0xc5, 0xbd, 0xbd, 0xcb, 0x1f, 0xe3, 0x37]),
  new Uint8Array([0x03, 0x46, 0x27, 0x79, 0xad, 0x4a, 0xad, 0x39, 0x51, 0x46, 0x14, 0x75, 0x1a, 0x71, 0x08, 0x5f, 0x2f, 0x10, 0xe1, 0xc7, 0xa5, 0x93, 0xe4, 0xe0, 0x30, 0xef, 0xb5, 0xb8, 0x72, 0x1c, 0xe5, 0x5b, 0x0b]),
  new Uint8Array([0x03, 0x62, 0xc0, 0xa0, 0x46, 0xda, 0xcc, 0xe8, 0x6d, 0xdd, 0x03, 0x43, 0xc6, 0xd3, 0xc7, 0xc7, 0x9c, 0x22, 0x08, 0xba, 0x0d, 0x9c, 0x9c, 0xf2, 0x4a, 0x6d, 0x04, 0x6d, 0x21, 0xd2, 0x1f, 0x90, 0xf7]),
];

export const TESTNET_GOVERNANCE_THRESHOLD = 3;
export const TESTNET_GOVERNANCE_VALIDATOR_COUNT = 5;

// Known trivial private keys (0x01*32 through 0x05*32) used for testnet bootstrapping.
// Any deployment using these keys is insecure — anyone can read this source and take control.
const TRIVIAL_TEST_PRIVKEYS: Uint8Array[] = Array.from({ length: 5 }, (_, i) =>
  new Uint8Array(32).fill(i + 1),
);

/**
 * Emits a CRITICAL warning to stderr if any of the configured governance pubkeys
 * correspond to known trivial test private keys (0x01*32 … 0x05*32).
 * Call this before any governance write operation.
 */
export function warnIfTrivialTestKeys(pubkeys: Uint8Array[]): void {
  const trivialPubkeys = TRIVIAL_TEST_PRIVKEYS.map((priv) =>
    secp256k1.getPublicKey(priv, true),
  );
  const hasTrivial = pubkeys.some((pub) =>
    trivialPubkeys.some(
      (tp) => tp.length === pub.length && tp.every((b, i) => b === pub[i]),
    ),
  );
  if (hasTrivial) {
    process.stderr.write(
      "\n⚠️  CRITICAL SECURITY WARNING ⚠️\n" +
      "The governance committee contains keys derived from trivial test private keys.\n" +
      "Any attacker who reads this repository's source code can sign governance proposals.\n" +
      "DO NOT use this deployment for any real-value or production purpose.\n" +
      "Rotate to freshly generated keys before any non-test use.\n\n",
    );
  }
}
