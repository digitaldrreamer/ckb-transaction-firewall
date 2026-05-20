//! Integration tests for Firewall Lock Script using ckb-testtool.
//! These tests execute the actual compiled contract binary.

use ckb_testtool::builtin::ALWAYS_SUCCESS;
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::{HeaderBuilder, ScriptHashType, TransactionBuilder},
    packed::{Byte32, CellDep, CellInput, CellOutput, OutPoint, Script, WitnessArgs},
    prelude::*,
};
use ckb_testtool::context::Context;

const MAX_CYCLES: u64 = 70_000_000;

// * Error codes from firewall lock script
const ERROR_INVALID_ARGS_LAYOUT: i8 = 5;
const ERROR_UNSUPPORTED_VERSION: i8 = 6;
const ERROR_UNSUPPORTED_FLAGS: i8 = 7;
const ERROR_MISSING_REGISTRY_CELL_DEP: i8 = 8;
const ERROR_INVALID_REGISTRY_DATA: i8 = 9;
const ERROR_REGISTRY_NOT_SORTED: i8 = 10;
const ERROR_BLACKLISTED_LOCK_ARGS: i8 = 11;
const ERROR_BLACKLISTED_TYPE_ARGS: i8 = 12;
const ERROR_AMBIGUOUS_REGISTRY_CELL_DEP: i8 = 17;
const ERROR_MISSING_INNER_LOCK_CELL_DEP: i8 = 13;
const ERROR_INNER_LOCK_REJECTED: i8 = 15;

// * Use compiled contract binary from Phase 1 build output
const FIREWALL_BINARY: &[u8] = include_bytes!(
    "../../../contracts/firewall-lock/target/riscv64imac-unknown-none-elf/release/firewall-lock"
);

// * CKB `always_failure` lock binary (from ckb-script testdata; see tests/unit/fixtures/README.md)
const ALWAYS_FAILURE_LOCK: &[u8] = include_bytes!("../fixtures/always_failure_lock");

// ── v2 helper builders ────────────────────────────────────────────────────────

/// Build 66-byte v2 registry type args for a test registry cell.
///
/// Layout: version(0x02) | gov_code_hash(32 zeros) | gov_hash_type(0x01) | type_id_value([tag; 32])
/// The type_id_value (bytes 34..66) is what the firewall lock matches on.
fn build_registry_v2_type_args(tag: u8) -> Bytes {
    let mut args = Vec::with_capacity(66);
    args.push(0x02u8);
    args.extend_from_slice(&[0u8; 32]);
    args.push(0x01u8);
    args.extend_from_slice(&[tag; 32]);
    Bytes::from(args)
}

/// Build v2-format lock args for early-failure tests (before registry matching).
///
/// v2 layout: version(1) | flags(1) | registry_count(1) |
///   [code_hash(32) | hash_type(1) | type_id_value(32) | required(1)] |
///   inner_code_hash(32) | inner_hash_type(1) | inner_args_len(2 LE)
fn build_firewall_lock_args_with_version_flags(version: u8, flags: u8) -> Bytes {
    let mut args = vec![version, flags, 1u8]; // 1 dummy registry
    args.extend_from_slice(&[0u8; 32]); // registry code_hash
    args.push(0x01u8);                  // registry hash_type
    args.extend_from_slice(&[0u8; 32]); // type_id_value (dummy — no matching dep in these tests)
    args.push(1u8);                     // required = true
    args.extend_from_slice(&[1u8; 32]); // inner_code_hash
    args.push(0x01u8);                  // inner_hash_type
    args.extend_from_slice(&[0u8, 0u8]); // inner_args_len = 0
    Bytes::from(args)
}

fn build_short_invalid_args() -> Bytes {
    Bytes::from(vec![0x01, 0x03, 0xAA]) // shorter than required minimum 38 bytes
}

