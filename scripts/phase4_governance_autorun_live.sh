#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE2_BIN="$ROOT_DIR/scripts/phase3_governance_mode2.sh"
PHASE4_CHECK_BIN="$ROOT_DIR/scripts/phase4_governance_evidence_check.sh"
TX_STATUS_BIN="$ROOT_DIR/scripts/phase4_governance_tx_status.sh"
PREPARE_TX_FILES_BIN="$ROOT_DIR/scripts/phase4_prepare_tx_files.sh"
SUBMIT_TX_BIN="$ROOT_DIR/scripts/phase4_submit_tx.sh"
VM_COMPAT_CHECK_BIN="$ROOT_DIR/scripts/check_registry_vm_compat.sh"
ARTIFACT_FILE="$ROOT_DIR/tests/integration/governance_drill/latest.json"
STATE_FILE="$ROOT_DIR/tests/integration/governance_drill/mode2_signer_state.json"

usage() {
  cat <<'USAGE'
Phase 4 live governance autorun (chain-backed evidence mode).

Usage:
  scripts/phase4_governance_autorun_live.sh --cmd-file <file>
  scripts/phase4_governance_autorun_live.sh --auto-from-tx-files

Required command variables (in --cmd-file):
  BOOTSTRAP_TX_CMD
  UPDATE_TX_CMD
  NEG_INVALID_SIGNER_SET_TX_CMD
  NEG_INVALID_ROOT_BINDING_TX_CMD

Optional signer variables (defaults shown):
  BOOTSTRAP_SIGNERS=0,1,2,3,4
  UPDATE_SIGNERS=0,1,2
  NEG_INVALID_SIGNER_SET_SIGNERS=0,1
  NEG_INVALID_ROOT_BINDING_SIGNERS=0,1,2

Notes:
  - Each *_TX_CMD must print a tx hash (0x + 64 hex) on success.
  - This script executes the provided commands and records live evidence.
  - It finishes by running phase4_governance_evidence_check.sh (chain verification).
  - In --auto-from-tx-files mode, tx JSON files are signed/sent automatically.
  - Missing tx JSON files are auto-prepared from deploy baseline + live cells.
USAGE
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

require_nonempty() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "missing required variable: $name" >&2
    exit 1
  fi
}

scenario_already_recorded() {
  local scenario_id="$1"
  [[ -f "$ARTIFACT_FILE" ]] || return 1
  jq -e --arg id "$scenario_id" '
    .scenarios[]
    | select(.id == $id)
    | (.tx_hash | type == "string" and length > 0)
      and (.status == "pass" or .status == "passed" or .status == "expected_failure")
  ' "$ARTIFACT_FILE" >/dev/null 2>&1
}

run_or_skip_scenario() {
  local scenario_id="$1"
  local signers="$2"
  local cmd="$3"

  if scenario_already_recorded "$scenario_id"; then
    echo "Skipping scenario $scenario_id (already recorded in artifact)."
    return 0
  fi

  "$MODE2_BIN" run \
    --id "$scenario_id" \
    --signers "$signers" \
    --cmd "$cmd"
}

tx_hash_chain_status() {
  local tx_hash="$1"
  "${CKB_CLI_BIN:-ckb-cli}" --url "${CKB_RPC_URL:-https://testnet.ckb.dev}" rpc get_transaction --hash "$tx_hash" --output-format json \
    | jq -r '.tx_status.status // "unknown"'
}

