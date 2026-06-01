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

# 1. tauri.conf.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" "$ROOT/src-tauri/tauri.conf.json"
echo "  ✓ src-tauri/tauri.conf.json"

# 2. Cargo.toml
sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" "$ROOT/src-tauri/Cargo.toml"
echo "  ✓ src-tauri/Cargo.toml"

# 3. package.json (root)
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" "$ROOT/package.json"
echo "  ✓ package.json"

# 4. server/package.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" "$ROOT/server/package.json"
echo "  ✓ server/package.json"

# 5. GitHub workflow
sed -i '' "s/APP_VERSION: '.*'/APP_VERSION: '$VERSION'/" "$ROOT/.github/workflows/build.yml"
echo "  ✓ .github/workflows/build.yml"

# 6. About page
sed -i '' "s/版本 .*</版本 $VERSION</" "$ROOT/src/app/teacher/about/page.tsx"
echo "  ✓ src/app/teacher/about/page.tsx"

echo ""
echo "全部更新完成！版本号: $VERSION"
echo "确认无误后提交:"
echo "  git add -u && git commit -m \"chore: bump version to $VERSION\""
