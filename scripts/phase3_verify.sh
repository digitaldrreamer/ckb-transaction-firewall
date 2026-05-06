#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/phase3_artifacts"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="$OUT_DIR/PHASE3_EVIDENCE_${STAMP}.md"
LATEST_LINK="$OUT_DIR/PHASE3_EVIDENCE_LATEST.md"

FIREWALL_DIR="$ROOT_DIR/contracts/firewall-lock"
REGISTRY_DIR="$ROOT_DIR/contracts/blacklist-registry"
TESTS_DIR="$ROOT_DIR/tests/unit"

FIREWALL_BIN="$FIREWALL_DIR/target/riscv64imac-unknown-none-elf/release/firewall-lock"
REGISTRY_BIN="$REGISTRY_DIR/target/riscv64imac-unknown-none-elf/release/blacklist-registry"

mkdir -p "$OUT_DIR"

echo "Phase 3 verification started at $STAMP"
echo "Repository root: $ROOT_DIR"

echo ""
echo "Building firewall-lock..."
(
  cd "$FIREWALL_DIR"
  cargo build --release --target=riscv64imac-unknown-none-elf
)

echo ""
echo "Building blacklist-registry (dev key feature for local verification)..."
(
  cd "$REGISTRY_DIR"
  cargo build --release --target=riscv64imac-unknown-none-elf --features dev-signer-keys
)

echo ""
echo "Verifying production build guard (blacklist-registry without dev keys should fail)..."
GUARD_LOG="$OUT_DIR/guard_${STAMP}.log"
set +e
(
  cd "$REGISTRY_DIR"
  cargo build --release --target=riscv64imac-unknown-none-elf
) >"$GUARD_LOG" 2>&1
GUARD_RC=$?
set -e
if [[ $GUARD_RC -eq 0 ]]; then
  echo "Expected blacklist-registry production-guard failure, but build succeeded." >&2
  exit 1
fi
echo "Production guard check passed (build failed as expected)."

echo ""
echo "Running unit + integration test suite..."
TEST_LOG="$OUT_DIR/tests_${STAMP}.log"
(
  cd "$TESTS_DIR"
  cargo test -- --nocapture
) | tee "$TEST_LOG"

echo ""
echo "Running cycle probe refresh..."
CYCLE_LOG="$OUT_DIR/cycles_${STAMP}.log"
(
  cd "$FIREWALL_DIR"
  ./profile-cycles.sh
) | tee "$CYCLE_LOG"

if [[ ! -f "$FIREWALL_BIN" ]]; then
  echo "Missing firewall binary: $FIREWALL_BIN" >&2
  exit 1
fi
if [[ ! -f "$REGISTRY_BIN" ]]; then
  echo "Missing registry binary: $REGISTRY_BIN" >&2
  exit 1
fi

FIREWALL_SHA="$(sha256sum "$FIREWALL_BIN" | awk '{print $1}')"
REGISTRY_SHA="$(sha256sum "$REGISTRY_BIN" | awk '{print $1}')"
FIREWALL_SIZE="$(stat -c '%s' "$FIREWALL_BIN")"
REGISTRY_SIZE="$(stat -c '%s' "$REGISTRY_BIN")"
FIREWALL_SIZE_H="$(ls -lh "$FIREWALL_BIN" | awk '{print $5}')"
REGISTRY_SIZE_H="$(ls -lh "$REGISTRY_BIN" | awk '{print $5}')"
HEAD_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
if [[ "$REGISTRY_SIZE" -lt 100000 ]]; then
  SIZE_GATE="PASS"
else
  SIZE_GATE="FAIL"
fi

cat > "$REPORT" <<EOF
# Phase 3 Evidence Report

- Generated (UTC): $STAMP
- Branch: \`$BRANCH\`
- Commit: \`$HEAD_SHA\`

## Build Commands

\`\`\`bash
cd contracts/firewall-lock && cargo build --release --target=riscv64imac-unknown-none-elf
cd contracts/blacklist-registry && cargo build --release --target=riscv64imac-unknown-none-elf --features dev-signer-keys
\`\`\`

## Artifact Manifest

| Artifact | Path | Size (bytes) | Human size | SHA256 |
|---|---|---:|---:|---|
| firewall-lock | \`contracts/firewall-lock/target/riscv64imac-unknown-none-elf/release/firewall-lock\` | $FIREWALL_SIZE | $FIREWALL_SIZE_H | \`$FIREWALL_SHA\` |
| blacklist-registry | \`contracts/blacklist-registry/target/riscv64imac-unknown-none-elf/release/blacklist-registry\` | $REGISTRY_SIZE | $REGISTRY_SIZE_H | \`$REGISTRY_SHA\` |

## Validation Runs

- Test log: \`phase3_artifacts/$(basename "$TEST_LOG")\`
- Cycle log: \`phase3_artifacts/$(basename "$CYCLE_LOG")\`
- Guard log: \`phase3_artifacts/$(basename "$GUARD_LOG")\`

### Test Command
\`\`\`bash
cd tests/unit && cargo test -- --nocapture
\`\`\`

### Cycle Probe Command
\`\`\`bash
cd contracts/firewall-lock && ./profile-cycles.sh
\`\`\`

## Notes

- \`blacklist-registry\` currently requires \`--features dev-signer-keys\` for local builds while production signer set finalization is pending.
- Use this report as evidence input for Phase 3 gates G2/G3/G5.

## Gate Snapshot

| Gate | Check | Status |
|---|---|---|
| G2 Correctness | \`tests/unit cargo test\` | PASS |
| G3 Performance (size proxy) | \`blacklist-registry < 100000 bytes\` | $SIZE_GATE |
| G5 Compatibility/Safety | production guard blocks no-feature build | PASS |
EOF

cp "$REPORT" "$LATEST_LINK"

echo ""
echo "Phase 3 evidence written:"
echo " - $REPORT"
echo " - $LATEST_LINK"
