#!/usr/bin/env bash
# Unified ClassNode release entry point.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
OUTPUT_DIR="${CLASSNODE_RELEASE_DIR:-$ROOT_DIR/dist/releases/v$VERSION}"
MODE="${1:-all}"
WINDOWS_ARCH="${2:-both}"

usage() {
  cat <<'EOF'
用法: ./release.sh <目标>

  all                 macOS 双架构 + Windows 双架构 + 源码包（默认）
  mac                 macOS 双架构
  mac-arm64           macOS Apple Silicon
  mac-intel           macOS Intel
  windows [架构]      GitHub Actions 构建，可选 both、x64、arm64
  source              仅源码分发包

环境变量:
  CLASSNODE_RELEASE_DIR       产物目录
  CLASSNODE_NODE_VERSION      桌面包内 Node.js 版本
  CLASSNODE_GITHUB_REPOSITORY GitHub 仓库
EOF
}

case "$MODE" in
  -h|--help|help) usage; exit 0 ;;
  all|mac|mac-arm64|mac-intel|windows|source) ;;
  *) echo "错误: 未知发布目标 $MODE" >&2; usage >&2; exit 2 ;;
esac

mkdir -p "$OUTPUT_DIR"
cd "$ROOT_DIR"

if [[ "${CLASSNODE_ALLOW_DIRTY_RELEASE:-0}" != 1 ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "错误: 工作区有未提交变更，拒绝创建不可复现的发行版" >&2
  echo "请先审查并提交变更；临时调试可设置 CLASSNODE_ALLOW_DIRTY_RELEASE=1" >&2
  exit 1
fi

copy_macos_artifact() {
  local target="$1" suffix="$2" source
  source="src-tauri/target/$target/release/bundle/dmg/ClassNode_${VERSION}_macos_${suffix}.dmg"
  [[ -f "$source" ]] || { echo "错误: 未生成 $source" >&2; exit 1; }
  cp "$source" "$OUTPUT_DIR/"
  echo "[release] $(basename "$source")"
}

build_arm64() {
  pnpm build:mac:arm64
  copy_macos_artifact aarch64-apple-darwin apple-silicon
}

build_intel() {
  pnpm build:mac:intel
  copy_macos_artifact x86_64-apple-darwin intel
}

package_source() {
  command -v git >/dev/null || { echo "错误: 源码打包需要 git" >&2; exit 1; }
  local name="classnode-$VERSION"
  rm -f "$OUTPUT_DIR/$name.zip" "$OUTPUT_DIR/$name.tar.gz"
  git archive --format=zip --prefix="$name/" --output="$OUTPUT_DIR/$name.zip" HEAD
  git archive --format=tar.gz --prefix="$name/" --output="$OUTPUT_DIR/$name.tar.gz" HEAD
  echo "[release] $name.zip"
  echo "[release] $name.tar.gz"
}

case "$MODE" in
  mac-arm64) build_arm64 ;;
  mac-intel) build_intel ;;
  mac) build_arm64; build_intel ;;
  windows) bash scripts/build-windows.sh "$WINDOWS_ARCH" ;;
  source) package_source ;;
  all)
    run_id_file="$(mktemp)"
    trap 'rm -f "$run_id_file"' EXIT
    bash scripts/build-windows.sh both --no-wait --run-id-file "$run_id_file"
    build_arm64
    build_intel
    package_source
    run_id="$(cat "$run_id_file")"
    gh run watch "$run_id" --repo "${CLASSNODE_GITHUB_REPOSITORY:-hzzxcgtz/classnode}" --exit-status
    ;;
esac

echo "[release] 完成: $OUTPUT_DIR"
