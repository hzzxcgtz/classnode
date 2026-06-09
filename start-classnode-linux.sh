#!/bin/bash
cd "$(dirname "$0")"

# 自动查找 Node.js（双击执行时不加载 .bashrc，PATH 可能不完整）
NODE_CMD=""
NODE_DIR=""
for cmd in node nodejs /usr/local/bin/node /usr/bin/node ~/software/nodejs24/bin/node; do
  if command -v "$cmd" &>/dev/null; then
    NODE_CMD="$cmd"
    NODE_DIR="$(dirname "$cmd")"
    break
  fi
done

if [ -z "$NODE_CMD" ]; then
  echo "错误：未找到 Node.js，请确认已安装。"
  echo "下载地址：https://nodejs.org"
  echo ""
  read -p "按 Enter 键退出..."
  exit 1
fi

# 将 Node.js 所在目录加入 PATH，确保 npx 等命令可用
export PATH="$NODE_DIR:$PATH"

clear
echo "============================================"
echo "  ClassNode - AI 互动课堂系统"
echo "  双击启动脚本"
echo "============================================"
echo ""
echo "  Node.js: $($NODE_CMD -v)"
echo ""
$NODE_CMD start.js
echo ""
echo "按 Enter 键退出..."
read
