//! Integration tests for Blacklist Registry Type Script using ckb-testtool.
//! These tests execute the actual compiled contract binary.

use blake2b_ref::{Blake2b, Blake2bBuilder};
use ckb_testtool::builtin::ALWAYS_SUCCESS;
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::TransactionBuilder,
    packed::{CellDep, CellInput, CellOutput, OutPoint, Script, WitnessArgs},
    prelude::*,
};
use ckb_testtool::context::Context;

const MAX_CYCLES: u64 = 70_000_000;

// Error codes from blacklist-registry type script
const ERROR_INVALID_TYPE_ARGS_LAYOUT: i8 = 20;
const ERROR_INVALID_REGISTRY_CELL_TOPOLOGY: i8 = 21;
const ERROR_INVALID_REGISTRY_PAYLOAD: i8 = 22;
const ERROR_INVALID_GOVERNANCE_WITNESS: i8 = 24;
const ERROR_UNAUTHORIZED_GOVERNANCE_LOCK: i8 = 25;
// Code 26 is reserved (previously UNAUTHORIZED_SIGNERS). Signer validation moved
// to the governance-lock in v2 — the registry script no longer checks it.
const ERROR_INVALID_TYPE_ID: i8 = 27;
const ERROR_INVALID_PROPOSAL_CELL: i8 = 28;
const REVIEW_DELAY_MS: u64 = 259_200_000;

const REGISTRY_BINARY: &[u8] = include_bytes!(
    "../../../contracts/blacklist-registry/target/riscv64imac-unknown-none-elf/release/blacklist-registry"
);

// Fixed dummy type_id_value for update tests (identical on input and output).
const DUMMY_TYPE_ID: [u8; 32] = [0xABu8; 32];

fn blake2b_256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut hasher: Blake2b = Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    hasher.update(data);
    hasher.finalize(&mut out);
    out
}

// ── v2 helpers ────────────────────────────────────────────────────────────────

/// Minimal BLKL v2 governance header: 1 signer, threshold 1, 0 validators.
/// gh_version(1) | signer_count(1) | threshold(1) | pubkey(33) | validator_count(2) | merkle_root(32) = 70 bytes
fn build_minimal_gov_header() -> Vec<u8> {
    let mut h = vec![0x01u8, 0x01, 0x01];
    h.extend_from_slice(&[0x03u8; 33]); // dummy compressed pubkey
    h.extend_from_slice(&[0x00, 0x00]); // validator_count = 0
    h.extend_from_slice(&[0u8; 32]); // validator_merkle_root
    h
}

/// Build a BLKL v2 payload with one permanent blacklisted identifier.
fn build_registry_payload_single_id(id: &[u8]) -> Bytes {
    build_registry_payload(&[(id, 0)])
}

fn build_registry_payload(entries: &[(&[u8], u64)]) -> Bytes {
    let gov_header = build_minimal_gov_header();
    build_registry_payload_with_gov_header(entries, &gov_header)
}

fn build_registry_payload_with_gov_header(entries: &[(&[u8], u64)], gov_header: &[u8]) -> Bytes {
    let mut data = vec![];
    data.extend_from_slice(b"BLKL");
    data.push(0x02u8);
    data.extend_from_slice(&(gov_header.len() as u16).to_le_bytes());
    data.extend_from_slice(gov_header);
    data.extend_from_slice(&(entries.len() as u32).to_le_bytes());
    for (id, expires_at) in entries {
        data.push(id.len() as u8);
        data.extend_from_slice(id);
        data.extend_from_slice(&expires_at.to_le_bytes());
    }
    Bytes::from(data)
}

fn build_treasury_gov_header(treasury_lock: &Script) -> Vec<u8> {
    let mut h = build_minimal_gov_header();
    h[0] = 0x02;
    h.extend_from_slice(&blake2b_256(treasury_lock.as_slice()));
    h
}

fn build_treasury_gov_header_v3(treasury_lock: &Script) -> Vec<u8> {
    let mut h = build_minimal_gov_header();
    h[0] = 0x03;
    let script_bytes = treasury_lock.as_slice();
    h.extend_from_slice(&(script_bytes.len() as u16).to_le_bytes());
    h.extend_from_slice(script_bytes);
    h
}