/// Build a BLKL v2 registry payload with per-entry `expires_at` (LE u64; `0` = permanent).
///
/// v2 format: BLKL(4) | version(0x02) | gov_header_len(2 LE) | [gov_header] |
///   entry_count(4 LE) | [identifier_len(1) | identifier | expires_at(8 LE)]...
/// Tests use gov_header_len = 0 (the firewall lock skips it without inspecting contents).
fn build_registry_payload_with_expires(entries: Vec<(Vec<u8>, u64)>, sorted: bool) -> Bytes {
    let mut rows = entries;
    if sorted {
        rows.sort_by(|a, b| a.0.cmp(&b.0));
    }
    let mut data = vec![];
    data.extend_from_slice(b"BLKL");
    data.push(0x02u8);                        // version = 2
    data.extend_from_slice(&0u16.to_le_bytes()); // gov_header_len = 0
    data.extend_from_slice(
        &u32::try_from(rows.len())
            .expect("registry row count exceeds u32")
            .to_le_bytes(),
    );
    for (id, expires_at) in rows {
        data.push(u8::try_from(id.len()).expect("id too long"));
        data.extend_from_slice(&id);
        data.extend_from_slice(&expires_at.to_le_bytes());
    }
    Bytes::from(data)
}

fn build_registry_payload(entries: Vec<Vec<u8>>, sorted: bool) -> Bytes {
    let mut ids = entries;
    if sorted {
        ids.sort();
    }
    let mut data = vec![];
    data.extend_from_slice(b"BLKL");
    data.push(0x02u8);                        // version = 2
    data.extend_from_slice(&0u16.to_le_bytes()); // gov_header_len = 0
    data.extend_from_slice(
        &u32::try_from(ids.len())
            .expect("registry id count exceeds u32")
            .to_le_bytes(),
    );
    for id in ids {
        data.push(u8::try_from(id.len()).expect("id too long"));
        data.extend_from_slice(&id);
        data.extend_from_slice(&0u64.to_le_bytes()); // permanent entry
    }
    Bytes::from(data)
}

/// Build v2 lock args from a registry type script whose args are 66-byte v2 format.
///
/// Extracts type_id_value from bytes [34..66] of the registry type script args,
/// which is the stable identity the firewall lock matches on across governance updates.
fn build_full_lock_args(
    version: u8,
    flags: u8,
    registry_type_script: &Script,
    inner_code_hash: [u8; 32],
    inner_hash_type: u8,
    inner_args: &[u8],
) -> Bytes {
    let registry_code_hash: [u8; 32] = registry_type_script.code_hash().unpack();
    let registry_hash_type: u8 = u8::from(registry_type_script.hash_type());
    let registry_type_args: Bytes = registry_type_script.args().unpack();

    assert_eq!(
        registry_type_args.len(),
        66,
        "registry type args must be 66-byte v2 format"
    );
    let mut type_id_value = [0u8; 32];
    type_id_value.copy_from_slice(&registry_type_args.as_ref()[34..66]);

    let mut args = vec![version, flags, 1u8]; // 1 registry
    args.extend_from_slice(&registry_code_hash);
    args.push(registry_hash_type);
    args.extend_from_slice(&type_id_value);
    args.push(1u8); // required = true
    args.extend_from_slice(&inner_code_hash);
    args.push(inner_hash_type);
    args.extend_from_slice(
        &u16::try_from(inner_args.len())
            .expect("inner lock args length exceeds u16")
            .to_le_bytes(),
    );
    args.extend_from_slice(inner_args);
    Bytes::from(args)
}

/// Insert synthetic block headers so `load_header` / median time match integration expectations.
fn insert_test_headers(context: &mut Context, timestamps: &[u64]) -> Vec<Byte32> {
    let mut hashes = Vec::with_capacity(timestamps.len());
    for (i, &ts) in timestamps.iter().enumerate() {
        let header = HeaderBuilder::default()
            .timestamp(ts.pack())
            .number(0u64.pack())
            .nonce(((i + 1) as u128).pack())
            .build();
        let h = header.hash();
        context.insert_header(header);
        hashes.push(h);
    }
    hashes
}

