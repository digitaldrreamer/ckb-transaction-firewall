#!/usr/bin/env bash
# Install @ckb-firewall/cli and make `ckb-firewall` available as a system command.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/digitaldrreamer/ckb-transaction-firewall/main/scripts/install-cli.sh | bash
#   — or —
#   ./scripts/install-cli.sh
#
# Windows: run inside Git Bash, WSL, or use `npm install -g @ckb-firewall/cli` directly.

set -euo pipefail

PACKAGE="@ckb-firewall/cli"
BIN="ckb-firewall"
MIN_NODE_MAJOR=20

# ── joke API ──────────────────────────────────────────────────────────────────
# Tries three joke APIs in order; silently skips each on failure.
# Called once at the end of a successful install.
fetch_joke(){
  local joke="" resp="" setup="" delivery=""
  # ── helper: extract a JSON string value by key (no jq required) ──────────
  _jval(){ echo "$1" | grep -o '"'"$2"'":"[^"]*"' | sed 's/"'"$2"'":"//;s/"//' | head -1; }

  # 1. JokeAPI v2 (sv443.net) — fetch once, parse setup + delivery
  if command -v curl >/dev/null 2>&1; then
    resp="$(curl -fsSL --max-time 5 \
      'https://v2.jokeapi.dev/joke/Any?blacklistFlags=nsfw,racist,sexist&type=twopart' \
      2>/dev/null)" || true
    setup="$(_jval "$resp" "setup")"
    delivery="$(_jval "$resp" "delivery")"
    [ -n "$setup" ] && [ -n "$delivery" ] && joke="$setup"$'\n'"  ↳ $delivery"
  fi

  # 2. Official Joke API (appspot) — fetch once, parse setup + punchline
  if [ -z "$joke" ] && command -v curl >/dev/null 2>&1; then
    resp="$(curl -fsSL --max-time 5 \
      'https://official-joke-api.appspot.com/random_joke' \
      2>/dev/null)" || true
    setup="$(_jval "$resp" "setup")"
    delivery="$(_jval "$resp" "punchline")"
    [ -n "$setup" ] && [ -n "$delivery" ] && joke="$setup"$'\n'"  ↳ $delivery"
  fi

  # 3. icanhazdadjoke (plain text)
  if [ -z "$joke" ] && command -v curl >/dev/null 2>&1; then
    joke="$(curl -fsSL --max-time 5 -H 'Accept: text/plain' \
      'https://icanhazdadjoke.com/' 2>/dev/null)" || true
  fi

  [ -n "$joke" ] && printf '\n\033[2m%s\033[0m\n' "😂  $joke"
}

# Unique temp file; cleaned up automatically on exit.
_TMPFILE="$(mktemp)"
trap 'rm -f "$_TMPFILE"' EXIT

# ── helpers ──────────────────────────────────────────────────────────────────

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }
step()   { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

die() { red "error: $*"; exit 1; }

# ── detect os ────────────────────────────────────────────────────────────────

OS="$(uname -s 2>/dev/null || echo unknown)"
case "$OS" in
  Darwin) PLATFORM="macOS" ;;
  Linux)  PLATFORM="Linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="Windows (Git Bash)" ;;
  *)      PLATFORM="$OS" ;;
esac

bold "CKB Firewall CLI installer"
echo "Platform: $PLATFORM"

# ── check node ───────────────────────────────────────────────────────────────

step "Checking Node.js"

if ! command -v node >/dev/null 2>&1; then
  red "Node.js not found."
  echo
  echo "Install Node.js $MIN_NODE_MAJOR+ using one of:"
  echo "  nvm (recommended):  https://github.com/nvm-sh/nvm"
  echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash"
  echo "    nvm install $MIN_NODE_MAJOR"
  echo "  Homebrew (macOS):   brew install node"
  echo "  Official installer: https://nodejs.org"
  exit 1
fi

NODE_VERSION="$(node --version)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"

if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  die "Node.js $MIN_NODE_MAJOR+ required, found $NODE_VERSION. Upgrade with: nvm install $MIN_NODE_MAJOR"
fi

echo "  Node.js $NODE_VERSION $(green ok)"

# ── check npm ────────────────────────────────────────────────────────────────

if ! command -v npm >/dev/null 2>&1; then
  die "npm not found — reinstall Node.js from https://nodejs.org"
fi

NPM_VERSION="$(npm --version)"
echo "  npm $NPM_VERSION $(green ok)"

# ── install ───────────────────────────────────────────────────────────────────

step "Installing $PACKAGE"

NPM_GLOBAL_PREFIX="$(npm prefix -g)"
NPM_GLOBAL_BIN="$NPM_GLOBAL_PREFIX/bin"

# Capture previous version (if any) before installing.
PREV_VERSION=""
if command -v "$BIN" >/dev/null 2>&1; then
  PREV_VERSION="$("$BIN" --version 2>/dev/null | head -1 | tr -d '[:space:]')" || true
