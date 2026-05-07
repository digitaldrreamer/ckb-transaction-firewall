# Phase 3 Artifact Manifest

- Generated (UTC): 20260506T114735Z
- Branch: `feat/phase3-verification-hardening`
- Commit: `e31fae8679437dcc6d245800544ac2ef9ac58efe`
- Determinism check: `2 clean build rounds` (PASS)

## Build Commands

```bash
cd contracts/firewall-lock
cargo clean
cargo build --locked --release --target=riscv64imac-unknown-none-elf

cd ../blacklist-registry
cargo clean
cargo build --locked --release --target=riscv64imac-unknown-none-elf --features dev-signer-keys
```

## Artifacts

| Artifact | Path | Size (bytes) | SHA256 |
|---|---|---:|---|
| firewall-lock | `contracts/firewall-lock/target/riscv64imac-unknown-none-elf/release/firewall-lock` | 23336 | `7c2f6dfb429ddba22be9bae6fd38ad9d7aa51636a07ce61209ca1eb8f10b46e2` |
| blacklist-registry | `contracts/blacklist-registry/target/riscv64imac-unknown-none-elf/release/blacklist-registry` | 98256 | `fd704f21d808015a63c97dfd9db594d32deafc969acd0287c9be9db66581d21d` |

## Machine-readable Output

- `phase3_artifacts/artifact_manifest_20260506T114735Z.json`

## Scope Note

- `blacklist-registry` artifact in this manifest is a pre-production dev-key build (`--features dev-signer-keys`).
- Production signer-set finalization requires a separate production manifest and SHA256 set.
