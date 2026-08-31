#!/usr/bin/env bash
# Reproducible macOS Tauri build for Apple Silicon or Intel.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_VERSION="${CLASSNODE_NODE_VERSION:-24.18.0}"
NODE_CACHE_DIR="${CLASSNODE_NODE_CACHE_DIR:-$ROOT_DIR/.dev/cache/node}"
NODE_DOWNLOAD_BASE="${CLASSNODE_NODE_DOWNLOAD_BASE:-https://nodejs.org/dist}"
NODE_MIRROR_BASE="${CLASSNODE_NODE_MIRROR_BASE:-https://npmmirror.com/mirrors/node}"
TARGET=""
BUNDLE_NODE=true

usage() {
  cat <<'EOF'
用法: scripts/build-mac.sh --target <aarch64-apple-darwin|x86_64-apple-darwin> [--without-node]

环境变量:
  CLASSNODE_NODE_VERSION         打包的 Node.js 版本（默认 24.18.0）
  CLASSNODE_NODE_CACHE_DIR       Node.js 下载缓存目录
  CLASSNODE_NODE_DOWNLOAD_BASE   Node.js 官方下载地址
  CLASSNODE_NODE_MIRROR_BASE     官方地址不可用时的备用镜像地址
EOF
}

while (($#)); do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || { echo "错误: --target 缺少值" >&2; exit 2; }
      TARGET="$2"; shift 2 ;;
    --without-node) BUNDLE_NODE=false; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "错误: 未知参数 $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  TARGET="$(rustc -vV | awk '/^host:/ { print $2 }')"
fi

case "$TARGET" in
  aarch64-apple-darwin) NODE_PLATFORM="darwin-arm64" ;;
  x86_64-apple-darwin) NODE_PLATFORM="darwin-x64" ;;
  *) echo "错误: 不支持的 macOS target: $TARGET" >&2; exit 2 ;;
esac

for command in node pnpm npm rustc curl tar; do
  command -v "$command" >/dev/null || { echo "错误: 缺少命令 $command" >&2; exit 1; }
done

cd "$ROOT_DIR"
echo "━━━ ClassNode macOS 构建 ━━━"
echo "目标: $TARGET"
echo "Node.js: $([[ "$BUNDLE_NODE" == true ]] && echo "v$NODE_VERSION" || echo '不打包')"

echo "[1/6] 同步版本"
node scripts/sync-version.mjs

echo "[2/6] 构建前端"
pnpm build

echo "[3/6] 编译服务端"
pnpm build:server

echo "[4/6] 组装目标平台服务端"
node scripts/package-server.mjs --target "$TARGET"

echo "[5/6] 准备 Node.js"
if [[ "$BUNDLE_NODE" == true ]]; then
  archive="node-v${NODE_VERSION}-${NODE_PLATFORM}.tar.gz"
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' EXIT
  cache_file="$NODE_CACHE_DIR/$archive"
  mkdir -p "$NODE_CACHE_DIR"

  if [[ -f "$cache_file" ]] && tar -tzf "$cache_file" >/dev/null 2>&1; then
    echo "使用已缓存的 Node.js: $cache_file"
    cp "$cache_file" "$temp_dir/$archive"
  else
    rm -f "$cache_file"
    downloaded=false
    for base in "$NODE_DOWNLOAD_BASE" "$NODE_MIRROR_BASE"; do
      url="${base%/}/v${NODE_VERSION}/${archive}"
      echo "下载 Node.js: $url"
      if curl --fail --location --retry 3 --retry-all-errors --connect-timeout 20 \
        --silent --show-error "$url" --output "$temp_dir/$archive"; then
        mv "$temp_dir/$archive" "$cache_file"
        cp "$cache_file" "$temp_dir/$archive"
        downloaded=true
        break
      fi
    done
    [[ "$downloaded" == true ]] || {
      echo "错误: 无法下载 Node.js。请检查网络或设置 CLASSNODE_NODE_DOWNLOAD_BASE。" >&2
      exit 1
    }
  fi
  tar -xzf "$temp_dir/$archive" -C "$temp_dir"
  cp "$temp_dir/node-v${NODE_VERSION}-${NODE_PLATFORM}/bin/node" \
    src-tauri/resources/server/node
  chmod +x src-tauri/resources/server/node
fi

echo "[6/6] 构建 Tauri"
pnpm tauri build --target "$TARGET"
node scripts/rename-bundle.mjs "$TARGET"

echo "构建完成: src-tauri/target/$TARGET/release/bundle/"
