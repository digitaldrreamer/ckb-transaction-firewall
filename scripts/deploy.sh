#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="testnet"
RPC_URL="https://testnet.ckb.dev"
CKB_CLI_BIN="${CKB_CLI_BIN:-ckb-cli}"
FROM_ADDRESS=""
FROM_LOCK_ARG=""
MIGRATIONS_DIR="$ROOT_DIR/deploy/migrations"
DEPLOYMENT_CONFIG="$ROOT_DIR/deploy/deployment.toml"
INFO_FILE="$ROOT_DIR/deploy/info.json"
DRY_RUN=0
BUILD_FIRST=1
STRICT_GOV_LOCK=0

usage() {
  cat <<'EOF'
Usage:
  scripts/deploy.sh [options]

Options:
  --network <testnet|mainnet>   Target network (default: testnet)
  --rpc-url <url>               RPC URL (default: https://testnet.ckb.dev)
  --from-address <address>      Funding/signing address for deployment txs
  --ckb-cli-bin <path>          ckb-cli binary path (default: ckb-cli)
  --deployment-config <path>    deployment.toml path
  --migrations-dir <path>       migrations directory path
  --info-file <path>            deployment info json path
  --no-build                    Skip contract build
  --strict-governance-lock      Two-stage deploy with non-secp governance lock for strict GOV1 drills
  --dry-run                     Generate config/commands only (no sign/apply)
  -h, --help                    Show help

Environment:
  CKB_CLI_BIN                   Override ckb-cli binary path
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network) NETWORK="$2"; shift 2 ;;
    --rpc-url) RPC_URL="$2"; shift 2 ;;
    --from-address) FROM_ADDRESS="$2"; shift 2 ;;
    --ckb-cli-bin) CKB_CLI_BIN="$2"; shift 2 ;;
    --deployment-config) DEPLOYMENT_CONFIG="$2"; shift 2 ;;
    --migrations-dir) MIGRATIONS_DIR="$2"; shift 2 ;;
    --info-file) INFO_FILE="$2"; shift 2 ;;
    --no-build) BUILD_FIRST=0; shift ;;
    --strict-governance-lock) STRICT_GOV_LOCK=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if ! command -v "$CKB_CLI_BIN" >/dev/null 2>&1; then
  echo "ckb-cli not found: $CKB_CLI_BIN" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEPLOYMENT_CONFIG")" "$MIGRATIONS_DIR"

rotate_info_file_if_exists() {
  local path="$1"
  if [[ -f "$path" ]]; then
    local ts
    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    local backup="${path}.${ts}.bak"
    mv "$path" "$backup"
    echo "Existing info file moved to: $backup"
  fi
}

resolve_governance_lock_data_hash_from_file() {
  local path="$1"
  if [[ -f "$path" ]]; then
    jq -r '.new_recipe.cell_recipes[]? | select(.name=="governance_lock") | .data_hash' "$path" | head -1
  fi
}

resolve_governance_lock_data_hash() {
  local primary="$1"
  local hash
  hash="$(resolve_governance_lock_data_hash_from_file "$primary")"
  if [[ -n "$hash" && "$hash" != "null" ]]; then
    echo "$hash"
    return 0
  fi
  local latest_backup
  latest_backup="$(ls -1t "${primary}".*.bak 2>/dev/null | head -1 || true)"
  if [[ -n "$latest_backup" ]]; then
    hash="$(resolve_governance_lock_data_hash_from_file "$latest_backup")"
    if [[ -n "$hash" && "$hash" != "null" ]]; then
      echo "$hash"
      return 0
    fi
  fi
  return 1
}

if [[ -z "$FROM_ADDRESS" ]]; then
  FROM_ADDRESS="$("$CKB_CLI_BIN" --url "$RPC_URL" account list --output-format json | jq -r '.[0].address.testnet // empty')"
fi

if [[ -z "$FROM_ADDRESS" ]]; then
  echo "Could not resolve --from-address (no local accounts found)." >&2
  exit 1
fi