/// Build 66-byte v2 registry type args.
/// Layout: version(0x02) | gov_code_hash(32) | gov_hash_type(1) | type_id_value(32)
fn build_registry_v2_type_args(governance_lock: &Script, type_id_value: [u8; 32]) -> Bytes {
    let gov_code_hash: [u8; 32] = governance_lock.code_hash().unpack();
    let gov_hash_type: u8 = u8::from(governance_lock.hash_type());
    let mut args = vec![0x02u8];
    args.extend_from_slice(&gov_code_hash);
    args.push(gov_hash_type);
    args.extend_from_slice(&type_id_value);
    assert_eq!(args.len(), 66);
    Bytes::from(args)
}

/// Compute the CKB Type ID: blake2b(first_input_outpoint(36 bytes) || output_index(8 LE)).
/// The 36-byte outpoint is tx_hash(32) || index(4 LE).
fn compute_type_id(first_input_outpoint: &OutPoint, registry_output_index: u64) -> [u8; 32] {
    let tx_hash: [u8; 32] = first_input_outpoint.tx_hash().unpack();
    let index: u32 = first_input_outpoint.index().unpack();
    let mut preimage = [0u8; 44];
    preimage[..32].copy_from_slice(&tx_hash);
    preimage[32..36].copy_from_slice(&index.to_le_bytes());
    preimage[36..44].copy_from_slice(&registry_output_index.to_le_bytes());
    blake2b_256(&preimage)
}

/// Build a GOV1 v4 binding for WitnessArgs.input_type (173 bytes).
/// Layout: GOV1(4) | version(0x04) | proposal_id_hash(32) | vote_digest_hash(32) |
///         old_root(32) | new_root(32) | proposal_data_hash(32) | review_delay_ms(8 LE u64)
/// Both proposal_id_hash and vote_digest_hash must be non-zero (enforced on-chain).
fn build_gov1_binding(
    proposal_id_hash: [u8; 32],
    vote_digest_hash: [u8; 32],
    old_root: [u8; 32],
    new_root: [u8; 32],
    proposal_data_hash: [u8; 32],
) -> Bytes {
    let mut raw = vec![];
    raw.extend_from_slice(b"GOV1");
    raw.push(0x04u8);
    raw.extend_from_slice(&proposal_id_hash);
    raw.extend_from_slice(&vote_digest_hash);
    raw.extend_from_slice(&old_root);
    raw.extend_from_slice(&new_root);
    raw.extend_from_slice(&proposal_data_hash);
    raw.extend_from_slice(&REVIEW_DELAY_MS.to_le_bytes());
    assert_eq!(raw.len(), 173);
    Bytes::from(raw)
}

fn build_proposal_cell(action: u8, identifier: &[u8], expires_at: u64) -> Bytes {
    let mut data = vec![];
    data.extend_from_slice(b"PBLK");
    data.push(0x01);
    data.extend_from_slice(&DUMMY_TYPE_ID);
    data.push(action);
    data.push(identifier.len() as u8);
    data.extend_from_slice(identifier);
    data.extend_from_slice(&expires_at.to_le_bytes());
    data.extend_from_slice(&[0x99u8; 32]);
    Bytes::from(data)
}

fn build_set_treasury_proposal_cell(treasury_lock: &Script) -> Bytes {
    let mut data = vec![];
    data.extend_from_slice(b"PBLK");
    data.push(0x02);
    data.extend_from_slice(&DUMMY_TYPE_ID);
    data.push(0x03);
    data.extend_from_slice(&blake2b_256(treasury_lock.as_slice()));
    data.extend_from_slice(&[0x99u8; 32]);
    Bytes::from(data)
}

fn create_set_treasury_proposal_input(
    context: &mut Context,
    lock: Script,
    treasury_lock: &Script,
) -> (CellInput, [u8; 32]) {
    let proposal_data = build_set_treasury_proposal_cell(treasury_lock);
    let proposal_hash = blake2b_256(proposal_data.as_ref());
    let proposal_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(200_000_000u64.pack())
            .lock(lock)
            .build(),
        proposal_data,
    );
    (
        CellInput::new_builder()
            .previous_output(proposal_out_point)
            .build(),
        proposal_hash,
    )
}

