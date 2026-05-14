import { blake2b } from "@noble/hashes/blake2b";

const CKB_PERSONALIZATION = new TextEncoder().encode("ckb-default-hash");

export function ckbBlake2b(data: Uint8Array): Uint8Array {
  return blake2b(data, { personalization: CKB_PERSONALIZATION, dkLen: 32 });
}

export interface Gov1Params {
  proposalIdHash: Uint8Array;
  voteDigestHash: Uint8Array;
  oldRoot: Uint8Array;
  newRoot: Uint8Array;
  // Each signer: index (0-4) + 65-byte signature (64 bytes + 1 byte recovery id).
  signers: Array<{ index: number; sig: Uint8Array }>;
}

export function buildGov1Witness(params: Gov1Params): Uint8Array {
  const signerCount = params.signers.length;
  // 4 magic + 1 version + 32*4 hashes + 1 count + signerCount * (1 index + 65 sig)
  const size = 4 + 1 + 32 + 32 + 32 + 32 + 1 + signerCount * 66;
  const buf = new Uint8Array(size);
  let off = 0;

  // "GOV1"
  buf[off++] = 0x47;
  buf[off++] = 0x4f;
  buf[off++] = 0x56;
  buf[off++] = 0x31;
  buf[off++] = 0x01; // version

  buf.set(params.proposalIdHash, off);
  off += 32;
  buf.set(params.voteDigestHash, off);
  off += 32;
  buf.set(params.oldRoot, off);
  off += 32;
  buf.set(params.newRoot, off);
  off += 32;

  buf[off++] = signerCount;
  for (const s of params.signers) {
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

// Placeholder signatures (3-of-5) for testnet where on-chain sig verification is off.
// Replace with real governance signatures for production use.
export function placeholderSigners(count: 3 | 4 | 5 = 3): Array<{ index: number; sig: Uint8Array }> {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    sig: new Uint8Array(65).fill(0x11), // non-zero, recovery id 0x11 will be stripped — see note below
  })).map((s) => {
    // Recovery id must be 0-3. Set last byte to 0.
    const sig = new Uint8Array(s.sig);
    sig[64] = 0x00;
    return { index: s.index, sig };
  });
}
