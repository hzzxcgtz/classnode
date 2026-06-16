#!/bin/zsh
# ClassNode - 触发 GitHub Actions 构建 Windows 安装包，生成 draft release
# 用法: ./build-release.sh [架构]
#   架构: all（默认，x64+arm64）, both, x64, arm64

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

REPO="hzzxcgtz/classnode"
BRANCH="main"
ARCH="${1:-all}"

case "$ARCH" in
  all|both|x64|arm64) ;;
  --help|-h)
    echo "用法: $0 [架构]"
    echo ""
    echo "架构:"
    echo "  all      x64 + arm64（默认）"
    echo "  both     仅 x64"
    echo "  x64      仅 x64"
    echo "  arm64    仅 arm64"
    exit 0 ;;
  *)
    err "未知架构: $1"
    dim "可用: all, both, x64, arm64"
    exit 1 ;;
esac

# ─── 前置检查 ─────────────────────────────────────────
gh auth status &>/dev/null || { err "请先执行: ${BOLD}gh auth login${NC}"; exit 1; }

# ─── 确认信息 ─────────────────────────────────────────
ARCH_LABEL="x64 + arm64"
[ "$ARCH" = "both" ] && ARCH_LABEL="仅 x64"
[ "$ARCH" = "x64" ] && ARCH_LABEL="仅 x64"
[ "$ARCH" = "arm64" ] && ARCH_LABEL="仅 arm64"

echo ""
echo -e "  ${BOLD}${BLUE}━━━ 触发 GitHub Actions 构建 Windows ━━━${NC}"
echo -e "  ${GRAY}架构:${NC}  ${ARCH_LABEL}"
hr

# ─── 触发构建 ─────────────────────────────────────────
info "触发工作流..."
gh workflow run build.yml \
  --repo "$REPO" \
  --ref "$BRANCH" \
  --field arch="$ARCH" 2>&1 || { err "触发失败"; exit 1; }

sleep 2

RUN_NUMBER=$(gh run list --repo "$REPO" --workflow build.yml --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId')

if [ -z "$RUN_NUMBER" ] || [ "$RUN_NUMBER" = "null" ]; then
  warn "未能获取到运行编号，请到 GitHub 查看进度"
  echo -e "  ${CYAN}🔗${NC} https://github.com/${REPO}/actions"
  exit 0
fi

ok "已触发！构建需要 10-20 分钟"
echo -e "  ${CYAN}🔗${NC} https://github.com/${REPO}/actions/runs/${RUN_NUMBER}"
echo ""

# ─── 等待构建完成 ─────────────────────────────────────
CI_START=$SECONDS
sp="/-\|"
si=0
info "等待构建完成（按 Ctrl+C 可跳过等待）..."

while true; do
  STATUS=$(gh run view "$RUN_NUMBER" --repo "$REPO" --json status,conclusion --jq '{status,conclusion}' 2>/dev/null)
  CONCLUSION=$(echo "$STATUS" | jq -r '.conclusion')
  STATE=$(echo "$STATUS" | jq -r '.status')

  if [ "$STATE" = "completed" ]; then
    echo ""
    if [ "$CONCLUSION" = "success" ]; then
      echo -e "  ${GREEN}${BOLD}━━━ 构建成功！━━━${NC}"
      echo ""
      info "获取 draft release..."
      sleep 5
      RELEASE_URL=$(gh release view "v$(jq -r .version package.json 2>/dev/null)" --repo "$REPO" --json url --jq '.url' 2>/dev/null)
      if [ -n "$RELEASE_URL" ] && [ "$RELEASE_URL" != "null" ]; then
        ok "Draft release 已创建"
        echo -e "  ${CYAN}🔗${NC} ${RELEASE_URL}"
      else
        info "Draft release 地址:"
        echo -e "  ${CYAN}🔗${NC} https://github.com/${REPO}/releases"
      fi
    else
      echo -e "  ${RED}${BOLD}━━━ 构建失败 (${CONCLUSION}) ━━━${NC}"
      dim "查看日志: https://github.com/${REPO}/actions/runs/${RUN_NUMBER}"
    fi
    break
  fi

  elapsed=$((SECONDS - CI_START))
  elapsed_str=$(printf "%dm %02ds" $((elapsed/60)) $((elapsed%60)))
  ci=${sp:$si:1}; si=$(( (si+1) % 4 ))
  printf "\r  ${DIM}⏳ 等待 CI 完成... ${ci}  已耗时 ${elapsed_str}     ${NC}"
  sleep 30
done
echo ""
