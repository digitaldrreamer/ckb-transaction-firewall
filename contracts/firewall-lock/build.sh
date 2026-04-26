#!/bin/bash
# Build script for Firewall Lock Script
# Run this outside Cursor IDE to avoid rustup proxy issues

set -e  # Exit on error

echo "🔨 Building CKB Firewall Lock Script..."
echo ""

# Find Rust toolchain
RUST_TOOLCHAIN=$(find ~/.rustup/toolchains -type d -name "stable-*" 2>/dev/null | head -1)

if [ -z "$RUST_TOOLCHAIN" ]; then
    echo "❌ Rust toolchain not found!"
    echo "   Please install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

echo "✓ Found Rust toolchain: $RUST_TOOLCHAIN"

# Use cargo from toolchain, rustup from ~/.cargo/bin
CARGO="$RUST_TOOLCHAIN/bin/cargo"
RUSTC="$RUST_TOOLCHAIN/bin/rustc"
RUSTDOC="$RUST_TOOLCHAIN/bin/rustdoc"
RUSTUP="$HOME/.cargo/bin/rustup"
TARGET="riscv64imac-unknown-none-elf"

# Check if RISC-V target is installed
echo ""
echo "📦 Checking RISC-V target..."
if ! $CARGO --version &>/dev/null; then
    echo "❌ Cargo not found at $CARGO"
    exit 1
fi

# Check if target is installed. Force-clean RUSTUP_FORCE_ARG0 to avoid "unknown proxy name: cursor".
if ! env -u RUSTUP_FORCE_ARG0 "$RUSTUP" target list --installed 2>/dev/null | rg -q "$TARGET"; then
    echo "   Installing RISC-V target..."
    env -u RUSTUP_FORCE_ARG0 "$RUSTUP" target add "$TARGET" || {
        echo "   ⚠️  Could not check/install target via rustup (Cursor issue)"
        echo "   Trying build anyway. If target is missing, run this manually:"
        echo "   env -u RUSTUP_FORCE_ARG0 ~/.cargo/bin/rustup target add $TARGET"
    }
else
    echo "✓ RISC-V target already installed"
fi

# Change to contract directory
cd "$(dirname "$0")"
echo ""
echo "📂 Building in: $(pwd)"

# * Force a single compiler toolchain for the whole script
unset RUSTUP_FORCE_ARG0
unset RUSTUP_TOOLCHAIN
unset RUSTC_WRAPPER
export RUSTC="$RUSTC"
export RUSTDOC="$RUSTDOC"

# * Clean stale artifacts from previous rustc versions
echo ""
echo "🧹 Cleaning old build artifacts (prevents E0514 rustc mismatch)..."
rm -rf target
$CARGO clean

echo "🔎 Compiler versions:"
$CARGO --version
$RUSTC --version

# Run tests first
echo ""
echo "🧪 Running unit tests..."
$CARGO test --features std

# Build release binary
echo ""
echo "🏗️  Building release binary..."
$CARGO build --release --target="$TARGET"

# Check if binary was created (contract may output as executable or cdylib)
BINARY_EXEC="target/$TARGET/release/firewall-lock"
BINARY_LIB="target/$TARGET/release/libfirewall_lock.so"
if [ -f "$BINARY_EXEC" ]; then
    BINARY="$BINARY_EXEC"
elif [ -f "$BINARY_LIB" ]; then
    BINARY="$BINARY_LIB"
fi

if [ -n "${BINARY:-}" ] && [ -f "$BINARY" ]; then
    SIZE=$(ls -lh "$BINARY" | awk '{print $5}')
    echo ""
    echo "✅ Build successful!"
    echo "   Binary: $BINARY"
    echo "   Size: $SIZE"
    
    # Check if size is under 100KB
    SIZE_BYTES=$(stat -c%s "$BINARY" 2>/dev/null || stat -f%z "$BINARY" 2>/dev/null)
    if [ $SIZE_BYTES -lt 102400 ]; then
        echo "   ✓ Size under 100KB target"
    else
        echo "   ⚠️  Size exceeds 100KB target (may need optimization)"
    fi
else
    echo ""
    echo "❌ Binary not found at expected location"
    echo "   Expected one of:"
    echo "   - $BINARY_EXEC"
    echo "   - $BINARY_LIB"
    echo "   Checking for alternatives..."
    find target -name "*.so" -o -name "firewall*"
    exit 1
fi

echo ""
echo "🎉 Build complete!"
echo ""
echo "Next steps:"
echo "1. Run integration tests with the binary"
echo "2. Profile cycle usage with ckb-debugger"
echo "3. Deploy to testnet for validation"