fn build_tx_with_firewall_lock(
    context: &mut Context,
    firewall_script_out_point: OutPoint,
    lock_args: Bytes,
    extra_cell_deps: Vec<CellDep>,
    header_dep_hashes: &[Byte32],
    output_lock_args: Bytes,
    output_type_args: Option<Bytes>,
    output_type_code_out_point: Option<OutPoint>,
) -> ckb_testtool::ckb_types::core::TransactionView {
    let lock_script = context
        .build_script(&firewall_script_out_point, lock_args)
        .expect("build firewall lock script");

    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64.pack())
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );

    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();

    let output_lock = context
        .build_script(
            &output_type_code_out_point
                .clone()
                .unwrap_or_else(|| firewall_script_out_point.clone()),
            output_lock_args,
        )
        .expect("build output lock script");

    let mut output_builder = CellOutput::new_builder()
        .capacity(900u64.pack())
        .lock(output_lock);

    if let (Some(type_args), Some(type_code)) = (output_type_args, output_type_code_out_point) {
        let output_type_script = context
            .build_script(&type_code, type_args)
            .expect("build output type script");
        output_builder = output_builder.type_(Some(output_type_script).pack());
    }

    let output = output_builder.build();

    // The firewall lock reads WitnessArgs.lock before spawn_cell — it returns
    // INNER_LOCK_REJECTED (15) immediately if the field is absent or empty.
    // Tests use a dummy 65-byte signature; ALWAYS_SUCCESS ignores argv contents.
    let dummy_witness = WitnessArgs::new_builder()
        .lock(Some(Bytes::from(vec![0u8; 65])).pack())
        .build();

    let mut tx_builder = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(Bytes::new().pack())
        .witness(dummy_witness.as_bytes().pack())
        .cell_dep(
            CellDep::new_builder()
                .out_point(firewall_script_out_point)
                .build(),
        );

    for dep in extra_cell_deps {
        tx_builder = tx_builder.cell_dep(dep);
    }

    for h in header_dep_hashes {
        tx_builder = tx_builder.header_dep(h.clone());
    }

    let tx = tx_builder.build();

    context.complete_tx(tx)
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
fn test_reject_invalid_lock_args_layout() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        build_short_invalid_args(),
        vec![],
        &[],
        Bytes::new(),
        None,
        None,
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail with invalid args layout");
    assert_error_code(err, ERROR_INVALID_ARGS_LAYOUT);
}

#[test]
fn test_reject_unsupported_version() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    // Version 0x01 is not supported in v2 binary; 0x02 is the only accepted version.
    let lock_args = build_firewall_lock_args_with_version_flags(0x01, 0x03);
    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![],
        &[],
        Bytes::new(),
        None,
        None,
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail with unsupported version");
    assert_error_code(err, ERROR_UNSUPPORTED_VERSION);
}

#[test]
fn test_reject_unsupported_flags() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    // bits 2-7 reserved; set bit 2 to trigger UnsupportedFlags. Version must be 0x02 to pass version check.
    let lock_args = build_firewall_lock_args_with_version_flags(0x02, 0x04);
    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![],
        &[],
        Bytes::new(),
        None,
        None,
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail with unsupported flags");
    assert_error_code(err, ERROR_UNSUPPORTED_FLAGS);
}

#[test]
fn test_reject_missing_registry_cell_dep() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    // Valid v2 args with one required registry spec, but no matching dep in the transaction.
    let lock_args = build_firewall_lock_args_with_version_flags(0x02, 0x03);
    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![],
        &[],
        Bytes::new(),
        None,
        None,
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail with missing registry cell dep");
    assert_error_code(err, ERROR_MISSING_REGISTRY_CELL_DEP);
}

#[test]
fn test_reject_invalid_registry_data() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));

    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x01))
        .expect("build registry type script");

    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();

    // Invalid magic to trigger ERROR_INVALID_REGISTRY_DATA
    let registry_out_point = context.create_cell(registry_output, Bytes::from(vec![0x00, 0x11, 0x22]));
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_hash: [u8; 32] = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script")
        .code_hash()
        .unpack();

    let lock_args = build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, 0x01, &[]);
    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep],
        &[],
        Bytes::new(),
        None,
        None,
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail with invalid registry data");
    assert_error_code(err, ERROR_INVALID_REGISTRY_DATA);
}

#[test]
fn test_reject_registry_not_sorted() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));

    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x02))
        .expect("build registry type script");

    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();

    // Unsorted entries: [0xBB], [0xAA] — BLKL v2 format
    let unsorted_payload = {
        let mut data = vec![];
        data.extend_from_slice(b"BLKL");
        data.push(0x02u8);
        data.extend_from_slice(&0u16.to_le_bytes()); // gov_header_len = 0
        data.extend_from_slice(&2u32.to_le_bytes());
        data.push(1); data.push(0xBB); data.extend_from_slice(&0u64.to_le_bytes());
        data.push(1); data.push(0xAA); data.extend_from_slice(&0u64.to_le_bytes());
        Bytes::from(data)
    };
    let registry_out_point = context.create_cell(registry_output, unsorted_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_hash: [u8; 32] = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script")
        .code_hash()
        .unpack();

    let lock_args = build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, 0x01, &[]);
    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep],
        &[],
        Bytes::new(),
        None,
        None,
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail with unsorted registry");
    assert_error_code(err, ERROR_REGISTRY_NOT_SORTED);
}

