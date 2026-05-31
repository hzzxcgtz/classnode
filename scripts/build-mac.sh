#!/bin/bash
set -euo pipefail

# ======================================================
# macOS 本地构建脚本
# 用法:
#   ./scripts/build-mac.sh                    # 构建当前架构，不打包 Node.js
#   ./scripts/build-mac.sh --with-node        # 构建当前架构，打包 Node.js
#   ./scripts/build-mac.sh --target x86_64-apple-darwin  # 构建 Intel 版本
# ======================================================

NODE_LTS="22.14.0"
BUNDLE_NODE=false
TAURI_TARGET=""

# 解析参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-node) BUNDLE_NODE=true; shift ;;
    --target) TAURI_TARGET="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

# 如果未指定目标，自动检测当前架构
if [ -z "$TAURI_TARGET" ]; then
  TAURI_TARGET=$(rustc -vV | grep host | cut -d' ' -f2)
fi

echo "========================================"
echo "  ClassNode macOS 构建"
echo "  目标架构: $TAURI_TARGET"
echo "  打包 Node.js: $BUNDLE_NODE"
echo "========================================"

# 获取项目根目录
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# 步骤 1: 构建前端
echo ""
echo "=== [1/5] 构建前端 ==="
pnpm build

# 步骤 2: 编译服务端
echo ""
echo "=== [2/5] 编译服务端 ==="
pnpm build:server

# 步骤 3: 打包服务端代码 + 前端静态文件到 Tauri 资源目录
echo ""
echo "=== [3/5] 打包服务端和前端代码 ==="
rm -rf src-tauri/resources/server
mkdir -p src-tauri/resources/server

cp -r server/dist src-tauri/resources/server/dist
cp -r server/prisma src-tauri/resources/server/prisma
cp server/package.json src-tauri/resources/server/
cp server/.env.example src-tauri/resources/server/.env

# 打包前端静态文件（由 Express 服务器承载）
echo "Copying frontend..."
cp -r out src-tauri/resources/server/frontend

cd src-tauri/resources/server
npm install --production --ignore-scripts

mkdir -p node_modules
cp -rL ../../../server/node_modules/@prisma/client node_modules/@prisma/
PRISMA_REAL=$(cd ../../../server/node_modules/@prisma/client && pwd -P)
PRISMA_DIR="$(dirname "$(dirname "$PRISMA_REAL")")/.prisma"
if [ -d "$PRISMA_DIR" ]; then
  cp -rL "$PRISMA_DIR" node_modules/
else
  echo "WARNING: .prisma not found at $PRISMA_DIR"
fi

echo "Server bundle contents:"
ls -la dist/

# 初始化数据库（创建表结构）
echo ""
echo "Creating database tables..."
../../../server/node_modules/.bin/prisma db push --accept-data-loss
echo "Database initialized."
cd "$ROOT_DIR"

# 步骤 4: 下载 Node.js 二进制（可选）
if [ "$BUNDLE_NODE" = true ]; then
  echo ""
  echo "=== [4/5] 下载 Node.js 二进制 ==="

  case "$TAURI_TARGET" in
    aarch64-apple-darwin) NODE_PLATFORM="darwin-arm64" ;;
    x86_64-apple-darwin)  NODE_PLATFORM="darwin-x64" ;;
    *)
      echo "错误: 不支持的构建目标 $TAURI_TARGET"
      echo "支持的 targets: aarch64-apple-darwin, x86_64-apple-darwin"
      exit 1
      ;;
  esac

  NODE_FILENAME="node-v${NODE_LTS}-${NODE_PLATFORM}"
  NODE_URL="https://nodejs.org/dist/v${NODE_LTS}/${NODE_FILENAME}.tar.gz"

  echo "Downloading: $NODE_URL"
  curl -fsSL "$NODE_URL" -o node-download.tar.gz
  tar xzf node-download.tar.gz
  cp "${NODE_FILENAME}/bin/node" src-tauri/resources/server/
  rm -rf "${NODE_FILENAME}" node-download.tar.gz

  echo "Node.js binary bundled at src-tauri/resources/server/node"
else
  echo ""
  echo "=== [4/5] 跳过 Node.js 下载（使用系统 node） ==="
fi

# 步骤 5: Tauri 构建
echo ""
echo "=== [5/5] 构建 Tauri App ==="
pnpm tauri build --target "$TAURI_TARGET"

echo ""
echo "========================================"
echo "  构建完成!"
echo "  产物目录: src-tauri/target/$TAURI_TARGET/release/bundle/"
echo "========================================"
