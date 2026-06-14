#!/bin/zsh
# ClassNode - 从 GitHub 下载发行版文件
# 用法: ./download-release.sh [版本号]
#   不写参数则下载最新版本

# ─── ANSI Colors ──────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
  CYAN='\033[0;36m'; BLUE='\033[0;34m'; GRAY='\033[0;90m'
else
  BOLD=; DIM=; NC=; RED=; GREEN=; YELLOW=; CYAN=; BLUE=; GRAY=
fi

# ─── Helpers ──────────────────────────────────────────
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
info() { echo -e "  ${CYAN}ℹ${NC} $*"; }
err()  { echo -e "  ${RED}✗${NC} $*" >&2; }
dim()  { echo -e "  ${GRAY}$*${NC}"; }
hr()   { echo -e "  ${DIM}────────────────────────────────────────${NC}"; }

REPO="hzzxcgtz/classnode"
DEST_BASE="/Users/zxc/Downloads/ClassNode/installer"

# ─── 解析版本 ─────────────────────────────────────────
if [ $# -eq 0 ]; then
  info "获取最新版本..."
  TAG=$(gh release list --repo "$REPO" --limit 1 --json tagName --jq '.[0].tagName' 2>/dev/null)
  if [ -z "$TAG" ]; then
    err "获取最新版本失败"
    exit 1
  fi
  VERSION="${TAG#v}"
  ok "最新版本: ${BOLD}v${VERSION}${NC}"
elif [ $# -eq 1 ]; then
  VERSION="$1"
  TAG="v${VERSION}"
else
  err "用法: $0 [版本号]"
  dim "$0          # 下载最新版"
  dim "$0 1.4.1    # 下载指定版"
  exit 1
fi

DEST="${DEST_BASE}/v${VERSION}"

# ─── 前置检查 ─────────────────────────────────────────
gh auth status &>/dev/null || { err "请先执行: ${BOLD}gh auth login${NC}"; exit 1; }

mkdir -p "$DEST"

# ─── 下载 ─────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}${BLUE}━━━ 下载 ClassNode v${VERSION} ━━━${NC}"
dim "目标: $DEST"
hr

gh release download "$TAG" --repo "$REPO" --dir "$DEST" --pattern "*.exe" 2>&1 | sed 's/^/  /'

if [ $? -ne 0 ]; then
  echo ""
  err "下载失败，请检查版本号是否正确"
  exit 1
fi

echo ""
ok "下载完成！"
echo ""
dim "文件清单:"
for f in "$DEST"/*; do
  [ -f "$f" ] || continue
  size=$(du -h "$f" | cut -f1)
  echo -e "    ${GRAY}•${NC} $(basename "$f") ${DIM}(${size})${NC}"
done
echo ""
