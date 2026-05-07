#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"
BASE_TX_FILE="$DEPLOY_DIR/gov_bootstrap_tx.json"
BASE_TX_TEMPLATE_FILE="$ROOT_DIR/tests/integration/governance_drill/gov_bootstrap_tx.template.json"
CKB_CLI_BIN="${CKB_CLI_BIN:-ckb-cli}"
CKB_RPC_URL="${CKB_RPC_URL:-https://testnet.ckb.dev}"
INFO_FILE="${INFO_FILE:-$DEPLOY_DIR/info.json}"
MIN_REQUIRED_CELLS="${MIN_REQUIRED_CELLS:-4}"
AUTO_TOPUP_CAPACITY_CKB="${AUTO_TOPUP_CAPACITY_CKB:-40000}"
AUTO_TOPUP_MAX_WAIT_SEC="${AUTO_TOPUP_MAX_WAIT_SEC:-180}"
FEE_SHANNONS="${FEE_SHANNONS:-120000}"
MIN_CHANGE_SHANNONS="${MIN_CHANGE_SHANNONS:-6100000000}"

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

rewrite_gov1_roots() {
  local tx_file="$1"
  local old_root_hex="$2"

  python3 - "$tx_file" "$old_root_hex" <<'PY'
import json
import hashlib
import sys

tx_file = sys.argv[1]
old_root = sys.argv[2].lower()
if not old_root.startswith("0x") or len(old_root) != 66:
    raise SystemExit(f"invalid old_root hex: {old_root}")

with open(tx_file, "r", encoding="utf-8") as f:
    data = json.load(f)

tx = data["transaction"]
if not tx.get("witnesses"):
    raise SystemExit("missing transaction.witnesses")
w0 = bytes.fromhex(tx["witnesses"][0][2:])
if len(w0) < 16:
    raise SystemExit("invalid witness layout")

off_lock = int.from_bytes(w0[4:8], "little")
off_input_type = int.from_bytes(w0[8:12], "little")
off_output_type = int.from_bytes(w0[12:16], "little")
if not (off_lock <= off_input_type <= off_output_type <= len(w0)):
    raise SystemExit("invalid witness offsets")

input_type_field = w0[off_input_type:off_output_type]
if len(input_type_field) < 4:
    raise SystemExit("input_type field missing")
gov_len = int.from_bytes(input_type_field[:4], "little")
if len(input_type_field) != 4 + gov_len:
    raise SystemExit("malformed input_type bytes payload")
gov = bytearray(input_type_field[4:])
if len(gov) < 133:
    raise SystemExit("gov payload too short")
if gov[0:4] != b"GOV1":
    raise SystemExit("gov payload magic mismatch")

out0 = bytes.fromhex(tx["outputs_data"][0][2:])
new_root = hashlib.blake2b(out0, digest_size=32, person=b"ckb-default-hash").digest()
old_root_bytes = bytes.fromhex(old_root[2:])
gov[69:101] = old_root_bytes
gov[101:133] = new_root

new_input_type = len(gov).to_bytes(4, "little") + bytes(gov)
patched = bytearray(w0)
patched[off_input_type:off_output_type] = new_input_type
tx["witnesses"][0] = "0x" + patched.hex()

with open(tx_file, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  require_cmd jq
  require_cmd "$CKB_CLI_BIN"
  [[ -f "$BASE_TX_TEMPLATE_FILE" ]] || {
    echo "missing base tx template file: $BASE_TX_TEMPLATE_FILE" >&2
    exit 1
  }
  [[ -f "$INFO_FILE" ]] || {
    echo "missing deploy info file: $INFO_FILE" >&2
    exit 1
  }

  if [[ ! -f "$BASE_TX_FILE" ]] || ! jq -e '.transaction and .transaction.inputs and .transaction.outputs and .transaction.witnesses' "$BASE_TX_FILE" >/dev/null 2>&1; then
    cp "$BASE_TX_TEMPLATE_FILE" "$BASE_TX_FILE"
    echo "recovered base tx file from template: $BASE_TX_FILE"
  fi

  local lock_code_hash lock_hash_type lock_args
  lock_code_hash="$(jq -r '.deployment.lock.code_hash' "$INFO_FILE")"
  lock_hash_type="$(jq -r '.deployment.lock.hash_type' "$INFO_FILE")"
  lock_args="$(jq -r '.deployment.lock.args' "$INFO_FILE")"

  [[ "$lock_code_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "invalid deployment.lock.code_hash" >&2; exit 1; }
  [[ "$lock_args" =~ ^0x[0-9a-fA-F]*$ ]] || { echo "invalid deployment.lock.args" >&2; exit 1; }

  local reg_tx_hash reg_index reg_type_id
  reg_tx_hash="$(jq -r '.new_recipe.cell_recipes[] | select(.name=="blacklist_registry") | .tx_hash' "$INFO_FILE" | head -1)"
  reg_index="$(jq -r '.new_recipe.cell_recipes[] | select(.name=="blacklist_registry") | .index' "$INFO_FILE" | head -1)"
  reg_type_id="$(jq -r '.new_recipe.cell_recipes[] | select(.name=="blacklist_registry") | .type_id' "$INFO_FILE" | head -1)"
  [[ "$reg_tx_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "invalid blacklist_registry tx_hash in info.json" >&2; exit 1; }
  [[ "$reg_type_id" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "invalid blacklist_registry type_id in info.json" >&2; exit 1; }
  local reg_index_hex
  if [[ "$reg_index" =~ ^0x[0-9a-fA-F]+$ ]]; then
    reg_index_hex="$reg_index"
  else
    reg_index_hex="$(printf '0x%x' "$reg_index")"
  fi

  local lock_hash_type_byte
  case "$lock_hash_type" in
    data) lock_hash_type_byte="00" ;;
    type) lock_hash_type_byte="01" ;;
    data1) lock_hash_type_byte="02" ;;
    *) echo "unsupported lock hash_type in info.json: $lock_hash_type" >&2; exit 1 ;;
  esac
  local lock_args_hex lock_args_len lock_args_len_le type_args
  lock_args_hex="${lock_args#0x}"
  lock_args_len=$(( ${#lock_args_hex} / 2 ))
  lock_args_len_le="$(printf '%02x%02x' $((lock_args_len & 0xff)) $(((lock_args_len >> 8) & 0xff)))"
  type_args="0x01${lock_code_hash#0x}${lock_hash_type_byte}${lock_args_len_le}${lock_args_hex}"

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

  local primary_output_capacity primary_output_ckb required_min_ckb
  primary_output_capacity="$(jq -r '.transaction.outputs[0].capacity' "$BASE_TX_TEMPLATE_FILE")"
  [[ "$primary_output_capacity" =~ ^0x[0-9a-fA-F]+$ ]] || {
    echo "invalid primary output capacity in template: $primary_output_capacity" >&2
    exit 1
  }
  local required_min_shannons
  required_min_shannons="$(( $(printf '%d' "$primary_output_capacity") + MIN_CHANGE_SHANNONS + FEE_SHANNONS ))"
  primary_output_ckb="$(awk "BEGIN { printf \"%.8f\", $(printf '%d' "$primary_output_capacity") / 100000000 }")"
  required_min_ckb="$(awk "BEGIN { printf \"%.8f\", $required_min_shannons / 100000000 }")"

  mapfile -t outpoints < <(
    jq -r --arg min "$required_min_ckb" '
      (.objects // .result.objects // [])
      | map(select((.output.capacity | tonumber) >= ($min | tonumber)))
      | .[]
      | [.out_point.tx_hash, .out_point.index, .output.capacity]
      | @tsv
    ' "$tmp_cells"
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
    local min_ckb auto_topup_ckb
    min_ckb="$(awk "BEGIN { printf \"%.8f\", $required_min_shannons / 100000000 }")"
    auto_topup_ckb="$AUTO_TOPUP_CAPACITY_CKB"
    awk "BEGIN { exit !($auto_topup_ckb < $min_ckb) }" && auto_topup_ckb="$min_ckb"
    echo "insufficient lock-only cells (${#outpoints[@]}/$MIN_REQUIRED_CELLS); auto-topup creating $need plain cells (capacity=${auto_topup_ckb} CKB)..."
    for ((n=0; n<need; n++)); do
      transfer_out="$("$CKB_CLI_BIN" --url "$CKB_RPC_URL" wallet transfer \
        --from-account "$from_account" \
        --to-address "$to_address" \
        --capacity "$auto_topup_ckb" 2>&1)" || {
          if grep -qi 'PoolRejectedDuplicatedTransaction' <<<"$transfer_out"; then
            echo "topup transfer already in pool, continuing..."
          else
            echo "$transfer_out" >&2
            exit 1
          fi
        }
    done

    local deadline
    deadline=$(( $(date +%s) + AUTO_TOPUP_MAX_WAIT_SEC ))
    while true; do
      refresh_cells
      mapfile -t outpoints < <(
        jq -r --arg min "$required_min_ckb" '
          (.objects // .result.objects // [])
          | map(select((.output.capacity | tonumber) >= ($min | tonumber)))
          | .[]
          | [.out_point.tx_hash, .out_point.index, .output.capacity]
          | @tsv
        ' "$tmp_cells"
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
    local txh idx idx_hex input_capacity_ckb input_capacity_shannons change_capacity change_capacity_hex
    txh="$(awk '{print $1}' <<<"${outpoints[$i]}")"
    idx="$(awk '{print $2}' <<<"${outpoints[$i]}")"
    input_capacity_ckb="$(awk '{print $3}' <<<"${outpoints[$i]}")"
    input_capacity_shannons="$(awk "BEGIN { printf \"%.0f\", $input_capacity_ckb * 100000000 }")"
    if [[ "$idx" =~ ^0x[0-9a-fA-F]+$ ]]; then
      idx_hex="$idx"
    elif [[ "$idx" =~ ^[0-9]+$ ]]; then
      idx_hex="$(printf '0x%x' "$idx")"
    else
      echo "unsupported outpoint index format: $idx" >&2
      exit 1
    fi
    change_capacity="$(( input_capacity_shannons - $(printf '%d' "$primary_output_capacity") - FEE_SHANNONS ))"
    if (( change_capacity < MIN_CHANGE_SHANNONS )); then
      echo "insufficient change capacity for selected input: $txh:$idx_hex" >&2
      exit 1
    fi
    change_capacity_hex="$(printf '0x%x' "$change_capacity")"

    local out_tmp
    out_tmp="$(mktemp)"
    jq \
      --arg txh "$txh" \
      --arg idx "$idx_hex" \
      --arg change_capacity "$change_capacity_hex" \
      --arg reg_tx_hash "$reg_tx_hash" \
      --arg reg_index "$reg_index_hex" \
      --arg reg_type_id "$reg_type_id" \
      --arg lock_code_hash "$lock_code_hash" \
      --arg lock_hash_type "$lock_hash_type" \
      --arg lock_args "$lock_args" \
      --arg type_args "$type_args" \
      '
      .transaction.inputs[0].previous_output.tx_hash = $txh
      | .transaction.inputs[0].previous_output.index = $idx
      | .transaction.cell_deps[1].out_point.tx_hash = $reg_tx_hash
      | .transaction.cell_deps[1].out_point.index = $reg_index
      | .transaction.outputs[0].lock.code_hash = $lock_code_hash
      | .transaction.outputs[0].lock.hash_type = $lock_hash_type
      | .transaction.outputs[0].lock.args = $lock_args
      | .transaction.outputs[0].type.code_hash = $reg_type_id
      | .transaction.outputs[0].type.args = $type_args
      | .transaction.outputs[1].lock.code_hash = $lock_code_hash
      | .transaction.outputs[1].lock.hash_type = $lock_hash_type
      | .transaction.outputs[1].lock.args = $lock_args
      | .transaction.outputs[1].capacity = $change_capacity
      | .signatures = {}
      ' "$BASE_TX_TEMPLATE_FILE" > "$out_tmp"
    jq -e '.transaction and .transaction.inputs and .transaction.outputs and .transaction.witnesses' "$out_tmp" >/dev/null
    mv "$out_tmp" "$f"
    rewrite_gov1_roots "$f" "0x0000000000000000000000000000000000000000000000000000000000000000"
    i=$((i + 1))
  done

  rm -f "$tmp_search" "$tmp_cells"
  echo "Prepared tx files:"
  printf ' - %s\n' "${files[@]}"
}

main "$@"
