#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Submit a tx file with resilient send behavior.

Usage:
  scripts/phase4_submit_tx.sh --tx-file <path> --from-account <addr>

Env:
  CKB_CLI_BIN        default: ckb-cli
  CKB_RPC_URL        default: https://testnet.ckb.dev
  PRIVKEY_PATH       optional; when set, uses --privkey-path for signing (non-interactive)
  SEND_RETRIES       default: 8
  SEND_RETRY_SLEEP   default: 4
USAGE
}

CKB_CLI_BIN="${CKB_CLI_BIN:-ckb-cli}"
CKB_RPC_URL="${CKB_RPC_URL:-https://testnet.ckb.dev}"
SEND_RETRIES="${SEND_RETRIES:-8}"
SEND_RETRY_SLEEP="${SEND_RETRY_SLEEP:-4}"
PRIVKEY_PATH="${PRIVKEY_PATH:-}"

tx_file=""
from_account=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tx-file) tx_file="${2:-}"; shift 2 ;;
    --from-account) from_account="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -n "$tx_file" && -n "$from_account" ]] || { usage >&2; exit 1; }
[[ -f "$tx_file" ]] || { echo "tx file not found: $tx_file" >&2; exit 1; }

command -v "$CKB_CLI_BIN" >/dev/null 2>&1 || { echo "missing ckb-cli: $CKB_CLI_BIN" >&2; exit 1; }

# Sign exactly once.
if [[ -n "$PRIVKEY_PATH" ]]; then
  [[ -f "$PRIVKEY_PATH" ]] || { echo "privkey file not found: $PRIVKEY_PATH" >&2; exit 1; }
  "$CKB_CLI_BIN" --url "$CKB_RPC_URL" tx sign-inputs \
    --privkey-path "$PRIVKEY_PATH" \
    --add-signatures \
    --tx-file "$tx_file" >/dev/null
else
  "$CKB_CLI_BIN" --url "$CKB_RPC_URL" tx sign-inputs \
    --from-account "$from_account" \
    --add-signatures \
    --tx-file "$tx_file" >/dev/null
fi

attempt=1
while (( attempt <= SEND_RETRIES )); do
  out="$("$CKB_CLI_BIN" --url "$CKB_RPC_URL" tx send --tx-file "$tx_file" 2>&1)" && {
    printf '%s\n' "$out"
    exit 0
  }

  if grep -qi 'PoolRejectedDuplicatedTransaction' <<<"$out"; then
    # Return hash if present so caller can still record evidence.
    if grep -Eo '0x[0-9a-fA-F]{64}' <<<"$out" >/dev/null; then
      grep -Eo '0x[0-9a-fA-F]{64}' <<<"$out" | head -1
      exit 0
    fi
    echo "$out"
    exit 0
  fi

  if grep -qi 'http error' <<<"$out"; then
    if (( attempt < SEND_RETRIES )); then
      sleep "$SEND_RETRY_SLEEP"
      attempt=$((attempt + 1))
      continue
    fi
  fi

  echo "$out" >&2
  exit 1
done
