#!/usr/bin/env bash
# ClassNode local development control.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$ROOT_DIR/.dev"
PID_DIR="$STATE_DIR/pids"
LOG_DIR="$STATE_DIR/logs"
CLIENT_PORT="${CLASSNODE_CLIENT_PORT:-4000}"
SERVER_PORT="${CLASSNODE_SERVER_PORT:-4001}"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'
  CYAN=$'\033[0;36m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; NC=$'\033[0m'
else
  RED=; GREEN=; YELLOW=; CYAN=; BOLD=; DIM=; NC=
fi

info() { printf '  %sℹ%s %s\n' "$CYAN" "$NC" "$*"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '  %s⚠%s %s\n' "$YELLOW" "$NC" "$*"; }
die() { printf '  %s✗%s %s\n' "$RED" "$NC" "$*" >&2; exit 1; }

require_command() {
  command -v "$1" >/dev/null || die "缺少命令: $1"
}

ensure_runtime() {
  require_command node
  require_command pnpm
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  ((major >= 24)) || die "需要 Node.js >= 24，当前为 $(node --version)"
}

pid_file() { printf '%s/%s.pid' "$PID_DIR" "$1"; }
log_file() { printf '%s/%s.log' "$LOG_DIR" "$1"; }

read_pid() {
  local file
  file="$(pid_file "$1")"
  [[ -f "$file" ]] && tr -dc '0-9' < "$file"
}

pid_running() {
  [[ -n "${1:-}" ]] && kill -0 "$1" 2>/dev/null
}

pid_belongs_to_project() {
  local pid="$1" cwd
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  [[ "$cwd" == "$ROOT_DIR" || "$cwd" == "$ROOT_DIR/"* ]]
}

port_pid() {
  lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1
}

assert_port_free() {
  local port="$1" pid
  pid="$(port_pid "$port" || true)"
  [[ -z "$pid" ]] || die "端口 $port 已被 PID $pid 占用；请先确认该进程后再停止它"
}

wait_for_port() {
  local port="$1" attempts=0
  while ((attempts < 120)); do
    [[ -n "$(port_pid "$port" || true)" ]] && return 0
    sleep 0.5
    attempts=$((attempts + 1))
  done
  return 1
}

kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

start_service() {
  local service="$1" port="$2" pid existing
  existing="$(read_pid "$service" || true)"
  if pid_running "$existing" && pid_belongs_to_project "$existing"; then
    info "${service} 已在运行（PID ${existing}）"
    return
  fi

  rm -f "$(pid_file "$service")"
  assert_port_free "$port"
  mkdir -p "$PID_DIR" "$LOG_DIR"

  if [[ "$service" == client ]]; then
    nohup env NEXT_PUBLIC_API_PORT="$SERVER_PORT" PORT="$CLIENT_PORT" \
      pnpm dev >"$(log_file client)" 2>&1 &
  else
    nohup env PORT="$SERVER_PORT" FRONTEND_PORT="$CLIENT_PORT" \
      pnpm dev:server >"$(log_file server)" 2>&1 &
  fi
  pid=$!
  printf '%s\n' "$pid" >"$(pid_file "$service")"

  if wait_for_port "$port"; then
    ok "${service} 已启动（PID ${pid}，端口 ${port}）"
  else
    warn "$service 在 60 秒内未监听端口 $port"
    tail -n 30 "$(log_file "$service")" || true
    kill_tree "$pid"
    rm -f "$(pid_file "$service")"
    return 1
  fi
}

stop_service() {
  local service="$1" pid attempts=0
  pid="$(read_pid "$service" || true)"
  if ! pid_running "$pid"; then
    rm -f "$(pid_file "$service")"
    info "$service 未运行"
    return
  fi
  if ! pid_belongs_to_project "$pid"; then
    warn "忽略 ${service} 的陈旧 PID ${pid}：进程不属于当前项目"
    rm -f "$(pid_file "$service")"
    return
  fi

  kill_tree "$pid"
  while pid_running "$pid" && ((attempts < 20)); do
    sleep 0.25
    attempts=$((attempts + 1))
  done
  if pid_running "$pid"; then
    warn "$service 未及时退出，强制终止 PID $pid"
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$(pid_file "$service")"
  ok "$service 已停止"
}

cmd_start() {
  ensure_runtime
  require_command lsof
  start_service server "$SERVER_PORT"
  start_service client "$CLIENT_PORT"
  printf '\n  前端: %shttp://localhost:%s%s\n' "$CYAN" "$CLIENT_PORT" "$NC"
  printf '  后端: %shttp://localhost:%s%s\n' "$CYAN" "$SERVER_PORT" "$NC"
}

cmd_foreground() {
  ensure_runtime
  require_command lsof
  assert_port_free "$CLIENT_PORT"
  assert_port_free "$SERVER_PORT"
  cd "$ROOT_DIR"
  env PORT="$SERVER_PORT" FRONTEND_PORT="$CLIENT_PORT" pnpm dev:server &
  local server_pid=$!
  env NEXT_PUBLIC_API_PORT="$SERVER_PORT" PORT="$CLIENT_PORT" pnpm dev &
  local client_pid=$!
  trap 'kill_tree "$client_pid"; kill_tree "$server_pid"' INT TERM EXIT
  wait "$client_pid" "$server_pid"
  trap - INT TERM EXIT
}

cmd_stop() {
  require_command lsof
  stop_service client
  stop_service server
}

cmd_status() {
  require_command lsof
  local service pid port
  for service in client server; do
    [[ "$service" == client ]] && port="$CLIENT_PORT" || port="$SERVER_PORT"
    pid="$(read_pid "$service" || true)"
    if pid_running "$pid" && pid_belongs_to_project "$pid"; then
      printf '  %s●%s %-7s PID %-7s 端口 %s\n' "$GREEN" "$NC" "$service" "$pid" "$port"
    else
      printf '  %s○%s %-7s 未运行\n' "$DIM" "$NC" "$service"
    fi
  done
}

cmd_logs() {
  local service="${1:-all}" files=()
  case "$service" in
    client|cl) files+=("$(log_file client)") ;;
    server|sv) files+=("$(log_file server)") ;;
    all) files+=("$(log_file server)" "$(log_file client)") ;;
    *) die "日志类型应为 client、server 或 all" ;;
  esac
  mkdir -p "$LOG_DIR"
  touch "${files[@]}"
  tail -n 80 -f "${files[@]}"
}

