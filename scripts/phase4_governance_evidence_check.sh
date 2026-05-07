#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_FILE="${1:-$ROOT_DIR/tests/integration/governance_drill/latest.json}"
CKB_CLI_BIN="${CKB_CLI_BIN:-ckb-cli}"
CKB_RPC_URL="${CKB_RPC_URL:-https://testnet.ckb.dev}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required." >&2
  exit 1
fi
if ! command -v "$CKB_CLI_BIN" >/dev/null 2>&1; then
  echo "ckb-cli binary not found: $CKB_CLI_BIN" >&2
  exit 1
fi
if [[ ! -f "$INPUT_FILE" ]]; then
  echo "Governance artifact not found: $INPUT_FILE" >&2
  exit 1
fi

echo "Phase 4 governance evidence check"
echo "Artifact: $INPUT_FILE"
echo "RPC: $CKB_RPC_URL"

# Must already satisfy base schema + pass status rules
"$ROOT_DIR/scripts/phase3_governance_drill_check.sh" "$INPUT_FILE" >/dev/null

# Reject known deterministic/synthetic evidence markers.
if jq -e 'any(.scenarios[]; (.notes // "") | test("deterministic|unit/contract checks|synthetic"; "i"))' "$INPUT_FILE" >/dev/null; then
  echo "Synthetic evidence marker found in scenario notes." >&2
  exit 1
fi

mapfile -t hashes < <(jq -r '.scenarios[].tx_hash' "$INPUT_FILE")
for h in "${hashes[@]}"; do
  if [[ ! "$h" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    echo "Invalid tx hash format: $h" >&2
    exit 1
  fi

  tx_json="$($CKB_CLI_BIN --url "$CKB_RPC_URL" rpc get_transaction --hash "$h" --output-format json)"
  if [[ -z "$tx_json" ]]; then
    echo "Failed to query tx hash: $h" >&2
    exit 1
  fi

  status="$(jq -r '.tx_status.status // "unknown"' <<<"$tx_json")"
  if [[ "$status" != "committed" ]]; then
    echo "Tx hash is not chain-committed: $h (status=$status)" >&2
    exit 1
  fi

done

echo "Phase 4 governance evidence check passed (chain-verifiable tx hashes)."
