#!/usr/bin/env bash
# ============================================================================
# ClassNode Linux 安装/升级脚本
# ============================================================================
# 用法：
#   首次安装：  sudo bash install.sh [/自定义/安装路径]
#   版本升级：  下载新版 -> 解压 -> sudo bash install.sh [/自定义/安装路径]
#
# 默认安装路径：/opt/classnode
# ============================================================================
set -euo pipefail

# ─── 配置 ─────────────────────────────────────────────────────────────────
INSTALL_DIR="${1:-/opt/classnode}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="/tmp/classnode-backup-$(date +%Y%m%d%H%M%S)"
STEP=0
MODE="fresh"  # fresh = 首次安装, upgrade = 版本升级

# ─── 颜色输出 ──────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

ok()   { echo -e "  ${GREEN}✔${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✘${NC} $1"; exit 1; }
info() { echo -e "  ${CYAN}→${NC} $1"; }
step() {
  STEP=$((STEP+1))
  echo ""
  echo -e "${CYAN}[$STEP/$TOTAL_STEPS]${NC} $1"
}

# ─── 横幅 ───────────────────────────────────────────────────────────────────
print_banner() {
  clear 2>/dev/null || true
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║                                              ║"
  echo "║     ClassNode 安装脚本                       ║"
  echo "║     课堂互动系统 · Linux 版                   ║"
  echo "║                                              ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""
}

print_success() {
  echo ""
  echo "┌──────────┬──────────┬──────────────┐"
  echo "│ 服务名称  │ 状态     │ 端口          │"
  echo "├──────────┼──────────┼──────────────┤"
  echo "│ classnode│ online   │ 3001          │"
  echo "└──────────┴──────────┴──────────────┘"
  echo ""
  echo -e "  ${GREEN}✅ 安装成功！${NC}"
  echo ""
  echo "  教师端：http://你的服务器IP:3001/teacher"
  echo "  学生端：http://你的服务器IP:3001/classroom"
  echo ""
  echo "  ⚠ 不知道服务器 IP？运行以下命令查看："
  echo "    ip addr show | grep inet"
  echo "    找到类似 192.168.x.x 或 10.x.x.x 的地址"
  echo ""
  echo "  💡 常用管理命令："
  echo "    pm2 status              — 查看运行状态"
  echo "    pm2 logs classnode      — 查看日志"
  echo "    pm2 restart classnode   — 重启服务"
  echo "    pm2 stop classnode      — 停止服务"
  echo ""
  echo "  📖 详细说明：https://github.com/hzzxcgtz/classnode"
  echo ""
}

# ─── 系统要求检测 ──────────────────────────────────────────────────────────
check_system() {
  step "检查系统环境"

  # Node.js
  if ! command -v node &>/dev/null; then
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║   未检测到 Node.js                      ║"
    echo "╚════════════════════════════════════════╝"
    echo ""
    echo "ClassNode 需要 Node.js 20 或更高版本。"
    echo ""
    echo "请根据你的 Linux 系统选择以下命令安装："
    echo ""
    echo "  📦 Ubuntu / Debian 系统："
    echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -"
    echo "    sudo apt install -y nodejs"
    echo ""
    echo "  📦 CentOS / RHEL / Fedora 系统："
    echo "    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -"
    echo "    sudo dnf install -y nodejs"
    echo ""
    echo "安装完成后，重新运行：bash install.sh"
    echo ""
    exit 1
  fi
  ok "Node.js 已安装（$(node -v)）"

  # Node.js 版本检查
  NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
  if [ "$NODE_MAJOR" -lt 18 ]; then
    fail "Node.js 版本过低（$(node -v)），请升级到 18 或更高版本"
  fi

  # pnpm
  if ! command -v pnpm &>/dev/null; then
    info "正在自动安装 pnpm..."
    npm install -g pnpm
  fi
  ok "pnpm 已安装"

  # PM2
  if ! command -v pm2 &>/dev/null; then
    info "正在自动安装 PM2（进程管理工具）..."
    npm install -g pm2
  fi
  ok "PM2 已安装"
}