fn create_proposal_input(
    context: &mut Context,
    lock: Script,
    action: u8,
    identifier: &[u8],
    expires_at: u64,
) -> (CellInput, [u8; 32]) {
    create_proposal_input_with_capacity(context, lock, action, identifier, expires_at, 1000)
}

fn create_proposal_input_with_capacity(
    context: &mut Context,
    lock: Script,
    action: u8,
    identifier: &[u8],
    expires_at: u64,
    capacity: u64,
) -> (CellInput, [u8; 32]) {
    let proposal_data = build_proposal_cell(action, identifier, expires_at);
    let proposal_hash = blake2b_256(proposal_data.as_ref());
    let proposal_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(capacity.pack())
            .lock(lock)
            .build(),
        proposal_data,
    );
    (
        CellInput::new_builder()
            .previous_output(proposal_out_point)
            .build(),
        proposal_hash,
    )
}

fn assert_error_code(err: ckb_testtool::ckb_error::Error, expected_code: i8) {
    let message = err.to_string();
    let needle = format!("error code {}", expected_code);
    assert!(
        message.contains(&needle),
        "expected '{}' in error message, got: {}",
        needle,
        message
    );
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[test]
fn test_pass_bootstrap_registry_creation_with_5_of_5_signers() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");

    // Create the funding cell first so we can derive the Type ID from its outpoint.
    let funding_cell = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(governance_lock.clone())
            .build(),
        Bytes::new(),
    );
    let type_id_value = compute_type_id(&funding_cell, 0); // registry is output[0]
    let registry_type_args = build_registry_v2_type_args(&governance_lock, type_id_value);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let payload = build_registry_payload_single_id(&[0xAA]);
    let new_root = blake2b_256(payload.as_ref());
    let gov_payload = build_gov1_binding(
        [0x11u8; 32],
        [0x22u8; 32],
        [0u8; 32],
        new_root,
        [0x33u8; 32],
    );

    let input = CellInput::new_builder()
        .previous_output(funding_cell)
        .build();
    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock)
        .type_(Some(registry_type).pack())
        .build();

    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("bootstrap tx should pass");
}

/// Signer threshold is enforced by the governance-lock, not the registry.
/// With ALWAYS_SUCCESS as governance lock, any signer count passes at the registry level.
#[test]
fn test_pass_bootstrap_registry_creation_with_partial_signers() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");

    let funding_cell = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(governance_lock.clone())
            .build(),
        Bytes::new(),
    );
    let type_id_value = compute_type_id(&funding_cell, 0);
    let registry_type_args = build_registry_v2_type_args(&governance_lock, type_id_value);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let payload = build_registry_payload_single_id(&[0xAA]);
    let new_root = blake2b_256(payload.as_ref());
    let gov_payload = build_gov1_binding(
        [0x11u8; 32],
        [0x22u8; 32],
        [0u8; 32],
        new_root,
        [0x33u8; 32],
    );

    let input = CellInput::new_builder()
        .previous_output(funding_cell)
        .build();
    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock)
        .type_(Some(registry_type).pack())
        .build();

    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("partial signers pass at registry level; governance-lock enforces threshold");
}

#[test]
fn test_pass_valid_registry_update_with_gov1_witness() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");

    let registry_type_args = build_registry_v2_type_args(&governance_lock, DUMMY_TYPE_ID);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let old_payload = build_registry_payload(&[]);
    let new_payload = build_registry_payload_single_id(&[0xBB]);
    let old_root = blake2b_256(old_payload.as_ref());
    let new_root = blake2b_256(new_payload.as_ref());
    let (proposal_input, proposal_data_hash) =
        create_proposal_input(&mut context, governance_lock.clone(), 0x01, &[0xBB], 0);

    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(governance_lock.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        old_payload.clone(),
    );

    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();

    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock.clone())
        .type_(Some(registry_type).pack())
        .build();

    let gov_payload = build_gov1_binding(
        [0x11u8; 32],
        [0x22u8; 32],
        old_root,
        new_root,
        proposal_data_hash,
    );
    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(input)
        .input(proposal_input)
        .output(output)
        .output_data(new_payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    context.verify_tx(&tx, MAX_CYCLES).expect("tx should pass");
}

