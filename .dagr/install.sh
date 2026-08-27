#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HOME/.local/bin"
TARGET="$BIN_DIR/dagr"

mkdir -p "$BIN_DIR"
ln -sf "$SCRIPT_DIR/dagr" "$TARGET"

echo "Installed: $TARGET"
echo "Make sure $BIN_DIR is in your PATH (add to ~/.zshrc or ~/.bashrc):"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
