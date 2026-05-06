# Quick Build Guide

## ✅ What I Fixed

1. **Cargo.toml Issues**:
   - Changed `edition = "2026"` → `edition = "2021"` (2026 doesn't exist)
   - Added `[lib] crate-type = ["cdylib"]` for CKB script output

2. **Created build.sh**: Automated build script that bypasses Cursor rustup issues

## 🚀 How to Build (Run Outside Cursor)

### Option 1: Use the Build Script (Easiest)

```bash
cd ~/Documents/Projects/ckb-transaction-firewall/contracts/firewall-lock
./build.sh
```

The script will:
- Find your Rust toolchain
- Install RISC-V target if needed
- Run unit tests
- Build the release binary
- Report binary size

### Option 2: Manual Build

```bash
cd ~/Documents/Projects/ckb-transaction-firewall/contracts/firewall-lock

# Find your Rust toolchain
RUST_TOOLCHAIN=$(find ~/.rustup/toolchains -type d -name "stable-*" | head -1)

# Add RISC-V target (one-time)
$RUST_TOOLCHAIN/bin/rustup target add riscv64imac-unknown-none-elf

# Build
$RUST_TOOLCHAIN/bin/cargo build --release --target=riscv64imac-unknown-none-elf

# Check result
ls -lh target/riscv64imac-unknown-none-elf/release/libfirewall_lock.so
```

## 📦 Expected Output

```
target/riscv64imac-unknown-none-elf/release/libfirewall_lock.so
```

**Target size**: <100KB

## 🧪 Run Tests

```bash
# Unit tests (uses std feature)
$RUST_TOOLCHAIN/bin/cargo test --features std

# Or use the build script which runs tests first
./build.sh
```

## 🐛 Troubleshooting

### "error: unknown proxy name: 'cursor'"
- **Cause**: Running inside Cursor IDE's integrated terminal
- **Fix**: Run in a regular terminal (GNOME Terminal, Konsole, etc.)

### "target not found: riscv64imac-unknown-none-elf"
```bash
$RUST_TOOLCHAIN/bin/rustup target add riscv64imac-unknown-none-elf
```

### "linker `rust-lld` not found"
```bash
$RUST_TOOLCHAIN/bin/rustup component add llvm-tools-preview
```

### Binary not at expected location
```bash
# Search for it
find target -name "*.so" -o -name "*firewall*"
```

## ✅ Success Checklist

After running `./build.sh`, you should see:

- [x] All 24 unit tests pass
- [x] Binary created at `target/riscv64imac-unknown-none-elf/release/libfirewall_lock.so`
- [x] Size under 100KB (ideally ~20-50KB)

## 📝 Next Steps After Build

1. **Update Integration Tests**:
   ```rust
   // tests/unit/tests/firewall_lock_tests.rs
   const FIREWALL_BINARY: &[u8] = include_bytes!(
       "../../../contracts/firewall-lock/target/riscv64imac-unknown-none-elf/release/libfirewall_lock.so"
   );
   ```

2. **Run Integration Tests**:
   ```bash
   cd ../../tests/unit
   cargo test
   ```

3. **Profile Cycles** (if ckb-debugger installed):
   ```bash
   ckb-debugger --bin target/riscv64imac-unknown-none-elf/release/libfirewall_lock.so
   ```

## 💡 Tips

- **Always build outside Cursor** to avoid rustup issues
- **Run tests before building** - the script does this automatically
- **Check binary size** - if >100KB, may need optimization
- **Keep the binary** for integration testing

## 🎯 Current Status

- ✅ Source code complete (831 lines)
- ✅ Unit tests complete (24 tests)
- ✅ Cargo.toml fixed
- ✅ Build script ready
- ⏳ **Next: Run `./build.sh` to compile**

---

**Run this now** (in a regular terminal, not Cursor):

```bash
cd ~/Documents/Projects/ckb-transaction-firewall/contracts/firewall-lock
./build.sh
```

Then report back the output!
