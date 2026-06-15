#!/bin/zsh
# ClassNode - 全平台构建
# 用法: ./release-full.sh [模式]
#   模式:
#     空        全平台: macOS ARM64+Intel + Windows x64+x86+arm64
#     mac       仅 macOS (ARM64+Intel)
#     arm64 仅 macOS ARM64
#     intel 仅 macOS Intel
#     win       macOS + Windows x64+x86+arm64（同默认）

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

# ─── 解析模式 ─────────────────────────────────────────
MODE="${1:-full}"
CI_BRANCH="main"
CI_ARCH="all"

BUILD_MAC_ARM64=false
BUILD_MAC_INTEL=false
DO_CI=false

case "$MODE" in
  full)
    BUILD_MAC_ARM64=true; BUILD_MAC_INTEL=true; DO_CI=true
    MAC_LABEL="ARM64 + Intel"; CI_LABEL="x64 + x86 + arm64"
    MODE_LABEL="全平台（5 个架构）" ;;
  mac)
    BUILD_MAC_ARM64=true; BUILD_MAC_INTEL=true; DO_CI=false
    MAC_LABEL="ARM64 + Intel"; CI_LABEL="无"
    MODE_LABEL="仅 macOS" ;;
  arm64|arm64)
    BUILD_MAC_ARM64=true; BUILD_MAC_INTEL=false; DO_CI=false
    MAC_LABEL="仅 ARM64"; CI_LABEL="无"
    MODE_LABEL="仅 macOS ARM64" ;;
  intel|intel)
    BUILD_MAC_ARM64=false; BUILD_MAC_INTEL=true; DO_CI=false
    MAC_LABEL="仅 Intel"; CI_LABEL="无"
    MODE_LABEL="仅 macOS Intel" ;;
  win)
    BUILD_MAC_ARM64=true; BUILD_MAC_INTEL=true; DO_CI=true
    MAC_LABEL="ARM64 + Intel"; CI_LABEL="x64 + x86 + arm64"
    MODE_LABEL="全平台（5 个架构）" ;;
  --help|-h)
    echo "用法: $0 [模式]"
    echo ""
    echo "模式:"
    echo "  （空）     全平台构建（默认）"
    echo "  mac        仅 macOS（ARM64 + Intel）"
    echo "  arm64  仅 macOS ARM64"
    echo "  intel  仅 macOS Intel"
    exit 0 ;;
  *)
    err "未知模式: $1"
    dim "可用: mac, arm64, intel"
    exit 1 ;;
esac

# ─── 前置检查 ─────────────────────────────────────────
cd "$ROOT"
VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null)
[ -z "$VERSION" ] && { err "无法读取版本号"; exit 1; }

INSTALLER_DIR="${INSTALLER_BASE}/v${VERSION}"
mkdir -p "$INSTALLER_DIR"

# ─── 显示计划 ─────────────────────────────────────────
echo ""
echo -e "  ${BOLD}${BLUE}━━━ ${MODE_LABEL} — ClassNode v${VERSION} ━━━${NC}"
echo -e "  ${GRAY}macOS:${NC} ${MAC_LABEL}"
echo -e "  ${GRAY}Windows CI:${NC} ${CI_LABEL}"
echo -e "  ${GRAY}输出:${NC} ${INSTALLER_DIR}"
hr