/// Registry cell data with trailing bytes after the declared entries is
/// rejected end-to-end, even when the governance witness commits to the exact
/// trailing-inclusive bytes.
///
/// This is the consensus-hardening regression for canonical encoding: the
/// transaction is identical to `test_pass_valid_registry_update_with_gov1_witness`
/// except for one extra output-data byte (with `new_root` recomputed over it, so
/// the root binding still passes). `parse_strict` rejects it with
/// `INVALID_REGISTRY_PAYLOAD`. Before trailing bytes were rejected, this
/// transaction would have been accepted.
#[test]
fn test_reject_registry_update_with_trailing_bytes() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");

    let registry_type_args = build_registry_v2_type_args(&governance_lock, DUMMY_TYPE_ID);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let old_payload = build_registry_payload(&[]);
    // Canonical new payload plus one trailing byte the parser must reject.
    let mut new_bytes = build_registry_payload_single_id(&[0xBB]).to_vec();
    new_bytes.push(0xFF);
    let new_payload = Bytes::from(new_bytes);

    let old_root = blake2b_256(old_payload.as_ref());
    // Commit new_root over the trailing-inclusive data so the transaction clears
    // the root-binding check and fails specifically in the payload parser.
    let new_root = blake2b_256(new_payload.as_ref());
    let (proposal_input, proposal_data_hash) =
        create_proposal_input(&mut context, governance_lock.clone(), 0x01, &[0xBB], 0);

    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(governance_lock.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        old_payload.clone(),
    );

    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();

    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock.clone())
        .type_(Some(registry_type).pack())
        .build();

    let gov_payload = build_gov1_binding(
        [0x11u8; 32],
        [0x22u8; 32],
        old_root,
        new_root,
        proposal_data_hash,
    );
    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(input)
        .input(proposal_input)
        .output(output)
        .output_data(new_payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx with trailing registry bytes should fail");
    assert_error_code(err, ERROR_INVALID_REGISTRY_PAYLOAD);
}

#[test]
fn test_pass_registry_update_with_treasury_anchor_return() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");
    let treasury_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x99]))
        .expect("build treasury lock");

    let registry_type_args = build_registry_v2_type_args(&governance_lock, DUMMY_TYPE_ID);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let gov_header = build_treasury_gov_header(&treasury_lock);
    let old_payload = build_registry_payload_with_gov_header(&[], &gov_header);
    let new_payload = build_registry_payload_with_gov_header(&[(&[0xBB], 0)], &gov_header);
    let old_root = blake2b_256(old_payload.as_ref());
    let new_root = blake2b_256(new_payload.as_ref());
    let (proposal_input, proposal_data_hash) = create_proposal_input_with_capacity(
        &mut context,
        treasury_lock.clone(),
        0x01,
        &[0xBB],
        0,
        200_000_000,
    );

    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1_000_000_000u64.pack())
            .lock(governance_lock.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        old_payload.clone(),
    );

    let registry_output = CellOutput::new_builder()
        .capacity(900_000_000u64.pack())
        .lock(governance_lock.clone())
        .type_(Some(registry_type).pack())
        .build();
    let treasury_output = CellOutput::new_builder()
        .capacity(200_000_000u64.pack())
        .lock(treasury_lock)
        .build();

    let gov_payload = build_gov1_binding(
        [0x11u8; 32],
        [0x22u8; 32],
        old_root,
        new_root,
        proposal_data_hash,
    );
    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_out_point)
                .build(),
        )
        .input(proposal_input)
        .output(registry_output)
        .output(treasury_output)
        .output_data(new_payload.pack())
        .output_data(Bytes::new().pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("treasury-funded anchor should pass when capacity returns to the treasury");
}

