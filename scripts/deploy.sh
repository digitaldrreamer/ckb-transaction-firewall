#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="testnet"
RPC_URL="https://testnet.ckb.dev"
CKB_CLI_BIN="${CKB_CLI_BIN:-ckb-cli}"
FROM_ADDRESS=""
MIGRATIONS_DIR="$ROOT_DIR/deploy/migrations"
DEPLOYMENT_CONFIG="$ROOT_DIR/deploy/deployment.toml"
INFO_FILE="$ROOT_DIR/deploy/info.json"
DRY_RUN=0
BUILD_FIRST=1

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

if [[ -z "$FROM_ADDRESS" ]]; then
  FROM_ADDRESS="$("$CKB_CLI_BIN" --url "$RPC_URL" account list --output-format json | jq -r '.[0].address.testnet // empty')"
fi

if [[ -z "$FROM_ADDRESS" ]]; then
  echo "Could not resolve --from-address (no local accounts found)." >&2
  exit 1
fi

if [[ $BUILD_FIRST -eq 1 ]]; then
  echo "Building contracts for deployment..."
  cargo build --release --target=riscv64imac-unknown-none-elf --manifest-path "$ROOT_DIR/contracts/firewall-lock/Cargo.toml"
  cargo build --release --target=riscv64imac-unknown-none-elf --manifest-path "$ROOT_DIR/contracts/blacklist-registry/Cargo.toml" --features dev-signer-keys
fi

FW_BIN="$ROOT_DIR/contracts/firewall-lock/target/riscv64imac-unknown-none-elf/release/firewall-lock"
REG_BIN="$ROOT_DIR/contracts/blacklist-registry/target/riscv64imac-unknown-none-elf/release/blacklist-registry"
if [[ ! -f "$FW_BIN" || ! -f "$REG_BIN" ]]; then
  echo "Missing built binaries. firewall-lock or blacklist-registry not found." >&2
  exit 1
fi

echo "Writing deployment config: $DEPLOYMENT_CONFIG"
cat >"$DEPLOYMENT_CONFIG" <<EOF
[[cells]]
name = "firewall_lock"
enable_type_id = true
location = { file = "${FW_BIN}" }

[[cells]]
name = "blacklist_registry"
enable_type_id = true
location = { file = "${REG_BIN}" }
EOF

echo "Generating deployment transactions..."
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
