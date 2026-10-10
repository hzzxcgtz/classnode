#!/usr/bin/env bash
# ClassNode local development control.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
STATE_DIR="$ROOT_DIR/.dev"
PID_DIR="$STATE_DIR/pids"
LOG_DIR="$STATE_DIR/logs"
CLIENT_PORT="${CLASSNODE_CLIENT_PORT:-4000}"
SERVER_PORT="${CLASSNODE_SERVER_PORT:-4001}"
# 探究空间托管服务的端口。必须与服务端口不同源，否则 sandbox 的 allow-same-origin
# 会让 iframe 能自行摘除 sandbox；服务端会拒绝「两者相同」并在日志里说明。
WEBAPP_PORT="${CLASSNODE_WEBAPP_PORT:-}"

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

validate_ports() {
  local port
  for port in "$CLIENT_PORT" "$SERVER_PORT"; do
    [[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] && ((port <= 65535)) || die "无效端口: $port（应为 1–65535）"
  done
  WEBAPP_PORT="${WEBAPP_PORT:-$((SERVER_PORT + 1))}"
  [[ "$WEBAPP_PORT" =~ ^[1-9][0-9]{0,4}$ ]] && ((WEBAPP_PORT <= 65535)) || die "无效托管端口: $WEBAPP_PORT"
  [[ "$CLIENT_PORT" != "$SERVER_PORT" && "$CLIENT_PORT" != "$WEBAPP_PORT" && "$SERVER_PORT" != "$WEBAPP_PORT" ]] || die "前端、后端和探究空间端口必须各不相同"
}

service_running() {
  local pid
  pid="$(read_pid "$1" || true)"
  pid_running "$pid" && pid_belongs_to_project "$pid"
}

pid_file() { printf '%s/%s.pid' "$PID_DIR" "$1"; }
log_file() { printf '%s/%s.log' "$LOG_DIR" "$1"; }

read_pid() {
  local file
  file="$(pid_file "$1")"
  [[ -f "$file" ]] || return 1
  local pid
  pid="$(cat "$file")"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] && printf '%s' "$pid"
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
  local port="$1" pid="$2" attempts=0 listener
  while ((attempts < 120)); do
    pid_running "$pid" || return 1
    listener="$(port_pid "$port" || true)"
    [[ -n "$listener" ]] && pid_belongs_to_project "$listener" && return 0
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
      CLASSNODE_WEBAPP_PORT="$WEBAPP_PORT" \
      pnpm dev:server >"$(log_file server)" 2>&1 &
  fi
  pid=$!
  printf '%s\n' "$pid" >"$(pid_file "$service")"

  if wait_for_port "$port" "$pid"; then
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
  require_command pgrep
  validate_ports
  local server_was_running=false
  if service_running server; then
    server_was_running=true
  else
    assert_port_free "$SERVER_PORT"
    assert_port_free "$WEBAPP_PORT"
  fi
  if ! service_running client; then assert_port_free "$CLIENT_PORT"; fi
  start_service server "$SERVER_PORT" || return 1
  # 后端会单独捕获托管服务的启动失败，因此还需检查它的监听状态。
  if ! wait_for_port "$WEBAPP_PORT" "$(read_pid server)"; then
    warn "探究空间未监听端口 $WEBAPP_PORT"
    [[ "$server_was_running" == true ]] || stop_service server
    return 1
  fi
  if ! start_service client "$CLIENT_PORT"; then
    [[ "$server_was_running" == true ]] || stop_service server
    return 1
  fi
  printf '\n  前端: %shttp://localhost:%s%s\n' "$CYAN" "$CLIENT_PORT" "$NC"
  printf '  后端: %shttp://localhost:%s%s\n' "$CYAN" "$SERVER_PORT" "$NC"
  printf '  托管: %shttp://localhost:%s%s  （探究空间）\n' "$CYAN" "$WEBAPP_PORT" "$NC"
}

cmd_foreground() {
  ensure_runtime
  require_command lsof
  require_command pgrep
  validate_ports
  assert_port_free "$CLIENT_PORT"
  assert_port_free "$SERVER_PORT"
  # 前台模式下端口被占会表现为「服务起来了但探究空间加载不出来」，而不是明确的启动失败。
  assert_port_free "$WEBAPP_PORT"
  cd "$ROOT_DIR"
  local server_pid="" client_pid="" result=0
  trap '[[ -z "$client_pid" ]] || kill_tree "$client_pid"; [[ -z "$server_pid" ]] || kill_tree "$server_pid"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  env PORT="$SERVER_PORT" FRONTEND_PORT="$CLIENT_PORT" \
    CLASSNODE_WEBAPP_PORT="$WEBAPP_PORT" pnpm dev:server &
  server_pid=$!
  env NEXT_PUBLIC_API_PORT="$SERVER_PORT" PORT="$CLIENT_PORT" pnpm dev &
  client_pid=$!
  # macOS 自带 Bash 3.2 没有 wait -n；轮询存活状态以便任一服务退出时清理另一方。
  while pid_running "$client_pid" && pid_running "$server_pid"; do sleep 0.5; done
  if ! pid_running "$client_pid"; then wait "$client_pid" || result=$?;
  else wait "$server_pid" || result=$?; fi
  exit "$result"
}

