#!/bin/bash
# ============================================
#  ClassNode - Build distribution copy
#  Copies the project and cleans user data.
#  Does NOT install dependencies or build.
# ============================================

set -e

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")"
DEFAULT_DST="${SRC_DIR}-${VERSION}"

echo ""
echo "=========================================="
echo "  ClassNode - Build Distribution v${VERSION}"
echo "=========================================="
echo ""
echo "Source: $SRC_DIR"

# Port note: 3001 (frontend) and 3002 (backend) are intentionally hardcoded
# in api-base.ts, page.tsx, standalone-*.html, serve-frontend.js, and startup scripts.
echo "  Ports: frontend=3001, backend=3002"

read -p "Destination (default: ${DEFAULT_DST}): " DST_DIR
DST_DIR="${DST_DIR:-$DEFAULT_DST}"

if [ -d "$DST_DIR" ]; then
  echo ""
  echo "Destination already exists: $DST_DIR"
  read -p "Overwrite? (y/N): " CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Cancelled."
    exit 1
  fi
  rm -rf "$DST_DIR"
fi

echo ""
echo "Copying project..."

rsync -av \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='out' \
  --exclude='server/node_modules' \
  --exclude='server/dist' \
  --exclude='server/frontend' \
  --exclude='server/prisma/dev.db' \
  --exclude='server/uploads/chat' \
  --exclude='server/uploads/logos' \
  --exclude='server/backups' \
  --exclude='src-tauri' \
  --exclude='.pnpm-store' \
  --exclude='pnpm-lock.yaml' \
  --exclude='pnpm-workspace.yaml' \
  --exclude='make-dist.sh' \
  --exclude='build-release.sh' \
  --exclude='release-full.sh' \
  --exclude='download-release.sh' \
  --exclude='upload-dist.sh' \
  --exclude='SCRIPTS.md' \
  --exclude='tsconfig.tsbuildinfo' \
  --exclude='next-env.d.ts' \
  --exclude='eslint.config.mjs' \
  --exclude='dev.md' \
  --exclude='dev.sh' \
  --exclude='server/.env' \
  --exclude='.env.development' \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='CLAUDE.md' \
  --exclude='memory/' \
  --exclude='portal/' \
  --exclude='scripts/' \
  --exclude='.npmrc' \
  "$SRC_DIR/" "$DST_DIR/" 2>/dev/null

echo "Copy complete"

cd "$DST_DIR"

# Remove pnpm workspace config
rm -f pnpm-workspace.yaml pnpm-lock.yaml

# Remove any leftover database to ensure fresh start
rm -f server/prisma/dev.db server/prisma/dev.db-journal

# Generate config files for fresh start
cat > ".npmrc" << 'NPMRC'
registry=https://registry.npmmirror.com/
NPMRC

# Generate .env with relative path (uses its own database, not the dev copy)
cat > "server/.env" << 'ENV'
DATABASE_URL="file:./dev.db"
ENV

echo "Packaging distribution..."
ZIP_FILE="${DST_DIR}.zip"
rm -f "$ZIP_FILE"
(cd "$(dirname "$DST_DIR")" && zip -r "$(basename "$ZIP_FILE")" "$(basename "$DST_DIR")" > /dev/null 2>&1)
echo ""
echo "Distribution created:"
echo "   Directory: $DST_DIR"
echo "   Size:      $(du -sh "$DST_DIR" | cut -f1)"
echo "   Archive:   ${ZIP_FILE}"
echo "   Zip size:  $(du -sh "$ZIP_FILE" | cut -f1)"
echo ""
echo "Share the ZIP file with the end user."
echo "The user just needs to: unzip, cd, node start.js"
