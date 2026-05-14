#!/usr/bin/env bash
set -euo pipefail

echo "Profiling firewall-lock cycles"
echo ""

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"
BINARY="$ROOT_DIR/target/riscv64imac-unknown-none-elf/release/firewall-lock"
TEST_DIR="$REPO_ROOT/tests/unit"
REPORT_FILE="$ROOT_DIR/CYCLE_REPORT.md"

if [ ! -f "$BINARY" ]; then
  echo "Binary not found at:"
  echo "  $BINARY"
  echo ""
  echo "Build first:"
  echo "  ./build.sh"
  exit 1
fi

echo "Binary:"
echo "  $BINARY"
echo ""
echo "Running cycle probe tests..."

TMP_OUTPUT="$(mktemp)"
(
  cd "$TEST_DIR"
  cargo test --test firewall_lock_tests test_cycle_probe_happy_path_ -- --nocapture
) | tee "$TMP_OUTPUT"

CYCLES_LOCK_ONLY="$(rg -o 'CYCLE_PROBE_HAPPY_PATH_LOCK_ONLY=\d+' "$TMP_OUTPUT" | head -1 | cut -d= -f2 || true)"
CYCLES_TYPE_ONLY="$(rg -o 'CYCLE_PROBE_HAPPY_PATH_TYPE_ONLY=\d+' "$TMP_OUTPUT" | head -1 | cut -d= -f2 || true)"
CYCLES_BOTH_CHECKS="$(rg -o 'CYCLE_PROBE_HAPPY_PATH_BOTH_CHECKS=\d+' "$TMP_OUTPUT" | head -1 | cut -d= -f2 || true)"
CYCLES_LARGE_REGISTRY_BOTH_CHECKS="$(rg -o 'CYCLE_PROBE_HAPPY_PATH_LARGE_REGISTRY_BOTH_CHECKS=\d+' "$TMP_OUTPUT" | head -1 | cut -d= -f2 || true)"
CYCLES_VERY_LARGE_REGISTRY_BOTH_CHECKS="$(rg -o 'CYCLE_PROBE_HAPPY_PATH_VERY_LARGE_REGISTRY_BOTH_CHECKS=\d+' "$TMP_OUTPUT" | head -1 | cut -d= -f2 || true)"
rm -f "$TMP_OUTPUT"

if [ -z "${CYCLES_LOCK_ONLY:-}" ] || [ -z "${CYCLES_TYPE_ONLY:-}" ] || [ -z "${CYCLES_BOTH_CHECKS:-}" ] || [ -z "${CYCLES_LARGE_REGISTRY_BOTH_CHECKS:-}" ] || [ -z "${CYCLES_VERY_LARGE_REGISTRY_BOTH_CHECKS:-}" ]; then
  echo ""
  echo "Could not parse cycle probe output."
  echo "Check test logs above."
  exit 1
fi

echo ""
echo "Happy path lock-only cycles: $CYCLES_LOCK_ONLY"
echo "Happy path type-only cycles: $CYCLES_TYPE_ONLY"
echo "Happy path both-checks cycles: $CYCLES_BOTH_CHECKS"
echo "Happy path large-registry (512 entries) both-checks cycles: $CYCLES_LARGE_REGISTRY_BOTH_CHECKS"
echo "Happy path very-large-registry (2000 entries) both-checks cycles: $CYCLES_VERY_LARGE_REGISTRY_BOTH_CHECKS"

if [ -f "$REPORT_FILE" ]; then
  echo ""
  echo "Updating CYCLE_REPORT.md..."
  sed -i "s/| happy path (lock-only) | pass |[^|]*|/| happy path (lock-only) | pass | $CYCLES_LOCK_ONLY |/" "$REPORT_FILE"
  sed -i "s/| happy path (type-only) | pass |[^|]*|/| happy path (type-only) | pass | $CYCLES_TYPE_ONLY |/" "$REPORT_FILE"
  sed -i "s/| happy path (both-checks) | pass |[^|]*|/| happy path (both-checks) | pass | $CYCLES_BOTH_CHECKS |/" "$REPORT_FILE"
  sed -i "s/| happy path (large registry, 512 entries, both-checks) | pass |[^|]*|/| happy path (large registry, 512 entries, both-checks) | pass | $CYCLES_LARGE_REGISTRY_BOTH_CHECKS |/" "$REPORT_FILE"
  sed -i "s/| happy path (very large registry, 2000 entries, both-checks) | pass |[^|]*|/| happy path (very large registry, 2000 entries, both-checks) | pass | $CYCLES_VERY_LARGE_REGISTRY_BOTH_CHECKS |/" "$REPORT_FILE"
  echo "Done. Report file: $REPORT_FILE"
else
  echo "CYCLE_REPORT.md not found, skipping file update (counts printed above)."
fi
echo ""
echo "Optional advanced profiling:"
echo "Use ckb-debugger with tx snapshots when available for per-scenario low-level VM traces."
