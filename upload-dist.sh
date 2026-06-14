#!/bin/zsh
# ClassNode - 上传版本安装文件到网盘 (123 / 夸克)
# 用法: ./upload-dist.sh [版本号]
#   不写参数则上传最新版本

# ─── ANSI Colors ──────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
  CYAN='\033[0;36m'; BLUE='\033[0;34m'; GRAY='\033[0;90m'
else
  BOLD=; DIM=; NC=; RED=; GREEN=; YELLOW=; CYAN=; BLUE=; GRAY=
fi

# ─── Helpers ──────────────────────────────────────────
ok()    { echo -e "  ${GREEN}✓${NC} $*"; }
info()  { echo -e "  ${CYAN}ℹ${NC} $*"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $*"; }
err()   { echo -e "  ${RED}✗${NC} $*" >&2; }
dim()   { echo -e "  ${GRAY}$*${NC}"; }
hr()    { echo -e "  ${DIM}────────────────────────────────────────${NC}"; }

SRC_BASE="/Users/zxc/Downloads/ClassNode/installer"
TARGETS=("123" "kuake")

# ─── 解析版本 ─────────────────────────────────────────
if [ $# -eq 0 ]; then
  VER=$(ls -1d ${SRC_BASE}/v* 2>/dev/null | sed 's/.*\/v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)
  if [ -z "$VER" ]; then
    err "找不到任何版本目录 (${SRC_BASE}/v*)"
    exit 1
  fi
  info "最新版本: ${BOLD}v${VER}${NC}"
elif [ $# -eq 1 ]; then
  VER="$1"
else
  err "用法: $0 [版本号]"
  dim "$0          # 上传最新版"
  dim "$0 1.4.1    # 上传指定版"
  exit 1
fi

SRC="${SRC_BASE}/v${VER}"
if [ ! -d "$SRC" ]; then
  err "目录不存在: ${BOLD}${SRC}${NC}"
  exit 1
fi

# ─── 文件清单 ─────────────────────────────────────────
files=()
for f in "$SRC"/*; do
  [ -f "$f" ] && files+=("$f")
done

if [ ${#files[@]} -eq 0 ]; then
  err "目录中没有任何文件: $SRC"
  exit 1
fi

echo ""
echo -e "  ${BOLD}${BLUE}━━━ 上传 ClassNode v${VER} 到网盘 ━━━${NC}"
dim "来源: $SRC"
hr

for f in "${files[@]}"; do
  size=$(du -h "$f" | cut -f1)
  echo -e "  ${GRAY}•${NC} $(basename "$f") ${DIM}(${size})${NC}"
done
echo ""

# ─── 上传 ─────────────────────────────────────────────
ALL_OK=true
for target in "${TARGETS[@]}"; do
  DEST="alist:${target}/v${VER}/"

  echo -e "  ${BOLD}☁️  ${target}${NC}"
  dim "→ ${DEST}"
  hr

  if rclone copy "$SRC" "$DEST" -P --transfers 1 --low-level-retries 10; then
    ok "${target} 上传完成"
  else
    warn "${target} 上传失败"
    ALL_OK=false
  fi
  echo ""
done

# ─── 汇总 ─────────────────────────────────────────────
if [ "$ALL_OK" = true ]; then
  echo -e "  ${GREEN}${BOLD}🎉 全部上传完成！${NC}"
else
  echo -e "  ${YELLOW}${BOLD}⚠ 部分上传失败，请检查后重试${NC}"
fi
echo ""
