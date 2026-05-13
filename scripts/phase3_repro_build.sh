#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/docs/internal/phase3_artifacts"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MANIFEST_MD="$OUT_DIR/ARTIFACT_MANIFEST_${STAMP}.md"
MANIFEST_JSON="$OUT_DIR/artifact_manifest_${STAMP}.json"
LATEST_MD="$OUT_DIR/ARTIFACT_MANIFEST_LATEST.md"
LATEST_JSON="$OUT_DIR/artifact_manifest_latest.json"
MAX_ARTIFACT_SETS="${MAX_ARTIFACT_SETS:-5}"

FW_DIR="$ROOT_DIR/contracts/firewall-lock"
REG_DIR="$ROOT_DIR/contracts/blacklist-registry"
TARGET="riscv64imac-unknown-none-elf"

mkdir -p "$OUT_DIR"

build_round() {
  local round="$1"
  echo "Running clean build round $round..."
  (
    cd "$FW_DIR"
    cargo clean
    cargo build --release --target="$TARGET"
  )
  (
    cd "$REG_DIR"
    cargo clean
    cargo build --release --target="$TARGET" --features dev-signer-keys
  )
}

artifact_meta() {
  local path="$1"
  local sha size
  sha="$(sha256sum "$path" | awk '{print $1}')"
  size="$(stat -c '%s' "$path")"
  printf '%s,%s' "$sha" "$size"
}

FW_BIN="$FW_DIR/target/$TARGET/release/firewall-lock"
REG_BIN="$REG_DIR/target/$TARGET/release/blacklist-registry"

build_round 1
FW_META_1="$(artifact_meta "$FW_BIN")"
REG_META_1="$(artifact_meta "$REG_BIN")"

build_round 2
FW_META_2="$(artifact_meta "$FW_BIN")"
REG_META_2="$(artifact_meta "$REG_BIN")"

if [[ "$FW_META_1" != "$FW_META_2" ]]; then
  echo "firewall-lock reproducibility mismatch between rounds." >&2
  echo "round1=$FW_META_1 round2=$FW_META_2" >&2
  exit 1
fi

if [[ "$REG_META_1" != "$REG_META_2" ]]; then
  echo "blacklist-registry reproducibility mismatch between rounds." >&2
  echo "round1=$REG_META_1 round2=$REG_META_2" >&2
  exit 1
fi

FW_SHA="$(echo "$FW_META_2" | cut -d, -f1)"
FW_SIZE="$(echo "$FW_META_2" | cut -d, -f2)"
REG_SHA="$(echo "$REG_META_2" | cut -d, -f1)"
REG_SIZE="$(echo "$REG_META_2" | cut -d, -f2)"
HEAD_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"

cat >"$MANIFEST_JSON" <<EOF
{
  "generated_utc": "$STAMP",
  "branch": "$BRANCH",
  "commit": "$HEAD_SHA",
  "target": "$TARGET",
  "rounds": 2,
  "artifacts": [
    {
      "name": "firewall-lock",
      "path": "contracts/firewall-lock/target/$TARGET/release/firewall-lock",
      "sha256": "$FW_SHA",
      "size_bytes": $FW_SIZE
    },
    {
      "name": "blacklist-registry",
      "path": "contracts/blacklist-registry/target/$TARGET/release/blacklist-registry",
      "sha256": "$REG_SHA",
      "size_bytes": $REG_SIZE,
      "features": ["dev-signer-keys"]
    }
  ]
}
EOF

cat >"$MANIFEST_MD" <<EOF
# Phase 3 Artifact Manifest

- Generated (UTC): $STAMP
- Branch: \`$BRANCH\`
- Commit: \`$HEAD_SHA\`
- Determinism check: \`2 clean build rounds\` (PASS)

## Build Commands

\`\`\`bash
cd contracts/firewall-lock
cargo clean
cargo build --release --target=$TARGET

cd ../blacklist-registry
cargo clean
cargo build --release --target=$TARGET --features dev-signer-keys
\`\`\`

## Artifacts

| Artifact | Path | Size (bytes) | SHA256 |
|---|---|---:|---|
| firewall-lock | \`contracts/firewall-lock/target/$TARGET/release/firewall-lock\` | $FW_SIZE | \`$FW_SHA\` |
| blacklist-registry | \`contracts/blacklist-registry/target/$TARGET/release/blacklist-registry\` | $REG_SIZE | \`$REG_SHA\` |

## Machine-readable Output

- \`docs/internal/phase3_artifacts/$(basename "$MANIFEST_JSON")\`
EOF

cp "$MANIFEST_MD" "$LATEST_MD"
cp "$MANIFEST_JSON" "$LATEST_JSON"

prune_artifacts_for_prefix() {
  local prefix="$1"
  mapfile -t old_files < <(ls -1t "$OUT_DIR"/"${prefix}"_* 2>/dev/null \
    | grep -Eiv '(_latest|_LATEST)(\.[a-z0-9]+)?$' \
    | tail -n +"$((MAX_ARTIFACT_SETS + 1))" || true)
  if (( ${#old_files[@]} > 0 )); then
    rm -f "${old_files[@]}"
  fi
}

prune_artifacts_for_prefix "ARTIFACT_MANIFEST"
prune_artifacts_for_prefix "artifact_manifest"

echo "Reproducible artifact manifest written:"
echo " - $MANIFEST_MD"
echo " - $MANIFEST_JSON"
echo " - $LATEST_MD"
echo " - $LATEST_JSON"
