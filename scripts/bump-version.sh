#!/bin/bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "用法: $0 <新版本号>"
  echo "示例: $0 1.1.0"
  exit 1
fi

VERSION="$1"

# 验证版本号格式
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "错误: 版本号格式必须为 X.Y.Z (如 1.1.0)"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 获取旧版本号
OLD_VERSION="$(node -p "require('$ROOT/package.json').version")"
if [ "$OLD_VERSION" = "$VERSION" ]; then
  echo "版本号未变化（$VERSION），跳过"
  exit 0
fi

echo "更新版本号: $OLD_VERSION → $VERSION"
echo ""

# ── 更新版本号文件 ──────────────────────────────────

# 1. package.json（根目录）
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" "$ROOT/package.json"
echo "  ✓ package.json"

# 2. server/package.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" "$ROOT/server/package.json"
echo "  ✓ server/package.json"

# 3. src-tauri/resources/server/package.json（Tauri 捆绑的服务器版本）
if [ -f "$ROOT/src-tauri/resources/server/package.json" ]; then
  sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" "$ROOT/src-tauri/resources/server/package.json"
  echo "  ✓ src-tauri/resources/server/package.json"
fi

# 3. tauri.conf.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" "$ROOT/src-tauri/tauri.conf.json"
echo "  ✓ src-tauri/tauri.conf.json"

# 4. Cargo.toml
sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" "$ROOT/src-tauri/Cargo.toml"
echo "  ✓ src-tauri/Cargo.toml"

# 5. README.md（cd 命令中的版本号）
sed -i '' "s/classnode-v[0-9]*\.[0-9]*\.[0-9]*/classnode-v$VERSION/g" "$ROOT/README.md"
echo "  ✓ README.md"

# 6. README.en.md
sed -i '' "s/classnode-v[0-9]*\.[0-9]*\.[0-9]*/classnode-v$VERSION/g" "$ROOT/README.en.md"
echo "  ✓ README.en.md"

# 7. portal/index.html（页头版本号）
sed -i '' "s/v[0-9]*\.[0-9]*\.[0-9]*/v$VERSION/g" "$ROOT/portal/index.html"
echo "  ✓ portal/index.html"

# 8. portal/deploy.html（示例命令中的版本号）
sed -i '' "s/classnode-v[0-9]*\.[0-9]*\.[0-9]*/classnode-v$VERSION/g" "$ROOT/portal/deploy.html"
echo "  ✓ portal/deploy.html"

echo ""

# ── 自动生成更新日志 ─────────────────────────────────

CHANGELOG_FILE="$ROOT/server/changelogs/v$VERSION.md"
TODAY="$(date +%Y-%m-%d)"

# 找上一次版本对应的 tag 或 commit
LAST_TAG="v$OLD_VERSION"
if ! git rev-parse "$LAST_TAG" &>/dev/null; then
  # 没有 tag，用最近一个版本号的 changelog 文件的时间
  LAST_FILE="$ROOT/server/changelogs/v$OLD_VERSION.md"
  if [ -f "$LAST_FILE" ]; then
    LAST_TAG=$(git log --oneline -- "$LAST_FILE" | head -1 | awk '{print $1}')
    [ -z "$LAST_TAG" ] && LAST_TAG="HEAD~10"
  else
    LAST_TAG="HEAD~10"
  fi
fi

# 从 git log 提取提交信息并分类
FEATS=""; FIXES=""; DOCS=""; STYLES=""; REFACTORS=""; CHORES=""
TMPLOG=$(mktemp)
git log "$LAST_TAG..HEAD" --no-merges --pretty="format:%s" 2>/dev/null > "$TMPLOG" || true
while IFS= read -r line; do
  [ -z "$line" ] && continue
  type="${line%%:*}"
  title="${line#*: }"
  [ "$title" = "$line" ] && title="" && type="other"
  case "$type" in
    feat*)   FEATS="${FEATS}* ${title}"$'\n' ;;
    fix*)    FIXES="${FIXES}* ${title}"$'\n' ;;
    docs*)   DOCS="${DOCS}* ${title}"$'\n' ;;
    style*)  STYLES="${STYLES}* ${title}"$'\n' ;;
    refactor*) REFACTORS="${REFACTORS}* ${title}"$'\n' ;;
    chore*)  CHORES="${CHORES}* ${title}"$'\n' ;;
    *)       FEATS="${FEATS}* ${line}"$'\n' ;;
  esac
done < "$TMPLOG"
rm -f "$TMPLOG"

cat > "$CHANGELOG_FILE" << CHANGELOG
# 更新日志

## [$VERSION] — $TODAY

$( [ -n "$FEATS" ] && cat << SECTION

### 新增

$FEATS
SECTION
)
$( [ -n "$FIXES" ] && cat << SECTION

### 修复

$FIXES
SECTION
)
$( [ -n "$STYLES" ] && cat << SECTION

### 样式优化

$STYLES
SECTION
)
$( [ -n "$REFACTORS" ] && cat << SECTION

### 重构

$REFACTORS
SECTION
)
$( [ -n "$DOCS" ] && cat << SECTION

### 文档

$DOCS
SECTION
)
$( [ -n "$CHORES" ] && cat << SECTION

### 其他

$CHORES
SECTION
)
CHANGELOG

# 简化多余的空行
sed -i '' '/^$/N;/^\n$/D' "$CHANGELOG_FILE"
echo "  ✓ server/changelogs/v$VERSION.md"
echo ""

# ── 提交 ────────────────────────────────────────────

cd "$ROOT"
git add \
  package.json \
  server/package.json \
  src-tauri/resources/server/package.json \
  src-tauri/tauri.conf.json \
  src-tauri/Cargo.toml \
  README.md \
  README.en.md \
  portal/index.html \
  portal/deploy.html \
  server/changelogs/v$VERSION.md

git commit -m "chore: bump version to $VERSION" 2>/dev/null && {
  echo "  ✓ 已自动提交"
  echo "  推送命令: git push"
} || {
  echo "  ℹ 无变更需要提交"
}
echo ""
echo "全部完成！版本号: $OLD_VERSION → $VERSION"
