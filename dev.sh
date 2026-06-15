#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ─── ANSI Colors ──────────────────────────────────────

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
  BLUE='\033[0;34m'; CYAN='\033[0;36m'; MAGENTA='\033[0;35m'
  GRAY='\033[0;90m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
else
  RED=; GREEN=; YELLOW=; BLUE=; CYAN=; MAGENTA=; GRAY=; BOLD=; DIM=; NC=
fi

# ─── Log Helpers ──────────────────────────────────────

log()         { echo -e "$*"; }
log_ok()      { echo -e "  ${GREEN}✓${NC} $*"; }
log_info()    { echo -e "  ${CYAN}ℹ${NC} $*"; }
log_warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
log_error()   { echo -e "  ${RED}✗${NC} $*" >&2; }
log_cmd()     { echo -e "  ${DIM}\$${NC} ${GRAY}$*${NC}"; }
log_sub()     { echo -e "  ${GRAY}$*${NC}"; }
log_section() { echo -e "\n  ${BOLD}${BLUE}━━━ $* ━━━${NC}"; }

# ─── Globals ──────────────────────────────────────────

VERSION="$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "?")"

finish_timer() {
  local elapsed=$((SECONDS - _start))
  printf "  ${DIM}⌛ 耗时 %dm %ds${NC}\n" $((elapsed/60)) $((elapsed%60))
}

# ─── Help ──────────────────────────────────────────────

show_help() {
  log ""
  printf "  ${BOLD}%s${NC} ${GRAY}%s${NC}\n" "ClassNode v${VERSION}" "— 开发工具"
  printf "  ${GRAY}%s${NC}\n" "用法: ./dev.sh <command> [options]"
  log ""

  log "  ${BOLD}开发${NC}"
  printf "    ${CYAN}%-28s${NC} %s\n" "dev" "启动前端 (Next.js)"
  printf "    ${CYAN}%-28s${NC} %s\n" "dev:server" "启动后端 (Express)"
  printf "    ${CYAN}%-28s${NC} %s\n" "dev:all" "同时启动前端 + 后端"
  printf "    ${CYAN}%-28s${NC} %s\n" "tauri" "启动 Tauri 桌面开发"
  printf "    ${CYAN}%-28s${NC} %s\n" "status" "查看当前运行状态"
  log ""

  log "  ${BOLD}端口选项${NC}"
  printf "    ${GRAY}%-28s${NC} %s\n" "--port N" "前端端口（默认 4000）"
  printf "    ${GRAY}%-28s${NC} %s\n" "--api-port N" "后端端口（默认 4001）"
  log ""

  log "  ${BOLD}构建${NC}"
  printf "    ${CYAN}%-28s${NC} %s\n" "build" "构建前端"
  printf "    ${CYAN}%-28s${NC} %s\n" "build:server" "编译后端"
  printf "    ${CYAN}%-28s${NC} %s\n" "build:all" "构建前端 + 后端"
  log ""

  log "  ${BOLD}版本号${NC}"
  printf "    ${CYAN}%-28s${NC} %s\n" "version" "查看当前版本"
  printf "    ${CYAN}%-28s${NC} %s\n" "version:bump <ver>" "升级到指定版本"
  printf "    ${CYAN}%-28s${NC} %s\n" "version:bump patch" "修订号 +1"
  printf "    ${CYAN}%-28s${NC} %s\n" "version:sync" "同步到所有子项目"
  log ""

  log "  ${BOLD}发行版${NC}"
  printf "    ${CYAN}%-28s${NC} %s\n" "r" "macOS ARM64"
  printf "    ${CYAN}%-28s${NC} %s\n" "r intel" "macOS Intel"
  printf "    ${CYAN}%-28s${NC} %s\n" "r both" "macOS 双架构（ARM64 + Intel）"
  printf "    ${CYAN}%-28s${NC} %s\n" "r all" "macOS 双架构 + 源码包"
  printf "    ${CYAN}%-28s${NC} %s\n" "release [x64|both|all]" "Windows 远程构建（默认 x64）"
  printf "    ${CYAN}%-28s${NC} %s\n" "release:full" "全平台构建（macOS + Windows CI + 下载 + 源码包）"
  printf "    ${CYAN}%-28s${NC} %s\n" "ci [x64|x86|arm64|both]" "Windows CI 构建（默认全架构）"
  log ""

  log "  ${BOLD}Git 快捷${NC}"
  printf "    ${CYAN}%-28s${NC} %s\n" "gs / git:status" "查看变更"
  printf "    ${CYAN}%-28s${NC} %s\n" "gl / git:log [n]" "提交历史（默认 10 条）"
  printf "    ${CYAN}%-28s${NC} %s\n" "gd / git:diff [file]" "查看改动内容"
  printf "    ${CYAN}%-28s${NC} %s\n" "git:pull" "拉取最新代码"
  printf "    ${CYAN}%-28s${NC} %s\n" "git:push" "推送代码"
  log ""

  log "  ${BOLD}数据库${NC}"
  printf "    ${CYAN}%-28s${NC} %s\n" "db:push" "同步表结构"
  printf "    ${CYAN}%-28s${NC} %s\n" "db:studio" "Prisma Studio"
  printf "    ${CYAN}%-28s${NC} %s\n" "db:generate" "重新生成 Prisma Client"
  printf "    ${CYAN}%-28s${NC} %s\n" "reset-db" "重置数据库（删除后重建）"
  printf "    ${CYAN}%-28s${NC} %s\n" "prisma:format" "格式化 Prisma schema"
  log ""

  log "  ${BOLD}进程管理${NC}"
  printf "    ${CYAN}%-28s${NC} %s\n" "ps" "查看运行中的服务进程"
  printf "    ${CYAN}%-28s${NC} %s\n" "stop [ports]" "停掉服务（默认 4000 4001）"
  log ""

  log "  ${BOLD}维护${NC}"
  printf "    ${CYAN}%-28s${NC} %s\n" "clean" "清理构建产物"
  printf "    ${CYAN}%-28s${NC} %s\n" "clean:all" "深度清理（含 node_modules）"
  printf "    ${CYAN}%-28s${NC} %s\n" "fresh" "全新安装（clean:all + 重装依赖）"
  printf "    ${CYAN}%-28s${NC} %s\n" "lint" "ESLint 检查"
  printf "    ${CYAN}%-28s${NC} %s\n" "start / run" "运行 node start.js"
  printf "    ${CYAN}%-28s${NC} %s\n" "dist / package" "打包源码分发包 (classnode-<ver>.zip)"
  printf "    ${CYAN}%-28s${NC} %s\n" "speedtest" "测试 GitHub 下载速度"
  printf "    ${CYAN}%-28s${NC} %s\n" "help" "显示本帮助"
  log ""
}