#[test]
fn test_reject_blacklisted_output_lock_args() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));

    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x03))
        .expect("build registry type script");

    let blacklist_id = vec![0xAA, 0xBB];
    let registry_payload = build_registry_payload(vec![blacklist_id.clone()], true);
    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();
    let registry_out_point = context.create_cell(registry_output, registry_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_hash: [u8; 32] = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script")
        .code_hash()
        .unpack();
    let lock_args = build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, 0x01, &[]);

    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep],
        &[],
        Bytes::from(blacklist_id),
        None,
        Some(type_code_out_point),
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail on blacklisted output lock args");
    assert_error_code(err, ERROR_BLACKLISTED_LOCK_ARGS);
}

#[test]
fn test_reject_blacklisted_output_type_args() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));

    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x04))
        .expect("build registry type script");

    let blacklist_type_args = vec![0x55, 0x66];
    let registry_payload = build_registry_payload(vec![blacklist_type_args.clone()], true);
    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();
    let registry_out_point = context.create_cell(registry_output, registry_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_hash: [u8; 32] = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script")
        .code_hash()
        .unpack();
    let lock_args = build_full_lock_args(0x02, 0x02, &registry_type_script, inner_hash, 0x01, &[]);

    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep],
        &[],
        Bytes::new(),
        Some(Bytes::from(blacklist_type_args)),
        Some(type_code_out_point),
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail on blacklisted output type args");
    assert_error_code(err, ERROR_BLACKLISTED_TYPE_ARGS);
}

#[test]
fn test_reject_ambiguous_registry_cell_dep() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));

    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x05))
        .expect("build registry type script");

    let registry_payload = build_registry_payload(vec![vec![0xAA]], true);
    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();

    // Create two registry deps with identical type script identity
    let registry_out_point_1 = context.create_cell(registry_output.clone(), registry_payload.clone());
    let registry_out_point_2 = context.create_cell(registry_output, registry_payload);
    let registry_dep_1 = CellDep::new_builder().out_point(registry_out_point_1).build();
    let registry_dep_2 = CellDep::new_builder().out_point(registry_out_point_2).build();

    let inner_hash: [u8; 32] = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script")
        .code_hash()
        .unpack();
    let lock_args = build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, 0x01, &[]);

    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep_1, registry_dep_2],
        &[],
        Bytes::new(),
        None,
        Some(type_code_out_point),
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("tx should fail with ambiguous registry cell dep");
    assert_error_code(err, ERROR_AMBIGUOUS_REGISTRY_CELL_DEP);
}

#[test]
fn test_pass_non_blacklisted_with_valid_registry_dep() {
    let cycles = run_non_blacklisted_pass_and_get_cycles(0x01, false);
    assert!(cycles > 0, "happy path should consume cycles");
}

fn run_non_blacklisted_pass_and_get_cycles(flags: u8, include_type_script: bool) -> u64 {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));

    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x06))
        .expect("build registry type script");

    // Registry contains a different id than the output lock args.
    let registry_payload = build_registry_payload(vec![vec![0xAA, 0xBB]], true);
    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();
    let registry_out_point = context.create_cell(registry_output, registry_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_script = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script");
    let inner_hash: [u8; 32] = inner_script.code_hash().unpack();
    let inner_hash_type: u8 = u8::from(inner_script.hash_type());
    let lock_args =
        build_full_lock_args(0x02, flags, &registry_type_script, inner_hash, inner_hash_type, &[]);

    let inner_dep = CellDep::new_builder()
        .out_point(inner_code_out_point.clone())
        .build();

    // output lock args [0x11, 0x22] is not blacklisted, so tx should pass.
    let output_type_args = if include_type_script {
        Some(Bytes::from(vec![0x33, 0x44]))
    } else {
        None
    };

    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep, inner_dep],
        &[],
        Bytes::from(vec![0x11, 0x22]),
        output_type_args,
        Some(type_code_out_point),
    );

    context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("tx should pass for non-blacklisted outputs")
}

