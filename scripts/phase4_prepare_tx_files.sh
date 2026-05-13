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
AUTO_TOPUP_MAX_WAIT_SEC="${AUTO_TOPUP_MAX_WAIT_SEC:-360}"
GET_CELLS_LIMIT="${GET_CELLS_LIMIT:-512}"
MAX_AUTO_TOPUP_ROUNDS="${MAX_AUTO_TOPUP_ROUNDS:-12}"
FEE_SHANNONS="${FEE_SHANNONS:-120000}"
MIN_CHANGE_SHANNONS="${MIN_CHANGE_SHANNONS:-6100000000}"
TOPUP_FEE_RATE="${TOPUP_FEE_RATE:-5000}"
TOPUP_TX_COMMIT_WAIT_SEC="${TOPUP_TX_COMMIT_WAIT_SEC:-300}"

usage() {
  cat <<'USAGE'
Prepare governance tx files for phase4 auto execution.

Usage:
  scripts/phase4_prepare_tx_files.sh

Env:
  CKB_CLI_BIN              default: ckb-cli
  CKB_RPC_URL              default: https://testnet.ckb.dev
  INFO_FILE                default: deploy/info.json
  MIN_REQUIRED_CELLS       default: 4 (set to 2 only if you already have two large enough inputs)
  FROM_ACCOUNT / TOPUP_FROM_ACCOUNT
                           ckt1 address (or lock-arg accepted by your ckb-cli) for wallet transfer auto-topup when
                           lock-only cells are low. If unset, uses the first "testnet:" row from `ckb-cli account list`.
  TOPUP_TO_ADDRESS         default: same as the resolved from-account (self-transfer to split UTXOs).
  TOPUP_PRIVKEY_PATH       optional; passed as `wallet transfer --privkey-path` for non-interactive runs (avoids keystore password prompts).
  SKIP_AUTO_TOPUP          if set to 1, exit with a message instead of running wallet transfer (use when you will fund/split cells manually).
  TOPUP_FEE_RATE           shannons/KB for top-up transfers (default: 5000). Raise if the node returns PoolRejectedRBF.
  TOPUP_TX_COMMIT_WAIT_SEC max seconds to wait for each top-up tx to become `committed` before sending the next (default: 300).
  TOPUP_DEBUG              set to 1 to pass `--debug` on `wallet transfer` for RPC tracing.
  TOPUP_SKIP_CHECK_TO_ADDRESS
                           set to 1 to pass `wallet transfer --skip-check-to-address` (only when you understand the risk).
  GET_CELLS_LIMIT          `rpc get_cells --limit` (default: 512).
  MAX_AUTO_TOPUP_ROUNDS    max wallet-transfer rounds while cells stay below MIN_REQUIRED_CELLS (default: 12); re-counts after each commit.
  AUTO_TOPUP_MAX_WAIT_SEC  seconds to poll the indexer after top-up (default: 360).

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

capacity_to_shannons() {
  python3 -c 'import sys
x = sys.argv[1].strip()
if not x:
    print(0)
elif x.lower().startswith("0x"):
    print(int(x, 16))
elif "." in x:
    print(int(float(x) * 100_000_000))
else:
    print(int(x))' "$1"
}

append_topup_matching_outputs_tsv() {
  local tx_hash="$1" lch="$2" ht="$3" la="$4" min_sh="$5"
  [[ "$tx_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || return 0
  local tx_json
  tx_json="$("$CKB_CLI_BIN" --url "$CKB_RPC_URL" rpc get_transaction --hash "$tx_hash" --output-format json 2>/dev/null)" || return 0
  [[ -n "$tx_json" ]] || return 0
  local tx_parse_tmp py_st
  tx_parse_tmp="$(mktemp)"
  printf '%s' "$tx_json" > "$tx_parse_tmp"
  # * Do not pipe JSON into `python3 - <<'PY'`: the heredoc replaces stdin, so json.load(sys.stdin) would read the script, not the RPC body.
  set +e
  python3 - "$tx_hash" "$lch" "$ht" "$la" "$min_sh" "$tx_parse_tmp" <<'PY'
import json
import re
import sys

txh, lch, ht, la, min_sh_s, path = sys.argv[1:7]
min_sh = int(min_sh_s)
with open(path, encoding="utf-8") as f:
    raw = json.load(f)
tx = raw.get("transaction")
if tx is None:
    r = raw.get("result")
    if isinstance(r, dict):
        tx = r.get("transaction")
if not isinstance(tx, dict):
    sys.exit(0)
outs = tx.get("outputs") or []


def norm_hex_field(s):
    if s is None:
        return ""
    if not isinstance(s, str):
        s = str(s)
    s = s.strip()
    m = re.match(r"(0x[0-9a-fA-F]+)", s, re.I)
    return m.group(1).lower() if m else s.split("(")[0].strip().lower()


def norm_hash_type(s):
    if s is None:
        return ""
    s = str(s).strip()
    return s.split("(")[0].split()[0].strip().lower()


def capacity_shannons(c):
    if isinstance(c, int):
        return c
    if isinstance(c, str):
        s = c.strip()
        if s.lower().startswith("0x"):
            return int(s, 16)
        if "." in s:
            return int(float(s) * 100_000_000)
        return int(s)
    return 0


lch_n = norm_hex_field(lch)
ht_n = norm_hash_type(ht)
la_n = norm_hex_field(la)

for i, o in enumerate(outs):
    lk = o.get("lock") or {}
    if norm_hex_field(lk.get("code_hash")) != lch_n:
        continue
    if norm_hash_type(lk.get("hash_type")) != ht_n:
        continue
    if norm_hex_field(lk.get("args")) != la_n:
        continue
    if o.get("type") is not None:
        continue
    cap_raw = o.get("capacity")
    if cap_raw is None:
        continue
    try:
        capv = capacity_shannons(cap_raw)
    except (TypeError, ValueError):
        continue
    if capv < min_sh:
        continue
    cap_field = cap_raw if isinstance(cap_raw, str) else hex(cap_raw)
    print(f"{txh}\t0x{i:x}\t{cap_field}")
PY
  py_st=$?
  set -e
  rm -f "$tx_parse_tmp"
  return "$py_st"
}

collect_outpoints_merged() {
  local tmp_cells_f="$1" tmp_merge_f="$2" tmp_search_f="$3"
  local min_sh="$4" lch="$5" ht="$6" la="$7"
  shift 7
  "$CKB_CLI_BIN" --url "$CKB_RPC_URL" rpc get_cells \
    --json-path "$tmp_search_f" \
    --order asc \
    --limit "${GET_CELLS_LIMIT}" \
    --output-format json > "$tmp_cells_f"
  jq -r '
    (.objects // .result.objects // [])
    | .[]
    | [.out_point.tx_hash, .out_point.index, .output.capacity]
    | @tsv
  ' "$tmp_cells_f" > "$tmp_merge_f"
  local h
  for h in "$@"; do
    append_topup_matching_outputs_tsv "$h" "$lch" "$ht" "$la" "$min_sh" >> "$tmp_merge_f" || true
  done
  sort -u "$tmp_merge_f" -o "$tmp_merge_f"
  mapfile -t outpoints < "$tmp_merge_f"
}

wait_topup_tx_committed() {
  local h="$1"
  if [[ ! "$h" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    return 0
  fi
  local deadline=$(( $(date +%s) + TOPUP_TX_COMMIT_WAIT_SEC ))
  echo "waiting for top-up tx ${h} to commit (max ${TOPUP_TX_COMMIT_WAIT_SEC}s)..." >&2
  while (( $(date +%s) < deadline )); do
    local st
    st="$("$CKB_CLI_BIN" --url "$CKB_RPC_URL" rpc get_transaction --hash "$h" --output-format json 2>/dev/null | jq -r '.tx_status.status // .result.tx_status.status // empty')" || true
    if [[ "$st" == "committed" ]]; then
      echo "top-up tx committed: $h" >&2
      return 0
    fi
    if [[ "$st" == "rejected" ]]; then
      echo "top-up tx rejected on-chain: $h" >&2
      return 1
    fi
    sleep 3
  done
  echo "error: timed out waiting for ${h} to commit (needed so the next top-up does not hit PoolRejectedRBF)." >&2
  return 1
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
  require_cmd python3
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

  local primary_output_capacity primary_output_ckb required_min_ckb required_min_shannons cap_min_hex
  primary_output_capacity="$(jq -r '.transaction.outputs[0].capacity' "$BASE_TX_TEMPLATE_FILE")"
  [[ "$primary_output_capacity" =~ ^0x[0-9a-fA-F]+$ ]] || {
    echo "invalid primary output capacity in template: $primary_output_capacity" >&2
    exit 1
  }
  required_min_shannons="$(( $(printf '%d' "$primary_output_capacity") + MIN_CHANGE_SHANNONS + FEE_SHANNONS ))"
  primary_output_ckb="$(awk "BEGIN { printf \"%.8f\", $(printf '%d' "$primary_output_capacity") / 100000000 }")"
  required_min_ckb="$(awk "BEGIN { printf \"%.8f\", $required_min_shannons / 100000000 }")"
  cap_min_hex="$(printf '0x%x' "$required_min_shannons")"

  local tmp_search tmp_cells tmp_merge
  tmp_search="$(mktemp)"
  tmp_cells="$(mktemp)"
  tmp_merge="$(mktemp)"
  local -a outpoints=()
  local -a topup_committed_hashes=()
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
    "script_len_range": ["0x0", "0x1"],
    "output_capacity_range": ["${cap_min_hex}", "0xffffffffffffffff"]
  },
  "with_data": false
}
JSON

  collect_outpoints_merged "$tmp_cells" "$tmp_merge" "$tmp_search" "$required_min_shannons" "$lock_code_hash" "$lock_hash_type" "$lock_args" "${topup_committed_hashes[@]}"

  if [[ "${#outpoints[@]}" -lt "$MIN_REQUIRED_CELLS" ]]; then
    local from_account to_address need
    from_account="${TOPUP_FROM_ACCOUNT:-${FROM_ACCOUNT:-}}"
    if [[ -z "$from_account" ]]; then
      from_account="$("$CKB_CLI_BIN" account list | awk '/testnet:/ {print $2; exit}')"
    fi
    [[ -n "$from_account" ]] || {
      echo "could not resolve FROM_ACCOUNT / TOPUP_FROM_ACCOUNT for auto-topup; set one of them or add a testnet account (ckb-cli account import)." >&2
      exit 1
    }
    to_address="${TOPUP_TO_ADDRESS:-$from_account}"
    [[ -n "$to_address" ]] || {
      echo "could not resolve TOPUP_TO_ADDRESS / from-account for auto-topup." >&2
      exit 1
    }

    if [[ "${SKIP_AUTO_TOPUP:-0}" == "1" ]]; then
      echo "SKIP_AUTO_TOPUP=1: not sending funds. You need >=${MIN_REQUIRED_CELLS} live cells matching deployment.lock in ${INFO_FILE}" >&2
      echo "with capacity >= ${required_min_ckb} CKB each (script_len_range empty type). Split or fund, then re-run without SKIP_AUTO_TOPUP." >&2
      exit 1
    fi

    local min_ckb auto_topup_ckb max_topup_rounds round
    min_ckb="$(awk "BEGIN { printf \"%.8f\", $required_min_shannons / 100000000 }")"
    auto_topup_ckb="$AUTO_TOPUP_CAPACITY_CKB"
    awk "BEGIN { exit !($auto_topup_ckb < $min_ckb) }" && auto_topup_ckb="$min_ckb"
    max_topup_rounds="${MAX_AUTO_TOPUP_ROUNDS:-12}"
    echo "insufficient lock-only cells (${#outpoints[@]}/$MIN_REQUIRED_CELLS); auto-topup (up to ${max_topup_rounds} round(s), ${auto_topup_ckb} CKB per send)..." >&2
    echo "If your keystore is encrypted, respond to ckb-cli prompts below (stdin/stdout are connected to this TTY via /dev/tty and tee)." >&2
    local priv_opt=()
    if [[ -n "${TOPUP_PRIVKEY_PATH:-}" ]]; then
      [[ -f "${TOPUP_PRIVKEY_PATH}" ]] || {
        echo "TOPUP_PRIVKEY_PATH is set but not a file: ${TOPUP_PRIVKEY_PATH}" >&2
        exit 1
      }
      priv_opt=(--privkey-path "${TOPUP_PRIVKEY_PATH}")
    fi
    local topup_dbg=()
    if [[ "${TOPUP_DEBUG:-0}" == "1" ]]; then
      topup_dbg=(--debug)
    fi
    local topup_skip_addr=()
    if [[ "${TOPUP_SKIP_CHECK_TO_ADDRESS:-0}" == "1" ]]; then
      topup_skip_addr=(--skip-check-to-address)
    fi
    round=0
    while [[ "${#outpoints[@]}" -lt "$MIN_REQUIRED_CELLS" ]]; do
      round=$((round + 1))
      if (( round > max_topup_rounds )); then
        echo "auto-topup: reached MAX_AUTO_TOPUP_ROUNDS (${max_topup_rounds}), still ${#outpoints[@]}/${MIN_REQUIRED_CELLS} qualifying cells." >&2
        break
      fi
      echo "top-up round ${round}/${max_topup_rounds} (${#outpoints[@]}/${MIN_REQUIRED_CELLS} cells): ${from_account} -> ${to_address} (${auto_topup_ckb} CKB, fee-rate ${TOPUP_FEE_RATE})..." >&2
      local json_tmp
      json_tmp="$(mktemp)"
      # * ckb-cli may print password / confirmation on stdout; do not redirect stdout only to a file or prompts are swallowed.
      # * stdin from /dev/tty so the process can read answers; tee copies the combined stream to json_tmp and back to the tty.
      "$CKB_CLI_BIN" --url "$CKB_RPC_URL" wallet transfer \
        --from-account "$from_account" \
        --to-address "$to_address" \
        --capacity "$auto_topup_ckb" \
        --fee-rate "${TOPUP_FEE_RATE}" \
        "${priv_opt[@]}" \
        "${topup_dbg[@]}" \
        "${topup_skip_addr[@]}" \
        --output-format json \
        </dev/tty 2>&1 | tee "$json_tmp" >/dev/tty
      if [[ "${PIPESTATUS[0]:-1}" -ne 0 ]]; then
        echo "wallet transfer failed (round ${round}/${max_topup_rounds}). If you saw PoolRejectedRBF, re-run after the previous top-up commits or set TOPUP_FEE_RATE higher (e.g. 10000)." >&2
        if [[ -f "$json_tmp" ]] && grep -qiE 'check password failed|password failed|wrong password' "$json_tmp" 2>/dev/null; then
          echo "ckb-cli rejected the keystore password (or could not read it). Re-type carefully, check Caps Lock / keyboard layout, confirm this account is in \`ckb-cli account list\`, or set TOPUP_PRIVKEY_PATH to a key file and re-run." >&2
        fi
        rm -f "$json_tmp"
        exit 1
      fi
      local json_out
      json_out="$(cat "$json_tmp")"
      rm -f "$json_tmp"
      local sent_hash
      sent_hash=""
      if jq -e . >/dev/null 2>&1 <<<"$json_out"; then
        sent_hash="$(jq -r '.hash // .transaction.hash // empty' <<<"$json_out" 2>/dev/null | head -1 || true)"
      fi
      if [[ ! "$sent_hash" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
        sent_hash="$(grep -Eo '0x[a-fA-F0-9]{64}' <<<"$json_out" | tail -1 || true)"
      fi
      if [[ "$sent_hash" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
        if ! wait_topup_tx_committed "$sent_hash"; then
          exit 1
        fi
        topup_committed_hashes+=("$sent_hash")
        collect_outpoints_merged "$tmp_cells" "$tmp_merge" "$tmp_search" "$required_min_shannons" "$lock_code_hash" "$lock_hash_type" "$lock_args" "${topup_committed_hashes[@]}"
        if [[ "${#outpoints[@]}" -ge "$MIN_REQUIRED_CELLS" ]]; then
          echo "lock-only cell inventory ok after top-up(s): ${#outpoints[@]} cells (need ${MIN_REQUIRED_CELLS})." >&2
          break
        fi
      else
        echo "warning: could not parse tx hash from wallet transfer JSON; sleeping 60s before next top-up round." >&2
        sleep 60
      fi
    done

    if [[ "${#outpoints[@]}" -lt "$MIN_REQUIRED_CELLS" ]]; then
      local deadline
      deadline=$(( $(date +%s) + AUTO_TOPUP_MAX_WAIT_SEC ))
      local poll_round=0
      while true; do
        collect_outpoints_merged "$tmp_cells" "$tmp_merge" "$tmp_search" "$required_min_shannons" "$lock_code_hash" "$lock_hash_type" "$lock_args" "${topup_committed_hashes[@]}"
        if [[ "${#outpoints[@]}" -ge "$MIN_REQUIRED_CELLS" ]]; then
          echo "lock-only cell inventory ok: ${#outpoints[@]} cells (need ${MIN_REQUIRED_CELLS})." >&2
          break
        fi
        if (( $(date +%s) >= deadline )); then
          echo "not enough live lock-only cells after auto-topup (need >=$MIN_REQUIRED_CELLS, got ${#outpoints[@]})." >&2
          echo "hint: each top-up must net at least one cell with capacity >= ${required_min_ckb} CKB and no type script; if the wallet spent a large input and change is small, raise MAX_AUTO_TOPUP_ROUNDS or split manually." >&2
          exit 1
        fi
        poll_round=$((poll_round + 1))
        if (( poll_round % 6 == 1 )); then
          echo "waiting for indexer/RPC to see ${MIN_REQUIRED_CELLS} lock-only cells (have ${#outpoints[@]}), ${AUTO_TOPUP_MAX_WAIT_SEC}s max..." >&2
        fi
        sleep 5
      done
    fi
  fi

  local files=(
    "$DEPLOY_DIR/gov_bootstrap_tx.json"
    "$DEPLOY_DIR/gov_update_tx.json"
    "$DEPLOY_DIR/gov_negative_invalid_signer_set_tx.json"
    "$DEPLOY_DIR/gov_negative_invalid_root_binding_tx.json"
  )
  if (( ${#outpoints[@]} < ${#files[@]} )); then
    echo "not enough qualifying outpoints to prepare tx files: need ${#files[@]}, got ${#outpoints[@]}." >&2
    echo "fund or split more lock-only cells, or set MIN_REQUIRED_CELLS to at least ${#files[@]}." >&2
    exit 1
  fi

  local i=0
  for f in "${files[@]}"; do
    local txh idx idx_hex input_capacity_raw input_capacity_shannons change_capacity change_capacity_hex
    txh="$(awk '{print $1}' <<<"${outpoints[$i]}")"
    idx="$(awk '{print $2}' <<<"${outpoints[$i]}")"
    input_capacity_raw="$(awk '{print $3}' <<<"${outpoints[$i]}")"
    input_capacity_shannons="$(capacity_to_shannons "$input_capacity_raw")"
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

  rm -f "$tmp_search" "$tmp_cells" "$tmp_merge"
  echo "Prepared tx files:"
  printf ' - %s\n' "${files[@]}"
}

main "$@"