# ─── 停止旧服务 ────────────────────────────────────────────────────────────
stop_old_service() {
  step "停止旧服务"
  if pm2 list 2>/dev/null | grep -q classnode; then
    pm2 stop classnode 2>/dev/null || true
    ok "旧服务已停止"
  else
    info "没有运行中的旧服务，跳过"
  fi
}

# ─── 备份用户数据（仅升级模式） ─────────────────────────────────────────────
backup_data() {
  step "备份数据"

  # 如果目标目录不存在，也就不用备份了
  if [ ! -d "$INSTALL_DIR" ]; then
    info "没有旧数据需要备份"
    return
  fi

  mkdir -p "$BACKUP_DIR"
  HAS_DATA=false

  if [ -f "$INSTALL_DIR/server/prisma/dev.db" ]; then
    cp "$INSTALL_DIR/server/prisma/dev.db" "$BACKUP_DIR/"
    HAS_DATA=true
  fi

  if [ -d "$INSTALL_DIR/server/uploads" ] && [ "$(ls -A "$INSTALL_DIR/server/uploads" 2>/dev/null)" ]; then
    cp -r "$INSTALL_DIR/server/uploads" "$BACKUP_DIR/"
    HAS_DATA=true
  fi

  if [ -d "$INSTALL_DIR/server/backups" ] && [ "$(ls -A "$INSTALL_DIR/server/backups" 2>/dev/null)" ]; then
    cp -r "$INSTALL_DIR/server/backups" "$BACKUP_DIR/"
    HAS_DATA=true
  fi

  if [ -f "$INSTALL_DIR/server/.encryption.key" ]; then
    cp "$INSTALL_DIR/server/.encryption.key" "$BACKUP_DIR/"
    HAS_DATA=true
  fi

  if [ "$HAS_DATA" = true ]; then
    ok "数据已备份到 $BACKUP_DIR"
  else
    info "没有需要备份的数据"
  fi
}

# ─── 恢复用户数据 ──────────────────────────────────────────────────────────
restore_data() {
  step "恢复数据"

  if [ ! -d "$BACKUP_DIR" ]; then
    info "没有备份数据需要恢复"
    return
  fi

  # 确保目标目录存在
  mkdir -p "$INSTALL_DIR/server/prisma"
  mkdir -p "$INSTALL_DIR/server/uploads"
  mkdir -p "$INSTALL_DIR/server/backups"

  if [ -f "$BACKUP_DIR/dev.db" ]; then
    cp "$BACKUP_DIR/dev.db" "$INSTALL_DIR/server/prisma/dev.db"
    ok "数据库已恢复"
  fi

  if [ -d "$BACKUP_DIR/uploads" ]; then
    cp -r "$BACKUP_DIR/uploads/"* "$INSTALL_DIR/server/uploads/" 2>/dev/null || true
    ok "上传文件已恢复"
  fi

  if [ -d "$BACKUP_DIR/backups" ]; then
    cp -r "$BACKUP_DIR/backups/"* "$INSTALL_DIR/server/backups/" 2>/dev/null || true
    ok "备份文件已恢复"
  fi

  if [ -f "$BACKUP_DIR/.encryption.key" ]; then
    cp "$BACKUP_DIR/.encryption.key" "$INSTALL_DIR/server/.encryption.key"
    ok "加密密钥已恢复"
  fi

  # 清理备份文件
  rm -rf "$BACKUP_DIR"
  info "临时备份文件已清理"
}

# ─── 复制源代码 ────────────────────────────────────────────────────────────
copy_source() {
  step "复制程序文件"

  # 创建目标目录
  mkdir -p "$INSTALL_DIR"

  # 复制所有文件（排除 .git 等不需要的目录）
  # 使用 find + cp 而非 rsync，减少依赖
  cd "$SCRIPT_DIR"

  # 列出需要排除的目录和文件
  EXCLUDES="node_modules .next out server/node_modules server/dist server/frontend .git"

  # 使用 tar 管道复制（比 cp -r 更精确控制排除）
  tar cf - --exclude='node_modules' \
           --exclude='.next' \
           --exclude='out' \
           --exclude='server/node_modules' \
           --exclude='server/dist' \
           --exclude='server/frontend' \
           --exclude='.git' \
           --exclude='*.db' \
           --exclude='server/logs' \
           --exclude='server/uploads' \
           --exclude='server/backups' \
           --exclude='.encryption.key' \
           --exclude='node_modules' \
           . 2>/dev/null | tar xf - -C "$INSTALL_DIR/"

  ok "程序文件复制到 $INSTALL_DIR"
}

