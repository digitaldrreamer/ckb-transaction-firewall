#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CKB_CLI_BIN="${CKB_CLI_BIN:-/tmp/ckbcli-bin/ckb-cli_v1.15.0_x86_64-unknown-linux-gnu/ckb-cli}"
CKB_RPC_URL="${CKB_RPC_URL:-https://testnet.ckb.dev}"

if [[ ! -x "$CKB_CLI_BIN" ]]; then
  echo "ckb-cli binary not found or not executable: $CKB_CLI_BIN" >&2
  exit 1
fi

echo "Checking testnet RPC connectivity..."
"$CKB_CLI_BIN" --url "$CKB_RPC_URL" rpc get_tip_header >/dev/null
echo "RPC reachable: $CKB_RPC_URL"

echo "Checking local ckb-cli accounts..."
accounts_json="$("$CKB_CLI_BIN" --url "$CKB_RPC_URL" account list --output-format json)"
account_count="$(echo "$accounts_json" | jq 'length')"
if [[ "$account_count" -eq 0 ]]; then
  echo "No local accounts configured in ckb-cli." >&2
  echo "Import or create signer accounts before running governance drill." >&2
  exit 1
fi

echo "Accounts configured: $account_count"
echo "Prerequisite check passed."
echo ""
echo "Next:"
echo "1) Fund at least one signer account with testnet CKBytes."
echo "2) Run governance drill execution and update:"
echo "   scripts/phase3_governance_drill_update.sh init"
echo "   scripts/phase3_governance_drill_update.sh set ..."
echo "   scripts/phase3_governance_drill_update.sh validate"