# ─── 版本号 ────────────────────────────────────────────

cmd_version() {
  echo "ClassNode v${VERSION}"
}

cmd_version_bump() {
  local new_ver
  if [ $# -eq 0 ]; then
    log_error "请指定版本号"
    log_info "用法: ./dev.sh version:bump <版本号|patch>"
    log_info "示例: ./dev.sh version:bump 1.4.0"
    log_info "      ./dev.sh version:bump patch"
    exit 1
  fi
  if [ "$1" = "patch" ]; then
    local cur
    cur=$(node -e "console.log(require('./package.json').version)") || true
    new_ver=$(echo "$cur" | awk -F. '{printf "%d.%d.%d", $1, $2, $3+1}')
    log_sub "修订号 +1: ${GRAY}$cur${NC} → ${CYAN}$new_ver${NC}"
  elif [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    new_ver="$1"
  else
    log_error "无效版本号: $1"
    log_info "请使用 semver 格式（如 1.4.0）或 patch"
    exit 1
  fi
  bash scripts/bump-version.sh "$new_ver"
  log_ok "版本已更新到 v${new_ver}（已自动提交，推送即可）"
}

cmd_version_sync() {
  node scripts/sync-version.mjs
}

# ─── 端口解析 ──────────────────────────────────────────

parse_port_opts() {
  FRONTEND_PORT=""
  API_PORT=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --port) FRONTEND_PORT="$2"; shift 2 ;;
      --api-port) API_PORT="$2"; shift 2 ;;
      *) break ;;
    esac
  done
}