fn run_non_blacklisted_large_registry_and_get_cycles(
    flags: u8,
    include_type_script: bool,
    entries: usize,
) -> u64 {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));

    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x07))
        .expect("build registry type script");

    let mut registry_ids = Vec::with_capacity(entries);
    for i in 0..entries {
        let hi = ((i >> 8) & 0xFF) as u8;
        let lo = (i & 0xFF) as u8;
        registry_ids.push(vec![0xAA, hi, lo]);
    }
    let registry_payload = build_registry_payload(registry_ids, true);
    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();
    let registry_out_point = context.create_cell(registry_output, registry_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_script = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script");
    let inner_hash: [u8; 32] = inner_script.code_hash().unpack();
    let inner_hash_type: u8 = u8::from(inner_script.hash_type());
    let lock_args =
        build_full_lock_args(0x02, flags, &registry_type_script, inner_hash, inner_hash_type, &[]);

    let inner_dep = CellDep::new_builder()
        .out_point(inner_code_out_point.clone())
        .build();

    // output lock args [0x11, 0x22] is not blacklisted.
    let output_type_args = if include_type_script {
        Some(Bytes::from(vec![0x33, 0x44]))
    } else {
        None
    };

    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep, inner_dep],
        &[],
        Bytes::from(vec![0x11, 0x22]),
        output_type_args,
        Some(type_code_out_point),
    );

    context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("tx should pass for non-blacklisted outputs with large registry")
}

#[test]
fn test_pass_temporary_blacklist_expired_with_header_median() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x10))
        .expect("build registry type script");

    let temp_id = vec![0xCC, 0xDD];
    let expires_at = 5000u64;
    let registry_payload =
        build_registry_payload_with_expires(vec![(temp_id.clone(), expires_at)], true);

    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();
    let registry_out_point = context.create_cell(registry_output, registry_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_script = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script");
    let inner_hash: [u8; 32] = inner_script.code_hash().unpack();
    let inner_hash_type: u8 = u8::from(inner_script.hash_type());
    let lock_args =
        build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, inner_hash_type, &[]);

    let inner_dep = CellDep::new_builder()
        .out_point(inner_code_out_point.clone())
        .build();

    // Median of [6000, 7000, 8000] is 7000 >= 5000 => temporary entry expired => spend allowed.
    let header_hashes = insert_test_headers(&mut context, &[6000, 7000, 8000]);

    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep, inner_dep],
        &header_hashes,
        Bytes::from(temp_id),
        None,
        Some(type_code_out_point),
    );

    context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("expired temporary blacklist should not block spend");
}

#[test]
fn test_reject_temporary_blacklist_active_with_header_median() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x11))
        .expect("build registry type script");

    let temp_id = vec![0xDE, 0xAD];
    let expires_at = 9000u64;
    let registry_payload =
        build_registry_payload_with_expires(vec![(temp_id.clone(), expires_at)], true);

    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();
    let registry_out_point = context.create_cell(registry_output, registry_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_script = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script");
    let inner_hash: [u8; 32] = inner_script.code_hash().unpack();
    let inner_hash_type: u8 = u8::from(inner_script.hash_type());
    let lock_args =
        build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, inner_hash_type, &[]);

    let inner_dep = CellDep::new_builder()
        .out_point(inner_code_out_point.clone())
        .build();

    // Median of [6000, 7000, 8000] is 7000 < 9000 => temporary entry still active.
    let header_hashes = insert_test_headers(&mut context, &[6000, 7000, 8000]);

    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep, inner_dep],
        &header_hashes,
        Bytes::from(temp_id),
        None,
        Some(type_code_out_point),
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("active temporary blacklist should reject");
    assert_error_code(err, ERROR_BLACKLISTED_LOCK_ARGS);
}

