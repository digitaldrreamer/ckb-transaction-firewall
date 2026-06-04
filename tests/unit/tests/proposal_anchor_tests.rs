//! Integration tests for Proposal Anchor Type Script using ckb-testtool.

use blake2b_ref::{Blake2b, Blake2bBuilder};
use ckb_testtool::builtin::ALWAYS_SUCCESS;
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::TransactionBuilder,
    packed::{CellDep, CellInput, CellOutput},
    prelude::*,
};
use ckb_testtool::context::Context;

const MAX_CYCLES: u64 = 30_000_000;
const REVIEW_DELAY_MS: u64 = 259_200_000;
const ERROR_INVALID_PROPOSAL_DATA: i8 = 33;
const ERROR_INVALID_RECLAIM_RETURN: i8 = 35;
const ERROR_INVALID_RECLAIM_SINCE: i8 = 36;

const PROPOSAL_ANCHOR_BINARY: &[u8] = include_bytes!(
    "../../../contracts/proposal-anchor/target/riscv64imac-unknown-none-elf/release/proposal-anchor"
);

const REGISTRY_TYPE_ID: [u8; 32] = [0x42u8; 32];

fn blake2b_256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut hasher: Blake2b = Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    hasher.update(data);
    hasher.finalize(&mut out);
    out
}

fn proposal_anchor_args(treasury_lock_hash: [u8; 32]) -> Bytes {
    let mut args = vec![0x01u8];
    args.extend_from_slice(&REGISTRY_TYPE_ID);
    args.extend_from_slice(&treasury_lock_hash);
    args.extend_from_slice(&REVIEW_DELAY_MS.to_le_bytes());
    Bytes::from(args)
}

fn pblk_data() -> Bytes {
    let mut data = vec![];
    data.extend_from_slice(b"PBLK");
    data.push(0x01);
    data.extend_from_slice(&REGISTRY_TYPE_ID);
    data.push(0x01);
    data.push(1);
    data.push(0xAA);
    data.extend_from_slice(&0u64.to_le_bytes());
    data.extend_from_slice(&[0x99u8; 32]);
    Bytes::from(data)
}

fn encode_relative_timestamp_since(ms: u64) -> u64 {
    // CKB since timestamp metric stores seconds (not ms); contract multiplies by 1000.
    0x8000_0000_0000_0000u64 | 0x4000_0000_0000_0000u64 | (ms / 1000)
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
fn test_pass_create_treasury_locked_anchor() {
    let mut context = Context::default();
    let anchor_code = context.deploy_cell(Bytes::from(PROPOSAL_ANCHOR_BINARY.to_vec()));
    let always_success = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let treasury_lock = context
        .build_script(&always_success, Bytes::from(vec![0x01]))
        .expect("treasury lock");
    let treasury_lock_hash = blake2b_256(treasury_lock.as_slice());
    let anchor_type = context
        .build_script(&anchor_code, proposal_anchor_args(treasury_lock_hash))
        .expect("anchor type");

    let funding = context.create_cell(
        CellOutput::new_builder()
            .capacity(300_000_000u64.pack())
            .lock(treasury_lock.clone())
            .build(),
        Bytes::new(),
    );

    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(funding).build())
        .output(
            CellOutput::new_builder()
                .capacity(200_000_000u64.pack())
                .lock(treasury_lock)
                .type_(Some(anchor_type).pack())
                .build(),
        )
        .output_data(pblk_data().pack())
        .cell_dep(CellDep::new_builder().out_point(anchor_code).build())
        .cell_dep(CellDep::new_builder().out_point(always_success).build())
        .build();

    let tx = context.complete_tx(tx);
    context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("anchor creation should pass");
}

#[test]
fn test_reject_create_anchor_with_invalid_pblk_data() {
    // The contract does not restrict which lock script an anchor may use on creation
    // (any lock is permitted; security is enforced on the consumption path).
    // This test verifies that malformed PBLK data IS rejected on the creation path.
    let mut context = Context::default();
    let anchor_code = context.deploy_cell(Bytes::from(PROPOSAL_ANCHOR_BINARY.to_vec()));
    let always_success = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let treasury_lock = context
        .build_script(&always_success, Bytes::from(vec![0x01]))
        .expect("treasury lock");
    let treasury_lock_hash = blake2b_256(treasury_lock.as_slice());
    let anchor_type = context
        .build_script(&anchor_code, proposal_anchor_args(treasury_lock_hash))
        .expect("anchor type");

    let funding = context.create_cell(
        CellOutput::new_builder()
            .capacity(300_000_000u64.pack())
            .lock(treasury_lock.clone())
            .build(),
        Bytes::new(),
    );

    // Garbage PBLK data — not a valid proposal payload.
    let bad_data = Bytes::from(vec![0xde, 0xad, 0xbe, 0xef]);

    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(funding).build())
        .output(
            CellOutput::new_builder()
                .capacity(200_000_000u64.pack())
                .lock(treasury_lock)
                .type_(Some(anchor_type).pack())
                .build(),
        )
        .output_data(bad_data.pack())
        .cell_dep(CellDep::new_builder().out_point(anchor_code).build())
        .cell_dep(CellDep::new_builder().out_point(always_success).build())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("anchor with invalid PBLK data should be rejected");
    assert_error_code(err, ERROR_INVALID_PROPOSAL_DATA);
}

