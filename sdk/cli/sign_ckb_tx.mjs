// CKB secp256k1-sighash signing for inputs 1+ in a governance execute transaction.
// Inputs: tx JSON file, privkey hex, output tx file
// Implements: https://github.com/nervosnetwork/ckb/blob/develop/script/src/syscalls/secp256k1.rs
import { readFileSync, writeFileSync } from 'fs';
import { secp256k1 } from './node_modules/@noble/curves/secp256k1.js';
import { blake2b } from './node_modules/@noble/hashes/blake2b.js';

const [,, txFile, privkeyHex, outFile] = process.argv;
const tx = JSON.parse(readFileSync(txFile, 'utf8'));
const privkey = Buffer.from(privkeyHex.replace('0x',''), 'hex');

// CKB blake2b: 32-byte digest with "ckb-default-hash" personalization
function ckbBlake2b(...parts) {
  const h = blake2b.create({ dkLen: 32, personalization: Buffer.from('ckb-default-hash') });
  for (const p of parts) h.update(p);
  return Buffer.from(h.digest());
}

// Serialize u64 little-endian
function u64le(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

// Encode WitnessArgs with lock=65 zero bytes (for signing) or lock=sig
function encodeWitnessArgs(lock) {
  // WitnessArgs molecule table: total_len(4) + lock_off(4) + input_type_off(4) + output_type_off(4)
  //   + lock_bytes_fixvec(4+N)
  const lockBytes = lock ?? Buffer.alloc(65); // 65 zero bytes placeholder
  const lockFixvec = Buffer.concat([u64le(lockBytes.length).slice(0,4), lockBytes]);
  // Offsets: 4 fields → 4*4=16 byte header; then: lock at 16, input_type at 16+len(lockFixvec), output_type at same
  const lockOff = 16;
  const inputTypeOff = lockOff + lockFixvec.length;
  const outputTypeOff = inputTypeOff; // empty
  const totalLen = lockOff + lockFixvec.length;
  const header = Buffer.alloc(16);
  header.writeUInt32LE(totalLen, 0);
  header.writeUInt32LE(lockOff, 4);
  header.writeUInt32LE(inputTypeOff, 8);
  header.writeUInt32LE(outputTypeOff, 12);
  return Buffer.concat([header, lockFixvec]);
}

// CKB signing hash for a group of secp256k1 witnesses
// tx_hash from the ckb-cli tx info isn't easily available — use the approach:
// Pass tx_hash as hex argument OR compute it
// Here we read it from the tx file signatures field if ckb-cli populated it, else need to compute.
// For simplicity, use ckb-cli to get tx_hash via a dry run or from tx file.

// Actually, ckb-cli stores nothing — need to serialize the raw tx to get the hash.
// Implement minimal CKB raw tx molecule serialization.

function hex(s) { return Buffer.from(s.replace('0x',''), 'hex'); }

function moleculeFixvecOf32(items) {
  const count = Buffer.alloc(4); count.writeUInt32LE(items.length);
  return Buffer.concat([count, ...items.map(hex)]);
}

function serializeScript(script) {
  if (!script) return null;
  const codeHash = hex(script.code_hash);  // 32 bytes
  const hashType = Buffer.from([script.hash_type === 'data' ? 0 : script.hash_type === 'type' ? 1 : 2]);
  const argsBytes = hex(script.args);
  const argsFixvec = Buffer.concat([Buffer.alloc(4), argsBytes]);
  argsFixvec.writeUInt32LE(argsBytes.length, 0);
  // Table: total(4) + code_hash_off(4) + hash_type_off(4) + args_off(4) = 16 byte header
  const codeHashOff = 16, hashTypeOff = 16 + 32, argsOff = 16 + 32 + 1;
  const total = argsOff + argsFixvec.length;
  const header = Buffer.alloc(16);
  header.writeUInt32LE(total, 0);
  header.writeUInt32LE(codeHashOff, 4);
  header.writeUInt32LE(hashTypeOff, 8);
  header.writeUInt32LE(argsOff, 12);
  return Buffer.concat([header, codeHash, hashType, argsFixvec]);
}

function serializeOptionScript(script) {
  if (!script) return Buffer.alloc(0);
  return serializeScript(script);
}

function moleculeVarTable(items) {
  // CKB DynVec: total_len(4) + N*offset(4) + items
  const serialized = items.map(it => it);
  let offset = 4 + 4 * serialized.length; // header size
  const offsets = serialized.map(it => { const o = offset; offset += it.length; return o; });
  const total = offset;
  const header = Buffer.alloc(4 + 4 * serialized.length);
  header.writeUInt32LE(total, 0);
  offsets.forEach((o, i) => header.writeUInt32LE(o, 4 + i * 4));
  return Buffer.concat([header, ...serialized]);
}

function serializeCellOutput(output) {
  const capacity = Buffer.alloc(8);
  capacity.writeBigUInt64LE(BigInt(parseInt(output.capacity, 16)));
  const lock = serializeScript(output.lock);
  const type_ = serializeOptionScript(output.type);
  // Table: total(4) + cap_off(4) + lock_off(4) + type_off(4) = 16 header
  const capOff = 16, lockOff = 16 + 8, typeOff = lockOff + lock.length;
  const total = typeOff + type_.length;
  const header = Buffer.alloc(16);
  header.writeUInt32LE(total, 0);
  header.writeUInt32LE(capOff, 4);
  header.writeUInt32LE(lockOff, 8);
  header.writeUInt32LE(typeOff, 12);
  return Buffer.concat([header, capacity, lock, type_]);
}

function serializeCellDep(cd) {
  const txHash = hex(cd.out_point.tx_hash);
  const index = Buffer.alloc(4); index.writeUInt32LE(parseInt(cd.out_point.index, 16));
  const depType = Buffer.from([cd.dep_type === 'dep_group' ? 1 : 0]);
  return Buffer.concat([txHash, index, depType]);
}

function serializeCellInput(inp) {
  const since = Buffer.alloc(8); since.writeBigUInt64LE(BigInt(parseInt(inp.since, 16)));
  const txHash = hex(inp.previous_output.tx_hash);
  const index = Buffer.alloc(4); index.writeUInt32LE(parseInt(inp.previous_output.index, 16));
  return Buffer.concat([since, txHash, index]);
}

function serializeRawTx(transaction) {
  const version = Buffer.alloc(4); version.writeUInt32LE(parseInt(transaction.version, 16));
  // cell_deps: fixed vector (each 37 bytes: 32+4+1)
  const cellDepsCount = Buffer.alloc(4); cellDepsCount.writeUInt32LE(transaction.cell_deps.length);
  const cellDepsBytes = Buffer.concat([cellDepsCount, ...transaction.cell_deps.map(serializeCellDep)]);
  // header_deps: fixed vector of byte32 (count + each 32-byte hash)
  const hdCount = Buffer.alloc(4); hdCount.writeUInt32LE(transaction.header_deps.length);
  const headerDepsBytes = Buffer.concat([
    hdCount,
    ...transaction.header_deps.map(h => Buffer.from(h.replace(/^0x/, ''), 'hex')),
  ]);
  // inputs: fixed vector (each 44 bytes: 8+32+4)
  const inpCount = Buffer.alloc(4); inpCount.writeUInt32LE(transaction.inputs.length);
  const inputsBytes = Buffer.concat([inpCount, ...transaction.inputs.map(serializeCellInput)]);
  // outputs: dynvec
  const outputsBytes = moleculeVarTable(transaction.outputs.map(serializeCellOutput));
  // outputs_data: dynvec of fixvec(bytes)
  const outputsDataItems = transaction.outputs_data.map(d => {
    const bytes = hex(d);
    const count = Buffer.alloc(4); count.writeUInt32LE(bytes.length);
    return Buffer.concat([count, bytes]);
  });
  const outputsDataBytes = moleculeVarTable(outputsDataItems);

  // RawTransaction table: 5 fields
  // total(4) + f0_off(4)*5 = 24 byte header
  const f0 = version, f1 = cellDepsBytes, f2 = headerDepsBytes, f3 = inputsBytes;
  const f4 = outputsBytes, f5 = outputsDataBytes;
  const fields = [f0, f1, f2, f3, f4, f5];
  let off = 4 + 4 * fields.length;
  const offsets = fields.map(f => { const o = off; off += f.length; return o; });
  const total = off;
  const header = Buffer.alloc(4 + 4 * fields.length);
  header.writeUInt32LE(total, 0);
  offsets.forEach((o, i) => header.writeUInt32LE(o, 4 + i * 4));
  return Buffer.concat([header, ...fields]);
}

const rawTxBytes = serializeRawTx(tx.transaction);
const txHash = ckbBlake2b(rawTxBytes);
console.log('tx_hash:', '0x' + txHash.toString('hex'));

// The secp256k1 lock group for account #1 covers inputs 1 and 2.
// witnesses[1] is the first witness in the group — put signature here.
// witnesses[2] stays as empty WitnessArgs.

// Signing message = blake2b(tx_hash | len(witnesses[1]_zeroed) | witnesses[1]_zeroed | len(witnesses[2]) | witnesses[2])
const witnessZeroed = encodeWitnessArgs(null); // lock = 65 zero bytes
const wit2 = hex(tx.transaction.witnesses[2]);

const msg = ckbBlake2b(
  txHash,
  u64le(witnessZeroed.length), witnessZeroed,
  u64le(wit2.length), wit2,
);
console.log('signing_hash:', '0x' + msg.toString('hex'));

// Sign
const sigRaw = secp256k1.sign(msg, privkey, { lowS: true, format: "recovered" });
// CKB format: r(32) + s(32) + v(1)
const sigBytes = Buffer.alloc(65);
sigBytes.set(sigRaw.slice(1), 0);
sigBytes[64] = sigRaw[0];
console.log('signature:', '0x' + sigBytes.toString('hex'));

// Inject into witnesses[1]
const witnessWithSig = encodeWitnessArgs(sigBytes);
tx.transaction.witnesses[1] = '0x' + witnessWithSig.toString('hex');

writeFileSync(outFile, JSON.stringify(tx, null, 2));
console.log('Signed tx written to', outFile);
