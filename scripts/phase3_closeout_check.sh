#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

FAILED=0

check_file() {
  local rel="$1"
  local label="$2"
  if [[ -f "$ROOT_DIR/$rel" ]]; then
    pass "$label ($rel)"
  else
    fail "$label ($rel)"
  fi
}

echo "Phase 3 closeout status check"
echo "Repo: $ROOT_DIR"
echo ""

# G2 evidence (governance drill)
if [[ -f "$ROOT_DIR/tests/integration/governance_drill/latest.json" ]]; then
  if "$ROOT_DIR/scripts/phase3_governance_drill_check.sh" "$ROOT_DIR/tests/integration/governance_drill/latest.json" >/dev/null 2>&1; then
    pass "G2 governance drill evidence valid"
  else
    fail "G2 governance drill evidence present but not valid/pass"
  fi
else
  fail "G2 governance drill evidence missing (tests/integration/governance_drill/latest.json)"
fi

# G3/G5 evidence artifacts
check_file "phase3_artifacts/PHASE3_EVIDENCE_LATEST.md" "Phase 3 evidence report"
check_file "phase3_artifacts/ARTIFACT_MANIFEST_LATEST.md" "Deterministic build manifest"

# G1 security docs
check_file "docs/phase3/security/findings-tracker.md" "Security findings tracker"
check_file "docs/phase3/security/waiver-register.md" "Security waiver register"

# G4 runbooks
check_file "docs/phase3/runbooks/deployment-runbook.md" "Deployment runbook"
check_file "docs/phase3/runbooks/key-rotation-runbook.md" "Key rotation runbook"
check_file "docs/phase3/runbooks/governance-incident-playbook.md" "Governance incident playbook"

echo ""
if [[ $FAILED -eq 0 ]]; then
  echo "Phase 3 closeout checks passed."
else
  echo "Phase 3 closeout checks FAILED."
  exit 1
fi
