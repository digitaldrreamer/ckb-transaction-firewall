#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPDATE_BIN="node $ROOT_DIR/scripts/update-blacklist.ts"
CHECK_BIN="$ROOT_DIR/scripts/phase3_governance_drill_check.sh"
PREFLIGHT_BIN="$ROOT_DIR/scripts/phase3_governance_lock_preflight.sh"
PREFLIGHT_INFO_FILE="${PREFLIGHT_INFO_FILE:-$ROOT_DIR/deploy/info.json}"
LATEST_FILE="$ROOT_DIR/tests/integration/governance_drill/latest.json"
STATE_FILE="$ROOT_DIR/tests/integration/governance_drill/mode2_signer_state.json"

usage() {
  cat <<'USAGE'
Strict Mode-2 governance helper (separated signer model).

Usage:
  scripts/phase3_governance_mode2.sh init
  scripts/phase3_governance_mode2.sh run --id <scenario_id> --cmd "<tx command>" --signers "0,1,2"
  scripts/phase3_governance_mode2.sh validate

Scenario IDs:
  bootstrap_0_to_1
  update_1_to_1
  negative_invalid_signer_set
  negative_invalid_root_binding

Rules enforced:
  - bootstrap_0_to_1 requires exactly 5 unique signer indices: 0,1,2,3,4
  - update_1_to_1 requires >=3 unique signer indices in [0..4]
  - negative_invalid_* scenarios require at least one declared signer index
  - signer indices must be integers 0..4

Notes:
  - This helper does not construct raw governance transactions. Use your validated tx command.
  - It records separation evidence (signer indices) in mode2_signer_state.json.
USAGE
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

normalize_signers() {
  local input="$1"
  echo "$input" | tr ',' '\n' | sed '/^$/d' | sed 's/^ *//;s/ *$//' | sort -n | uniq | paste -sd, -
}

validate_signers() {
  local id="$1"
  local signers_csv="$2"
  local count=0
  IFS=',' read -r -a arr <<< "$signers_csv"

  for s in "${arr[@]}"; do
    [[ "$s" =~ ^[0-4]$ ]] || {
      echo "invalid signer index: $s (allowed 0..4)" >&2
      exit 1
    }
    count=$((count + 1))
  done

  case "$id" in
    bootstrap_0_to_1)
      [[ "$signers_csv" == "0,1,2,3,4" ]] || {
        echo "bootstrap_0_to_1 requires signers exactly: 0,1,2,3,4" >&2
        exit 1
      }
      ;;
    update_1_to_1)
      (( count >= 3 )) || {
        echo "update_1_to_1 requires at least 3 unique signers" >&2
        exit 1
      }
      ;;
    negative_invalid_signer_set|negative_invalid_root_binding)
      (( count >= 1 )) || {
        echo "$id requires at least one declared signer" >&2
        exit 1
      }
      ;;
    *)
      echo "unknown scenario id: $id" >&2
      exit 1
      ;;
  esac
}

write_state() {
  local id="$1"
  local signers_csv="$2"
  local tx_hash="$3"
  local when_utc
  when_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  node <<NODE
const fs = require('node:fs');
const path = '$STATE_FILE';
const id = '$id';
const signers = '$signers_csv'.split(',').filter(Boolean).map((x) => Number(x));
const txHash = '$tx_hash';
const whenUtc = '$when_utc';
let data = { generated_utc: whenUtc, model: 'mode2-separated-signers', scenarios: {} };
if (fs.existsSync(path)) {
  data = JSON.parse(fs.readFileSync(path, 'utf8'));
}
data.generated_utc = whenUtc;
data.model = 'mode2-separated-signers';
if (!data.scenarios || typeof data.scenarios !== 'object') data.scenarios = {};
data.scenarios[id] = { signers, tx_hash: txHash, updated_utc: whenUtc };
fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
NODE
}

extract_tx_hash() {
  local id="$1"
  node -e "const fs=require('node:fs'); const j=JSON.parse(fs.readFileSync('$LATEST_FILE','utf8')); const s=(j.scenarios||[]).find(x=>x.id==='${id}'); if(!s||!/^0x[0-9a-fA-F]{64}$/.test(s.tx_hash||'')){process.exit(2);} process.stdout.write(s.tx_hash);"
}

validate_state() {
  [[ -f "$STATE_FILE" ]] || {
    echo "missing state file: $STATE_FILE" >&2
    exit 1
  }

  node <<NODE
const fs = require('node:fs');
const drill = JSON.parse(fs.readFileSync('$LATEST_FILE', 'utf8'));
const state = JSON.parse(fs.readFileSync('$STATE_FILE', 'utf8'));

const required = ['bootstrap_0_to_1','update_1_to_1','negative_invalid_signer_set','negative_invalid_root_binding'];
for (const id of required) {
  if (!state.scenarios || !state.scenarios[id]) {
    throw new Error('missing mode2 signer record for ' + id);
  }
  const tx = (drill.scenarios || []).find((x) => x.id === id);
  if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(tx.tx_hash || '')) {
    throw new Error('missing tx_hash in latest.json for ' + id);
  }
}
const b = state.scenarios.bootstrap_0_to_1.signers || [];
if (b.join(',') !== '0,1,2,3,4') {
  throw new Error('bootstrap signer set must be exactly 0,1,2,3,4');
}
const u = state.scenarios.update_1_to_1.signers || [];
if (u.length < 3) {
  throw new Error('update_1_to_1 must include at least 3 signers');
}
console.log('mode2 signer state validation passed.');
NODE
}

main() {
  require_cmd node
  [[ -x "$PREFLIGHT_BIN" ]] || {
    echo "missing preflight script: $PREFLIGHT_BIN" >&2
    exit 1
  }
  local cmd="${1:-}"
  case "$cmd" in
    init)
      "$PREFLIGHT_BIN"
      $UPDATE_BIN init
      rm -f "$STATE_FILE"
      echo "initialized strict mode-2 artifacts"
      ;;
    run)
      shift
      local id=""
      local tx_cmd=""
      local signers=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --id) id="$2"; shift 2 ;;
          --cmd) tx_cmd="$2"; shift 2 ;;
          --signers) signers="$2"; shift 2 ;;
          *) echo "unknown arg: $1" >&2; exit 1 ;;
        esac
      done

      [[ -n "$id" && -n "$tx_cmd" && -n "$signers" ]] || {
        echo "run requires --id, --cmd, and --signers" >&2
        exit 1
      }

      local normalized
      normalized="$(normalize_signers "$signers")"
      validate_signers "$id" "$normalized"

      $UPDATE_BIN run --id "$id" --cmd "$tx_cmd"
      local tx_hash
      tx_hash="$(extract_tx_hash "$id")"
      write_state "$id" "$normalized" "$tx_hash"
      echo "recorded mode2 signer evidence for $id => signers [$normalized], tx $tx_hash"
      ;;
    validate)
      if [[ -f "$PREFLIGHT_INFO_FILE" ]]; then
        "$PREFLIGHT_BIN" "$PREFLIGHT_INFO_FILE"
      else
        echo "mode2 validate: skipping governance-lock preflight (missing $PREFLIGHT_INFO_FILE)" >&2
      fi
      $UPDATE_BIN validate
      "$CHECK_BIN" "$LATEST_FILE"
      validate_state
      ;;
    -h|--help|"")
      usage
      ;;
    *)
      echo "unknown command: $cmd" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
