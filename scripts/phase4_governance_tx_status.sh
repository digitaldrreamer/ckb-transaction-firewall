#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_FILE="$ROOT_DIR/tests/integration/governance_drill/latest.json"
OUT_FILE="$ROOT_DIR/tests/integration/governance_drill/chain_status_latest.json"
CKB_CLI_BIN="${CKB_CLI_BIN:-ckb-cli}"
CKB_RPC_URL="${CKB_RPC_URL:-https://testnet.ckb.dev}"
TIMEOUT_SEC="${TIMEOUT_SEC:-120}"
POLL_SEC="${POLL_SEC:-5}"

usage() {
  cat <<'USAGE'
Query and persist chain status for governance drill tx hashes.

Usage:
  scripts/phase4_governance_tx_status.sh [--input <latest.json>] [--out <status.json>]

Env:
  CKB_CLI_BIN (default: ckb-cli)
  CKB_RPC_URL (default: https://testnet.ckb.dev)
  TIMEOUT_SEC (default: 120)
  POLL_SEC (default: 5)
USAGE
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --input)
        [[ $# -ge 2 && -n "${2:-}" && "${2:-}" != -* ]] || { echo "missing value for --input" >&2; usage; exit 1; }
        INPUT_FILE="$2"; shift 2
        ;;
      --out)
        [[ $# -ge 2 && -n "${2:-}" && "${2:-}" != -* ]] || { echo "missing value for --out" >&2; usage; exit 1; }
        OUT_FILE="$2"; shift 2
        ;;
      -h|--help) usage; exit 0 ;;
      *) echo "unknown arg: $1" >&2; usage; exit 1 ;;
    esac
  done

  require_cmd jq
  require_cmd "$CKB_CLI_BIN"
  [[ -f "$INPUT_FILE" ]] || {
    echo "input artifact not found: $INPUT_FILE" >&2
    exit 1
  }

  local now_utc
  now_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local timeout_at=$(( $(date +%s) + TIMEOUT_SEC ))

  local ids
  ids="$(jq -r '.scenarios[].id' "$INPUT_FILE")"

  local tmp
  tmp="$(mktemp)"
  jq -n \
    --arg generated_utc "$now_utc" \
    --arg rpc_url "$CKB_RPC_URL" \
    '{generated_utc:$generated_utc,rpc_url:$rpc_url,scenarios:[]}' > "$tmp"

  while IFS= read -r id; do
    [[ -n "$id" ]] || continue
    local tx_hash
    tx_hash="$(jq -r --arg id "$id" '.scenarios[] | select(.id == $id) | .tx_hash' "$INPUT_FILE")"
    [[ "$tx_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || {
      echo "invalid tx hash for scenario $id: $tx_hash" >&2
      exit 1
    }

    local status="unknown"
    local block_hash=""
    local block_number=""
    local tx_index=""
    local reason=""
    while true; do
      local tx_json
      tx_json="$($CKB_CLI_BIN --url "$CKB_RPC_URL" rpc get_transaction --hash "$tx_hash" --output-format json || true)"
      if [[ -n "$tx_json" ]]; then
        status="$(jq -r '.tx_status.status // "unknown"' <<<"$tx_json")"
        block_hash="$(jq -r '.tx_status.block_hash // ""' <<<"$tx_json")"
        block_number="$(jq -r '.tx_status.block_number // ""' <<<"$tx_json")"
        tx_index="$(jq -r '.tx_status.tx_index // ""' <<<"$tx_json")"
        reason="$(jq -r '.tx_status.reason // ""' <<<"$tx_json")"
      fi

      # * Wait for a terminal chain-visible status (matches phase4_governance_evidence_check.sh expectations).
      if [[ "$status" == "committed" || "$status" == "rejected" ]]; then
        break
      fi
      if (( $(date +%s) >= timeout_at )); then
        break
      fi
      sleep "$POLL_SEC"
    done

    jq \
      --arg id "$id" \
      --arg tx_hash "$tx_hash" \
      --arg status "$status" \
      --arg block_hash "$block_hash" \
      --arg block_number "$block_number" \
      --arg tx_index "$tx_index" \
      --arg reason "$reason" \
      '.scenarios += [{id:$id,tx_hash:$tx_hash,tx_status:{status:$status,block_hash:$block_hash,block_number:$block_number,tx_index:$tx_index,reason:$reason}}]' \
      "$tmp" > "${tmp}.next"
    mv "${tmp}.next" "$tmp"
  done <<< "$ids"

  mv "$tmp" "$OUT_FILE"
  echo "wrote chain status artifact: $OUT_FILE"
}

main "$@"
