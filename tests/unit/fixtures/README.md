# Test fixtures

## `always_failure_lock`

### What “third-party testdata” means

The bytes in `always_failure_lock` are **not authored in this repository**. They come from the **Nervos CKB** reference codebase (`ckb-script` crate testdata: `testdata/always_failure`). That is what “third-party” means: **another project’s pre-built binary**, copied here so integration tests can run a lock script that **reliably fails** in CKB-VM (non-zero exit), without maintaining our own tiny RISC-V failure program in-tree.

### Why we use it

The firewall lock delegates to an **inner lock** via `spawn_cell`. To assert error **15** (`InnerLockRejected`), the inner script must actually run and exit with failure. `always_failure` is a well-known, minimal test fixture for that behavior.

### Provenance / licensing

Upstream: [https://github.com/nervosnetwork/ckb](https://github.com/nervosnetwork/ckb) — the **`ckb-script`** crate ships `testdata/always_failure` (exact path inside the git tree varies by branch/tag; the crates.io package matches the layout used when recording the hash below).

### Integrity (manual verification)

After any copy or refresh of this file, confirm size and SHA-256:

| Field | Value |
|--------|--------|
| File | `tests/unit/fixtures/always_failure_lock` |
| Size (bytes) | 464 |
| SHA-256 | `4c21801e84dc6b716bba3d07a11af7dd211910403c2aa2ba215722033edc82c0` |

**Recorded source:** byte-identical to `ckb-script` **0.118.0** on crates.io (`testdata/always_failure` in the published crate). To re-verify locally:

```bash
sha256sum tests/unit/fixtures/always_failure_lock
stat -c%s tests/unit/fixtures/always_failure_lock   # byte size for the Size row (Linux)
```

### Replacing this fixture (required checklist)

If you **replace** `always_failure_lock` with a new binary (new CKB release, custom build, or different failure script):

1. Overwrite `tests/unit/fixtures/always_failure_lock` with the new bytes.
2. Recompute **size** and **SHA-256** (commands above) and update the **Integrity** table in this README (`Size (bytes)` and `SHA-256`).
3. Update the **Recorded source** line: set the **`ckb-script` crates.io version** (or document “custom in-repo build” and how to reproduce it).
4. Run `cargo test --test firewall_lock_tests` (from `tests/unit`) and fix any VM or spawn behavior changes.
5. Append a short note to the root `CHANGELOG.md` so the fixture change is traceable in release history.

Until those rows and the version line match the file on disk, integrity checks and audits will disagree with the committed blob.