FROM_LOCK_ARG="$("$CKB_CLI_BIN" --url "$RPC_URL" account list --output-format json | jq -r --arg addr "$FROM_ADDRESS" '.[] | select(.address.testnet == $addr or .address.mainnet == $addr) | .lock_arg' | head -1)"
if [[ -z "$FROM_LOCK_ARG" || "$FROM_LOCK_ARG" == "null" ]]; then
  echo "Could not resolve lock_arg for from address: $FROM_ADDRESS" >&2
  exit 1
fi

if [[ $BUILD_FIRST -eq 1 ]]; then
  echo "Building contracts for deployment..."
  if [[ $STRICT_GOV_LOCK -eq 1 ]]; then
    cargo build --release --target=riscv64imac-unknown-none-elf --manifest-path "$ROOT_DIR/contracts/governance-lock/Cargo.toml"
  fi
  cargo build --release --target=riscv64imac-unknown-none-elf --manifest-path "$ROOT_DIR/contracts/firewall-lock/Cargo.toml"
  cargo build --release --target=riscv64imac-unknown-none-elf --manifest-path "$ROOT_DIR/contracts/blacklist-registry/Cargo.toml" --features dev-signer-keys
fi

FW_BIN="$ROOT_DIR/contracts/firewall-lock/target/riscv64imac-unknown-none-elf/release/firewall-lock"
REG_BIN="$ROOT_DIR/contracts/blacklist-registry/target/riscv64imac-unknown-none-elf/release/blacklist-registry"
GOV_BIN="$ROOT_DIR/contracts/governance-lock/target/riscv64imac-unknown-none-elf/release/governance-lock"
if [[ ! -f "$FW_BIN" || ! -f "$REG_BIN" ]]; then
  echo "Missing built binaries. firewall-lock or blacklist-registry not found." >&2
  exit 1
fi
if [[ $STRICT_GOV_LOCK -eq 1 && ! -f "$GOV_BIN" ]]; then
  echo "Missing governance-lock binary: $GOV_BIN" >&2
  exit 1
fi

SECP_CODE_HASH="0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8"

if [[ $STRICT_GOV_LOCK -eq 1 ]]; then
  GOV_INFO_FILE="${INFO_FILE%.json}.governance_lock.json"
  GOV_DEPLOYMENT_CONFIG="${DEPLOYMENT_CONFIG%.toml}.governance_lock.toml"
  GOV_MIGRATIONS_DIR="${MIGRATIONS_DIR}.governance_lock"
  mkdir -p "$GOV_MIGRATIONS_DIR"

  echo "Writing strict governance-lock stage config: $GOV_DEPLOYMENT_CONFIG"
  cat >"$GOV_DEPLOYMENT_CONFIG" <<EOF
[[cells]]
name = "governance_lock"
enable_type_id = true
location = { file = "${GOV_BIN}" }
force_redeploy = false

[lock]
code_hash = "${SECP_CODE_HASH}"
args = "${FROM_LOCK_ARG}"
hash_type = "type"
EOF

  echo "Generating governance-lock stage transactions..."
  rotate_info_file_if_exists "$GOV_INFO_FILE"
  set +e
  GOV_GEN_OUTPUT="$("$CKB_CLI_BIN" --url "$RPC_URL" deploy gen-txs \
    --deployment-config "$GOV_DEPLOYMENT_CONFIG" \
    --migration-dir "$GOV_MIGRATIONS_DIR" \
    --from-address "$FROM_ADDRESS" \
    --info-file "$GOV_INFO_FILE" 2>&1)"
  GOV_GEN_STATUS=$?
  set -e
  echo "$GOV_GEN_OUTPUT"

  if [[ $GOV_GEN_STATUS -ne 0 && "$GOV_GEN_OUTPUT" != *"No cells/dep_groups need update"* ]]; then
    echo "governance-lock stage generation failed" >&2
    exit $GOV_GEN_STATUS
  fi

  if [[ $DRY_RUN -eq 1 ]]; then
    cat <<EOF
