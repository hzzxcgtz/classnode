#!/usr/bin/env bash
# Unified ClassNode release entry point.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-all}"
WINDOWS_ARCH="${2:-both}"
GENERATED_ARTIFACTS=()

usage() {
  cat <<'EOF'
用法: ./release.sh <目标>

  all                 macOS 双架构 + Windows 双架构 + 源码包（默认）
  mac                 macOS 双架构
  mac-arm64           macOS Apple Silicon
  mac-intel           macOS Intel
  windows [架构]      触发 GitHub Actions MSI 构建后立即返回，可选 both、x64、arm64
  source              仅源码分发包

环境变量:
  CLASSNODE_RELEASE_DIR       产物目录
  CLASSNODE_INSTALLER_DIR     安装包归档根目录（默认：~/Downloads/ClassNode/installer）
  CLASSNODE_NODE_VERSION      桌面包内 Node.js 版本
  CLASSNODE_GITHUB_REPOSITORY GitHub 仓库
  CLASSNODE_RELEASE_BRANCH    Windows Actions 构建分支（默认 main）
  CLASSNODE_ALLOW_DIRTY_RELEASE  设为 1 允许本地调试；源码包始终仅含 HEAD
EOF
}

case "$MODE" in
  -h|--help|help) usage; exit 0 ;;
  all|mac|mac-arm64|mac-intel|windows|source) ;;
  *) echo "错误: 未知发布目标 $MODE" >&2; usage >&2; exit 2 ;;
esac
if [[ "$MODE" == windows ]]; then
  [[ $# -le 2 ]] || { echo "错误: windows 仅接受一个架构参数" >&2; exit 2; }
  case "$WINDOWS_ARCH" in both|all|x64|arm64) ;; *) echo "错误: 未知 Windows 架构 $WINDOWS_ARCH" >&2; exit 2 ;; esac
else
  [[ $# -le 1 ]] || { echo "错误: $MODE 不接受额外参数" >&2; exit 2; }
fi
cd "$ROOT_DIR"
VERSION="$(node -p 'require("./package.json").version')"
OUTPUT_DIR="${CLASSNODE_RELEASE_DIR:-$ROOT_DIR/dist/releases/v$VERSION}"
INSTALLER_ROOT="${CLASSNODE_INSTALLER_DIR:-$HOME/Downloads/ClassNode/installer}"
INSTALLER_DIR="$INSTALLER_ROOT/v$VERSION"

if [[ "${CLASSNODE_ALLOW_DIRTY_RELEASE:-0}" != 1 ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "错误: 工作区有未提交变更，拒绝创建不可复现的发行版" >&2
  echo "请先审查并提交变更；临时调试可设置 CLASSNODE_ALLOW_DIRTY_RELEASE=1" >&2
  exit 1
fi

# 源码分发始终来自 HEAD，不能以工作树的新版本号给旧提交命名。
if [[ "$MODE" == source || "$MODE" == all ]]; then
  head_version="$(git show HEAD:package.json | node -e 'let text="";process.stdin.on("data",chunk=>text+=chunk);process.stdin.on("end",()=>console.log(JSON.parse(text).version))')"
  [[ "$VERSION" == "$head_version" ]] || { echo "错误: 当前版本 $VERSION 尚未提交（HEAD 为 $head_version），无法生成对应源码包" >&2; exit 1; }
fi
if [[ "$MODE" != windows ]]; then mkdir -p "$OUTPUT_DIR"; fi

copy_macos_artifact() {
  local target="$1" suffix="$2" source
  source="src-tauri/target/$target/release/bundle/dmg/ClassNode_${VERSION}_macos_${suffix}.dmg"
  [[ -f "$source" ]] || { echo "错误: 未生成 $source" >&2; exit 1; }
  cp "$source" "$OUTPUT_DIR/"
  GENERATED_ARTIFACTS+=("$OUTPUT_DIR/$(basename "$source")")
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
  GENERATED_ARTIFACTS+=("$OUTPUT_DIR/$name.zip" "$OUTPUT_DIR/$name.tar.gz")
  echo "[release] $name.zip"
  echo "[release] $name.tar.gz"
}

archive_installers() {
  if ((${#GENERATED_ARTIFACTS[@]} == 0)); then
    return
  fi

  mkdir -p "$INSTALLER_DIR"

  # 自定义产物目录已指向归档目录时，无需重复移动。
  if [[ "$(cd "$OUTPUT_DIR" && pwd -P)" == "$(cd "$INSTALLER_DIR" && pwd -P)" ]]; then
    echo "[release] 安装包归档目录: $INSTALLER_DIR"
    return
  fi

  mv -f "${GENERATED_ARTIFACTS[@]}" "$INSTALLER_DIR/"
  echo "[release] 安装包已归档: $INSTALLER_DIR"
}

case "$MODE" in
  mac-arm64) build_arm64 ;;
  mac-intel) build_intel ;;
  mac) build_arm64; build_intel ;;
  windows)
    bash scripts/build-windows.sh "$WINDOWS_ARCH" --no-wait
    ;;
  source) package_source ;;
  all)
    bash scripts/build-windows.sh both --no-wait
    build_arm64
    build_intel
    package_source
    ;;
esac

archive_installers
if [[ "$MODE" == windows ]]; then
  echo "[release] Windows MSI 构建已提交，请稍后从 GitHub 手工下载"
else
  echo "[release] 完成: $INSTALLER_DIR"
fi