#[test]
fn test_median_time_even_header_count_affects_expiry() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x12))
        .expect("build registry type script");

    let temp_id = vec![0xBE, 0xEF];
    // Even count timestamps [1000,2000,3000,4000] => median (2000+3000)/2 = 2500.
    let expires_at = 2600u64;
    let registry_payload =
        build_registry_payload_with_expires(vec![(temp_id.clone(), expires_at)], true);

    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();
    let registry_out_point = context.create_cell(registry_output, registry_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_script = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script");
    let inner_hash: [u8; 32] = inner_script.code_hash().unpack();
    let inner_hash_type: u8 = u8::from(inner_script.hash_type());
    let lock_args =
        build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, inner_hash_type, &[]);

    let inner_dep = CellDep::new_builder()
        .out_point(inner_code_out_point.clone())
        .build();

    let header_hashes = insert_test_headers(&mut context, &[1000, 2000, 3000, 4000]);

    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep, inner_dep],
        &header_hashes,
        Bytes::from(temp_id),
        None,
        Some(type_code_out_point),
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("median 2500 < 2600 => temp entry still active");
    assert_error_code(err, ERROR_BLACKLISTED_LOCK_ARGS);
}

/// `header_dep` order in the transaction does not change median: the lock sorts timestamps internally.
#[test]
fn test_header_dep_order_permutation_invariant_for_median_expiry() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x21))
        .expect("build registry type script");

    let temp_id = vec![0x01, 0x02];
    let expires_at = 5000u64;
    let registry_payload =
        build_registry_payload_with_expires(vec![(temp_id.clone(), expires_at)], true);

    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();
    let registry_out_point = context.create_cell(registry_output, registry_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_script = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script");
    let inner_hash: [u8; 32] = inner_script.code_hash().unpack();
    let inner_hash_type: u8 = u8::from(inner_script.hash_type());
    let lock_args =
        build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, inner_hash_type, &[]);

    let inner_dep = CellDep::new_builder()
        .out_point(inner_code_out_point.clone())
        .build();

    let hashes = insert_test_headers(&mut context, &[6000, 7000, 8000]);
    let permutations = vec![
        vec![hashes[0].clone(), hashes[1].clone(), hashes[2].clone()],
        vec![hashes[2].clone(), hashes[0].clone(), hashes[1].clone()],
        vec![hashes[1].clone(), hashes[2].clone(), hashes[0].clone()],
    ];

    for order in permutations {
        let tx = build_tx_with_firewall_lock(
            &mut context,
            firewall_out_point.clone(),
            lock_args.clone(),
            vec![registry_dep.clone(), inner_dep.clone()],
            &order,
            Bytes::from(temp_id.clone()),
            None,
            Some(type_code_out_point.clone()),
        );
        context
            .verify_tx(&tx, MAX_CYCLES)
            .expect("median invariant across header_dep permutations");
    }
}

/// Nine headers (odd count): timestamps 1000..9000 step 1000 => median 5000.
#[test]
fn test_median_nine_headers_expiry_matrix() {
    let timestamps: Vec<u64> = (1..=9).map(|i| i * 1000).collect();
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x22))
        .expect("build registry type script");

    let temp_id = vec![0x03, 0x04];
    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();

    let inner_script = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script");
    let inner_hash: [u8; 32] = inner_script.code_hash().unpack();
    let inner_hash_type: u8 = u8::from(inner_script.hash_type());
    let inner_dep = CellDep::new_builder()
        .out_point(inner_code_out_point.clone())
        .build();

    let header_hashes = insert_test_headers(&mut context, &timestamps);

    // expires 4500 < median 5000 => expired => pass
    let payload_expired = build_registry_payload_with_expires(vec![(temp_id.clone(), 4500)], true);
    let registry_out_expired = context.create_cell(registry_output.clone(), payload_expired);
    let dep_expired = CellDep::new_builder()
        .out_point(registry_out_expired)
        .build();
    let lock_args_expired =
        build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, inner_hash_type, &[]);
    let tx_ok = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point.clone(),
        lock_args_expired,
        vec![dep_expired, inner_dep.clone()],
        &header_hashes,
        Bytes::from(temp_id.clone()),
        None,
        Some(type_code_out_point.clone()),
    );
    context
        .verify_tx(&tx_ok, MAX_CYCLES)
        .expect("median 5000 >= 4500 => temporary blacklist inactive");

    // expires 6000 > median 5000 => active => reject
    let payload_active = build_registry_payload_with_expires(vec![(temp_id.clone(), 6000)], true);
    let registry_out_active = context.create_cell(registry_output, payload_active);
    let dep_active = CellDep::new_builder()
        .out_point(registry_out_active)
        .build();
    let lock_args_active =
        build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, inner_hash_type, &[]);
    let tx_bad = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args_active,
        vec![dep_active, inner_dep],
        &header_hashes,
        Bytes::from(temp_id),
        None,
        Some(type_code_out_point),
    );
    let err = context
        .verify_tx(&tx_bad, MAX_CYCLES)
        .expect_err("median 5000 < 6000 => temporary blacklist still active");
    assert_error_code(err, ERROR_BLACKLISTED_LOCK_ARGS);
}