Dry run (strict mode) stage 1 complete.
Next commands:
  $CKB_CLI_BIN --url "$RPC_URL" deploy sign-txs --from-account "$FROM_ADDRESS" --add-signatures --info-file "$GOV_INFO_FILE"
  $CKB_CLI_BIN --url "$RPC_URL" deploy apply-txs --migration-dir "$GOV_MIGRATIONS_DIR" --info-file "$GOV_INFO_FILE"
After stage 1 is applied, rerun this script without --dry-run to complete stage 2.
EOF
    exit 0
  fi

  if [[ $GOV_GEN_STATUS -eq 0 ]]; then
    echo "Signing governance-lock stage transactions..."
    "$CKB_CLI_BIN" --url "$RPC_URL" deploy sign-txs \
      --from-account "$FROM_ADDRESS" \
      --add-signatures \
      --info-file "$GOV_INFO_FILE"

    echo "Applying governance-lock stage transactions..."
    "$CKB_CLI_BIN" --url "$RPC_URL" deploy apply-txs \
      --migration-dir "$GOV_MIGRATIONS_DIR" \
      --info-file "$GOV_INFO_FILE"
  fi

  GOV_LOCK_CODE_HASH="$(resolve_governance_lock_data_hash "$GOV_INFO_FILE" || true)"
  if [[ -z "$GOV_LOCK_CODE_HASH" || "$GOV_LOCK_CODE_HASH" == "null" ]]; then
    echo "Could not resolve governance_lock data_hash from $GOV_INFO_FILE or backups" >&2
    exit 1
  fi
  GOV_LOCK_HASH_TYPE="data1"
  GOV_LOCK_ARGS="0x"
  echo "Stage 1 complete. governance_lock code_hash=$GOV_LOCK_CODE_HASH hash_type=$GOV_LOCK_HASH_TYPE args=$GOV_LOCK_ARGS"
else
  GOV_LOCK_CODE_HASH="$SECP_CODE_HASH"
  GOV_LOCK_HASH_TYPE="type"
  GOV_LOCK_ARGS="$FROM_LOCK_ARG"
fi

echo "Writing deployment config: $DEPLOYMENT_CONFIG"
cat >"$DEPLOYMENT_CONFIG" <<EOF
[[cells]]
name = "firewall_lock"
enable_type_id = true
location = { file = "${FW_BIN}" }
force_redeploy = true

[[cells]]
name = "blacklist_registry"
enable_type_id = true
location = { file = "${REG_BIN}" }
force_redeploy = true

[lock]
code_hash = "${GOV_LOCK_CODE_HASH}"
args = "${GOV_LOCK_ARGS}"
hash_type = "${GOV_LOCK_HASH_TYPE}"
EOF

echo "Generating deployment transactions..."
rotate_info_file_if_exists "$INFO_FILE"
"$CKB_CLI_BIN" --url "$RPC_URL" deploy gen-txs \
  --deployment-config "$DEPLOYMENT_CONFIG" \
  --migration-dir "$MIGRATIONS_DIR" \
  --from-address "$FROM_ADDRESS" \
  --info-file "$INFO_FILE"

if [[ $DRY_RUN -eq 1 ]]; then
  cat <<EOF
Dry run complete.
Next commands:
  $CKB_CLI_BIN --url "$RPC_URL" deploy sign-txs --from-account "$FROM_ADDRESS" --add-signatures --info-file "$INFO_FILE"
  $CKB_CLI_BIN --url "$RPC_URL" deploy apply-txs --migration-dir "$MIGRATIONS_DIR" --info-file "$INFO_FILE"
EOF
  exit 0
fi

echo "Signing deployment transactions..."
"$CKB_CLI_BIN" --url "$RPC_URL" deploy sign-txs \
  --from-account "$FROM_ADDRESS" \
  --add-signatures \
  --info-file "$INFO_FILE"

echo "Applying deployment transactions..."
"$CKB_CLI_BIN" --url "$RPC_URL" deploy apply-txs \
  --migration-dir "$MIGRATIONS_DIR" \
  --info-file "$INFO_FILE"

echo "Deployment flow complete. Inspect $INFO_FILE and $MIGRATIONS_DIR for tx hashes."
