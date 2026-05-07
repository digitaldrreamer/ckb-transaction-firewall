#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE2_BIN="$ROOT_DIR/scripts/phase3_governance_mode2.sh"
PHASE4_CHECK_BIN="$ROOT_DIR/scripts/phase4_governance_evidence_check.sh"
ARTIFACT_FILE="$ROOT_DIR/tests/integration/governance_drill/latest.json"

usage() {
  cat <<'USAGE'
Phase 4 live governance autorun (chain-backed evidence mode).

Usage:
  scripts/phase4_governance_autorun_live.sh --cmd-file <file>

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
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --cmd-file)
        cmd_file="${2:-}"
        shift 2
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

  [[ -n "$cmd_file" ]] || {
    echo "--cmd-file is required" >&2
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
  "$PHASE4_CHECK_BIN" "$ARTIFACT_FILE"
  echo "Phase4 live governance autorun complete."
}

main "$@"