/// With no `header_deps`, median time is 0: conservative fail-safe keeps temporary rows active.
#[test]
fn test_no_header_deps_zero_median_keeps_temporary_blacklist_active() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x23))
        .expect("build registry type script");

    let temp_id = vec![0x05, 0x06];
    let registry_payload =
        build_registry_payload_with_expires(vec![(temp_id.clone(), 9_999_999)], true);

    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();
    let registry_out_point = context.create_cell(registry_output, registry_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_script = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script");
    let inner_hash: [u8; 32] = inner_script.code_hash().unpack();
    let inner_hash_type: u8 = u8::from(inner_script.hash_type());
    let lock_args =
        build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, inner_hash_type, &[]);

    let inner_dep = CellDep::new_builder()
        .out_point(inner_code_out_point.clone())
        .build();

    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep, inner_dep],
        &[],
        Bytes::from(temp_id),
        None,
        Some(type_code_out_point),
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("median 0 < expires_at => temporary entry enforced");
    assert_error_code(err, ERROR_BLACKLISTED_LOCK_ARGS);
}

/// Duplicate header timestamps collapse to one median value; boundary `expires_at == median` is expired.
#[test]
fn test_median_duplicate_header_timestamps_boundary_eq_expires() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x24))
        .expect("build registry type script");

    let temp_id = vec![0x07, 0x08];
    let expires_at = 7000u64;
    let registry_payload =
        build_registry_payload_with_expires(vec![(temp_id.clone(), expires_at)], true);

    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();
    let registry_out_point = context.create_cell(registry_output, registry_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_script = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script");
    let inner_hash: [u8; 32] = inner_script.code_hash().unpack();
    let inner_hash_type: u8 = u8::from(inner_script.hash_type());
    let lock_args =
        build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, inner_hash_type, &[]);

    let inner_dep = CellDep::new_builder()
        .out_point(inner_code_out_point.clone())
        .build();

    let header_hashes = insert_test_headers(&mut context, &[7000, 7000, 7000]);

    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep, inner_dep],
        &header_hashes,
        Bytes::from(temp_id),
        None,
        Some(type_code_out_point),
    );

    context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("median == expires_at => temporary blacklist expired (not strictly before)");
}

/// Single header: median equals that header's timestamp.
#[test]
fn test_median_single_header_timestamp() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x25))
        .expect("build registry type script");

    let temp_id = vec![0x09, 0x0a];
    let expires_at = 40_000u64;
    let registry_payload =
        build_registry_payload_with_expires(vec![(temp_id.clone(), expires_at)], true);

    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();
    let registry_out_point = context.create_cell(registry_output, registry_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_script = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script");
    let inner_hash: [u8; 32] = inner_script.code_hash().unpack();
    let inner_hash_type: u8 = u8::from(inner_script.hash_type());
    let lock_args =
        build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, inner_hash_type, &[]);

    let inner_dep = CellDep::new_builder()
        .out_point(inner_code_out_point.clone())
        .build();

    let header_hashes = insert_test_headers(&mut context, &[50_000]);

    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep, inner_dep],
        &header_hashes,
        Bytes::from(temp_id),
        None,
        Some(type_code_out_point),
    );

    context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("single header median 50000 >= 40000 => expired");
}

#[test]
fn test_reject_missing_inner_lock_cell_dep() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x13))
        .expect("build registry type script");

    let registry_payload = build_registry_payload(vec![vec![0xAA, 0xBB]], true);
    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_code_out_point, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();
    let registry_out_point = context.create_cell(registry_output, registry_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_script = context
        .build_script(&inner_code_out_point, Bytes::new())
        .expect("build inner script");
    let inner_hash: [u8; 32] = inner_script.code_hash().unpack();
    let inner_hash_type: u8 = u8::from(inner_script.hash_type());
    let lock_args =
        build_full_lock_args(0x02, 0x01, &registry_type_script, inner_hash, inner_hash_type, &[]);

    // Intentionally omit inner lock code cell_dep so spawn_cell cannot resolve the binary.
    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep],
        &[],
        Bytes::from(vec![0x11, 0x22]),
        None,
        Some(type_code_out_point),
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("missing inner lock cell dep should fail spawn");
    assert_error_code(err, ERROR_MISSING_INNER_LOCK_CELL_DEP);
}

