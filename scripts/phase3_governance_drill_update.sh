#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LATEST_FILE="$ROOT_DIR/tests/integration/governance_drill/latest.json"
TEMPLATE_FILE="$ROOT_DIR/tests/integration/governance_drill/template.json"

usage() {
  cat <<'EOF'
Usage:
  scripts/phase3_governance_drill_update.sh init
  scripts/phase3_governance_drill_update.sh set \
    --id <scenario_id> \
    --status <pass|fail|pending> \
    [--tx-hash 0x...] \
    [--notes "..."] \
    [--expected-error-code <int>]
  scripts/phase3_governance_drill_update.sh validate

Commands:
  init      Copy template.json to latest.json if latest.json does not exist.
  set       Update one scenario entry in latest.json.
  validate  Run governance drill gate validation against latest.json.
EOF
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required." >&2
    exit 1
  fi
}

cmd_init() {
  if [[ -f "$LATEST_FILE" ]]; then
    echo "Already exists: $LATEST_FILE"
    exit 0
  fi
  cp "$TEMPLATE_FILE" "$LATEST_FILE"
  echo "Created $LATEST_FILE from template."
}

cmd_set() {
  require_jq
  local id=""
  local status=""
  local tx_hash=""
  local notes=""
  local expected_error_code=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id) id="$2"; shift 2 ;;
      --status) status="$2"; shift 2 ;;
      --tx-hash) tx_hash="$2"; shift 2 ;;
      --notes) notes="$2"; shift 2 ;;
      --expected-error-code) expected_error_code="$2"; shift 2 ;;
      *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
    esac
  done

  if [[ -z "$id" || -z "$status" ]]; then
    echo "--id and --status are required." >&2
    usage
    exit 1
  fi

  if [[ "$status" != "pass" && "$status" != "fail" && "$status" != "pending" ]]; then
    echo "Invalid --status: $status" >&2
    exit 1
  fi

  if [[ ! -f "$LATEST_FILE" ]]; then
    echo "Missing $LATEST_FILE. Run: $0 init" >&2
    exit 1
  fi

  if ! jq -e --arg id "$id" '.scenarios[] | select(.id == $id)' "$LATEST_FILE" >/dev/null; then
    echo "Scenario id not found in latest.json: $id" >&2
    exit 1
  fi

  local tmp
  tmp="$(mktemp)"
  jq \
    --arg id "$id" \
    --arg status "$status" \
    --arg tx_hash "$tx_hash" \
    --arg notes "$notes" \
    --arg expected_error_code "$expected_error_code" \
    '
    .generated_utc = (now | todateiso8601)
    | .scenarios = (
        .scenarios
        | map(
            if .id == $id then
              .status = $status
              | (if $tx_hash != "" then .tx_hash = $tx_hash else . end)
              | (if $notes != "" then .notes = $notes else . end)
              | (if $expected_error_code != "" then .expected_error_code = ($expected_error_code | tonumber) else . end)
            else
              .
            end
          )
      )
    ' "$LATEST_FILE" > "$tmp"

  mv "$tmp" "$LATEST_FILE"
  echo "Updated scenario '$id' in $LATEST_FILE"
}

cmd_validate() {
  "$ROOT_DIR/scripts/phase3_governance_drill_check.sh" "$LATEST_FILE"
}

main() {
  local command="${1:-}"
  case "$command" in
    init) shift; cmd_init "$@" ;;
    set) shift; cmd_set "$@" ;;
    validate) shift; cmd_validate "$@" ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
