#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIREWALL_SRC="$ROOT_DIR/contracts/firewall-lock/src/main.rs"
REGISTRY_SRC="$ROOT_DIR/contracts/blacklist-registry/src/main.rs"
LOCK_SPEC="$ROOT_DIR/docs/lock-script-spec.md"
GOV_DOC="$ROOT_DIR/docs/governance.md"

echo "Running Phase 3 compatibility/spec consistency checks..."

if [[ ! -f "$FIREWALL_SRC" || ! -f "$REGISTRY_SRC" || ! -f "$LOCK_SPEC" || ! -f "$GOV_DOC" ]]; then
  echo "Missing required source/spec files." >&2
  exit 1
fi

tmp_expected="$(mktemp)"
tmp_doc="$(mktemp)"
tmp_expected_norm="$(mktemp)"
trap 'rm -f "$tmp_expected" "$tmp_doc" "$tmp_expected_norm"' EXIT

# Extract on-chain frozen firewall error mapping: CODE NAME
awk '
  /pub const [A-Z_]+: i8 = [0-9]+;/ {
    name = $3
    gsub(":", "", name)
    code = $6
    gsub(";", "", code)
    print code " " name
  }
' "$FIREWALL_SRC" | sort -n > "$tmp_expected"

awk '
  function to_camel(s,   out, n, i, p) {
    n = split(s, p, "_")
    out = ""
    for (i = 1; i <= n; i++) {
      if (p[i] == "") {
        continue
      }
      out = out toupper(substr(p[i],1,1)) tolower(substr(p[i],2))
    }
    return out
  }
  { print $1 " " to_camel($2) }
' "$tmp_expected" > "$tmp_expected_norm"

awk '
  /^- `([0-9]+)`: `([A-Za-z0-9_]+)`$/ {
    gsub(/^- `/, "", $0)
    gsub(/`: `/, " ", $0)
    gsub(/`$/, "", $0)
    print $0
  }
' "$LOCK_SPEC" | sort -n > "$tmp_doc"

if ! diff -u "$tmp_expected_norm" "$tmp_doc" > /dev/null; then
  echo "Firewall error code map drift detected between contract and docs/lock-script-spec.md" >&2
  diff -u "$tmp_expected_norm" "$tmp_doc" || true
  exit 1
fi

grep -q 'if version != 0x01' "$FIREWALL_SRC"
grep -q 'if version != 0x01' "$REGISTRY_SRC"
grep -q 'MUST be `0x01`' "$LOCK_SPEC"

grep -q 'b"BLKL"' "$FIREWALL_SRC"
grep -q 'b"BLKL"' "$REGISTRY_SRC"
grep -q 'BLKL' "$LOCK_SPEC"
grep -q 'BLKL' "$GOV_DOC"

grep -q 'b"GOV1"' "$REGISTRY_SRC"
grep -q 'GOV1' "$GOV_DOC"

grep -q 'MissingRegistryCellDep' "$LOCK_SPEC"
grep -q 'AmbiguousRegistryCellDep' "$LOCK_SPEC"

echo "Phase 3 compatibility checks passed."