#[test]
fn test_reject_inner_lock_spawn_always_failure() {
    let mut context = Context::default();
    let firewall_out_point = context.deploy_cell(Bytes::from(FIREWALL_BINARY.to_vec()));
    let type_code_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_success_out = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let inner_fail_out = context.deploy_cell(Bytes::from(ALWAYS_FAILURE_LOCK.to_vec()));

    let registry_type_script = context
        .build_script(&type_code_out_point, build_registry_v2_type_args(0x14))
        .expect("build registry type script");

    let registry_payload = build_registry_payload(vec![vec![0xAA, 0xBB]], true);
    let registry_output = CellOutput::new_builder()
        .capacity(1000u64.pack())
        .lock(
            context
                .build_script(&inner_success_out, Bytes::new())
                .expect("build registry lock"),
        )
        .type_(Some(registry_type_script.clone()).pack())
        .build();
    let registry_out_point = context.create_cell(registry_output, registry_payload);
    let registry_dep = CellDep::new_builder().out_point(registry_out_point).build();

    let inner_fail_script = context
        .build_script_with_hash_type(&inner_fail_out, ScriptHashType::Data, Bytes::new())
        .expect("build always_failure inner lock script");
    let inner_fail_hash: [u8; 32] = inner_fail_script.code_hash().unpack();
    let inner_fail_hash_type: u8 = u8::from(inner_fail_script.hash_type());

    let lock_args = build_full_lock_args(
        0x02,
        0x01,
        &registry_type_script,
        inner_fail_hash,
        inner_fail_hash_type,
        &[],
    );

    let inner_fail_dep = CellDep::new_builder().out_point(inner_fail_out).build();

    let tx = build_tx_with_firewall_lock(
        &mut context,
        firewall_out_point,
        lock_args,
        vec![registry_dep, inner_fail_dep],
        &[],
        Bytes::from(vec![0x11, 0x22]),
        None,
        Some(type_code_out_point),
    );

    let err = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect_err("inner lock that always fails should surface InnerLockRejected");
    assert_error_code(err, ERROR_INNER_LOCK_REJECTED);
}

#[test]
fn test_pass_non_blacklisted_registry_256_entries_stress() {
    let cycles = run_non_blacklisted_large_registry_and_get_cycles(0x03, true, 256);
    assert!(cycles > 0, "256-entry registry path should consume cycles");
}

#[test]
fn test_cycle_probe_happy_path_lock_only() {
    let cycles = run_non_blacklisted_pass_and_get_cycles(0x01, false);
    println!("CYCLE_PROBE_HAPPY_PATH_LOCK_ONLY={cycles}");
}

#[test]
fn test_cycle_probe_happy_path_type_only() {
    let cycles = run_non_blacklisted_pass_and_get_cycles(0x02, true);
    println!("CYCLE_PROBE_HAPPY_PATH_TYPE_ONLY={cycles}");
}

#[test]
fn test_cycle_probe_happy_path_both_checks() {
    let cycles = run_non_blacklisted_pass_and_get_cycles(0x03, true);
    println!("CYCLE_PROBE_HAPPY_PATH_BOTH_CHECKS={cycles}");
}

#[test]
fn test_cycle_probe_happy_path_large_registry_both_checks() {
    let cycles = run_non_blacklisted_large_registry_and_get_cycles(0x03, true, 512);
    println!("CYCLE_PROBE_HAPPY_PATH_LARGE_REGISTRY_BOTH_CHECKS={cycles}");
}

#[test]
fn test_cycle_probe_happy_path_very_large_registry_both_checks() {
    let cycles = run_non_blacklisted_large_registry_and_get_cycles(0x03, true, 2000);
    println!("CYCLE_PROBE_HAPPY_PATH_VERY_LARGE_REGISTRY_BOTH_CHECKS={cycles}");
}
