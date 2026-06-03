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

// GOV1 v4 — 173 bytes. governance-lock locates the input whose cell data hashes to
// proposalDataHash and requires that input's `since` field to encode a relative
// median-time-past delay >= reviewDelayMs.
export function buildGov1WitnessV4(
  params: Gov1BindingParams & { proposalDataHash: Uint8Array; reviewDelayMs: bigint },
): Uint8Array {
  for (const [name, val] of [
    ["proposalIdHash", params.proposalIdHash],
    ["voteDigestHash", params.voteDigestHash],
    ["oldRoot", params.oldRoot],
    ["newRoot", params.newRoot],
    ["proposalDataHash", params.proposalDataHash],
  ] as const) {
    if (val.length !== 32) throw new Error(`${name} must be exactly 32 bytes, got ${val.length}`);
  }
  // 4 magic + 1 version + 32*5 hashes + 8 reviewDelayMs = 173 bytes
  const buf = new Uint8Array(173);
  let off = 0;
  buf[off++] = 0x47; buf[off++] = 0x4f; buf[off++] = 0x56; buf[off++] = 0x31; // GOV1
  buf[off++] = 0x04; // version 4
  buf.set(params.proposalIdHash, off); off += 32;
  buf.set(params.voteDigestHash, off); off += 32;
  buf.set(params.oldRoot, off); off += 32;
  buf.set(params.newRoot, off); off += 32;
  buf.set(params.proposalDataHash, off); off += 32;
  // reviewDelayMs as LE u64
  let ms = params.reviewDelayMs;
  for (let i = 0; i < 8; i++) {
    buf[off++] = Number(ms & 0xffn);
    ms >>= 8n;
  }
  return buf;
}

// Encodes a duration in milliseconds as a CKB relative median-time-past `since` value.
// Format: bit63=1 (relative), bit62=1 (timestamp metric), bits55-0 = duration_in_SECONDS.
// CKB consensus enforces timestamp since values in seconds; the governance-lock contract
// multiplies the since seconds value by 1000 before comparing to review_delay_ms.
export function encodeRelativeTimestampSince(durationMs: bigint): string {
  const TIMESTAMP_FLAG = 0x4000_0000_0000_0000n;
  const RELATIVE_FLAG = 0x8000_0000_0000_0000n;
  const VALUE_MASK = 0x00FF_FFFF_FFFF_FFFFn;
  const durationSec = durationMs / 1000n;  // CKB timestamp since field is in seconds
  const since = RELATIVE_FLAG | TIMESTAMP_FLAG | (durationSec & VALUE_MASK);
  return `0x${since.toString(16).padStart(16, "0")}`;
}

export interface ValidatorVoteWitnessEntry {
  pubkey: Uint8Array;
  vote: "yes" | "no" | "abstain";
  timestamp: string;
  signature: Uint8Array;
  merkleLeafIndex: number;
  merkleProof: Uint8Array[];
}

function voteCode(vote: ValidatorVoteWitnessEntry["vote"]): number {
  if (vote === "yes") return 1;
  if (vote === "no") return 2;
  if (vote === "abstain") return 3;
  throw new Error(`unsupported vote: ${vote}`);
}

function writeU16LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
}

// Builds WitnessArgs.lock content for validator-authorized governance updates.
// Format:
//   vote_count(1)
//   repeated:
//     pubkey(33) | vote(1) | timestamp_len(2 LE) | timestamp_utf8 |
//     signature(65) | merkle_leaf_index(4 LE) | proof_count(1) | proof_hash(32)*
export function buildValidatorVoteWitness(votes: ValidatorVoteWitnessEntry[]): Uint8Array {
  if (votes.length > 255) throw new Error("vote_count must fit in 1 byte (max 255)");
  const enc = new TextEncoder();
  const parts = votes.map((v) => {
    if (v.pubkey.length !== 33) throw new Error(`validator pubkey must be 33 bytes, got ${v.pubkey.length}`);
    if (v.signature.length !== 65) throw new Error(`vote signature must be 65 bytes, got ${v.signature.length}`);
    if (!Number.isInteger(v.merkleLeafIndex) || v.merkleLeafIndex < 0 || v.merkleLeafIndex > 0xffff_ffff) {
      throw new Error(`merkle leaf index out of range: ${v.merkleLeafIndex}`);
    }
    if (v.merkleProof.length > 255) throw new Error("merkle proof length must fit in 1 byte");
    for (const proof of v.merkleProof) {
      if (proof.length !== 32) throw new Error(`merkle proof hash must be 32 bytes, got ${proof.length}`);
    }
    const timestamp = enc.encode(v.timestamp);
    if (timestamp.length > 0xffff) throw new Error("timestamp is too long");
    return { v, timestamp };
  });
  const size = 1 + parts.reduce(
    (sum, p) => sum + 33 + 1 + 2 + p.timestamp.length + 65 + 4 + 1 + p.v.merkleProof.length * 32,
    0,
  );
  const buf = new Uint8Array(size);
  buf[0] = votes.length;
  let off = 1;
  for (const { v, timestamp } of parts) {
    buf.set(v.pubkey, off); off += 33;
    buf[off++] = voteCode(v.vote);
    writeU16LE(buf, off, timestamp.length); off += 2;
    buf.set(timestamp, off); off += timestamp.length;
    buf.set(v.signature, off); off += 65;
    writeU32LE(buf, off, v.merkleLeafIndex); off += 4;
    buf[off++] = v.merkleProof.length;
    for (const proof of v.merkleProof) {
      buf.set(proof, off);
      off += 32;
    }
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