fi

# Try a standard global install first. If it fails with a permission error,
# fall back to a user-local prefix that never needs sudo.
if npm install -g "$PACKAGE" 2>"$_TMPFILE"; then
  INSTALL_METHOD="global"
else
  ERR_OUTPUT="$(cat "$_TMPFILE")"

  if echo "$ERR_OUTPUT" | grep -qiE "EACCES|permission denied"; then
    yellow "Global install needs elevated permissions — installing to ~/.local instead."
    LOCAL_PREFIX="$HOME/.local"
    mkdir -p "$LOCAL_PREFIX/bin"
    npm install -g --prefix "$LOCAL_PREFIX" "$PACKAGE"
    NPM_GLOBAL_BIN="$LOCAL_PREFIX/bin"
    INSTALL_METHOD="local-prefix"
  else
    echo "$ERR_OUTPUT" >&2
    die "npm install failed — see output above."
  fi
fi

# ── verify and fix PATH ───────────────────────────────────────────────────────

step "Verifying installation"

BIN_PATH="$NPM_GLOBAL_BIN/$BIN"

if [ ! -f "$BIN_PATH" ]; then
  die "Binary not found at $BIN_PATH after install. Check npm logs."
fi

if command -v "$BIN" >/dev/null 2>&1; then
  green "  $BIN is already in PATH"
  PATH_OK=1
else
  yellow "  $BIN not yet in PATH"
  PATH_OK=0
fi

# ── PATH instructions (only when needed) ─────────────────────────────────────

if [ "$PATH_OK" -eq 0 ]; then
  echo
  bold "Add the following line to your shell profile, then restart your terminal:"
  echo

  EXPORT_LINE="export PATH=\"$NPM_GLOBAL_BIN:\$PATH\""

  # Detect shell and suggest the right profile file.
  SHELL_NAME="$(basename "${SHELL:-bash}")"
  case "$SHELL_NAME" in
    zsh)   PROFILE="~/.zshrc" ;;
    fish)  PROFILE="~/.config/fish/config.fish"
           EXPORT_LINE="fish_add_path $NPM_GLOBAL_BIN" ;;
    *)     PROFILE="~/.bashrc" ;;
  esac

  echo "  $EXPORT_LINE"
  echo
  echo "  (Add to $PROFILE)"
  echo
  echo "Or reload now in this session:"
  if [ "$SHELL_NAME" = "fish" ]; then
    echo "  fish_add_path $NPM_GLOBAL_BIN"
  else
    echo "  export PATH=\"$NPM_GLOBAL_BIN:\$PATH\""
  fi

  # Offer to append automatically.
  if [ -t 0 ]; then
    echo
    read -rp "Append to $PROFILE automatically? [y/N] " REPLY
    if [[ "${REPLY:-n}" =~ ^[Yy]$ ]]; then
      PROFILE_PATH="${PROFILE/#\~/$HOME}"
      {
        echo ""
        echo "# Added by ckb-firewall installer"
        echo "$EXPORT_LINE"
      } >> "$PROFILE_PATH"
      green "  Written to $PROFILE_PATH"
      # Apply in current session.
      export PATH="$NPM_GLOBAL_BIN:$PATH"
      PATH_OK=1
    fi
  fi
fi

# ── done ─────────────────────────────────────────────────────────────────────

# Detect new version (may not be in PATH yet if PATH_OK=0).
NEW_VERSION=""
if command -v "$BIN" >/dev/null 2>&1; then
  NEW_VERSION="$("$BIN" --version 2>/dev/null | head -1 | tr -d '[:space:]')" || true
elif [ -f "$NPM_GLOBAL_BIN/$BIN" ]; then
  NEW_VERSION="$("$NPM_GLOBAL_BIN/$BIN" --version 2>/dev/null | head -1 | tr -d '[:space:]')" || true
fi

echo
if [ "$PATH_OK" -eq 1 ] && command -v "$BIN" >/dev/null 2>&1; then
  if [ -n "$PREV_VERSION" ] && [ "$PREV_VERSION" != "$NEW_VERSION" ]; then
    green "Updated $BIN: $PREV_VERSION → $NEW_VERSION"
  elif [ -n "$PREV_VERSION" ] && [ "$PREV_VERSION" = "$NEW_VERSION" ]; then
    green "Already up to date: $BIN $NEW_VERSION"
  else
    green "Installed $BIN ${NEW_VERSION:-successfully}."
  fi
  echo
  bold "Try it:"
  echo "  $BIN inspect          # view current testnet blacklist"
  echo "  $BIN add --help       # add an address (governance tx)"
  echo "  $BIN --help           # all commands"
  fetch_joke
else
  if [ -n "$NEW_VERSION" ]; then
    yellow "Installed $BIN $NEW_VERSION — restart your terminal, then run: $BIN --help"
  else
    yellow "Installation complete — restart your terminal, then run: $BIN --help"
  fi
  fetch_joke
fi
echo
