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

BLOCKER DETECTED
- Current governance lock is secp256k1-blake160-sighash-all.
- blacklist-registry requires GOV1 payload in WitnessArgs.lock for registry script checks.
- secp lock also requires WitnessArgs.lock to be a 65-byte signature.
- These requirements conflict, so strict governance txs cannot be executed with this governance lock.

Required remediation for strict mode:
1) Use a non-secp governance lock identity for registry cells (commonly always_success for dev/testnet drills).
2) Bootstrap and updates must keep input witness layout compatible with GOV1 payload checks.
3) Rebuild/deploy workflow for registry bootstrap with the corrected governance lock identity.

This is a design/configuration mismatch, not an operator mistake.
MSG
  exit 2
fi

echo "Preflight passed: governance lock is not secp-sighash; strict GOV1 flow can proceed."
