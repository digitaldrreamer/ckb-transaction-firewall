#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE2_BIN="$ROOT_DIR/scripts/phase3_governance_mode2.sh"
PHASE4_CHECK_BIN="$ROOT_DIR/scripts/phase4_governance_evidence_check.sh"
TX_STATUS_BIN="$ROOT_DIR/scripts/phase4_governance_tx_status.sh"
PREPARE_TX_FILES_BIN="$ROOT_DIR/scripts/phase4_prepare_tx_files.sh"
SUBMIT_TX_BIN="$ROOT_DIR/scripts/phase4_submit_tx.sh"
ARTIFACT_FILE="$ROOT_DIR/tests/integration/governance_drill/latest.json"

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

main() {
  require_cmd bash
  require_cmd node
  require_cmd jq

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

  "$MODE2_BIN" run \
    --id bootstrap_0_to_1 \
    --signers "$bootstrap_signers" \
    --cmd "$BOOTSTRAP_TX_CMD"

  "$MODE2_BIN" run \
    --id update_1_to_1 \
    --signers "$update_signers" \
    --cmd "$UPDATE_TX_CMD"

  "$MODE2_BIN" run \
    --id negative_invalid_signer_set \
    --signers "$neg_invalid_signer_set_signers" \
    --cmd "$NEG_INVALID_SIGNER_SET_TX_CMD"

  "$MODE2_BIN" run \
    --id negative_invalid_root_binding \
    --signers "$neg_invalid_root_binding_signers" \
    --cmd "$NEG_INVALID_ROOT_BINDING_TX_CMD"

  "$MODE2_BIN" validate
  "$TX_STATUS_BIN" --input "$ARTIFACT_FILE"
  "$PHASE4_CHECK_BIN" "$ARTIFACT_FILE"
  echo "Phase4 live governance autorun complete."
}

main "$@"
