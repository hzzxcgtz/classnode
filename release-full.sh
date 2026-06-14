#!/bin/zsh
# ClassNode - 全平台构建：本地 macOS (ARM64+Intel) + GitHub Actions (Windows x64+x86)
# 全部产物汇总到 installer/v{ver}/
# 用法: ./release-full.sh [选项]

# ─── ANSI Colors ──────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
  CYAN='\033[0;36m'; BLUE='\033[0;34m'; MAGENTA='\033[0;35m'; GRAY='\033[0;90m'
else
  BOLD=; DIM=; NC=; RED=; GREEN=; YELLOW=; CYAN=; BLUE=; MAGENTA=; GRAY=
fi

ok()      { echo -e "  ${GREEN}✓${NC} $*"; }
info()    { echo -e "  ${CYAN}ℹ${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
err()     { echo -e "  ${RED}✗${NC} $*" >&2; }
dim()     { echo -e "  ${GRAY}$*${NC}"; }
hr()      { echo -e "  ${DIM}────────────────────────────────────────${NC}"; }
section() { echo -e "\n  ${BOLD}${BLUE}━━━ $* ━━━${NC}"; }
sub()     { echo -e "  ${GRAY}$*${NC}"; }

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="hzzxcgtz/classnode"
INSTALLER_BASE="/Users/zxc/Downloads/ClassNode/installer"
_start=$SECONDS

# ─── 参数 ─────────────────────────────────────────────
CI_BRANCH="main"
CI_ARCH="both"

while [ $# -gt 0 ]; do
  case "$1" in
    --branch|-b) CI_BRANCH="$2"; shift 2 ;;
    --help|-h)
      echo "用法: $0 [选项]"
      echo ""
      echo "选项:"
      echo "  -b, --branch <分支>   指定 CI 构建分支（默认: main）"
      echo "  -h, --help            显示此帮助"
      exit 0 ;;
    *) err "未知参数: $1"; exit 1 ;;
  esac
done

# ─── 前置检查 ─────────────────────────────────────────
cd "$ROOT"
VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null)
[ -z "$VERSION" ] && { err "无法读取版本号"; exit 1; }

gh auth status &>/dev/null || { err "请先执行: ${BOLD}gh auth login${NC}"; exit 1; }
command -v rclone &>/dev/null || warn "rclone 未安装，无法上传网盘"

INSTALLER_DIR="${INSTALLER_BASE}/v${VERSION}"
mkdir -p "$INSTALLER_DIR"

# ─── 显示计划 ─────────────────────────────────────────
echo ""
echo -e "  ${BOLD}${BLUE}━━━ 全平台构建 ClassNode v${VERSION} ━━━${NC}"
echo -e "  ${GRAY}本地:${NC}  macOS ARM64 + Intel  (${BOLD}build:mac:arm64${NC} + ${BOLD}build:mac:intel${NC})"
echo -e "  ${GRAY}CI:${NC}    Windows x64 + x86    (${BOLD}${CI_BRANCH}${NC} 分支)"
echo -e "  ${GRAY}输出:${NC}  ${INSTALLER_DIR}"
hr

# ─── 第 1 步：触发 GitHub Actions ─────────────────────
section "第 1 步 / 4  触发 GitHub Actions"
info "触发 Windows 构建（${CI_BRANCH}）..."
CI_RUN_ID=$(gh workflow run build.yml \
  --repo "$REPO" \
  --ref "$CI_BRANCH" \
  --field arch="$CI_ARCH" 2>&1)
[ $? -ne 0 ] && { err "触发 CI 失败"; exit 1; }