rerun_unknown_scenarios_if_any() {
  local reran=0
  local ids=(
    "bootstrap_0_to_1"
    "update_1_to_1"
    "negative_invalid_signer_set"
    "negative_invalid_root_binding"
  )

  for id in "${ids[@]}"; do
    local tx_hash
    tx_hash="$(jq -r --arg id "$id" '.scenarios[] | select(.id == $id) | .tx_hash // ""' "$ARTIFACT_FILE")"
    [[ "$tx_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || continue
    local status
    status="$(tx_hash_chain_status "$tx_hash" || echo "unknown")"
    if [[ "$status" != "unknown" && "$status" != "~" ]]; then
      continue
    fi

    echo "Scenario $id has non-resolvable tx hash ($tx_hash, status=$status); rerunning to refresh evidence..."
    case "$id" in
      bootstrap_0_to_1)
        "$MODE2_BIN" run --id "$id" --signers "${BOOTSTRAP_SIGNERS:-0,1,2,3,4}" --cmd "$BOOTSTRAP_TX_CMD"
        ;;
      update_1_to_1)
        "$MODE2_BIN" run --id "$id" --signers "${UPDATE_SIGNERS:-0,1,2}" --cmd "$UPDATE_TX_CMD"
        ;;
      negative_invalid_signer_set)
        "$MODE2_BIN" run --id "$id" --signers "${NEG_INVALID_SIGNER_SET_SIGNERS:-0,1}" --cmd "$NEG_INVALID_SIGNER_SET_TX_CMD"
        ;;
      negative_invalid_root_binding)
        "$MODE2_BIN" run --id "$id" --signers "${NEG_INVALID_ROOT_BINDING_SIGNERS:-0,1,2}" --cmd "$NEG_INVALID_ROOT_BINDING_TX_CMD"
        ;;
    esac
    reran=1
  done

  return $reran
}

rebuild_mode2_state_if_needed() {
  [[ -f "$STATE_FILE" ]] && return 0
  [[ -f "$ARTIFACT_FILE" ]] || return 0
  ARTIFACT_PATH="$ARTIFACT_FILE" STATE_PATH="$STATE_FILE" node <<'NODE'
const fs = require('node:fs');
const artifactPath = process.env.ARTIFACT_PATH;
const statePath = process.env.STATE_PATH;
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const drill = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const defaults = {
  bootstrap_0_to_1: [0,1,2,3,4],
  update_1_to_1: [0,1,2],
  negative_invalid_signer_set: [0,1],
  negative_invalid_root_binding: [0,1,2],
};
const scenarios = {};
for (const [id, signers] of Object.entries(defaults)) {
  const row = (drill.scenarios || []).find((s) => s.id === id);
  if (!row || !/^0x[0-9a-fA-F]{64}$/.test(row.tx_hash || '')) continue;
  scenarios[id] = { signers, tx_hash: row.tx_hash, updated_utc: now };
}
if (Object.keys(scenarios).length > 0) {
  const state = { generated_utc: now, model: 'mode2-separated-signers', scenarios };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  console.log(`Rebuilt mode2 signer state: ${statePath}`);
}
NODE
}

