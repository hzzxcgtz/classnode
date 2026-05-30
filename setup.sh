#!/bin/bash
set -e

echo "=============================================="
echo "  ClassNode v1.0.0 - 一键安装部署脚本"
echo "=============================================="
echo ""

# 1. 后端安装
echo "----------------------------------------------"
echo " [1/3] 安装后端..."
echo "----------------------------------------------"
cd server

# 创建环境变量
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  ✔ 已创建 .env 文件"
fi

# 安装依赖
npm install --silent
echo "  ✔ 后端依赖安装完成"

# 生成 Prisma 客户端
npx prisma generate --no-hints 2>/dev/null
echo "  ✔ Prisma 客户端生成完成"

# 编译 TypeScript
npx tsc
echo "  ✔ TypeScript 编译完成"

# 同步数据库
npx prisma db push --skip-generate 2>/dev/null || true
echo "  ✔ 数据库初始化完成"

cd ..

# 2. 前端安装
echo ""
echo "----------------------------------------------"
echo " [2/3] 安装前端..."
echo "----------------------------------------------"

npm install --silent
echo "  ✔ 前端依赖安装完成"

npx next build 2>&1 | tail -1
echo "  ✔ Next.js 构建完成"

# 3. 完成
echo ""
echo "=============================================="
echo "  安装完成！启动方式："
echo "=============================================="
echo ""
echo "  # 终端1 - 启动后端 (端口 3001)"
echo "  cd server && node dist/index.js"
echo ""
echo "  # 终端2 - 启动前端 (端口 3000)"
echo "  node serve-frontend.js"
echo ""
echo "  然后访问: http://localhost:3000"
echo "=============================================="