# ─── 开发环境 ──────────────────────────────────────────

cleanup_tsx_watch() {
  local count
  count=$(pgrep -f "tsx.*watch.*src/index.ts" 2>/dev/null | wc -l | tr -d ' ') || true
  if [ "$count" -gt 0 ]; then
    log_info "清理 $count 个残留 tsx watch 进程..."
    pkill -f "tsx.*watch.*src/index.ts" 2>/dev/null || true
    pkill -f "esbuild.*service" 2>/dev/null || true
    log_ok "残留进程已清理"
  fi
}

cmd_dev() {
  cleanup_tsx_watch
  parse_port_opts "$@"
  local port="${FRONTEND_PORT:-4000}"
  log_info "前端 → ${CYAN}http://localhost:$port${NC}"
  if [ -n "$FRONTEND_PORT" ]; then
    PORT=$FRONTEND_PORT pnpm dev
  else
    pnpm dev
  fi
}

cmd_dev_server() {
  cleanup_tsx_watch
  parse_port_opts "$@"
  local port="${API_PORT:-4001}"
  log_info "后端 → ${CYAN}http://localhost:$port${NC}"
  if [ -n "$API_PORT" ]; then
    PORT=$API_PORT pnpm dev:server
  else
    pnpm dev:server
  fi
}

cmd_dev_all() {
  cleanup_tsx_watch
  parse_port_opts "$@"
  local fp="${FRONTEND_PORT:-4000}"
  local ap="${API_PORT:-4001}"
  log_section "并行启动"
  log_info "前端 → ${CYAN}http://localhost:$fp${NC}"
  log_info "后端 → ${CYAN}http://localhost:$ap${NC}"
  log_sub "按 ${DIM}Ctrl+C${NC} 同时停掉两个服务"
  log ""
  NEXT_PUBLIC_API_PORT=$ap PORT=$fp pnpm dlx concurrently \
    "NEXT_PUBLIC_API_PORT=$ap PORT=$fp pnpm dev" \
    "PORT=$ap pnpm dev:server"
}

cmd_tauri() { pnpm tauri dev; }