cmd_clean() {
  cmd_stop || true
  rm -rf "$ROOT_DIR/.next" "$ROOT_DIR/out" "$ROOT_DIR/server/dist" \
    "$ROOT_DIR/server/frontend" "$ROOT_DIR/src-tauri/resources/server"
  # 只清 PID/日志这类临时状态，否则陈旧文件会一直堆积。
  # 注意不要删整个 .dev/：其中 cache/node 是 build-mac.sh 的 Node.js 下载缓存
  # （约 100MB），删掉会强制下次打包重新下载。
  rm -rf "$PID_DIR" "$LOG_DIR"
  ok "构建产物已清理"
}

cmd_reset() {
  cmd_clean
  rm -rf "$ROOT_DIR/node_modules" "$ROOT_DIR/server/node_modules"
  cd "$ROOT_DIR"
  pnpm install
  cmd_start
}

cmd_reset_db() {
  printf '将删除开发数据库，输入 reset 确认: '
  local answer
  read -r answer
  [[ "$answer" == reset ]] || { info "已取消"; return; }
  rm -f "$ROOT_DIR/server/prisma/dev.db" "$ROOT_DIR/server/prisma/dev.db-journal"
  pnpm --dir "$ROOT_DIR" --filter classnode-server db:push
}

# 统一的打包目标词汇表。新旧两套写法都接受，归一为 release.sh 的目标名：
#   新: mac | mac-arm | mac-intel | win | all | source
#   旧: both(macOS 双架构) | arm64 | intel | windows | msi
# 结果写入 PKG_TARGET 而非 stdout —— die 在 $( ) 子 shell 中只会退出子 shell，
# 会让非法目标静默退化成空串并触发 release.sh 的默认值(全量构建)。
PKG_TARGET=""
resolve_pkg_target() {
  case "${1:-mac}" in
    mac|macos|both)              PKG_TARGET=mac ;;
    mac-arm|arm|arm64|mac-arm64) PKG_TARGET=mac-arm64 ;;
    mac-intel|intel|x64)         PKG_TARGET=mac-intel ;;
    win|windows|msi)             PKG_TARGET=windows ;;
    all)                         PKG_TARGET=all ;;
    source)                      PKG_TARGET=source ;;
    *) die "未知的打包目标: $1（可用：mac、mac-arm、mac-intel、win、all、source）" ;;
  esac
}

