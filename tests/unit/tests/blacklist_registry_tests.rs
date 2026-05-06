//! Integration tests for Blacklist Registry Type Script using ckb-testtool.
//! These tests execute the actual compiled contract binary.

use blake2b_ref::{Blake2b, Blake2bBuilder};
use ckb_testtool::builtin::ALWAYS_SUCCESS;
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::TransactionBuilder,
    packed::{CellDep, CellInput, CellOutput, Script, WitnessArgs},
    prelude::*,
};
use ckb_testtool::context::Context;
use k256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey};

const MAX_CYCLES: u64 = 70_000_000;

// * Error codes from blacklist-registry type script
const ERROR_INVALID_TYPE_ARGS_LAYOUT: i8 = 20;
const ERROR_INVALID_REGISTRY_CELL_TOPOLOGY: i8 = 21;
const ERROR_INVALID_REGISTRY_PAYLOAD: i8 = 22;
const ERROR_INVALID_GOVERNANCE_WITNESS: i8 = 24;
const ERROR_UNAUTHORIZED_GOVERNANCE_LOCK: i8 = 25;
const ERROR_UNAUTHORIZED_SIGNERS: i8 = 26;

const REGISTRY_BINARY: &[u8] = include_bytes!(
    "../../../contracts/blacklist-registry/target/riscv64imac-unknown-none-elf/release/blacklist-registry"
);

fn blake2b_256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut hasher: Blake2b = Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    hasher.update(data);
    hasher.finalize(&mut out);
    out
}

fn build_registry_payload_single_id(id: &[u8]) -> Bytes {
    let mut data = vec![];
    data.extend_from_slice(b"BLKL");
    data.push(0x01);
    data.extend_from_slice(&1u32.to_le_bytes());
    data.push(id.len() as u8);
    data.extend_from_slice(id);
    data.extend_from_slice(&0u64.to_le_bytes());
    Bytes::from(data)
}

fn build_registry_type_args_from_governance_lock(governance_lock: &Script) -> Bytes {
    let gov_code_hash: [u8; 32] = governance_lock.code_hash().unpack();
    let gov_hash_type: u8 = u8::from(governance_lock.hash_type());
    let gov_args: Bytes = governance_lock.args().unpack();

    let mut args = vec![0x01];
    args.extend_from_slice(&gov_code_hash);
    args.push(gov_hash_type);
    args.extend_from_slice(&(gov_args.len() as u16).to_le_bytes());
    args.extend_from_slice(gov_args.as_ref());
    Bytes::from(args)
}

fn build_gov1_lock_field(proposal_byte: u8, vote_byte: u8, old_root: [u8; 32], new_root: [u8; 32]) -> Bytes {
    build_gov1_lock_field_with_signers(proposal_byte, vote_byte, old_root, new_root, &[0, 1, 2])
}

fn build_governance_message_digest(
    proposal_byte: u8,
    vote_byte: u8,
    old_root: [u8; 32],
    new_root: [u8; 32],
) -> [u8; 32] {
    let mut preimage = vec![];
    preimage.extend_from_slice(&[proposal_byte; 32]);
    preimage.extend_from_slice(&[vote_byte; 32]);
    preimage.extend_from_slice(&old_root);
    preimage.extend_from_slice(&new_root);
    blake2b_256(&preimage)
}

fn signer_private_key(index: u8) -> SigningKey {
    let mut bytes = [0u8; 32];
    bytes[31] = index + 1;
    SigningKey::from_bytes((&bytes).into()).expect("valid private key")
}

fn build_gov1_lock_field_with_signers(
    proposal_byte: u8,
    vote_byte: u8,
    old_root: [u8; 32],
    new_root: [u8; 32],
    signer_indices: &[u8],
) -> Bytes {
    let mut raw = vec![];
    raw.extend_from_slice(b"GOV1");
    raw.push(0x01);
    raw.extend_from_slice(&[proposal_byte; 32]);
    raw.extend_from_slice(&[vote_byte; 32]);
    raw.extend_from_slice(&old_root);
    raw.extend_from_slice(&new_root);
    raw.push(signer_indices.len() as u8);

    let message_digest = build_governance_message_digest(proposal_byte, vote_byte, old_root, new_root);
    for signer_index in signer_indices {
        raw.push(*signer_index);
        let signing_key = signer_private_key(*signer_index);
        let signature: Signature = signing_key
            .sign_prehash(&message_digest)
            .expect("sign prehash");
        raw.extend_from_slice(signature.to_bytes().as_ref());
        raw.push(0); // recovery id placeholder, validated by range only in contract
    }

    Bytes::from(raw)
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

#[test]
fn test_pass_valid_registry_update_with_gov1_witness() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x42]))
        .expect("build governance lock");

    let registry_type_args = build_registry_type_args_from_governance_lock(&governance_lock);
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
        .lock(governance_lock.clone())
        .type_(Some(registry_type).pack())
        .build();

    let gov_lock_field = build_gov1_lock_field(0x11, 0x22, old_root, new_root);
    let witness = WitnessArgs::new_builder()
        .lock(Some(gov_lock_field).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(new_payload.pack())
        .cell_dep(CellDep::new_builder().out_point(registry_code_out_point).build())
        .cell_dep(CellDep::new_builder().out_point(always_success_out_point).build())
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("tx should pass");
}