#[test]
fn test_pass_consume_anchor_returns_to_treasury_after_delay() {
    let mut context = Context::default();
    let anchor_code = context.deploy_cell(Bytes::from(PROPOSAL_ANCHOR_BINARY.to_vec()));
    let always_success = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let treasury_lock = context
        .build_script(&always_success, Bytes::from(vec![0x01]))
        .expect("treasury lock");
    let treasury_lock_hash = blake2b_256(treasury_lock.as_slice());
    let anchor_type = context
        .build_script(&anchor_code, proposal_anchor_args(treasury_lock_hash))
        .expect("anchor type");

    let anchor = context.create_cell(
        CellOutput::new_builder()
            .capacity(200_000_000u64.pack())
            .lock(treasury_lock.clone())
            .type_(Some(anchor_type).pack())
            .build(),
        pblk_data(),
    );

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .since(encode_relative_timestamp_since(REVIEW_DELAY_MS).pack())
                .previous_output(anchor)
                .build(),
        )
        .output(
            CellOutput::new_builder()
                .capacity(100_000_000u64.pack())
                .lock(treasury_lock)
                .build(),
        )
        .output_data(Bytes::new().pack())
        .cell_dep(CellDep::new_builder().out_point(anchor_code).build())
        .cell_dep(CellDep::new_builder().out_point(always_success).build())
        .build();

    let tx = context.complete_tx(tx);
    context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("anchor consume should pass");
}

#[test]
fn test_reject_consume_anchor_without_treasury_return() {
    let mut context = Context::default();
    let anchor_code = context.deploy_cell(Bytes::from(PROPOSAL_ANCHOR_BINARY.to_vec()));
    let always_success = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let treasury_lock = context
        .build_script(&always_success, Bytes::from(vec![0x01]))
        .expect("treasury lock");
    let wrong_lock = context
        .build_script(&always_success, Bytes::from(vec![0x02]))
        .expect("wrong lock");
    let treasury_lock_hash = blake2b_256(treasury_lock.as_slice());
    let anchor_type = context
        .build_script(&anchor_code, proposal_anchor_args(treasury_lock_hash))
        .expect("anchor type");

    let anchor = context.create_cell(
        CellOutput::new_builder()
            .capacity(200_000_000u64.pack())
            .lock(treasury_lock)
            .type_(Some(anchor_type).pack())
            .build(),
        pblk_data(),
    );

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .since(encode_relative_timestamp_since(REVIEW_DELAY_MS).pack())
                .previous_output(anchor)
                .build(),
        )
        .output(
            CellOutput::new_builder()
                .capacity(100_000_000u64.pack())
                .lock(wrong_lock)
                .build(),
        )
        .output_data(Bytes::new().pack())
        .cell_dep(CellDep::new_builder().out_point(anchor_code).build())
        .cell_dep(CellDep::new_builder().out_point(always_success).build())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("missing treasury return should be rejected");
    assert_error_code(err, ERROR_INVALID_RECLAIM_RETURN);
}

#[test]
fn test_reject_consume_anchor_before_delay() {
    let mut context = Context::default();
    let anchor_code = context.deploy_cell(Bytes::from(PROPOSAL_ANCHOR_BINARY.to_vec()));
    let always_success = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let treasury_lock = context
        .build_script(&always_success, Bytes::from(vec![0x01]))
        .expect("treasury lock");
    let treasury_lock_hash = blake2b_256(treasury_lock.as_slice());
    let anchor_type = context
        .build_script(&anchor_code, proposal_anchor_args(treasury_lock_hash))
        .expect("anchor type");

    let anchor = context.create_cell(
        CellOutput::new_builder()
            .capacity(200_000_000u64.pack())
            .lock(treasury_lock.clone())
            .type_(Some(anchor_type).pack())
            .build(),
        pblk_data(),
    );

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .since(encode_relative_timestamp_since(REVIEW_DELAY_MS - 1).pack())
                .previous_output(anchor)
                .build(),
        )
        .output(
            CellOutput::new_builder()
                .capacity(100_000_000u64.pack())
                .lock(treasury_lock)
                .build(),
        )
        .output_data(Bytes::new().pack())
        .cell_dep(CellDep::new_builder().out_point(anchor_code).build())
        .cell_dep(CellDep::new_builder().out_point(always_success).build())
        .build();

    let tx = context.complete_tx(tx);
    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("early anchor consume should be rejected");
    assert_error_code(err, ERROR_INVALID_RECLAIM_SINCE);
}
