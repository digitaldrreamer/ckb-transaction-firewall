#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STRICT_GOV_MODE2="${STRICT_GOV_MODE2:-1}"
REAL_GOV_EVIDENCE_REQUIRED="${REAL_GOV_EVIDENCE_REQUIRED:-0}"
ALLOW_DEV_SIGNER_KEYS="${ALLOW_DEV_SIGNER_KEYS:-1}"

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

check_security_tracker_zeroes() {
  local file="$ROOT_DIR/docs/phase3/security/findings-tracker.md"
  if [[ ! -f "$file" ]]; then
    fail "Security findings tracker missing for G1 parsing"
    return
  fi

  local crit high
  crit="$(grep -E '^- Open critical:' "$file" | awk -F: '{gsub(/ /, "", $2); print $2}' || true)"
  high="$(grep -E '^- Open high:' "$file" | awk -F: '{gsub(/ /, "", $2); print $2}' || true)"

  if [[ -z "$crit" || -z "$high" ]]; then
    fail "Security findings tracker summary fields missing"
    return
  fi

  if [[ "$crit" == "0" && "$high" == "0" ]]; then
    pass "G1 security summary shows zero open critical/high"
  else
    fail "G1 security summary not green (critical=$crit high=$high)"
  fi
}

check_manifest_dev_signer_keys_policy() {
  local manifest_json="$ROOT_DIR/phase3_artifacts/artifact_manifest_latest.json"
  if [[ ! -f "$manifest_json" ]]; then
    fail "Deterministic manifest JSON missing for feature-policy check ($manifest_json)"
    return
  fi

  if jq -e 'any(.artifacts[]?; (.features // []) | index("dev-signer-keys") != null)' "$manifest_json" >/dev/null 2>&1; then
    if [[ "$ALLOW_DEV_SIGNER_KEYS" == "1" ]]; then
      pass "Manifest contains dev-signer-keys (allowed by ALLOW_DEV_SIGNER_KEYS=1)"
    else
      fail "Manifest contains dev-signer-keys but ALLOW_DEV_SIGNER_KEYS!=1"
    fi
  else
    pass "Manifest has no dev-signer-keys feature usage"
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

if [[ "$STRICT_GOV_MODE2" == "1" ]]; then
  if [[ -f "$ROOT_DIR/tests/integration/governance_drill/mode2_signer_state.json" ]]; then
    if "$ROOT_DIR/scripts/phase3_governance_mode2.sh" validate >/dev/null 2>&1; then
      pass "G2 mode2 signer-separation evidence valid"
    else
      fail "G2 mode2 signer-separation evidence invalid"
    fi
  else
    fail "G2 mode2 signer-separation evidence missing (tests/integration/governance_drill/mode2_signer_state.json)"
  fi
fi

if [[ "$REAL_GOV_EVIDENCE_REQUIRED" == "1" ]]; then
  if "$ROOT_DIR/scripts/phase4_governance_evidence_check.sh" "$ROOT_DIR/tests/integration/governance_drill/latest.json" >/dev/null 2>&1; then
    pass "G2 real chain-backed governance evidence valid (phase4 gate)"
  else
    fail "G2 real chain-backed governance evidence invalid/missing (phase4 gate)"
  fi
  if [[ -f "$ROOT_DIR/tests/integration/governance_drill/chain_status_latest.json" ]]; then
    if jq -e '.scenarios | length > 0 and all(.[]; (.tx_status.status // "unknown") != "unknown" and (.tx_status.status // "~") != "~")' \
      "$ROOT_DIR/tests/integration/governance_drill/chain_status_latest.json" >/dev/null 2>&1; then
      pass "G2 chain status artifact present with resolved tx statuses"
    else
      fail "G2 chain status artifact present but has unresolved tx status entries"
    fi
  else
    fail "G2 chain status artifact missing (tests/integration/governance_drill/chain_status_latest.json)"
  fi
fi

# G3/G5 evidence artifacts
check_file "phase3_artifacts/PHASE3_EVIDENCE_LATEST.md" "Phase 3 evidence report"
check_file "phase3_artifacts/ARTIFACT_MANIFEST_LATEST.md" "Deterministic build manifest"
check_manifest_dev_signer_keys_policy

# G1 security docs
check_file "docs/phase3/security/findings-tracker.md" "Security findings tracker"
check_file "docs/phase3/security/waiver-register.md" "Security waiver register"
check_security_tracker_zeroes

# G4 runbooks
check_file "docs/phase3/runbooks/deployment-runbook.md" "Deployment runbook"
check_file "docs/phase3/runbooks/key-rotation-runbook.md" "Key rotation runbook"
check_file "docs/phase3/runbooks/governance-incident-playbook.md" "Governance incident playbook"

# Signer cutover policy
check_file "docs/phase3/keys/signer-custody-policy-template.md" "Signer custody policy template"

# Go/No-Go templates
check_file "docs/phase3/go-no-go/decision-record-template.md" "Go/No-Go decision record template"
check_file "docs/phase3/go-no-go/rollout-checklist-template.md" "Mainnet rollout checklist template"
check_file "docs/phase3/go-no-go/post-deploy-verification-template.md" "Post-deploy verification template"

# Soak + integration evidence templates
check_file "docs/phase3/soak/testnet-soak-report-template.md" "Testnet soak report template"
check_file "docs/phase3/integration/testnet-integration-report-template.md" "Testnet integration report template"
check_file "docs/phase3/integration/sdk-parity-matrix-template.md" "SDK parity matrix template"

echo ""
if [[ $FAILED -eq 0 ]]; then
  echo "Phase 3 closeout checks passed."
else
  echo "Phase 3 closeout checks FAILED."
  exit 1
fi