#[test]
fn test_reject_invalid_type_args_layout() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x42]))
        .expect("build governance lock");

    // * Invalid: too short, should trigger ERROR_INVALID_TYPE_ARGS_LAYOUT before anything else
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

    // * Output cell uses same invalid registry type script.
    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock)
        .type_(Some(registry_type).pack())
        .build();

    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(payload.pack())
        .cell_dep(CellDep::new_builder().out_point(registry_code_out_point).build())
        .cell_dep(CellDep::new_builder().out_point(always_success_out_point).build())
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
        .build_script(&always_success_out_point, Bytes::from(vec![0x42]))
        .expect("build governance lock");

    let registry_type_args = build_registry_type_args_from_governance_lock(&governance_lock);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    // * Invalid payload (wrong magic) should trigger ERROR_INVALID_REGISTRY_PAYLOAD
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
        .cell_dep(CellDep::new_builder().out_point(registry_code_out_point).build())
        .cell_dep(CellDep::new_builder().out_point(always_success_out_point).build())
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
        .build_script(&always_success_out_point, Bytes::from(vec![0x42]))
        .expect("build governance lock");

    let registry_type_args = build_registry_type_args_from_governance_lock(&governance_lock);
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

    // * Deliberately wrong roots
    let gov_lock_field = build_gov1_lock_field(0x11, 0x22, [9u8; 32], [8u8; 32]);
    let witness = WitnessArgs::new_builder()
        .lock(Some(gov_lock_field).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(new_payload.pack())
        .cell_dep(CellDep::new_builder().out_point(registry_code_out_point).build())
        .cell_dep(CellDep::new_builder().out_point(always_success_out_point).build())
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

    // * Build two distinct always-success locks (different args) so identities differ.
    let governance_lock_expected = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x01]))
        .expect("build governance lock expected");
    let governance_lock_wrong = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x02]))
        .expect("build governance lock wrong");

    let registry_type_args = build_registry_type_args_from_governance_lock(&governance_lock_expected);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let payload = build_registry_payload_single_id(&[0xAA]);
    let root = blake2b_256(payload.as_ref());
    let gov_lock_field = build_gov1_lock_field(0x11, 0x22, root, root);
    let witness = WitnessArgs::new_builder()
        .lock(Some(gov_lock_field).pack())
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
        .cell_dep(CellDep::new_builder().out_point(registry_code_out_point).build())
        .cell_dep(CellDep::new_builder().out_point(always_success_out_point).build())
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail on unauthorized governance lock identity");
    assert_error_code(err, ERROR_UNAUTHORIZED_GOVERNANCE_LOCK);
}

#[test]
fn test_reject_topology_multiple_registry_inputs() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x42]))
        .expect("build governance lock");

    let registry_type_args = build_registry_type_args_from_governance_lock(&governance_lock);
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

    let input_a = CellInput::new_builder()
        .previous_output(input_out_point_a)
        .build();
    let input_b = CellInput::new_builder()
        .previous_output(input_out_point_b)
        .build();

    let output = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(governance_lock.clone())
        .type_(Some(registry_type.clone()).pack())
        .build();

    let root_a = blake2b_256(payload_a.as_ref());
    let root_b = blake2b_256(payload_b.as_ref());
    let gov_lock_field = build_gov1_lock_field(0x11, 0x22, root_a, root_b);
    let witness = WitnessArgs::new_builder()
        .lock(Some(gov_lock_field).pack())
        .build()
        .as_bytes();

    let tx = TransactionBuilder::default()
        .input(input_a)
        .input(input_b)
        .output(output)
        .output_data(payload_b.pack())
        .cell_dep(CellDep::new_builder().out_point(registry_code_out_point).build())
        .cell_dep(CellDep::new_builder().out_point(always_success_out_point).build())
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail on multiple registry inputs");
    assert_error_code(err, ERROR_INVALID_REGISTRY_CELL_TOPOLOGY);
}

