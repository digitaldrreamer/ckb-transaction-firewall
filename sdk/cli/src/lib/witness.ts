import { blake2b } from "@noble/hashes/blake2b";

const CKB_PERSONALIZATION = new TextEncoder().encode("ckb-default-hash");

export function ckbBlake2b(data: Uint8Array): Uint8Array {
  return blake2b(data, { personalization: CKB_PERSONALIZATION, dkLen: 32 });
}

export interface Gov1BindingParams {
  proposalIdHash: Uint8Array;
  voteDigestHash: Uint8Array;
  oldRoot: Uint8Array;
  newRoot: Uint8Array;
}

// GOV1 v2 — binding commitment only, no signers (133 bytes).
// Signers go in WitnessArgs.lock as a separate governance-sig-witness.
export function buildGov1WitnessV2(params: Gov1BindingParams): Uint8Array {
  for (const [name, val] of [
    ["proposalIdHash", params.proposalIdHash],
    ["voteDigestHash", params.voteDigestHash],
    ["oldRoot", params.oldRoot],
    ["newRoot", params.newRoot],
  ] as const) {
    if (val.length !== 32) throw new Error(`${name} must be exactly 32 bytes, got ${val.length}`);
  }
  // 4 magic + 1 version + 32*4 hashes = 133 bytes
  const buf = new Uint8Array(133);
  let off = 0;
  buf[off++] = 0x47; buf[off++] = 0x4f; buf[off++] = 0x56; buf[off++] = 0x31; // GOV1
  buf[off++] = 0x02; // version 2
  buf.set(params.proposalIdHash, off); off += 32;
  buf.set(params.voteDigestHash, off); off += 32;
  buf.set(params.oldRoot, off); off += 32;
  buf.set(params.newRoot, off); off += 32;
  return buf;
}

// Builds the WitnessArgs.lock content for governance transactions (v2).
// Format: signer_count(1) | [signer_index(1) + r+s+v(65)] * N
export function buildGovernanceSigWitness(signers: Array<{ index: number; sig: Uint8Array }>): Uint8Array {
  if (signers.length > 255) throw new Error("signer_count must fit in 1 byte (max 255)");
  for (const s of signers) {
    if (!Number.isInteger(s.index) || s.index < 0 || s.index > 255) {
      throw new Error(`signer index out of range: ${s.index}`);
    }
    if (s.sig.length !== 65) throw new Error(`signature must be 65 bytes, got ${s.sig.length}`);
  }
  const buf = new Uint8Array(1 + signers.length * 66);
  buf[0] = signers.length;
  let off = 1;
  for (const s of signers) {
    buf[off++] = s.index;
    buf.set(s.sig, off);
    off += 65;
  }
  return buf;
}

function writeU32LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
  buf[offset + 2] = (value >> 16) & 0xff;
  buf[offset + 3] = (value >> 24) & 0xff;
}

function bytesOpt(data: Uint8Array | undefined): Uint8Array {
  if (!data) return new Uint8Array(0);
  const buf = new Uint8Array(4 + data.length);
  writeU32LE(buf, 0, data.length);
  buf.set(data, 4);
  return buf;
}

// Molecule-encodes a WitnessArgs table (lock, input_type, output_type).
// The lock field is a 65-byte zero placeholder that ckb-cli sign-tx fills in.
export function buildWitnessArgs(params: {
  lock?: Uint8Array;
  inputType?: Uint8Array;
  outputType?: Uint8Array;
}): Uint8Array {
  const lockOpt = bytesOpt(params.lock);
  const inputTypeOpt = bytesOpt(params.inputType);
  const outputTypeOpt = bytesOpt(params.outputType);

  const HEADER = 16; // 4 total_size + 3 * 4 offsets
  const offLock = HEADER;
  const offInputType = offLock + lockOpt.length;
  const offOutputType = offInputType + inputTypeOpt.length;
  const totalSize = offOutputType + outputTypeOpt.length;

  const buf = new Uint8Array(totalSize);
  writeU32LE(buf, 0, totalSize);
  writeU32LE(buf, 4, offLock);
  writeU32LE(buf, 8, offInputType);
  writeU32LE(buf, 12, offOutputType);
  buf.set(lockOpt, offLock);
  buf.set(inputTypeOpt, offInputType);
  buf.set(outputTypeOpt, offOutputType);

  return buf;
}

// FOR UNIT TESTING ONLY — generates structurally-valid but cryptographically fake signatures.
// governance-lock v2 DOES verify secp256k1 signatures on-chain; these WILL be rejected by the chain.
// Never use in a real governance transaction. Only valid in test environments that mock the contract.
export function placeholderSigners(count: 3 | 4 | 5 = 3): Array<{ index: number; sig: Uint8Array }> {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    sig: new Uint8Array(65).fill(0x11), // non-zero placeholder; recovery id corrected to 0x00 below
  })).map((s) => {
    // Recovery id must be 0-3. Set last byte to 0.
    const sig = new Uint8Array(s.sig);
    sig[64] = 0x00;
    return { index: s.index, sig };
  });
}
