#!/usr/bin/env bash
# Package a release tarball for distribution.
# Usage: bash scripts/package-release.sh
# Output: release/dkc-v<version>.tar.gz
#
# The tarball is self-contained: no npm install needed for core functionality.
# Only @anthropic-ai/sdk and openai are optional (for LLM-enhanced mode).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION=$(node -e "console.log(require('./package.json').version)")
RELEASE_DIR="$ROOT/release"
STAGING="$RELEASE_DIR/dkc-v${VERSION}"

echo "Packaging DKC v${VERSION}..."

# Clean
rm -rf "$RELEASE_DIR"
mkdir -p "$STAGING"

# Ensure release build exists
if [ ! -f "dist/cli/index.js" ]; then
  echo "Error: dist/ not found. Run 'npm run build:release' first."
  exit 1
fi

# Copy dist (bundled JS, no source maps)
cp -r dist "$STAGING/dist"

# Copy plugin structure
cp -r .claude-plugin "$STAGING/.claude-plugin"
cp -r hooks "$STAGING/hooks"
cp -r commands "$STAGING/commands"
cp -r skills "$STAGING/skills"
cp -r agents "$STAGING/agents"

# Copy docs
cp README.md "$STAGING/"
cp LICENSE "$STAGING/"
cp CHANGELOG.md "$STAGING/"
cp .env.example "$STAGING/"
cp install.sh "$STAGING/"

# Create minimal package.json (no source deps, only optional LLM SDKs)
node -e "
const pkg = require('./package.json');
const minimal = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  author: pkg.author,
  license: pkg.license,
  type: 'module',
  bin: { dkc: './dist/cli/index.js' },
  engines: pkg.engines,
  optionalDependencies: {
    '@anthropic-ai/sdk': pkg.dependencies['@anthropic-ai/sdk'] || '^0.85.0',
    'openai': pkg.dependencies['openai'] || '^6.33.0',
  },
};
process.stdout.write(JSON.stringify(minimal, null, 2) + '\n');
" > "$STAGING/package.json"

# Make CLI executable
chmod +x "$STAGING/dist/cli/index.js"
chmod +x "$STAGING/install.sh"

# Create tarball
cd "$RELEASE_DIR"
tar -czf "dkc-v${VERSION}.tar.gz" "dkc-v${VERSION}"

# Cleanup staging
rm -rf "$STAGING"

SIZE=$(du -h "dkc-v${VERSION}.tar.gz" | cut -f1)
echo ""
echo "  Release: release/dkc-v${VERSION}.tar.gz ($SIZE)"
echo ""
echo "  Contents (no source code):"
echo "    dist/           — Bundled JS (self-contained)"
echo "    .claude-plugin/ — Plugin manifest"
echo "    hooks/          — Hook config"
echo "    commands/       — Slash commands"
echo "    skills/         — Skill definitions"
echo "    agents/         — Agent definitions"
echo "    package.json    — Minimal (optional LLM deps only)"
echo ""
echo "  To test: tar xzf dkc-v${VERSION}.tar.gz && cd dkc-v${VERSION} && node dist/cli/index.js --help"
echo ""