#[test]
fn test_reject_registry_update_with_treasury_anchor_not_returned() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");
    let treasury_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x99]))
        .expect("build treasury lock");
    let non_treasury_anchor_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x98]))
        .expect("build non-treasury anchor lock");

    let registry_type_args = build_registry_v2_type_args(&governance_lock, DUMMY_TYPE_ID);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let gov_header = build_treasury_gov_header(&treasury_lock);
    let old_payload = build_registry_payload_with_gov_header(&[], &gov_header);
    let new_payload = build_registry_payload_with_gov_header(&[(&[0xBB], 0)], &gov_header);
    let old_root = blake2b_256(old_payload.as_ref());
    let new_root = blake2b_256(new_payload.as_ref());
    let (proposal_input, proposal_data_hash) = create_proposal_input_with_capacity(
        &mut context,
        non_treasury_anchor_lock,
        0x01,
        &[0xBB],
        0,
        200_000_000,
    );

    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1_000_000_000u64.pack())
            .lock(governance_lock.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        old_payload.clone(),
    );

    let output = CellOutput::new_builder()
        .capacity(900_000_000u64.pack())
        .lock(governance_lock.clone())
        .type_(Some(registry_type).pack())
        .build();

    let gov_payload = build_gov1_binding(
        [0x11u8; 32],
        [0x22u8; 32],
        old_root,
        new_root,
        proposal_data_hash,
    );
    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_out_point)
                .build(),
        )
        .input(proposal_input)
        .output(output)
        .output_data(new_payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("missing treasury return output should be rejected");
    assert_error_code(err, ERROR_INVALID_PROPOSAL_CELL);
}

#[test]
fn test_pass_registry_metadata_update_sets_treasury_script() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");
    let treasury_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x99]))
        .expect("build treasury lock");

    let registry_type_args = build_registry_v2_type_args(&governance_lock, DUMMY_TYPE_ID);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let old_payload = build_registry_payload_with_gov_header(&[(&[0xAA], 0)], &build_minimal_gov_header());
    let new_payload = build_registry_payload_with_gov_header(&[(&[0xAA], 0)], &build_treasury_gov_header_v3(&treasury_lock));
    let old_root = blake2b_256(old_payload.as_ref());
    let new_root = blake2b_256(new_payload.as_ref());
    let (proposal_input, proposal_data_hash) =
        create_set_treasury_proposal_input(&mut context, governance_lock.clone(), &treasury_lock);

    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1_000_000_000u64.pack())
            .lock(governance_lock.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        old_payload,
    );

    let output = CellOutput::new_builder()
        .capacity(1_000_000_000u64.pack())
        .lock(governance_lock.clone())
        .type_(Some(registry_type).pack())
        .build();

    let gov_payload = build_gov1_binding(
        [0x11u8; 32],
        [0x22u8; 32],
        old_root,
        new_root,
        proposal_data_hash,
    );
    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_out_point)
                .build(),
        )
        .input(proposal_input)
        .output(output)
        .output_data(new_payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("metadata update should pass when treasury hash matches the proposal");
}

#[test]
fn test_reject_registry_metadata_update_wrong_treasury_script() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");
    let proposed_treasury_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x99]))
        .expect("build proposed treasury lock");
    let wrong_treasury_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x98]))
        .expect("build wrong treasury lock");

    let registry_type_args = build_registry_v2_type_args(&governance_lock, DUMMY_TYPE_ID);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let old_payload = build_registry_payload_with_gov_header(&[(&[0xAA], 0)], &build_minimal_gov_header());
    let new_payload = build_registry_payload_with_gov_header(&[(&[0xAA], 0)], &build_treasury_gov_header_v3(&wrong_treasury_lock));
    let old_root = blake2b_256(old_payload.as_ref());
    let new_root = blake2b_256(new_payload.as_ref());
    let (proposal_input, proposal_data_hash) =
        create_set_treasury_proposal_input(&mut context, governance_lock.clone(), &proposed_treasury_lock);

    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1_000_000_000u64.pack())
            .lock(governance_lock.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        old_payload,
    );

    let output = CellOutput::new_builder()
        .capacity(1_000_000_000u64.pack())
        .lock(governance_lock.clone())
        .type_(Some(registry_type).pack())
        .build();

    let gov_payload = build_gov1_binding(
        [0x11u8; 32],
        [0x22u8; 32],
        old_root,
        new_root,
        proposal_data_hash,
    );
    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_out_point)
                .build(),
        )
        .input(proposal_input)
        .output(output)
        .output_data(new_payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("metadata update with a different treasury script should fail");
    assert_error_code(err, ERROR_INVALID_PROPOSAL_CELL);
}

