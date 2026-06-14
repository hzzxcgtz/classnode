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

  log "  ${BOLD}发行版（macOS）${NC}"
  printf "    ${CYAN}%-28s${NC} %s\n" "release" "构建 ARM64 版并导出到安装包目录"
  printf "    ${CYAN}%-28s${NC} %s\n" "release:intel" "构建 Intel 版并导出到安装包目录"
  printf "    ${CYAN}%-28s${NC} %s\n" "release:all" "构建 ARM64 + Intel 并导出到安装包目录"
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
  printf "    ${CYAN}%-28s${NC} %s\n" "dist / package" "运行 make-dist.sh 打包分发"
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
  local count=0
  for src in "$@"; do
    if [ -f "$src" ]; then
      cp "$src" "$dst/"
      log_ok "$(basename "$src") → 安装包目录"
      count=$((count + 1))
    fi
  done
  [ "$count" -gt 0 ] && log_sub "目标: $dst"
}

cmd_release() {
  _start=$SECONDS
  log_section "构建发行版（ARM64）"
  pnpm build:mac:arm64 || { log_error "ARM64 构建失败"; exit 1; }
  _release_export "ClassNode-v${VERSION}-Apple-Silicon.dmg"
  finish_timer
}

cmd_release_intel() {
  _start=$SECONDS
  log_section "构建发行版（Intel）"
  pnpm build:mac:intel || { log_error "Intel 构建失败"; exit 1; }
  _release_export "ClassNode-v${VERSION}-Intel.dmg"
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
  log_ok "两个版本构建完成"
  _release_export "ClassNode-v${VERSION}-Apple-Silicon.dmg" "ClassNode-v${VERSION}-Intel.dmg"
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
  log_info "运行 make-dist.sh ..."
  bash make-dist.sh
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
  release)                         cmd_release ;;
  release:intel)                   cmd_release_intel ;;
  release:all)                     cmd_release_all ;;
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
  reset-db)                        cmd_reset_db ;;
  prisma:format)                   cmd_prisma_format ;;
  help|--help|-h)                  show_help ;;
  *)
    log_error "未知命令: $1"
    log_sub "可用命令: ${CYAN}./dev.sh help${NC}"
    exit 1
    ;;
esac