cmd_pkg() {
  ensure_runtime
  resolve_pkg_target "${1:-mac}"
  if [[ "$PKG_TARGET" == windows || "$PKG_TARGET" == all ]]; then
    info "Windows MSI 由 GitHub Actions 构建：命令派发后立即返回，不会在本机产出文件"
  fi
  exec bash "$ROOT_DIR/release.sh" "$PKG_TARGET"
}

cmd_db() {
  ensure_runtime
  case "${1:-}" in
    push)         pnpm --filter classnode-server db:push ;;
    gen|generate) pnpm --filter classnode-server db:generate ;;
    studio)       pnpm --filter classnode-server db:studio ;;
    reset)        cmd_reset_db ;;
    *) die "db 的动作应为 push、gen、studio 或 reset" ;;
  esac
}

# 逃生舱：低频需求直接透传给 pnpm，避免本脚本再跟着 package.json 增删子命令。
cmd_run() {
  ensure_runtime
  (($#)) || die "用法: ./dev.sh run <pnpm 脚本名> [参数...]"
  pnpm run "$@"
}

show_help() {
  cat <<EOF
${BOLD}ClassNode 开发工具${NC}

用法: ./dev.sh <命令>

${BOLD}日常${NC}
  start                 后台启动开发环境（前端 ${CLIENT_PORT} / 后端 ${SERVER_PORT}）—— 默认命令
  fg                    前台启动，Ctrl-C 退出
  stop                  关闭
  restart               重启
  status                查看服务状态
  logs [client]         跟踪日志（默认前端 + 后端）

${BOLD}构建${NC}
  build                 构建前端静态导出 → out/
  pkg [目标]            构建并生成安装包（默认 mac）
                        目标：mac | mac-arm | mac-intel | win | all | source

${BOLD}维护${NC}
  db <动作>             数据库：push | gen | studio | reset
  clean                 停止服务并清理构建产物与 .dev/ 状态
  run <脚本> [参数...]   直接执行任意 pnpm 脚本
  version               查看当前版本
  version:bump <版本>   准备新版本（不自动提交）
  help                  显示本帮助

${BOLD}说明${NC}
  pkg win / pkg all 中的 Windows MSI 由 GitHub Actions 构建，命令派发后
  立即返回，不会在本机产出文件。
  pkg 要求工作区无未提交改动；临时放行可设 CLASSNODE_ALLOW_DIRTY_RELEASE=1。
  db reset 会删除开发数据库，需输入 reset 确认。
  端口可通过 CLASSNODE_CLIENT_PORT / CLASSNODE_SERVER_PORT 覆盖。
EOF
}

cd "$ROOT_DIR"
command_name="${1:-start}"
shift || true
case "$command_name" in
  # 日常
  start|dev:all)  cmd_start ;;
  fg|foreground)  cmd_foreground ;;
  stop)           cmd_stop ;;
  restart)        cmd_stop; cmd_start ;;
  status|ps)      cmd_status ;;
  logs)           cmd_logs "$@" ;;

  # 构建
  build)          ensure_runtime; pnpm build ;;
  pkg)            cmd_pkg "$@" ;;
  # 旧的 r / release 一律走 cmd_pkg，其目标归一表同时接受旧词汇
  r|release|release:full) cmd_pkg "$@" ;;

  # 维护
  db)             cmd_db "$@" ;;
  clean)          cmd_clean ;;
  run)            cmd_run "$@" ;;
  version)        node -p '"ClassNode v" + require("./package.json").version' ;;
  version:bump)   ensure_runtime; node scripts/prepare-release.mjs "$@" ;;

  # 已废弃的旧名，保留一代以免打断肌肉记忆；下一版可整段删除
  build:server)   ensure_runtime; pnpm build:server ;;
  build:all)      ensure_runtime; pnpm build:all ;;
  db:push)        cmd_db push ;;
  db:generate)    cmd_db gen ;;
  db:studio)      cmd_db studio ;;
  reset-db)       cmd_db reset ;;
  reset|fresh)    ensure_runtime; cmd_reset ;;

  help|-h|--help) show_help ;;
  *) die "未知命令: ${command_name}（运行 ./dev.sh help 查看帮助）" ;;
esac
