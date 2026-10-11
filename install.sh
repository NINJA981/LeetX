#!/usr/bin/env bash
# LeetX Squads installer for macOS & Linux (Chromium browsers, unpacked).
# Installs the latest *released* build, never unreleased code from main.
#   curl -fsSL https://raw.githubusercontent.com/NINJA981/LeetX/main/install.sh | bash
set -euo pipefail

REPO="NINJA981/LeetX"
INSTALL_DIR="${LEETX_INSTALL_DIR:-$HOME/leetx-squads}"
ZIP_URL="https://github.com/${REPO}/releases/latest/download/leetx-chrome.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "LeetX Squads installer"
echo "→ Downloading the latest release…"
curl -fsSL "$ZIP_URL" -o "$TMP/leetx.zip"

echo "→ Installing to $INSTALL_DIR"
mkdir -p "$TMP/x"
unzip -q "$TMP/leetx.zip" -d "$TMP/x"
if [ ! -f "$TMP/x/manifest.json" ]; then
  echo "Downloaded package is missing manifest.json - aborting." >&2
  exit 1
fi
rm -rf "$INSTALL_DIR"
mkdir -p "$(dirname "$INSTALL_DIR")"
mv "$TMP/x" "$INSTALL_DIR"

if command -v pbcopy >/dev/null 2>&1; then printf '%s' "$INSTALL_DIR" | pbcopy && echo "→ Folder path copied to clipboard"
elif command -v xclip >/dev/null 2>&1; then printf '%s' "$INSTALL_DIR" | xclip -selection clipboard && echo "→ Folder path copied to clipboard"
fi

cat <<EOF

Done. To finish:
  1. Open chrome://extensions (or edge://extensions, brave://extensions)
  2. Turn on Developer mode
  3. Click "Load unpacked" and choose: $INSTALL_DIR

Re-run this script any time to update.
EOF
