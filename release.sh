#!/usr/bin/env bash
# Unified ClassNode release entry point.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
OUTPUT_DIR="${CLASSNODE_RELEASE_DIR:-$ROOT_DIR/dist/releases/v$VERSION}"
INSTALLER_ROOT="${CLASSNODE_INSTALLER_DIR:-$HOME/Downloads/ClassNode/installer}"
INSTALLER_DIR="$INSTALLER_ROOT/v$VERSION"
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
  CLASSNODE_INSTALLER_DIR     安装包归档根目录（默认：~/Downloads/ClassNode/installer）
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

download_windows_artifacts() {
  command -v gh >/dev/null || { echo "错误: 下载 Windows 安装包需要 gh" >&2; exit 1; }
  gh release download "v$VERSION" \
    --repo "${CLASSNODE_GITHUB_REPOSITORY:-hzzxcgtz/classnode}" \
    --dir "$OUTPUT_DIR" \
    --pattern "*.exe" \
    --pattern "*.msi" \
    --clobber
}

archive_installers() {
  mkdir -p "$INSTALLER_DIR"

  # 自定义产物目录已指向归档目录时，无需重复移动。
  if [[ "$(cd "$OUTPUT_DIR" && pwd -P)" == "$(cd "$INSTALLER_DIR" && pwd -P)" ]]; then
    echo "[release] 安装包归档目录: $INSTALLER_DIR"
    return
  fi

  local artifacts=()
  while IFS= read -r -d '' file; do
    artifacts+=("$file")
  done < <(find "$OUTPUT_DIR" -maxdepth 1 -type f -print0)

  if ((${#artifacts[@]} == 0)); then
    echo "错误: 未找到可归档的发布产物: $OUTPUT_DIR" >&2
    exit 1
  fi

  mv -f "${artifacts[@]}" "$INSTALLER_DIR/"
  echo "[release] 安装包已归档: $INSTALLER_DIR"
}

case "$MODE" in
  mac-arm64) build_arm64 ;;
  mac-intel) build_intel ;;
  mac) build_arm64; build_intel ;;
  windows)
    bash scripts/build-windows.sh "$WINDOWS_ARCH"
    download_windows_artifacts
    ;;
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
    download_windows_artifacts
    ;;
esac

archive_installers
echo "[release] 完成: $INSTALLER_DIR"
