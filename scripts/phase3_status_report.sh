#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/notes/internal/phase3_artifacts"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="$OUT_DIR/PHASE3_STATUS_${STAMP}.md"
LATEST="$OUT_DIR/PHASE3_STATUS_LATEST.md"

mkdir -p "$OUT_DIR"

set +e
CHECK_OUTPUT="$("$ROOT_DIR/scripts/phase3_closeout_check.sh" 2>&1)"
CHECK_RC=$?
set -e
CHECK_OUTPUT="${CHECK_OUTPUT//$ROOT_DIR/<repo_root>}"

cat >"$REPORT" <<PHASE3_STATUS_REPORT_END
# Phase 3 Status Snapshot

- Generated (UTC): $STAMP
- Branch: $(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)
- Commit: $(git -C "$ROOT_DIR" rev-parse HEAD)
- Closeout check exit code: $CHECK_RC

## Closeout Check Output

\`\`\`text
$CHECK_OUTPUT
\`\`\`
PHASE3_STATUS_REPORT_END

cp "$REPORT" "$LATEST"

echo "Phase 3 status report written:"
echo " - $REPORT"
echo " - $LATEST"

# Intentionally always succeeds: CHECK_RC is recorded in the report instead of propagating failure here.
exit 0