main() {
  require_cmd bash
  require_cmd node
  require_cmd jq
  if [[ -x "$VM_COMPAT_CHECK_BIN" ]]; then
    "$VM_COMPAT_CHECK_BIN"
  fi

  local cmd_file=""
  local auto_from_tx_files=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --cmd-file)
        cmd_file="${2:-}"
        shift 2
        ;;
      --auto-from-tx-files)
        auto_from_tx_files=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "unknown arg: $1" >&2
        usage
        exit 1
        ;;
    esac
  done

  if [[ "$auto_from_tx_files" == "1" ]]; then
    require_cmd "${CKB_CLI_BIN:-ckb-cli}"
    local cli="${CKB_CLI_BIN:-ckb-cli}"
    local rpc="${CKB_RPC_URL:-https://testnet.ckb.dev}"
    local from_account="${FROM_ACCOUNT:-}"
    if [[ -z "$from_account" ]]; then
      from_account="$($cli account list | awk '/testnet:/ {print $2; exit}')"
    fi
    [[ -n "$from_account" ]] || {
      echo "could not determine FROM_ACCOUNT; set FROM_ACCOUNT env var." >&2
      exit 1
    }

    local bootstrap_tx_file="${BOOTSTRAP_TX_FILE:-$ROOT_DIR/deploy/gov_bootstrap_tx.json}"
    local update_tx_file="${UPDATE_TX_FILE:-$ROOT_DIR/deploy/gov_update_tx.json}"
    local neg_signer_tx_file="${NEG_INVALID_SIGNER_SET_TX_FILE:-$ROOT_DIR/deploy/gov_negative_invalid_signer_set_tx.json}"
    local neg_root_tx_file="${NEG_INVALID_ROOT_BINDING_TX_FILE:-$ROOT_DIR/deploy/gov_negative_invalid_root_binding_tx.json}"

    [[ -f "$bootstrap_tx_file" ]] || { echo "missing base tx file: $bootstrap_tx_file" >&2; exit 1; }
    # Always refresh scenario tx files to avoid stale/dead input outpoints.
    "$PREPARE_TX_FILES_BIN"
    [[ -f "$update_tx_file" ]] || { echo "missing tx file after preparation: $update_tx_file" >&2; exit 1; }
    [[ -f "$neg_signer_tx_file" ]] || { echo "missing tx file after preparation: $neg_signer_tx_file" >&2; exit 1; }
    [[ -f "$neg_root_tx_file" ]] || { echo "missing tx file after preparation: $neg_root_tx_file" >&2; exit 1; }

    BOOTSTRAP_TX_CMD="CKB_CLI_BIN=\"$cli\" CKB_RPC_URL=\"$rpc\" \"$SUBMIT_TX_BIN\" --tx-file \"$bootstrap_tx_file\" --from-account \"$from_account\""
    UPDATE_TX_CMD="CKB_CLI_BIN=\"$cli\" CKB_RPC_URL=\"$rpc\" \"$SUBMIT_TX_BIN\" --tx-file \"$update_tx_file\" --from-account \"$from_account\""
    NEG_INVALID_SIGNER_SET_TX_CMD="CKB_CLI_BIN=\"$cli\" CKB_RPC_URL=\"$rpc\" \"$SUBMIT_TX_BIN\" --tx-file \"$neg_signer_tx_file\" --from-account \"$from_account\""
    NEG_INVALID_ROOT_BINDING_TX_CMD="CKB_CLI_BIN=\"$cli\" CKB_RPC_URL=\"$rpc\" \"$SUBMIT_TX_BIN\" --tx-file \"$neg_root_tx_file\" --from-account \"$from_account\""
  else
    [[ -n "$cmd_file" ]] || {
      echo "either --cmd-file or --auto-from-tx-files is required" >&2
      usage
      exit 1
    }
    [[ -f "$cmd_file" ]] || {
      echo "command file not found: $cmd_file" >&2
      exit 1
    }
    # shellcheck source=/dev/null
    source "$cmd_file"
    require_nonempty BOOTSTRAP_TX_CMD
    require_nonempty UPDATE_TX_CMD
    require_nonempty NEG_INVALID_SIGNER_SET_TX_CMD
    require_nonempty NEG_INVALID_ROOT_BINDING_TX_CMD
  fi

  local bootstrap_signers="${BOOTSTRAP_SIGNERS:-0,1,2,3,4}"
  local update_signers="${UPDATE_SIGNERS:-0,1,2}"
  local neg_invalid_signer_set_signers="${NEG_INVALID_SIGNER_SET_SIGNERS:-0,1}"
  local neg_invalid_root_binding_signers="${NEG_INVALID_ROOT_BINDING_SIGNERS:-0,1,2}"

  echo "Starting phase4 live governance autorun (chain-backed evidence mode)..."
  "$MODE2_BIN" init

  run_or_skip_scenario "bootstrap_0_to_1" "$bootstrap_signers" "$BOOTSTRAP_TX_CMD"
  run_or_skip_scenario "update_1_to_1" "$update_signers" "$UPDATE_TX_CMD"
  run_or_skip_scenario "negative_invalid_signer_set" "$neg_invalid_signer_set_signers" "$NEG_INVALID_SIGNER_SET_TX_CMD"
  run_or_skip_scenario "negative_invalid_root_binding" "$neg_invalid_root_binding_signers" "$NEG_INVALID_ROOT_BINDING_TX_CMD"

  rebuild_mode2_state_if_needed "$ARTIFACT_FILE" "$STATE_FILE"

  set +e
  rerun_unknown_scenarios_if_any
  local rerun_rc=$?
  set -e
  if [[ "$rerun_rc" -eq 1 ]]; then
    echo "Refreshed unknown scenario tx hashes."
    rebuild_mode2_state_if_needed "$ARTIFACT_FILE" "$STATE_FILE"
  fi

  "$MODE2_BIN" validate
  "$TX_STATUS_BIN" --input "$ARTIFACT_FILE"
  "$PHASE4_CHECK_BIN" "$ARTIFACT_FILE"
  echo "Phase4 live governance autorun complete."
}

main "$@"
