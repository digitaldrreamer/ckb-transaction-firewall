# Alternative Build Setup (Modern Approach)

## Issue with `ckb-capsule`

The error you encountered is a known dependency conflict in `ckb-capsule` v0.10.5 due to multiple versions of CKB crates in the dependency tree.

## ✅ **Recommended Solution: Use `ckb-script-templates`**

The CKB ecosystem has moved to `ckb-script-templates` which provides a better maintained build system.

### Quick Setup

```bash
# 1. You already have cargo-generate installed! ✓
which cargo-generate

# 2. Fix Rust PATH issue
# Add to ~/.bashrc or ~/.zshrc:
export PATH="$HOME/.cargo/bin:$PATH"

# Then reload:
source ~/.bashrc  # or source ~/.zshrc
```

### Build the Firewall Lock

**Option A: Standalone Build (Simplest)**

```bash
cd contracts/firewall-lock

# Build using cargo directly (no capsule needed!)
cargo build --release --target=riscv64imac-unknown-none-elf

# Binary will be at:
# target/riscv64imac-unknown-none-elf/release/firewall-lock
```

**Option B: Use ckb-script-templates Makefile (Recommended)**

```bash
# Generate a proper build setup
cd /tmp
cargo generate gh:cryptape/ckb-script-templates standalone-contract --name firewall-lock-build

# Copy our implementation
cp /home/digitaldrreamer/Documents/Projects/ckb-transaction-firewall/contracts/firewall-lock/src/main.rs \
   firewall-lock-build/src/main.rs

cp /home/digitaldrreamer/Documents/Projects/ckb-transaction-firewall/contracts/firewall-lock/Cargo.toml \
   firewall-lock-build/Cargo.toml

# Build with Makefile
cd firewall-lock-build
make build

# Binary at: build/release/firewall-lock
```

### Prerequisites Check

```bash
# 1. Check Rust
rustc --version
# Expected: rustc 1.70+ or later

# 2. Add RISC-V target (if not present)
rustup target add riscv64imac-unknown-none-elf

# 3. Check LLVM/clang (optional, for C code)
clang --version
# If missing: sudo apt install llvm clang  (on Ubuntu/Debian)
```

### Minimal Cargo.toml for Direct Build

If you want the simplest approach, here's a minimal `Cargo.toml` that builds directly:

```toml
[package]
name = "firewall-lock"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
ckb-std = { version = "0.16.2", default-features = false }
molecule = { version = "0.8.0", default-features = false }
cfg-if = "1.0"

[profile.release]
overflow-checks = true
opt-level = "s"
lto = true
codegen-units = 1
panic = "abort"
strip = true

[features]
default = []
std = ["ckb-std/std", "molecule/std"]
```

### Build Commands

```bash
# From contracts/firewall-lock/

# 1. Add RISC-V target (one-time)
rustup target add riscv64imac-unknown-none-elf

# 2. Build
cargo build --release --target=riscv64imac-unknown-none-elf

# 3. Check binary size
ls -lh target/riscv64imac-unknown-none-elf/release/firewall-lock

# 4. Run tests
cargo test --features std
```

### Why This Works

- **No capsule dependency**: Direct cargo build avoids version conflicts
- **Modern approach**: Aligns with current CKB development practices (2026)
- **Simpler**: Fewer moving parts, easier to debug
- **Well-supported**: ckb-script-templates actively maintained

### Next Steps

1. **Fix Rust PATH**:
   ```bash
   echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.bashrc
   source ~/.bashrc
   ```

2. **Add RISC-V target**:
   ```bash
   $HOME/.cargo/bin/rustup target add riscv64imac-unknown-none-elf
   ```

3. **Try direct build**:
   ```bash
   cd contracts/firewall-lock
   $HOME/.cargo/bin/cargo build --release --target=riscv64imac-unknown-none-elf
   ```

4. **If successful**, binary will be at:
   ```
   target/riscv64imac-unknown-none-elf/release/firewall-lock
   ```

### Troubleshooting

**If build fails with linker errors**:
```bash
# Install RISC-V GCC toolchain
# Ubuntu/Debian:
sudo apt install gcc-riscv64-unknown-elf

# Or use LLVM's lld
rustup component add llvm-tools-preview
```

**If you need debugging symbols**:
```bash
cargo build --target=riscv64imac-unknown-none-elf  # debug mode
```

### Integration with Testing

Once you have the binary, update the test path:

```rust
// tests/unit/tests/firewall_lock_tests.rs

const FIREWALL_LOCK_BINARY: &[u8] = include_bytes!(
    "../../../contracts/firewall-lock/target/riscv64imac-unknown-none-elf/release/firewall-lock"
);
```

---

## Summary

✅ **You don't need capsule!**  
✅ **Use direct cargo build** or `ckb-script-templates`  
✅ **Your Cargo.toml is already correct**  
✅ **Just need to fix PATH and add RISC-V target**
