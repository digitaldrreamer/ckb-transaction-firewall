#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_FILE="${1:-$ROOT_DIR/tests/integration/governance_drill/latest.json}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for governance drill validation." >&2
  exit 1
fi

if [[ ! -f "$INPUT_FILE" ]]; then
  echo "Governance drill artifact not found: $INPUT_FILE" >&2
  echo "Use tests/integration/governance_drill/template.json to create it." >&2
  exit 1
fi

echo "Validating governance drill artifact: $INPUT_FILE"

required_ids=(
  "bootstrap_0_to_1"
  "update_1_to_1"
  "negative_invalid_signer_set"
  "negative_invalid_root_binding"
)

for id in "${required_ids[@]}"; do
  jq -e --arg id "$id" '.scenarios[] | select(.id == $id)' "$INPUT_FILE" >/dev/null
done

jq -e '
  .scenarios
  | all(.status == "pass" or .status == "fail" or .status == "pending")
' "$INPUT_FILE" >/dev/null

jq -e '
  .scenarios
  | all(
      if (.status == "pass" or .status == "fail")
      then (.tx_hash | test("^0x[0-9a-fA-F]{64}$"))
      else true
      end
    )
' "$INPUT_FILE" >/dev/null

if jq -e '.scenarios | any(.status == "pending")' "$INPUT_FILE" >/dev/null; then
  echo "Governance drill still pending: at least one scenario has status=pending." >&2
  exit 1
fi

if jq -e '.scenarios | any(.status == "fail")' "$INPUT_FILE" >/dev/null; then
  echo "Governance drill completed with failures. Review scenario entries." >&2
  exit 1
fi

echo "Governance drill artifact validation passed."
