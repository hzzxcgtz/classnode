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
    nohup env PORT="$SERVER_PORT" pnpm dev:server >"$(log_file server)" 2>&1 &
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
  env PORT="$SERVER_PORT" pnpm dev:server &
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
  rm -f "$ROOT_DIR/server/prisma/dev.db" "$ROOT_DIR/server/prisma/dev.db-journal" \
    "$ROOT_DIR/server/.schema-version"
  pnpm --dir "$ROOT_DIR" --filter classnode-server db:push
}

show_help() {
  cat <<EOF
${BOLD}ClassNode 开发工具${NC}

用法: ./dev.sh <命令>

  start                 后台启动前端和后端（默认）
  foreground            前台启动前端和后端
  stop | restart        停止或重启由本脚本启动的服务
  status                查看服务状态
  logs [client|server]  跟踪日志
  build                 构建前端
  build:server          编译后端
  build:all             构建前后端并组装 Web 运行目录
  db:push|db:generate|db:studio
  reset-db              重建开发数据库
  clean                 停止服务并清理构建产物
  reset                 清理、重装依赖并启动
  version               查看版本
  version:bump <版本>   准备新版本（不自动提交）
  release [目标]        调用统一发布脚本

端口可通过 CLASSNODE_CLIENT_PORT / CLASSNODE_SERVER_PORT 覆盖。
EOF
}

cd "$ROOT_DIR"
command_name="${1:-start}"
shift || true
case "$command_name" in
  start|dev:all) cmd_start ;;
  foreground) cmd_foreground ;;
  stop) cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status|ps) cmd_status ;;
  logs) cmd_logs "$@" ;;
  build) ensure_runtime; pnpm build ;;
  build:server) ensure_runtime; pnpm build:server ;;
  build:all) ensure_runtime; pnpm build:all ;;
  db:push|db:generate|db:studio) ensure_runtime; pnpm --filter classnode-server "$command_name" ;;
  reset-db) ensure_runtime; cmd_reset_db ;;
  clean) cmd_clean ;;
  reset|fresh) ensure_runtime; cmd_reset ;;
  version) node -p '"ClassNode v" + require("./package.json").version' ;;
  version:bump) ensure_runtime; node scripts/prepare-release.mjs "$@" ;;
  release|release:full) exec bash "$ROOT_DIR/release.sh" "$@" ;;
  r)
    case "${1:-arm64}" in
      arm64) target=mac-arm64 ;;
      intel) target=mac-intel ;;
      both) target=mac ;;
      all) target=all ;;
      *) die "r 的目标应为 arm64、intel、both 或 all" ;;
    esac
    exec bash "$ROOT_DIR/release.sh" "$target"
    ;;
  help|-h|--help) show_help ;;
  *) die "未知命令: ${command_name}（运行 ./dev.sh help 查看帮助）" ;;
esac
