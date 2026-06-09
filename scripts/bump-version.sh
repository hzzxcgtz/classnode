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

echo "更新版本号到 $VERSION ..."

# 1. package.json（根目录）
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" "$ROOT/package.json"
echo "  ✓ package.json"

# 2. server/package.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" "$ROOT/server/package.json"
echo "  ✓ server/package.json"

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

echo ""
echo "全部更新完成！版本号: $VERSION"
echo ""

# 自动提交（仅版本文件，不捎带其他改动）
cd "$ROOT"
git add \
  package.json \
  server/package.json \
  src-tauri/tauri.conf.json \
  src-tauri/Cargo.toml \
  README.md \
  README.en.md
git commit -m "chore: bump version to $VERSION" 2>/dev/null && {
  echo "  ✓ 已自动提交"
  echo "  推送命令: git push && git push <其他远程>"
} || {
  echo "  ℹ 无变更需要提交"
}
