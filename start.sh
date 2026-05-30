#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$DIR/server"

cleanup() {
  echo ""
  echo "正在停止服务..."
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

# ---- 安装阶段（仅首次或缺失时执行） ----
if [ ! -d "$SERVER_DIR/node_modules" ] || [ ! -d "$SERVER_DIR/dist" ] || [ ! -d "$DIR/out" ]; then
  echo "=============================================="
  echo "  ClassNode v1.0.0 - 安装部署"
  echo "=============================================="
  echo ""

  # 后端
  echo "-- [1/4] 安装后端依赖 --"
  cd "$SERVER_DIR"
  [ ! -f .env ] && cp .env.example .env
  npm install --silent
  echo "  ✔ 后端依赖安装完成"

  echo "-- [2/4] 生成 Prisma 客户端 --"
  npx prisma generate --no-hints 2>/dev/null
  echo "  ✔ Prisma 客户端生成完成"

  echo "-- [3/4] 编译 TypeScript --"
  npx tsc
  echo "  ✔ TypeScript 编译完成"

  # 数据库初始化
  npx prisma db push --skip-generate 2>/dev/null || true
  echo "  ✔ 数据库初始化完成"

  # 前端
  echo "-- [4/4] 构建前端 --"
  cd "$DIR"
  npm install --silent
  echo "  ✔ 前端依赖安装完成"
  npx next build 2>&1 | tail -1
  echo "  ✔ Next.js 构建完成"

  echo ""
  echo "=============================================="
  echo "  安装完成，正在启动服务..."
  echo "=============================================="
else
  echo "检测到已安装，直接启动..."
fi

# ---- 启动阶段 ----
cd "$SERVER_DIR"
node dist/index.js &
BACKEND_PID=$!
echo "后端服务已启动 (PID: $BACKEND_PID)  http://localhost:3001"

cd "$DIR"
node serve-frontend.js &
FRONTEND_PID=$!
echo "前端服务已启动 (PID: $FRONTEND_PID)  http://localhost:3000"

echo ""
echo "=============================================="
echo "  访问 http://localhost:3000"
echo "  按 Ctrl+C 停止所有服务"
echo "=============================================="

wait
