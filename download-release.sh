#!/bin/zsh
# ClassNode - 从 GitHub 下载发行版文件（带断点续传 + 重试 + 校验）
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

ok()    { echo -e "  ${GREEN}✓${NC} $*"; }
info()  { echo -e "  ${CYAN}ℹ${NC} $*"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $*"; }
err()   { echo -e "  ${RED}✗${NC} $*" >&2; }
dim()   { echo -e "  ${GRAY}$*${NC}"; }
hr()    { echo -e "  ${DIM}────────────────────────────────────────${NC}"; }
sub()   { echo -e "  ${GRAY}$*${NC}"; }

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

echo ""
echo -e "  ${BOLD}${BLUE}━━━ 下载 ClassNode v${VERSION} ━━━${NC}"
dim "目标: $DEST"
hr

# ─── 获取 Release 资产信息 ────────────────────────────
info "获取 Release 资产信息..."
ASSETS_JSON=$(gh api "repos/${REPO}/releases/tags/${TAG}" \
  --jq '.assets[] | select(.name | endswith(".exe")) | {name, size, browser_download_url}' 2>/dev/null)

if [ -z "$ASSETS_JSON" ]; then
  err "未找到 Release v${VERSION} 或其中没有 exe 文件"
  exit 1
fi

ALL_OK=true
TOTAL_FILES=0
TOTAL_BYTES=0

while read -r asset; do
  NAME=$(echo "$asset" | jq -r '.name')
  SIZE=$(echo "$asset" | jq -r '.size')
  URL=$(echo "$asset" | jq -r '.browser_download_url')
  FILE="${DEST}/${NAME}"

  # 如果已存在且大小匹配则跳过
  if [ -f "$FILE" ]; then
    EXISTING_SIZE=$(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE" 2>/dev/null)
    if [ "$EXISTING_SIZE" = "$SIZE" ]; then
      ok "${NAME} 已存在，跳过下载"
      TOTAL_FILES=$((TOTAL_FILES + 1))
      TOTAL_BYTES=$((TOTAL_BYTES + SIZE))
      continue
    fi
    sub "${NAME} 文件不完整，断点续传..."
  fi

  SIZE_MB=$(awk "BEGIN{printf \"%.1f\", ${SIZE}/1048576}")

  sub ""
  sub "下载 ${NAME}（${SIZE_MB} MB）..."
  echo ""

  # curl 带断点续传 + 自动重试
  #   -C -     断点续传（已存在的部分自动跳过）
  #   --retry 5  最多重试 5 次
  #   --retry-delay 10  重试间隔 10 秒
  #   --retry-max-time 600  重试阶段总超时 10 分钟
  #   --connect-timeout 30  连接超时 30 秒
  #   --max-time 1800      单次传输总超时 30 分钟
  if curl -L -C - \
    --retry 5 --retry-delay 10 --retry-max-time 600 \
    --connect-timeout 30 --max-time 1800 \
    -o "$FILE" "$URL" 2>&1; then

    # 校验大小
    DOWNLOADED_SIZE=$(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE" 2>/dev/null)
    if [ "$DOWNLOADED_SIZE" -eq "$SIZE" ] 2>/dev/null; then
      ok "${NAME} 下载完成（大小匹配）"
      TOTAL_FILES=$((TOTAL_FILES + 1))
      TOTAL_BYTES=$((TOTAL_BYTES + SIZE))
    else
      err "${NAME} 大小不匹配（期望 ${SIZE_MB} MB，实际 $(awk "BEGIN{printf \"%.1f\", ${DOWNLOADED_SIZE}/1048576}") MB）"
      ALL_OK=false
    fi
  else
    err "${NAME} 下载失败，请稍后重试"
    ALL_OK=false
  fi
done < <(echo "$ASSETS_JSON" | jq -c '.')

echo ""
hr
if [ "$ALL_OK" = true ]; then
  TOTAL_SIZE_MB=$(awk "BEGIN{printf \"%.1f\", ${TOTAL_BYTES}/1048576}")
  ok "全部下载完成！共 ${TOTAL_FILES} 个文件（${TOTAL_SIZE_MB} MB）"
  echo ""
  dim "文件清单:"
  for f in "$DEST"/*.exe; do
    [ -f "$f" ] || continue
    size=$(du -h "$f" | cut -f1)
    echo -e "    ${GRAY}•${NC} $(basename "$f") ${DIM}(${size})${NC}"
  done
else
  warn "部分文件下载失败，请检查后重试"
  echo ""
  dim "提示: 重新运行本脚本会从断点继续下载"
fi
echo ""
