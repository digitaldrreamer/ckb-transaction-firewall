import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { RegistrySpecLike } from "@ckb-firewall/sdk";

export const TESTNET_RPC_URL = "https://testnet.ckb.dev";

// v2 registry spec: matches registry cell dep by type_id_value (bytes 34..66 of 66-byte v2 type args).
// Survives governance-lock upgrades — update only typeIdValue if the registry cell is re-bootstrapped.
export const TESTNET_REGISTRY_SPEC: RegistrySpecLike = {
  codeHash:
    "0x5812b3f0f68ded4d61e8f12117caa011f295dbe88a29c07b86c9caec14bd6c55",
  hashType: "type",
  typeIdValue:
    "0xc70a072cdfb7d25a5e92d27a47f9c8a0f30513de683e56e16d55ae30775f3951",
  required: true,
};

// Live registry cell outpoint on testnet. Moves after each governance update.
export const TESTNET_REGISTRY_CELL = {
  txHash:
    "0x685dc49bfe466a198a01abd94117f5fe7dd79f28570d6ceba744616d7aa51eb4",
  index: 0,
};

// Deployed contract binary cells (2026-05-26 deployment).
export const TESTNET_CONTRACT_OUTPOINTS = {
  firewallLock: {
    txHash:
      "0x128193cc2d547b224ccf10a6e299cb0749c633c5f9354ff5a9a5fd3e894318d2",
    index: 0,
  },
  blacklistRegistry: {
    txHash:
      "0x410864a6815cec51cbc3a86dfe5cf7c1ff62f1c56648ea0a0bdb2feeb6831973",
    index: 1,
  },
  governanceLock: {
    txHash:
      "0x410864a6815cec51cbc3a86dfe5cf7c1ff62f1c56648ea0a0bdb2feeb6831973",
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
// deployment with real value.
export const TESTNET_GOVERNANCE_PUBKEYS: Uint8Array[] = [
  new Uint8Array([0x03, 0xc6, 0x0a, 0xaf, 0x53, 0x51, 0x94, 0xf8, 0x0f, 0x45, 0xdc, 0x59, 0xe8, 0xe9, 0xd0, 0xc4, 0x37, 0x35, 0xc6, 0xa1, 0xf2, 0xa3, 0x59, 0xeb, 0x9e, 0x42, 0xcf, 0xcf, 0x95, 0xab, 0x76, 0x3d, 0xaf]),
  new Uint8Array([0x03, 0xdd, 0xee, 0xa1, 0x9e, 0xe4, 0x52, 0xac, 0xae, 0xc2, 0xfe, 0x23, 0xbe, 0x86, 0xdf, 0xef, 0x14, 0x8e, 0xb0, 0x06, 0x15, 0x70, 0x2b, 0xbd, 0x4f, 0x28, 0x7d, 0xa6, 0x6a, 0x19, 0x54, 0x24, 0x38]),
  new Uint8Array([0x03, 0x8f, 0x5f, 0xf1, 0xcb, 0xbb, 0x8e, 0x14, 0x00, 0x68, 0xf4, 0x9f, 0x67, 0x18, 0x3d, 0xb9, 0x5e, 0x06, 0xba, 0xa2, 0x1c, 0xcf, 0x06, 0x97, 0x59, 0x89, 0x35, 0x0b, 0x8d, 0x4f, 0xa9, 0xf2, 0xa0]),
  new Uint8Array([0x03, 0x99, 0x2a, 0xc4, 0xc9, 0x37, 0xd1, 0xe8, 0x80, 0xcb, 0x47, 0x9b, 0x55, 0x39, 0x15, 0x85, 0xf2, 0xad, 0x88, 0x83, 0x5a, 0xa9, 0xac, 0xc7, 0xcd, 0x82, 0x2f, 0x91, 0x25, 0x62, 0xd1, 0x63, 0x22]),
  new Uint8Array([0x02, 0x42, 0x93, 0x3e, 0xbb, 0x42, 0x76, 0xe5, 0x82, 0x0c, 0xab, 0xd2, 0xc0, 0x68, 0x45, 0xa5, 0x8a, 0xcb, 0x8f, 0x98, 0x1f, 0xcd, 0x79, 0xa2, 0x78, 0x39, 0x86, 0xe5, 0x51, 0x34, 0xc3, 0xfa, 0xc2]),
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
