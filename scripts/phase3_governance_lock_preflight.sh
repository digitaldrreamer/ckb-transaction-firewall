#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFO_FILE="${1:-$ROOT_DIR/deploy/info.json}"

SECP_CODE_HASH="0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8"

if [[ ! -f "$INFO_FILE" ]]; then
  echo "missing deploy info file: $INFO_FILE" >&2
  exit 1
fi

code_hash="$(jq -r '.deployment.lock.code_hash // ""' "$INFO_FILE")"
hash_type="$(jq -r '.deployment.lock.hash_type // ""' "$INFO_FILE")"
args="$(jq -r '.deployment.lock.args // ""' "$INFO_FILE")"

if [[ -z "$code_hash" || "$code_hash" == "null" ]]; then
  echo "invalid deploy info: missing deployment.lock" >&2
  exit 1
fi

echo "Governance lock from deploy info:"
echo "  code_hash: $code_hash"
echo "  hash_type: $hash_type"
echo "  args:      $args"

if [[ "$code_hash" == "$SECP_CODE_HASH" && "$hash_type" == "type" ]]; then
  cat <<'MSG'

NOTICE
- Governance lock is secp256k1-blake160-sighash-all.
- Strict GOV1 execution is supported when GOV1 payload is placed in WitnessArgs.input_type
  (with lock field reserved for secp signature bytes).
MSG
  exit 0
fi

echo "Preflight passed: governance lock is not secp-sighash; strict GOV1 flow can proceed."