#[test]
fn test_reject_invalid_type_args_layout() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");

    // Too short — triggers ERROR_INVALID_TYPE_ARGS_LAYOUT before anything else.
    let invalid_type_args = Bytes::from(vec![0x01, 0x02, 0x03]);
    let registry_type = context
        .build_script(&registry_code_out_point, invalid_type_args)
        .expect("build registry type script");

    let payload = build_registry_payload_single_id(&[0xAA]);
    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(governance_lock.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        payload.clone(),
    );

    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();

    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock)
        .type_(Some(registry_type).pack())
        .build();

    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail on invalid type args layout");
    assert_error_code(err, ERROR_INVALID_TYPE_ARGS_LAYOUT);
}

#[test]
fn test_reject_invalid_registry_payload() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");

    let registry_type_args = build_registry_v2_type_args(&governance_lock, DUMMY_TYPE_ID);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    // Invalid payload (wrong magic).
    let invalid_payload = Bytes::from(vec![0x00, 0x11, 0x22, 0x33]);

    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(governance_lock.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        invalid_payload.clone(),
    );

    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();

    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock)
        .type_(Some(registry_type).pack())
        .build();

    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(invalid_payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail on invalid registry payload");
    assert_error_code(err, ERROR_INVALID_REGISTRY_PAYLOAD);
}

#[test]
fn test_reject_invalid_governance_witness_root_mismatch() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");

    let registry_type_args = build_registry_v2_type_args(&governance_lock, DUMMY_TYPE_ID);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let old_payload = build_registry_payload_single_id(&[0xAA]);
    let new_payload = build_registry_payload_single_id(&[0xBB]);

    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(governance_lock.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        old_payload.clone(),
    );

    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();

    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock.clone())
        .type_(Some(registry_type).pack())
        .build();

    // Deliberately wrong roots — neither matches the actual payload hashes.
    let gov_payload = build_gov1_binding(
        [0x11u8; 32],
        [0x22u8; 32],
        [9u8; 32],
        [8u8; 32],
        [0x33u8; 32],
    );
    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(new_payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail on GOV1 root mismatch");
    assert_error_code(err, ERROR_INVALID_GOVERNANCE_WITNESS);
}

#[test]
fn test_reject_unauthorized_governance_lock_identity() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    // Two distinct always-success locks with different args → different identities.
    let governance_lock_expected = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build expected governance lock");
    let governance_lock_wrong = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x02]))
        .expect("build wrong governance lock");

    let registry_type_args = build_registry_v2_type_args(&governance_lock_expected, DUMMY_TYPE_ID);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let payload = build_registry_payload_single_id(&[0xAA]);
    let root = blake2b_256(payload.as_ref());
    let gov_payload = build_gov1_binding([0x11u8; 32], [0x22u8; 32], root, root, [0x33u8; 32]);
    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(governance_lock_wrong.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        payload.clone(),
    );

    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();

    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock_wrong)
        .type_(Some(registry_type).pack())
        .build();

    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail on unauthorized governance lock");
    assert_error_code(err, ERROR_UNAUTHORIZED_GOVERNANCE_LOCK);
}

#[test]
fn test_reject_topology_multiple_registry_inputs() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");

    let registry_type_args = build_registry_v2_type_args(&governance_lock, DUMMY_TYPE_ID);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let payload_a = build_registry_payload_single_id(&[0xAA]);
    let payload_b = build_registry_payload_single_id(&[0xBB]);

    let input_out_point_a = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(governance_lock.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        payload_a.clone(),
    );
    let input_out_point_b = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(governance_lock.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        payload_b.clone(),
    );

    let root_a = blake2b_256(payload_a.as_ref());
    let root_b = blake2b_256(payload_b.as_ref());
    let gov_payload = build_gov1_binding([0x11u8; 32], [0x22u8; 32], root_a, root_b, [0x33u8; 32]);
    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock.clone())
        .type_(Some(registry_type.clone()).pack())
        .build();

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_out_point_a)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(input_out_point_b)
                .build(),
        )
        .output(output)
        .output_data(payload_b.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail on multiple registry inputs");
    assert_error_code(err, ERROR_INVALID_REGISTRY_CELL_TOPOLOGY);
}

