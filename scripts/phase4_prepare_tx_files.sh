#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"
BASE_TX_FILE="$DEPLOY_DIR/gov_bootstrap_tx.json"
CKB_CLI_BIN="${CKB_CLI_BIN:-ckb-cli}"
CKB_RPC_URL="${CKB_RPC_URL:-https://testnet.ckb.dev}"
INFO_FILE="${INFO_FILE:-$DEPLOY_DIR/info.json}"
MIN_REQUIRED_CELLS="${MIN_REQUIRED_CELLS:-4}"
AUTO_TOPUP_CAPACITY_CKB="${AUTO_TOPUP_CAPACITY_CKB:-200}"
AUTO_TOPUP_MAX_WAIT_SEC="${AUTO_TOPUP_MAX_WAIT_SEC:-180}"

usage() {
  cat <<'USAGE'
Prepare governance tx files for phase4 auto execution.

Usage:
  scripts/phase4_prepare_tx_files.sh

Outputs:
  deploy/gov_bootstrap_tx.json (input refreshed to live outpoint)
  deploy/gov_update_tx.json
  deploy/gov_negative_invalid_signer_set_tx.json
  deploy/gov_negative_invalid_root_binding_tx.json
USAGE
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  require_cmd jq
  require_cmd "$CKB_CLI_BIN"
  [[ -f "$BASE_TX_FILE" ]] || {
    echo "missing base tx file: $BASE_TX_FILE" >&2
    exit 1
  }
  [[ -f "$INFO_FILE" ]] || {
    echo "missing deploy info file: $INFO_FILE" >&2
    exit 1
  }

  local lock_code_hash lock_hash_type lock_args
  lock_code_hash="$(jq -r '.deployment.lock.code_hash' "$INFO_FILE")"
  lock_hash_type="$(jq -r '.deployment.lock.hash_type' "$INFO_FILE")"
  lock_args="$(jq -r '.deployment.lock.args' "$INFO_FILE")"

  [[ "$lock_code_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "invalid deployment.lock.code_hash" >&2; exit 1; }
  [[ "$lock_args" =~ ^0x[0-9a-fA-F]*$ ]] || { echo "invalid deployment.lock.args" >&2; exit 1; }

  local tmp_search tmp_cells
  tmp_search="$(mktemp)"
  tmp_cells="$(mktemp)"
  cat > "$tmp_search" <<JSON
{
  "script": {
    "code_hash": "$lock_code_hash",
    "hash_type": "$lock_hash_type",
    "args": "$lock_args"
  },
  "script_type": "lock",
  "script_search_mode": "exact",
  "filter": {
    "script_len_range": ["0x0", "0x1"]
  },
  "with_data": false
}
JSON

  refresh_cells() {
    "$CKB_CLI_BIN" --url "$CKB_RPC_URL" rpc get_cells \
      --json-path "$tmp_search" \
      --order asc \
      --limit 64 \
      --output-format json > "$tmp_cells"
  }
  refresh_cells

  mapfile -t outpoints < <(
    jq -r '(.objects // .result.objects // [])[] | [.out_point.tx_hash, .out_point.index] | @tsv' "$tmp_cells"
  )

  if [[ "${#outpoints[@]}" -lt "$MIN_REQUIRED_CELLS" ]]; then
    local from_account to_address need
    from_account="$(jq -r '.deployment.lock.args' "$INFO_FILE")"
    to_address="$($CKB_CLI_BIN account list | awk '/testnet:/ {print $2; exit}')"
    [[ -n "$to_address" ]] || {
      echo "could not resolve local testnet address for auto-topup." >&2
      exit 1
    }

    need=$(( MIN_REQUIRED_CELLS - ${#outpoints[@]} ))
    echo "insufficient lock-only cells (${#outpoints[@]}/$MIN_REQUIRED_CELLS); auto-topup creating $need plain cells..."
    for ((n=0; n<need; n++)); do
      "$CKB_CLI_BIN" --url "$CKB_RPC_URL" wallet transfer \
        --from-account "$from_account" \
        --to-address "$to_address" \
        --capacity "$AUTO_TOPUP_CAPACITY_CKB"
    done

    local deadline
    deadline=$(( $(date +%s) + AUTO_TOPUP_MAX_WAIT_SEC ))
    while true; do
      refresh_cells
      mapfile -t outpoints < <(
        jq -r '(.objects // .result.objects // [])[] | [.out_point.tx_hash, .out_point.index] | @tsv' "$tmp_cells"
      )
      if [[ "${#outpoints[@]}" -ge "$MIN_REQUIRED_CELLS" ]]; then
        break
      fi
      if (( $(date +%s) >= deadline )); then
        echo "not enough live lock-only cells after auto-topup (need >=$MIN_REQUIRED_CELLS, got ${#outpoints[@]})." >&2
        exit 1
      fi
      sleep 5
    done
  fi

  local files=(
    "$DEPLOY_DIR/gov_bootstrap_tx.json"
    "$DEPLOY_DIR/gov_update_tx.json"
    "$DEPLOY_DIR/gov_negative_invalid_signer_set_tx.json"
    "$DEPLOY_DIR/gov_negative_invalid_root_binding_tx.json"
  )

  local i=0
  for f in "${files[@]}"; do
    local txh idx
    txh="$(awk '{print $1}' <<<"${outpoints[$i]}")"
    idx="$(awk '{print $2}' <<<"${outpoints[$i]}")"

    jq \
      --arg txh "$txh" \
      --arg idx "$idx" \
      '
      .transaction.inputs[0].previous_output.tx_hash = $txh
      | .transaction.inputs[0].previous_output.index = $idx
      | .signatures = {}
      ' "$BASE_TX_FILE" > "$f"
    i=$((i + 1))
  done

  rm -f "$tmp_search" "$tmp_cells"
  echo "Prepared tx files:"
  printf ' - %s\n' "${files[@]}"
}

main "$@"