# ─── 触发 CI ─────────────────────────────────────────
if [ "$DO_CI" = true ]; then
  gh auth status &>/dev/null || { err "请先执行: ${BOLD}gh auth login${NC}"; exit 1; }

  section "触发 GitHub Actions（Windows CI）"
  info "触发 Windows 构建（${CI_ARCH}）..."
  gh workflow run build.yml \
    --repo "$REPO" \
    --ref "$CI_BRANCH" \
    --field arch="$CI_ARCH" 2>&1 || { err "触发 CI 失败"; exit 1; }

  sleep 3
  CI_RUN_NUM=$(gh run list --repo "$REPO" --workflow build.yml --branch "$CI_BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId')
  if [ -n "$CI_RUN_NUM" ] && [ "$CI_RUN_NUM" != "null" ]; then
    ok "CI 已触发（运行 #${CI_RUN_NUM}）"
    CI_URL="https://github.com/${REPO}/actions/runs/${CI_RUN_NUM}"
    echo -e "  ${CYAN}🔗${NC} ${CI_URL}"
  else
    warn "未能获取运行编号，后续需手动检查"
    CI_RUN_NUM=""; CI_URL=""
  fi
fi

# ─── 本地构建 macOS ──────────────────────────────────
if [ "$BUILD_MAC_ARM64" = true ]; then
  section "构建 macOS ARM64"
  pnpm build:mac:arm64 2>&1 | sed 's/^/  /' || { err "ARM64 构建失败"; exit 1; }
  ok "ARM64 构建完成"
fi

if [ "$BUILD_MAC_INTEL" = true ]; then
  section "构建 macOS Intel"
  pnpm build:mac:intel 2>&1 | sed 's/^/  /' || { err "Intel 构建失败"; exit 1; }
  ok "Intel 构建完成"
fi

# ─── 导出 DMG ───────────────────────────────────────
sub ""
sub "导出 DMG → ${INSTALLER_DIR}"
for dmg in \
  "src-tauri/target/release/bundle/dmg/ClassNode_${VERSION}_macos_apple-silicon.dmg" \
  "src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/ClassNode_${VERSION}_macos_intel.dmg"; do
  [ -f "$dmg" ] || continue
  sz=$(du -h "$dmg" | cut -f1)
  cp "$dmg" "$INSTALLER_DIR/"
  ok "$(basename "$dmg")  (${sz})"
done

# ─── 源码包 ──────────────────────────────────────────
sub ""
sub "打包源码分发包..."
bash dev.sh dist 2>&1 | sed 's/^/  /'

# ─── 等待 CI ──────────────────────────────────────────
if [ "$DO_CI" = true ] && [ -n "$CI_RUN_NUM" ]; then
  section "等待 CI 构建完成"
  CI_START=$SECONDS
  sp="/-\|"; si=0

  while true; do
    STATUS=$(gh run view "$CI_RUN_NUM" --repo "$REPO" --json status,conclusion --jq '{status,conclusion}' 2>/dev/null)
    CONCLUSION=$(echo "$STATUS" | jq -r '.conclusion')
    STATE=$(echo "$STATUS" | jq -r '.status')

    if [ "$STATE" = "completed" ]; then
      echo ""
      if [ "$CONCLUSION" = "success" ]; then
        elapsed=$((SECONDS - CI_START))
        elapsed_str=$(printf "%dm %02ds" $((elapsed/60)) $((elapsed%60)))
        ok "CI 构建成功（耗时 ${elapsed_str}）"
        sleep 5

        sub ""; sub "获取 Release 资产信息..."
        ASSETS_JSON=$(gh api "repos/${REPO}/releases/tags/v${VERSION}" --jq '.assets[] | select(.name | endswith(".exe")) | {name, size, browser_download_url}' 2>/dev/null)
        if [ -z "$ASSETS_JSON" ]; then
          warn "未找到 Release，等待 10 秒后重试..."
          sleep 10
          ASSETS_JSON=$(gh api "repos/${REPO}/releases/tags/v${VERSION}" --jq '.assets[] | select(.name | endswith(".exe")) | {name, size, browser_download_url}' 2>/dev/null)
        fi

        if [ -n "$ASSETS_JSON" ]; then
          DOWNLOAD_OK=true
          while read -r asset; do
            NAME=$(echo "$asset" | jq -r '.name')
            SIZE=$(echo "$asset" | jq -r '.size')
            URL=$(echo "$asset" | jq -r '.browser_download_url')
            FILE="${INSTALLER_DIR}/${NAME}"

            # 如果已存在且大小匹配则跳过
            if [ -f "$FILE" ]; then
              EXISTING_SIZE=$(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE" 2>/dev/null)
              if [ "$EXISTING_SIZE" = "$SIZE" ]; then
                ok "${NAME} 已存在，跳过下载"
                continue
              fi
              sub "文件不完整，断点续传..."
            fi

            sub "下载 ${NAME}（${SIZE} bytes）..."
            curl -L -C - -o "$FILE" "$URL" 2>&1 | sed 's/^/  /' || { warn "${NAME} 下载失败"; DOWNLOAD_OK=false; continue; }

            # 校验大小
            DOWNLOADED_SIZE=$(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE" 2>/dev/null)
            if [ "$DOWNLOADED_SIZE" -eq "$SIZE" ] 2>/dev/null; then
              ok "${NAME} 下载完成（大小匹配）"
            else
              warn "${NAME} 大小不匹配（期望 ${SIZE}，实际 ${DOWNLOADED_SIZE}），重试一次..."
              curl -L -C - -o "$FILE" "$URL" 2>&1 | sed 's/^/  /'
              DOWNLOADED_SIZE=$(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE" 2>/dev/null)
              if [ "$DOWNLOADED_SIZE" -eq "$SIZE" ] 2>/dev/null; then
                ok "${NAME} 下载完成（重试后大小匹配）"
              else
                warn "${NAME} 大小仍不匹配，跳过"
                DOWNLOAD_OK=false
              fi
            fi
          done < <(echo "$ASSETS_JSON" | jq -c '.')

          if [ "$DOWNLOAD_OK" = true ]; then
            ok "所有 Windows 安装包下载完成"

            # ─── 上传到网盘 ─────────────────────────────
            section "上传到网盘"
            for target in "123" "kuake"; do
              dest="alist:${target}/v${VERSION}/"
              sub "上传到 ${target}..."
              if rclone copy "$INSTALLER_DIR" "$dest" -P --transfers 1 --low-level-retries 10 2>&1 | sed 's/^/  /'; then
                ok "${target} 上传完成"
              else
                warn "${target} 上传失败"
              fi
            done
          else
            warn "部分文件下载失败，跳过上传"
          fi
        else
          warn "无法获取 Release 资产信息，请手动下载"
        fi
      else
        echo -e "  ${RED}${BOLD}━━━ CI 构建失败 (${CONCLUSION}) ━━━${NC}"
        [ -n "$CI_URL" ] && dim "查看日志: ${CI_URL}"
      fi
      break
    fi

    elapsed=$((SECONDS - CI_START))
    elapsed_str=$(printf "%dm %02ds" $((elapsed/60)) $((elapsed%60)))
    ci=${sp:$si:1}; si=$(( (si+1) % 4 ))
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
for f in "$INSTALLER_DIR"/*; do
  [ -f "$f" ] || continue
  echo -e "  ${GRAY}•${NC} $(basename "$f")  ${DIM}($(du -h "$f" | cut -f1))${NC}"
done

mac_count=$(ls "$INSTALLER_DIR"/*.dmg 2>/dev/null | wc -l | tr -d ' ')
win_count=$(ls "$INSTALLER_DIR"/*.exe 2>/dev/null | wc -l | tr -d ' ')
zip_count=$(ls "$INSTALLER_DIR"/*.zip 2>/dev/null | wc -l | tr -d ' ')

echo ""
echo -e "  ${GREEN}${BOLD}🎉 构建完成！${NC}"
echo -e "  ${GRAY}macOS DMG:${NC} ${mac_count} 个   ${GRAY}Windows exe:${NC} ${win_count} 个   ${GRAY}源码包:${NC} ${zip_count} 个"
echo ""