sleep 3
CI_RUN_NUM=$(gh run list --repo "$REPO" --workflow build.yml --branch "$CI_BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId')
if [ -n "$CI_RUN_NUM" ] && [ "$CI_RUN_NUM" != "null" ]; then
  ok "CI 已触发（运行 #${CI_RUN_NUM}）"
  CI_URL="https://github.com/${REPO}/actions/runs/${CI_RUN_NUM}"
  echo -e "  ${CYAN}🔗${NC} ${CI_URL}"
else
  warn "未能获取运行编号，后续需手动检查"
  CI_RUN_NUM=""
  CI_URL=""
fi

# ─── 第 2 步：本地构建 macOS ──────────────────────────
section "第 2 步 / 4  构建 macOS ARM64"
info "开始构建..."
if pnpm build:mac:arm64 2>&1 | sed 's/^/  /'; then
  ok "ARM64 构建完成"
else
  err "ARM64 构建失败"
  exit 1
fi

section "第 3 步 / 4  构建 macOS Intel"
info "开始构建..."
if pnpm build:mac:intel 2>&1 | sed 's/^/  /'; then
  ok "Intel 构建完成"
else
  err "Intel 构建失败"
  exit 1
fi

# ─── 导出 DMG 到安装包目录 ─────────────────────────
sub ""
sub "导出 DMG → ${INSTALLER_DIR}"
for dmg in \
  "src-tauri/target/release/bundle/dmg/ClassNode_${VERSION}_macos_apple-silicon.dmg" \
  "src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/ClassNode_${VERSION}_macos_intel.dmg"; do
  if [ -f "$dmg" ]; then
    sz=$(du -h "$dmg" | cut -f1)
    cp "$dmg" "$INSTALLER_DIR/"
    ok "$(basename "$dmg")  (${sz})"
  else
    warn "未找到: $dmg"
  fi
done

# ─── 打包源码分发包 ────────────────────────────────
sub ""
sub "打包源码分发包..."
bash dev.sh dist 2>&1 | sed 's/^/  /'

# ─── 第 4 步：等待 CI 完成并下载 ──────────────────────
section "第 4 步 / 4  等待 CI 构建完成"

if [ -z "$CI_RUN_NUM" ]; then
  warn "没有 CI 运行编号，请手动下载 Windows 安装包"
  info "检查: https://github.com/${REPO}/actions"
else
  CI_START=$SECONDS
  sp="/-\|"
  si=0
  while true; do
    STATUS=$(gh run view "$CI_RUN_NUM" --repo "$REPO" --json status,conclusion --jq '{status,conclusion}' 2>/dev/null)
    CONCLUSION=$(echo "$STATUS" | jq -r '.conclusion')
    STATE=$(echo "$STATUS" | jq -r '.status')

    elapsed=$((SECONDS - CI_START))
    elapsed_str=$(printf "%dm %02ds" $((elapsed/60)) $((elapsed%60)))
    ci=${sp:$si:1}; si=$(( (si+1) % 4 ))

    if [ "$STATE" = "completed" ]; then
      echo ""
      if [ "$CONCLUSION" = "success" ]; then
        ok "CI 构建成功（耗时 ${elapsed_str}）"

        # 等待一下让 release 创建完成
        sleep 5

        # 下载 Windows 安装包
        sub ""
        sub "下载 Windows 安装包..."
        gh release download "v${VERSION}" --repo "$REPO" --dir "$INSTALLER_DIR" --pattern "*.exe" 2>&1 | sed 's/^/  /'

        if [ $? -eq 0 ]; then
          ok "Windows 安装包已下载"
        else
          warn "下载失败，可能是 draft release 尚未完成"
          info "可手动下载: https://github.com/${REPO}/releases"
        fi
      else
        echo -e "  ${RED}${BOLD}━━━ CI 构建失败 (${CONCLUSION}) ━━━${NC}"
        warn "耗时 ${elapsed_str}"
        [ -n "$CI_URL" ] && info "查看日志: ${CI_URL}"
      fi
      break
    fi

    printf "\r  ${DIM}⏳ 等待 CI 完成... ${ci}  已耗时 ${elapsed_str}     ${NC}"
    sleep 30
  done
fi

# ─── 汇总 ─────────────────────────────────────────────
total_elapsed=$((SECONDS - _start))
printf "\n  ${DIM}⌛ 总计耗时 %dm %02ds${NC}\n" $((total_elapsed/60)) $((total_elapsed%60))

echo ""
echo -e "  ${BOLD}${BLUE}━━━ 构建汇总 ━━━${NC}"
echo -e "  ${GRAY}输出目录:${NC} ${INSTALLER_DIR}"
hr
all_files=("$INSTALLER_DIR"/*)
for f in "${all_files[@]}"; do
  [ -f "$f" ] || continue
  sz=$(du -h "$f" | cut -f1)
  echo -e "  ${GRAY}•${NC} $(basename "$f")  ${DIM}(${sz})${NC}"
done

mac_count=$(ls "$INSTALLER_DIR"/*.dmg 2>/dev/null | wc -l | tr -d ' ')
win_count=$(ls "$INSTALLER_DIR"/*.exe 2>/dev/null | wc -l | tr -d ' ')
zip_count=$(ls "$INSTALLER_DIR"/*.zip 2>/dev/null | wc -l | tr -d ' ')

echo ""
echo -e "  ${GREEN}${BOLD}🎉 全平台构建完成！${NC}"
echo -e "  ${GRAY}macOS DMG:${NC} ${mac_count} 个   ${GRAY}Windows exe:${NC} ${win_count} 个   ${GRAY}源码包:${NC} ${zip_count} 个"
echo ""