/// Bootstrap with a wrong type_id_value in the type args triggers ERROR_INVALID_TYPE_ID (27).
#[test]
fn test_reject_bootstrap_type_id_mismatch() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");

    let funding_cell = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(governance_lock.clone())
            .build(),
        Bytes::new(),
    );

    // Deliberately use a wrong type_id_value instead of the one derived from the input.
    let wrong_type_id = [0xFFu8; 32];
    let registry_type_args = build_registry_v2_type_args(&governance_lock, wrong_type_id);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let payload = build_registry_payload_single_id(&[0xAA]);
    let new_root = blake2b_256(payload.as_ref());
    let gov_payload = build_gov1_binding(
        [0x11u8; 32],
        [0x22u8; 32],
        [0u8; 32],
        new_root,
        [0x33u8; 32],
    );

    let input = CellInput::new_builder()
        .previous_output(funding_cell)
        .build();
    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock)
        .type_(Some(registry_type).pack())
        .build();

    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("bootstrap with wrong type_id_value should fail");
    assert_error_code(err, ERROR_INVALID_TYPE_ID);
}

/// The GOV1 v4 binding requires non-zero proposal_id_hash and vote_digest_hash.
#[test]
fn test_reject_zero_proposal_hash_in_gov1_witness() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");

    let registry_type_args = build_registry_v2_type_args(&governance_lock, DUMMY_TYPE_ID);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let old_payload = build_registry_payload_single_id(&[0xAA]);
    let new_payload = build_registry_payload_single_id(&[0xBB]);
    let old_root = blake2b_256(old_payload.as_ref());
    let new_root = blake2b_256(new_payload.as_ref());

    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(governance_lock.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        old_payload.clone(),
    );
    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();
    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock)
        .type_(Some(registry_type).pack())
        .build();

    // Zero proposal_id_hash — rejected by the contract.
    let gov_payload = build_gov1_binding([0u8; 32], [0x22u8; 32], old_root, new_root, [0x33u8; 32]);
    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(new_payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("zero proposal_id_hash should be rejected");
    assert_error_code(err, ERROR_INVALID_GOVERNANCE_WITNESS);
}

/// Ensure insufficient valid signers produces the expected result.
/// Signer validation is the governance-lock's responsibility.
/// With ALWAYS_SUCCESS as governance lock, any signer set passes at the registry level.
#[test]
fn test_pass_update_with_insufficient_signers_at_registry_level() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock");

    let registry_type_args = build_registry_v2_type_args(&governance_lock, DUMMY_TYPE_ID);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let old_payload = build_registry_payload(&[]);
    let new_payload = build_registry_payload_single_id(&[0xBB]);
    let old_root = blake2b_256(old_payload.as_ref());
    let new_root = blake2b_256(new_payload.as_ref());
    let (proposal_input, proposal_data_hash) =
        create_proposal_input(&mut context, governance_lock.clone(), 0x01, &[0xBB], 0);

    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(governance_lock.clone())
            .type_(Some(registry_type.clone()).pack())
            .build(),
        old_payload.clone(),
    );
    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();
    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock)
        .type_(Some(registry_type).pack())
        .build();

    let gov_payload = build_gov1_binding(
        [0x11u8; 32],
        [0x22u8; 32],
        old_root,
        new_root,
        proposal_data_hash,
    );
    let witness = WitnessArgs::new_builder()
        .input_type(Some(gov_payload).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(input)
        .input(proposal_input)
        .output(output)
        .output_data(new_payload.pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(registry_code_out_point)
                .build(),
        )
        .cell_dep(
            CellDep::new_builder()
                .out_point(always_success_out_point)
                .build(),
        )
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("registry passes; governance-lock (ALWAYS_SUCCESS) accepts any signer set");
}
