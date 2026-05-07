#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Check blacklist-registry binary for instructions unsupported by some CKB VM environments.

Usage:
  scripts/check_registry_vm_compat.sh [--bin <path>]

Default bin:
  contracts/blacklist-registry/target/riscv64imac-unknown-none-elf/release/blacklist-registry
USAGE
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_PATH="${ROOT_DIR}/contracts/blacklist-registry/target/riscv64imac-unknown-none-elf/release/blacklist-registry"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bin) BIN_PATH="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

command -v llvm-objdump >/dev/null 2>&1 || {
  echo "missing command: llvm-objdump" >&2
  exit 1
}
[[ -f "$BIN_PATH" ]] || {
  echo "binary not found: $BIN_PATH" >&2
  exit 1
}

tmp="$(mktemp)"
llvm-objdump -d "$BIN_PATH" > "$tmp"
if rg -n '\blr\.d\b|\bsc\.d\b|\blr\.w\b|\bsc\.w\b|\bamo[a-z0-9._]+' "$tmp" >/dev/null 2>&1; then
  echo "VM compatibility check failed for blacklist-registry binary." >&2
  echo "Detected RISC-V atomic instructions (LR/SC/AMO) that can trigger InvalidInstruction on-chain." >&2
  echo "Example matches:" >&2
  rg -n '\blr\.d\b|\bsc\.d\b|\blr\.w\b|\bsc\.w\b|\bamo[a-z0-9._]+' "$tmp" | head -10 >&2
  rm -f "$tmp"
  exit 2
fi

rm -f "$tmp"
echo "VM compatibility check passed: no LR/SC/AMO instructions found in blacklist-registry binary."