# ─── 安装依赖 ──────────────────────────────────────────────────────────────
install_deps() {
  step "安装依赖"
  info "正在安装程序运行所需的依赖包..."
  info "根据网络速度，可能需要 2-5 分钟，请稍候..."

  cd "$INSTALL_DIR"
  if pnpm install 2>&1; then
    ok "依赖安装完成"
  else
    fail "依赖安装失败，请检查网络连接后重试"
  fi
}

# ─── 构建程序 ──────────────────────────────────────────────────────────────
build_app() {
  step "构建程序"
  info "正在编译前端页面..."
  info "正在编译后端服务..."
  info "这可能需要 3-8 分钟，请耐心等待..."

  cd "$INSTALL_DIR"

  if pnpm build 2>&1; then
    ok "前端构建完成"
  else
    fail "前端构建失败"
  fi

  if pnpm build:server 2>&1; then
    ok "后端编译完成"
  else
    fail "后端编译失败"
  fi
}

# ─── 数据库初始化 ──────────────────────────────────────────────────────────
init_database() {
  step "初始化数据库"

  cd "$INSTALL_DIR/server"

  if [ "$MODE" = "upgrade" ]; then
    # 升级模式：允许数据库结构变更
    if npx prisma db push --accept-data-loss 2>&1; then
      ok "数据库已更新（保留所有数据）"
    else
      fail "数据库更新失败"
    fi
  else
    # 首次安装：创建数据库
    if npx prisma db push 2>&1; then
      ok "数据库初始化完成"
    else
      fail "数据库初始化失败"
    fi
  fi
}

# ─── PM2 配置与启动 ────────────────────────────────────────────────────────
start_service() {
  step "启动服务"

  cd "$INSTALL_DIR"

  # 替换 ecosystem.config.js 中的路径占位符
  if [ -f "ecosystem.config.js" ]; then
    sed "s|<INSTALL_DIR>|$INSTALL_DIR|g" ecosystem.config.js > ecosystem.config.tmp.js
    mv ecosystem.config.tmp.js ecosystem.config.js
  else
    fail "未找到 ecosystem.config.js，请重新下载源码包"
  fi

  # 启动 PM2 进程
  if pm2 start ecosystem.config.js 2>&1; then
    ok "PM2 进程已启动"
    pm2 save 2>/dev/null || true
  else
    fail "PM2 启动失败，请检查错误信息"
  fi

  # 提示开机自启
  echo ""
  info "如果需要开机自启，请执行以下命令（需要 sudo）："
  echo "    pm2 startup"
  echo ""
}

# ─── 主流程 ─────────────────────────────────────────────────────────────────
main() {
  print_banner

  # 判断安装模式
  if [ -f "$INSTALL_DIR/server/package.json" ]; then
    MODE="upgrade"
    TOTAL_STEPS=7
    echo -e "  ${YELLOW}检测到 $INSTALL_DIR 已安装 ClassNode，正在执行升级...${NC}"
    echo ""
  else
    MODE="fresh"
    TOTAL_STEPS=6
    echo -e "  安装目录：${CYAN}$INSTALL_DIR${NC}"
    echo ""
  fi

  # 1. 系统环境检查
  check_system

  # 2. 停止旧服务（仅升级模式）
  if [ "$MODE" = "upgrade" ]; then
    stop_old_service
  fi

  # 3. 备份数据（仅升级模式）
  if [ "$MODE" = "upgrade" ]; then
    backup_data
  fi

  # 4. 复制源文件
  copy_source

  # 5. 恢复数据（仅升级模式）
  if [ "$MODE" = "upgrade" ]; then
    restore_data
  fi

  # 6. 安装依赖
  install_deps

  # 7. 构建
  build_app

  # 8. 初始化数据库
  init_database

  # 9. 启动服务
  start_service

  # 10. 完成
  print_success
}

# ─── 执行 ───────────────────────────────────────────────────────────────────
main "$@"