cmd_stop() {
  local ports=()
  for arg in "$@"; do
    [[ "$arg" =~ ^[0-9]+$ ]] && ports+=("$arg")
  done
  [ ${#ports[@]} -eq 0 ] && ports=(4000 4001)

  local found=false
  for p in "${ports[@]}"; do
    local pids
    pids=$(lsof -ti:$p 2>/dev/null || true)
    if [ -n "$pids" ]; then
      log_info "端口 ${CYAN}$p${NC}（PID: $(echo "$pids" | tr '\n' ' ')）"
      # SIGTERM 优雅退出
      echo "$pids" | xargs kill 2>/dev/null || true
      sleep 1
      local remaining
      remaining=$(lsof -ti:$p 2>/dev/null || true)
      if [ -n "$remaining" ]; then
        log_warn "进程未响应，强制终止..."
        echo "$remaining" | xargs kill -9 2>/dev/null || true
      fi
      log_ok "端口 $p 已释放"
      found=true
    fi
  done

  cleanup_tsx_watch

  if [ "$found" = false ]; then
    log_info "没有运行中的进程"
  fi
}

cmd_status() {
  log_section "服务状态"

  local ports=(4000 4001)
  local found=false

  if ! command -v lsof &>/dev/null; then
    log_warn "lsof 未安装，无法检查端口状态"
    return
  fi

  for p in "${ports[@]}"; do
    local pids
    pids=$(lsof -ti:$p 2>/dev/null || true)
    if [ -n "$pids" ]; then
      printf "  ${GREEN}●${NC} 端口 ${CYAN}%-4s${NC}  运行中（PID: %s）\n" "$p" "$(echo "$pids" | tr '\n' ' ')"
      found=true
    else
      printf "  ${GRAY}○${NC} 端口 %-4s  空闲\n" "$p"
    fi
  done

  local watch_pids
  watch_pids=$(pgrep -f "tsx.*watch.*src/index.ts" 2>/dev/null || true)
  if [ -n "$watch_pids" ]; then
    log_info "后端 watch 进程: $(echo "$watch_pids" | tr '\n' ' ')"
  fi

  if [ "$found" = false ]; then
    log ""
    log_info "标准端口无运行中服务"
    log_sub "可用 ${CYAN}./dev.sh dev:all${NC} 一键启动"
  fi
}

# ─── 构建 ──────────────────────────────────────────────

cmd_build() {
  _start=$SECONDS
  log_info "构建前端..."
  pnpm build
  log_ok "前端构建完成"
  finish_timer
}

cmd_build_server() {
  _start=$SECONDS
  log_info "编译后端..."
  pnpm build:server
  log_ok "后端编译完成"
  finish_timer
}

cmd_build_all() {
  _start=$SECONDS
  log_section "构建全部"

  log_info "构建前端..."
  pnpm build
  log_ok "前端构建完成"

  log_info "复制静态资源..."
  cp -r out server/frontend
  cp -r out src-tauri/resources/server/frontend
  log_ok "静态资源已复制"

  finish_timer
}

# ─── 数据库 ────────────────────────────────────────────

cmd_db_push()     { pnpm --filter classnode-server db:push; }
cmd_db_studio()   { pnpm --filter classnode-server db:studio; }
cmd_db_generate() { pnpm --filter classnode-server db:generate; }

# ─── 发行版 ────────────────────────────────────────────

_release_export() {
  local dst="/Users/zxc/Downloads/ClassNode/installer/v${VERSION}"
  mkdir -p "$dst"
  log_sub "目标: $dst"
  for src in "$@"; do
    if [ -f "$src" ]; then
      size=$(du -h "$src" | cut -f1)
      cp "$src" "$dst/"
      log_ok "$(basename "$src")  ${DIM}(${size})${NC}"
    fi
  done
}

_make_source_dist() {
  local dst="/Users/zxc/Downloads/ClassNode/installer/v${VERSION}"
  local dist_name="classnode-${VERSION}"
  local dist_dir="/tmp/${dist_name}"
  local zip_file="${dst}/${dist_name}.zip"

  log_info "打包源码分发包..."

  # 清理临时目录
  rm -rf "$dist_dir"
  mkdir -p "$(dirname "$dist_dir")"

  # rsync 复制项目文件（排除构建产物和开发文件）
  rsync -a \
    --exclude='node_modules' \
    --exclude='.next' \
    --exclude='out' \
    --exclude='server/node_modules' \
    --exclude='server/dist' \
    --exclude='server/frontend' \
    --exclude='server/prisma/dev.db' \
    --exclude='server/prisma/dev.db-journal' \
    --exclude='server/uploads/chat' \
    --exclude='server/uploads/logos' \
    --exclude='server/backups' \
    --exclude='src-tauri' \
    --exclude='.pnpm-store' \
    --exclude='pnpm-lock.yaml' \
    --exclude='pnpm-workspace.yaml' \
    --exclude='make-dist.sh' \
    --exclude='build-release.sh' \
    --exclude='release-full.sh' \
    --exclude='download-release.sh' \
    --exclude='upload-dist.sh' \
    --exclude='SCRIPTS.md' \
    --exclude='tsconfig.tsbuildinfo' \
    --exclude='next-env.d.ts' \
    --exclude='eslint.config.mjs' \
    --exclude='dev.md' \
    --exclude='dev.sh' \
    --exclude='server/.env' \
    --exclude='.env.development' \
    --exclude='.git' \
    --exclude='.DS_Store' \
    --exclude='.npmrc' \
    --exclude='CLAUDE.md' \
    --exclude='memory/' \
    --exclude='portal/' \
    --exclude='scripts/' \
    "$ROOT/" "$dist_dir/" 2>/dev/null

  # 清理并生成运行所需配置
  rm -f "$dist_dir/pnpm-workspace.yaml"
  rm -f "$dist_dir/server/prisma/dev.db" "$dist_dir/server/prisma/dev.db-journal"

  cat > "$dist_dir/.npmrc" << 'NPMRC'
registry=https://registry.npmmirror.com/
NPMRC

  cat > "$dist_dir/server/.env" << 'ENV'
DATABASE_URL="file:./dev.db"
ENV

  # 压缩
  mkdir -p "$dst"
  rm -f "$zip_file"
  (cd /tmp && zip -r "$zip_file" "$dist_name" > /dev/null 2>&1)

  size=$(du -sh "$zip_file" | cut -f1)
  log_ok "${dist_name}.zip → 安装包目录（${size}）"
  rm -rf "$dist_dir"
}

cmd_release() {
  _start=$SECONDS
  log_section "构建发行版（ARM64）"
  pnpm build:mac:arm64 || { log_error "ARM64 构建失败"; exit 1; }
  log ""
  log_section "导出到安装包目录"
  _release_export "src-tauri/target/release/bundle/dmg/ClassNode_${VERSION}_macos_apple-silicon.dmg"
  finish_timer
}

cmd_release_intel() {
  _start=$SECONDS
  log_section "构建发行版（Intel）"
  pnpm build:mac:intel || { log_error "Intel 构建失败"; exit 1; }
  log ""
  log_section "导出到安装包目录"
  _release_export "src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/ClassNode_${VERSION}_macos_intel.dmg"
  finish_timer
}

cmd_release_both() {
  _start=$SECONDS
  log_section "构建 ARM64 版"
  pnpm build:mac:arm64 || { log_error "ARM64 构建失败"; exit 1; }
  log ""
  log_section "构建 Intel 版"
  pnpm build:mac:intel || { log_error "Intel 构建失败"; exit 1; }
  log ""
  log_section "导出到安装包目录"
  _release_export \
    "src-tauri/target/release/bundle/dmg/ClassNode_${VERSION}_macos_apple-silicon.dmg" \
    "src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/ClassNode_${VERSION}_macos_intel.dmg"
  finish_timer
}

cmd_release_all() {
  _start=$SECONDS
  log_section "构建 ARM64 版"
  pnpm build:mac:arm64 || { log_error "ARM64 构建失败"; exit 1; }
  log ""
  log_section "构建 Intel 版"
  pnpm build:mac:intel || { log_error "Intel 构建失败"; exit 1; }
  log ""
  log_section "导出到安装包目录"
  _release_export \
    "src-tauri/target/release/bundle/dmg/ClassNode_${VERSION}_macos_apple-silicon.dmg" \
    "src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/ClassNode_${VERSION}_macos_intel.dmg"
  _make_source_dist
  finish_timer
}

# ─── 其他 ──────────────────────────────────────────────

cmd_lint()  { pnpm lint; }

cmd_clean() {
  log_info "清理构建产物..."
  rm -rf out server/dist server/frontend
  rm -rf src-tauri/resources/server/dist src-tauri/resources/server/changelogs src-tauri/resources/server/frontend
  log_ok "前端产物（out/）已清理"
  log_ok "后端产物（server/dist/）已清理"
  log_ok "Tauri 资源目录产物已清理"
}

cmd_clean_all() {
  log_section "深度清理"
  log_info "清理所有构建产物和 node_modules..."
  rm -rf out server/dist server/frontend node_modules server/node_modules
  log_ok "构建产物和 node_modules 已删除"
  log_sub "运行 ${CYAN}./dev.sh fresh${NC} 重新安装"
}

cmd_fresh() {
  log_section "全新安装"
  cmd_clean_all
  log_info "重新安装依赖..."
  pnpm install && cd server && pnpm install && cd ..
  log_ok "依赖安装完成"
  cmd_db_push
  log_info "运行 ${CYAN}./dev.sh build:all${NC} 完成构建"
}

# ─── 进程管理 ──────────────────────────────────────────

cmd_ps() {
  log_section "运行中的进程"
  local count=0
  for port in 4000 4001 3000 3001; do
    local pids
    pids=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pids" ]; then
      printf "  ${GREEN}●${NC} 端口 ${CYAN}%-4s${NC}   PID: %s\n" "$port" "$(echo "$pids" | tr '\n' ' ')"
      count=$((count+1))
    fi
  done
  local watch_pids
  watch_pids=$(pgrep -f "tsx.*watch.*src/index.ts" 2>/dev/null || true)
  if [ -n "$watch_pids" ]; then
    log_info "tsx watch: $(echo "$watch_pids" | tr '\n' ' ')"
  fi
  if [ "$count" -eq 0 ]; then
    log_info "没有运行中的服务"
  fi
}

# ─── Git 快捷操作 ─────────────────────────────────────

cmd_git_status() {
  git status -s
}

cmd_git_log() {
  local n="${1:-10}"
  git log --oneline --graph -"$n"
}

cmd_git_diff() {
  local file="$1"
  if [ -n "$file" ]; then
    git diff "$file"
  else
    git diff --stat
  fi
}

cmd_git_pull() {
  log_info "拉取最新代码..."
  git pull --rebase
  log_ok "已更新"
}

cmd_git_commit() {
  if [ $# -eq 0 ]; then
    log_error "请提供提交信息"
    log_info "用法: ./dev.sh git:commit <提交信息>"
    return
  fi
  local msg="$*"
  git add -A
  git commit -m "$msg"
  log_ok "已提交: ${msg}"
}

cmd_git_push() {
  local branch
  branch=$(git branch --show-current)
  log_info "推送到 ${CYAN}$branch${NC} ..."
  git push
  log_ok "已推送"
}

# ─── 启动与分发 ───────────────────────────────────────

cmd_start() {
  log_info "运行 node start.js ..."
  node start.js
}

cmd_dist() {
  log_info "打包源码分发包到 /tmp ..."
  _make_source_dist
}

cmd_speedtest() {
  local url="${1:-}"
  local tmpfile="/tmp/classnode-speedtest"
  local loop_mode=false
  [ "${1:-}" = "--loop" ] && loop_mode=true && url=""
  [ "${2:-}" = "--loop" ] && loop_mode=true

  # 如果没给 URL，自动找最新 Release 里最大的 exe
  if [ -z "$url" ]; then
    log_section "GitHub 下载速度测试"
    log_info "自动获取最新 Release 文件..."
    local asset
    asset=$(gh api "repos/hzzxcgtz/classnode/releases" \
      --jq '[.[] | select(.draft == false)][0].assets[] | select(.name | endswith(".exe")) | {name, browser_download_url, size}' 2>/dev/null | jq -s 'sort_by(.size) | reverse | .[0]' 2>/dev/null || echo "")
    if [ -z "$asset" ] || [ "$asset" = "null" ] || [ -z "$(echo "$asset" | jq -r '.browser_download_url' 2>/dev/null || echo '')" ]; then
      log_warn "未找到 Release，回退到源码 zip 测速"
      url="https://github.com/hzzxcgtz/classnode/archive/refs/heads/main.zip"
      log_info "文件: main.zip"
    else
      url=$(echo "$asset" | jq -r '.browser_download_url')
      local name=$(echo "$asset" | jq -r '.name')
      log_info "文件: ${name}（约 ${size_mb} MB）"
    fi
  else
    log_section "GitHub 下载速度测试"
  fi
  log_info "地址: $(echo "$url" | sed 's|https://||')"
  [ "$loop_mode" = true ] && log_info "循环模式: 每轮结束后等待 5 秒自动重测"
  log_info "提示: 测速过程中可切换代理链路，观察实时速度变化"
  echo ""

  local round=0
  while true; do
    round=$((round + 1))
    [ "$loop_mode" = true ] && echo -e "  ${DIM}─── 第 ${round} 轮 ───${NC}"

    # 下载测速（实时进度显示 + 手动计算速率）
    local start_time end_time elapsed size
    start_time=$(date +%s 2>/dev/null || echo 0)
    curl -L -o "$tmpfile" "$url" 2>&1 | sed 's/^/  /'
    local curl_exit=$?
    end_time=$(date +%s 2>/dev/null || echo 0)
    time_total=$((end_time - start_time))
    [ "$time_total" -lt 1 ] && time_total=1

    local http_code size_mb speed_mb
    http_code=200
    size=$(stat -f%z "$tmpfile" 2>/dev/null || stat -c%s "$tmpfile" 2>/dev/null)
    size="${size:-0}"
    [ "$time_total" -gt 0 ] 2>/dev/null || time_total=1
    size_mb=$(python3 -c "print('%.2f' % (${size}/1048576))" 2>/dev/null || echo "0.00")
    speed_mb=$(python3 -c "print('%.2f' % (${size}/1048576/${time_total}))" 2>/dev/null || echo "0.00")

    if [ "$curl_exit" -ne 0 ]; then
      echo ""
      log_error "下载失败（curl 退出码: $curl_exit）"
      rm -f "$tmpfile" 2>/dev/null
      [ "$loop_mode" = false ] && return 1
      sleep 3; continue
    fi

    size=$(stat -f%z "$tmpfile" 2>/dev/null || stat -c%s "$tmpfile" 2>/dev/null)

    echo ""
    echo -e "  ${BOLD}━━━ 第 ${round} 轮结果 ━━━${NC}"
    echo -e "  ${GRAY}文件大小:${NC} ${size_mb} MB"
    echo -e "  ${GRAY}下载用时:${NC} ${time_total}s"
    echo -e "  ${GRAY}平均速度:${NC} ${speed_mb} MB/s"
    echo -e "  ${GRAY}HTTP 状态:${NC} ${http_code}"

    rm -f "$tmpfile" 2>/dev/null

    if [ "$loop_mode" = true ]; then
      log_info "5 秒后下一轮（按 Ctrl+C 终止）..."
      echo ""
      sleep 5
    else
      break
    fi
  done

  [ "$loop_mode" = false ] && log_ok "测试完成"
}

# ─── 数据库操作 ───────────────────────────────────────

cmd_reset_db() {
  log_section "重置数据库"
  log_warn "将删除现有数据库！"
  read -p "  确认重置? (y/N): " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    log_info "已取消"
    return
  fi
  rm -f server/prisma/dev.db server/prisma/dev.db-journal server/.schema-version
  log_ok "数据库文件已删除"
  cmd_db_push
}

cmd_prisma_format() {
  log_info "格式化 Prisma schema..."
  pnpm --filter classnode-server exec prisma format
  log_ok "已完成"
}

# ─── 入口 ──────────────────────────────────────────────

case "${1:-help}" in
  --version|-v)                    cmd_version ;;
  r) shift
     case "$1" in
       both)  cmd_release_both ;;
       intel) cmd_release_intel ;;
       all)   cmd_release_all ;;
       *)     cmd_release ;;
     esac ;;
  ci)                               shift; bash build-release.sh "$@" ;;
  dev)                             shift; cmd_dev "$@" ;;
  dev:server)                      shift; cmd_dev_server "$@" ;;
  dev:all)                         shift; cmd_dev_all "$@" ;;
  tauri)                           cmd_tauri ;;
  stop)                            shift; cmd_stop "$@" ;;
  status)                          cmd_status ;;
  build)                           cmd_build ;;
  build:server)                    cmd_build_server ;;
  build:all)                       cmd_build_all ;;
  db:push)                         cmd_db_push ;;
  db:studio)                       cmd_db_studio ;;
  db:generate)                     cmd_db_generate ;;
  version)                         cmd_version ;;
  version:bump)                    shift; cmd_version_bump "$@" ;;
  version:sync)                    cmd_version_sync ;;
  release)                         shift; bash build-release.sh "${1:-x64}" ;;
  release:full)                    shift; bash release-full.sh "$@" ;;
  build:ci)                        shift; bash build-release.sh "$@" ;;
  lint)                            cmd_lint ;;
  clean)                           cmd_clean ;;
  clean:all)                       cmd_clean_all ;;
  fresh)                           cmd_fresh ;;
  ps)                              cmd_ps ;;
  gs|git:status)                   cmd_git_status ;;
  gl|git:log)                      shift; cmd_git_log "$@" ;;
  gd|git:diff)                     shift; cmd_git_diff "$@" ;;
  git:pull)                        cmd_git_pull ;;
  git:commit)                      shift; cmd_git_commit "$@" ;;
  git:push)                        cmd_git_push ;;
  start|run)                       cmd_start ;;
  dist|package)                    cmd_dist ;;
  speedtest)                       shift; cmd_speedtest "$@" ;;
  reset-db)                        cmd_reset_db ;;
  prisma:format)                   cmd_prisma_format ;;
  help|--help|-h)                  show_help ;;
  *)
    log_error "未知命令: $1"
    log_sub "可用命令: ${CYAN}./dev.sh help${NC}"
    exit 1
    ;;
esac
