#!/bin/bash
# ============================================
#  ClassNode - Build distribution copy
#  Copies the project and cleans user data.
#  Does NOT install dependencies or build.
# ============================================

set -e

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="1.0.0"
DEFAULT_DST="${SRC_DIR}-v${VERSION}"

echo ""
echo "=========================================="
echo "  ClassNode - Build Distribution v${VERSION}"
echo "=========================================="
echo ""
echo "Source: $SRC_DIR"

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
  --exclude='server/prisma/dev.db' \
  --exclude='server/uploads/chat' \
  --exclude='server/uploads/logos' \
  --exclude='server/backups' \
  --exclude='src-tauri' \
  --exclude='.pnpm-store' \
  --exclude='pnpm-lock.yaml' \
  --exclude='pnpm-workspace.yaml' \
  --exclude='make-dist.sh' \
  --exclude='tsconfig.tsbuildinfo' \
  --exclude='next-env.d.ts' \
  --exclude='eslint.config.mjs' \
  --exclude='server/.env' \
  --exclude='.git' \
  --exclude='.DS_Store' \
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

echo "Distribution directory created at: $DST_DIR"
echo "   Size: $(du -sh "$DST_DIR" | cut -f1)"
echo ""
echo "   Next steps for the recipient:"
echo "   1. cd $DST_DIR"
echo "   2. npm install"
echo "   3. cd server && npm install && node_modules/.bin/prisma db push && node_modules/.bin/tsc && cd .."
echo "   4. node_modules/.bin/next build --no-lint"
echo "   5. start-classnode-mac.command (macOS) / start-classnode-win.bat (Windows)"
