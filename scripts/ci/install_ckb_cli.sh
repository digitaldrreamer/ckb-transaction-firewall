#!/usr/bin/env bash
# * Installs a pinned ckb-cli binary for CI (Phase 4 chain-backed governance checks).
set -euo pipefail

VERSION="${CKB_CLI_VERSION:-v1.15.0}"
ARCH="${CKB_CLI_ARCH:-x86_64-unknown-linux-gnu}"
INSTALL_DIR="${CKB_CLI_INSTALL_DIR:-$HOME/.local/bin}"
BASE_URL="https://github.com/nervosnetwork/ckb-cli/releases/download/${VERSION}"
ARCHIVE="ckb-cli_${VERSION}_${ARCH}.tar.gz"

mkdir -p "$INSTALL_DIR"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

curl -fsSL --retry 5 --connect-timeout 10 "${BASE_URL}/${ARCHIVE}" -o "${TMP}/${ARCHIVE}"

# Verify archive integrity if checksum is provided
if [[ -n "${EXPECTED_SHA256:-}" ]]; then
  ACTUAL_SHA256="$(sha256sum "${TMP}/${ARCHIVE}" | awk '{print $1}')"
  if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
    echo "ERROR: SHA256 mismatch for ${ARCHIVE}" >&2
    echo "  Expected: $EXPECTED_SHA256" >&2
    echo "  Actual:   $ACTUAL_SHA256" >&2
    exit 1
  fi
  echo "SHA256 verification passed for ${ARCHIVE}"
fi

tar xzf "${TMP}/${ARCHIVE}" -C "$TMP"
BIN="$(find "$TMP" -type f -name ckb-cli | head -1)"
if [[ -z "$BIN" ]]; then
  echo "ckb-cli binary not found after extracting ${ARCHIVE}" >&2
  exit 1
fi
chmod +x "$BIN"
cp -f "$BIN" "${INSTALL_DIR}/ckb-cli"

if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "$INSTALL_DIR" >>"$GITHUB_PATH"
fi

command -v "${INSTALL_DIR}/ckb-cli"
"${INSTALL_DIR}/ckb-cli" --version