cmd_stop() {
  require_command lsof
  require_command pgrep
  stop_service client
  stop_service server
}

cmd_status() {
  require_command lsof
  validate_ports
  local service pid port note
  for service in client server; do
    [[ "$service" == client ]] && port="$CLIENT_PORT" || port="$SERVER_PORT"
    # 探究空间与 server **同进程**，所以只附加在 server 那行，不新增第三个 service 项 ——
    # cmd_stop 只按 PID 文件停，单列一项会去找一个不存在的 PID 文件。
    [[ "$service" == server ]] && note="（探究空间 ${WEBAPP_PORT}）" || note=""
    pid="$(read_pid "$service" || true)"
    if pid_running "$pid" && pid_belongs_to_project "$pid"; then
      printf '  %s●%s %-7s PID %-7s 端口 %s%s\n' "$GREEN" "$NC" "$service" "$pid" "$port" "$note"
    else
      printf '  %s○%s %-7s 未运行\n' "$DIM" "$NC" "$service"
    fi
  done
}

cmd_logs() {
  local service="${1:-all}" files=()
  case "$service" in
    web|frontend|client|cl) files+=("$(log_file client)") ;;
    backend|server|sv) files+=("$(log_file server)") ;;
    all) files+=("$(log_file server)" "$(log_file client)") ;;
    *) die "日志类型应为 client、server 或 all" ;;
  esac
  mkdir -p "$LOG_DIR"
  touch "${files[@]}"
  tail -n 80 -f "${files[@]}"
}

cmd_clean() {
  cmd_stop
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
  cmd_stop
  rm -f "$ROOT_DIR/server/prisma/dev.db" "$ROOT_DIR/server/prisma/dev.db-journal" \
    "$ROOT_DIR/server/prisma/dev.db-wal" "$ROOT_DIR/server/prisma/dev.db-shm"
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
  if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then exec bash "$ROOT_DIR/release.sh" --help; fi
  ensure_runtime
  resolve_pkg_target "${1:-mac}"
  (($# == 0)) || shift
  if [[ "$PKG_TARGET" == windows || "$PKG_TARGET" == all ]]; then
    info "Windows MSI 由 GitHub Actions 构建：命令派发后立即返回，不会在本机产出文件"
  fi
  exec bash "$ROOT_DIR/release.sh" "$PKG_TARGET" "$@"
}

cmd_db() {
  ensure_runtime
  case "${1:-}" in
    push)         pnpm --filter classnode-server db:push ;;
    gen|generate) pnpm --filter classnode-server db:generate ;;
    studio)       pnpm --filter classnode-server db:studio ;;
    reset)        cmd_reset_db ;;
    *) die "db 的动作应为 push、generate、studio 或 reset" ;;
  esac
}

# 逃生舱：低频需求直接透传给 pnpm，避免本脚本再跟着 package.json 增删子命令。
cmd_run() {
  ensure_runtime
  (($#)) || die "用法: ./dev.sh run <pnpm 脚本名> [参数...]"
  pnpm run "$@"
}

cmd_build() {
  ensure_runtime
  (($# <= 1)) || die "用法: ./dev.sh build [web|server|all]"
  case "${1:-all}" in
    web|client|frontend) pnpm build ;;
    server) pnpm build:server ;;
    all) pnpm build:all ;;
    *) die "构建目标应为 web、server 或 all" ;;
  esac
}

cmd_install() {
  ensure_runtime
  pnpm install --frozen-lockfile
  pnpm --filter classnode-server db:generate
  ok "依赖和数据库客户端已准备好；运行 ./dev.sh start 启动开发环境"
}

cmd_test() {
  ensure_runtime
  local target="${1:-all}" script
  (($# == 0)) || shift
  case "$target" in
    all) script=test ;;
    web|client|frontend) script=test:client ;;
    server|backend) script=test:server ;;
    scripts) script=test:scripts ;;
    *) die "用法: ./dev.sh test [all|web|server|scripts] [测试参数...]" ;;
  esac
  if [[ "$target" == all && $# -gt 0 ]]; then die "筛选测试时请指定 web、server 或 scripts"; fi
  pnpm run "$script" "$@"
}

cmd_check() {
  ensure_runtime
  (($# <= 1)) || die "用法: ./dev.sh check [all|scripts|lint]"
  case "${1:-all}" in
    all) pnpm check:scripts; pnpm lint ;;
    scripts) pnpm check:scripts ;;
    lint) pnpm lint ;;
    *) die "用法: ./dev.sh check [all|scripts|lint]" ;;
  esac
}

