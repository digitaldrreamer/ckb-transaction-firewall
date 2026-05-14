import type { ScriptLike } from "@ckb-firewall/sdk";

export const TESTNET_RPC_URL = "https://testnet.ckb.dev";

export const TESTNET_REGISTRY_SCRIPT: ScriptLike = {
  codeHash:
    "0xbbfbcf51b88c57c9c1d6414de4a7e4f9dae133625dfab71588c8bc5d05b71096",
  hashType: "type",
  args: "0x019bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce80114003f54dea35bcc7a0efef541d361799f77bd1b8581",
};

// Known live registry cell outpoint on testnet (may move after governance updates).
export const TESTNET_REGISTRY_CELL = {
  txHash:
    "0x57edc162ddd476d970b8a65558466ca11bb1762be9366fd12c76d620fe695fb7",
  index: 0,
};

// Deployed contract binary cells.
export const TESTNET_CONTRACT_OUTPOINTS = {
  firewallLock: {
    txHash:
      "0x11b0397cd58dce5c2bd704108ee6e1609128c0d828a3f3360237585e82bb7aed",
    index: 0,
  },
  blacklistRegistry: {
    txHash:
      "0x11b0397cd58dce5c2bd704108ee6e1609128c0d828a3f3360237585e82bb7aed",
    index: 1,
  },
};

// secp256k1 dep group used by ckb-cli for fee-payer signing.
export const SECP256K1_DEP_GROUP = {
  txHash:
    "0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37",
  index: 0,
};