#[test]
fn test_reject_insufficient_valid_signers() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x42]))
        .expect("build governance lock");

    let registry_type_args = build_registry_type_args_from_governance_lock(&governance_lock);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let payload = build_registry_payload_single_id(&[0xAA]);
    let root = blake2b_256(payload.as_ref());
    let gov_lock_field = build_gov1_lock_field_with_signers(0x11, 0x22, root, root, &[0, 1]);

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

    let witness = WitnessArgs::new_builder()
        .lock(Some(gov_lock_field).pack())
        .build()
        .as_bytes();
    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(payload.pack())
        .cell_dep(CellDep::new_builder().out_point(registry_code_out_point).build())
        .cell_dep(CellDep::new_builder().out_point(always_success_out_point).build())
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail with fewer than 3 signers");
    assert_error_code(err, ERROR_INVALID_GOVERNANCE_WITNESS);
}

#[test]
fn test_reject_duplicate_signer_index() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x42]))
        .expect("build governance lock");

    let registry_type_args = build_registry_type_args_from_governance_lock(&governance_lock);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let payload = build_registry_payload_single_id(&[0xAA]);
    let root = blake2b_256(payload.as_ref());
    let gov_lock_field = build_gov1_lock_field_with_signers(0x11, 0x22, root, root, &[0, 0, 1]);

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

    let witness = WitnessArgs::new_builder()
        .lock(Some(gov_lock_field).pack())
        .build()
        .as_bytes();
    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(payload.pack())
        .cell_dep(CellDep::new_builder().out_point(registry_code_out_point).build())
        .cell_dep(CellDep::new_builder().out_point(always_success_out_point).build())
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail with duplicate signer indexes");
    assert_error_code(err, ERROR_UNAUTHORIZED_SIGNERS);
}

#[test]
fn test_reject_signer_index_out_of_range() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x42]))
        .expect("build governance lock");

    let registry_type_args = build_registry_type_args_from_governance_lock(&governance_lock);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let payload = build_registry_payload_single_id(&[0xAA]);
    let root = blake2b_256(payload.as_ref());
    let gov_lock_field = build_gov1_lock_field_with_signers(0x11, 0x22, root, root, &[0, 1, 5]);

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

    let witness = WitnessArgs::new_builder()
        .lock(Some(gov_lock_field).pack())
        .build()
        .as_bytes();
    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(payload.pack())
        .cell_dep(CellDep::new_builder().out_point(registry_code_out_point).build())
        .cell_dep(CellDep::new_builder().out_point(always_success_out_point).build())
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail with signer index out of range");
    assert_error_code(err, ERROR_UNAUTHORIZED_SIGNERS);
}

#[test]
fn test_reject_invalid_recovery_id_in_signature_entry() {
    let mut context = Context::default();

    let registry_code_out_point = context.deploy_cell(Bytes::from(REGISTRY_BINARY.to_vec()));
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let governance_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![0x42]))
        .expect("build governance lock");

    let registry_type_args = build_registry_type_args_from_governance_lock(&governance_lock);
    let registry_type = context
        .build_script(&registry_code_out_point, registry_type_args)
        .expect("build registry type script");

    let payload = build_registry_payload_single_id(&[0xAA]);
    let root = blake2b_256(payload.as_ref());
    let mut gov_lock_field = build_gov1_lock_field_with_signers(0x11, 0x22, root, root, &[0, 1, 2]).to_vec();

    // Corrupt recovery id in first signer entry (must be <= 3).
    const FIRST_RECOVERY_ID_OFFSET: usize = 134 + 1 + 64;
    gov_lock_field[FIRST_RECOVERY_ID_OFFSET] = 7;

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

    let witness = WitnessArgs::new_builder()
        .lock(Some(Bytes::from(gov_lock_field)).pack())
        .build()
        .as_bytes();
    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(payload.pack())
        .cell_dep(CellDep::new_builder().out_point(registry_code_out_point).build())
        .cell_dep(CellDep::new_builder().out_point(always_success_out_point).build())
        .witness(witness.pack())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail with invalid recovery id");
    assert_error_code(err, ERROR_UNAUTHORIZED_SIGNERS);
}