cmd_version() {
  local action="${1:-show}"
  (($# == 0)) || shift
  case "$action" in
    show) (($# == 0)) || die "用法: ./dev.sh version"; node -p '"ClassNode v" + require("./package.json").version' ;;
    sync) (($# == 0)) || die "用法: ./dev.sh version sync"; ensure_runtime; node scripts/sync-version.mjs ;;
    prepare) ensure_runtime; node scripts/prepare-release.mjs "$@" ;;
    *) die "用法: ./dev.sh version [show|sync|prepare <patch|minor|major|版本号>]" ;;
  esac
}

cmd_serve() {
  ensure_runtime
  [[ -f "$ROOT_DIR/server/dist/index.js" && -f "$ROOT_DIR/server/frontend/index.html" ]] || die "请先运行 ./dev.sh build，再运行 ./dev.sh serve"
  pnpm start
}

show_help() {
  cat <<EOF
${BOLD}ClassNode 开发工具${NC}

在项目根目录直接运行以下命令，不需要记 pnpm 或 node 的内部命令。

${BOLD}第一次使用${NC}
  ./dev.sh install            安装依赖并生成数据库客户端
  ./dev.sh start              后台启动开发环境

${BOLD}日常${NC}
  ./dev.sh start              后台启动（前端 ${CLIENT_PORT} / 后端 ${SERVER_PORT}）
  ./dev.sh foreground         前台启动，Ctrl-C 停止
  ./dev.sh stop               停止开发服务
  ./dev.sh restart            重启开发服务
  ./dev.sh status             查看服务状态
  ./dev.sh logs               跟踪全部开发日志，Ctrl-C 退出查看
  ./dev.sh logs web           只看前端日志（server 为后端）

${BOLD}构建${NC}
  ./dev.sh build              构建前端和后端，准备本地运行目录
  ./dev.sh build web          只构建前端（server 为后端）
  ./dev.sh serve              运行构建好的项目，Ctrl-C 停止
  ./dev.sh package mac-arm64  打包 Apple Silicon 安装包
  ./dev.sh package mac-intel  打包 Intel 安装包
  ./dev.sh package mac        打包 macOS 两种架构（package 默认目标）
  ./dev.sh package windows    触发远程 Windows 构建
  ./dev.sh package source     打包已提交的源码
  ./dev.sh package all        打包全部平台和源码

${BOLD}检查与测试${NC}
  ./dev.sh check              检查脚本语法和代码规范
  ./dev.sh check scripts      只检查脚本语法（lint 为代码规范）
  ./dev.sh test               运行全部测试
  ./dev.sh test web           只测前端（server 为后端，scripts 为开发工具）

${BOLD}维护${NC}
  ./dev.sh db generate        生成数据库客户端
  ./dev.sh db push            将数据库结构同步到开发库
  ./dev.sh db studio          打开数据库管理界面
  ./dev.sh db reset           删除开发数据库并重新创建（需确认）
  ./dev.sh clean              停服务、清构建产物和日志（不删数据库）
  ./dev.sh version            查看版本
  ./dev.sh version sync       同步各处版本号
  ./dev.sh version prepare patch  准备下一个补丁版本，不提交或推送
  ./dev.sh help               显示帮助；只输入 ./dev.sh 也显示帮助

${BOLD}说明${NC}
  package win / package all 中的 Windows MSI 由 GitHub Actions 构建，命令派发后
  立即返回，不会在本机产出文件。
  package 要求工作区无未提交改动；临时放行可设 CLASSNODE_ALLOW_DIRTY_RELEASE=1。
  db reset 会删除开发数据库，需输入 reset 确认。
  端口可通过 CLASSNODE_CLIENT_PORT / CLASSNODE_SERVER_PORT /
  CLASSNODE_WEBAPP_PORT 覆盖。探究空间托管端口必须与后端端口不同（同源会让
  iframe 的 sandbox 隔离失效），服务端遇到两者相同会拒绝启动该服务。
EOF
}

cd "$ROOT_DIR"
command_name="${1:-help}"
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
  build)          cmd_build "$@" ;;
  package|pkg)    cmd_pkg "$@" ;;
  # 旧的 r / release 一律走 cmd_pkg，其目标归一表同时接受旧词汇
  r|release|release:full) cmd_pkg "$@" ;;

  # 维护
  install|setup)  cmd_install ;;
  test)           cmd_test "$@" ;;
  check)          cmd_check "$@" ;;
  serve)          cmd_serve ;;
  db)             cmd_db "$@" ;;
  clean)          cmd_clean ;;
  run)            cmd_run "$@" ;;
  version)        cmd_version "$@" ;;
  version:prepare|version:bump) ensure_runtime; node scripts/prepare-release.mjs "$@" ;;

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
