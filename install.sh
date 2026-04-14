#!/usr/bin/env bash
# DKC Installer — Developer Knowledge Compiler
# Usage:
#   bash install.sh                    # Install from GitHub release
#   bash install.sh /path/to/dir       # Custom install directory
#   bash install.sh --local dkc.tar.gz # Install from local tarball
#
# Default install dir: ~/.dkc

set -euo pipefail

VERSION="1.0.0"
GITHUB_REPO="YOUR_USERNAME/claude-knowledge-compiler"
DEFAULT_DIR="$HOME/.dkc"
INSTALL_DIR="$DEFAULT_DIR"
LOCAL_TARBALL=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      LOCAL_TARBALL="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: bash install.sh [--local tarball.tar.gz] [install-dir]"
      echo "  Default: downloads from GitHub and installs to ~/.dkc"
      exit 0 ;;
    *)
      INSTALL_DIR="$1"; shift ;;
  esac
done

# Colors
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
fi

info()  { echo -e "${CYAN}[DKC]${NC} $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}  !${NC} $*"; }

echo ""
echo -e "${BOLD}Developer Knowledge Compiler (DKC) v${VERSION}${NC}"
echo ""

# Check Node.js
command -v node >/dev/null 2>&1 || { echo "Error: Node.js >= 18 required. Install from https://nodejs.org"; exit 1; }
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Error: Node.js >= 18 required (found v${NODE_VERSION})"
  exit 1
fi
ok "Node.js v$(node -v | sed 's/v//') found"

# Get tarball
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

if [ -n "$LOCAL_TARBALL" ]; then
  # Install from local tarball
  if [ ! -f "$LOCAL_TARBALL" ]; then
    echo "Error: File not found: $LOCAL_TARBALL"
    exit 1
  fi
  info "Installing from local tarball: $LOCAL_TARBALL"
  cp "$LOCAL_TARBALL" "$TMPDIR/dkc.tar.gz"
else
  # Download from GitHub releases
  TARBALL_URL="https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/dkc-v${VERSION}.tar.gz"
  info "Downloading DKC v${VERSION}..."

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$TARBALL_URL" -o "$TMPDIR/dkc.tar.gz" || {
      echo ""
      echo "Error: Download failed. The release may not exist yet."
      echo "Alternative: download the tarball manually and run:"
      echo "  bash install.sh --local /path/to/dkc-v${VERSION}.tar.gz"
      exit 1
    }
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$TARBALL_URL" -O "$TMPDIR/dkc.tar.gz" || {
      echo "Error: Download failed."
      exit 1
    }
  else
    echo "Error: curl or wget required for download."
    exit 1
  fi
  ok "Downloaded"
fi

# Extract
info "Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
tar -xzf "$TMPDIR/dkc.tar.gz" --strip-components=1 -C "$INSTALL_DIR"
ok "Extracted"

# Make CLI executable
chmod +x "$INSTALL_DIR/dist/cli/index.js" 2>/dev/null || true

# Verify
if [ ! -f "$INSTALL_DIR/dist/hooks/session-start.js" ]; then
  echo "Error: Installation verification failed."
  exit 1
fi
if [ ! -f "$INSTALL_DIR/.claude-plugin/plugin.json" ]; then
  echo "Error: Plugin manifest missing."
  exit 1
fi
ok "Verified"

# Optional: install LLM SDKs
echo ""
if [ -t 0 ]; then
  echo -en "Install optional LLM SDKs for richer compilation? (13MB) [y/N] "
  read -r REPLY
  if [ "$REPLY" = "Y" ] || [ "$REPLY" = "y" ]; then
    info "Installing @anthropic-ai/sdk and openai..."
    cd "$INSTALL_DIR"
    npm install --save-optional 2>/dev/null || npm install
    ok "LLM SDKs installed"
  else
    ok "Skipped — DKC will use deterministic mode (works fine without API key)"
  fi
else
  info "Non-interactive mode — skipping optional LLM SDKs"
  info "To install later: cd $INSTALL_DIR && npm install"
fi

# Shell alias
SHELL_CONFIG=""
if [ -f "$HOME/.zshrc" ]; then
  SHELL_CONFIG="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  SHELL_CONFIG="$HOME/.bashrc"
elif [ -f "$HOME/.bash_profile" ]; then
  SHELL_CONFIG="$HOME/.bash_profile"
fi

ALIAS_LINE="alias claude='claude --plugin-dir $INSTALL_DIR'"

if [ -n "$SHELL_CONFIG" ] && [ -t 0 ]; then
  if grep -qF "plugin-dir" "$SHELL_CONFIG" 2>/dev/null; then
    ok "Claude alias already exists in $SHELL_CONFIG"
  else
    echo ""
    echo -en "Add Claude Code alias to ${BOLD}${SHELL_CONFIG}${NC}? [Y/n] "
    read -r REPLY
    if [ -z "$REPLY" ] || [ "$REPLY" = "Y" ] || [ "$REPLY" = "y" ]; then
      echo "" >> "$SHELL_CONFIG"
      echo "# DKC — Developer Knowledge Compiler plugin" >> "$SHELL_CONFIG"
      echo "$ALIAS_LINE" >> "$SHELL_CONFIG"
      ok "Alias added"
    fi
  fi
fi

echo ""
echo -e "${GREEN}${BOLD}Installation complete!${NC}"
echo ""
echo -e "${BOLD}Next steps:${NC}"
echo ""
if [ -n "$SHELL_CONFIG" ]; then
  echo -e "  1. Reload shell:  ${CYAN}source $SHELL_CONFIG${NC}"
else
  echo "  1. Add alias:  $ALIAS_LINE"
fi
echo -e "  2. Init project:  ${CYAN}cd /your/project && node $INSTALL_DIR/dist/cli/index.js init${NC}"
echo -e "  3. Start coding — DKC works automatically."
echo ""
echo -e "  (Optional) Set up LLM key for richer output:"
echo -e "     ${CYAN}cp $INSTALL_DIR/.env.example $INSTALL_DIR/.env${NC}"
echo ""
