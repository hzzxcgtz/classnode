#!/bin/bash
# ============================================
# ClassNode - 上传版本安装文件到百度网盘
# 用法:
#   ./scripts/upload-to-baidupan.sh 1.4.1
#   ./scripts/upload-to-baidupan.sh 1.4.1 ./dist
#
# 前置条件:
#   先安装 BaiduPCS-Go: https://github.com/qjfoidnh/BaiduPCS-Go
#   并执行 BaiduPCS-Go login 完成登录
# ============================================

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "用法: $0 <version> [source-dir]"
  echo "示例: $0 1.4.1"
  echo "      $0 1.4.1 /path/to/v1.4.1"
  exit 1
fi

VERSION="$1"
REMOTE_DIR="/classnode"

# 确定源目录
if [ $# -ge 2 ]; then
  SRC_DIR="$2"
else
  SRC_DIR="./v${VERSION}"
fi

if [ ! -d "$SRC_DIR" ]; then
  echo "错误: 源目录不存在: $SRC_DIR"
  exit 1
fi

# 检查 BaiduPCS-Go 是否可用
if ! command -v BaiduPCS-Go &>/dev/null; then
  echo "错误: 未找到 BaiduPCS-Go，请先安装:"
  echo "  https://github.com/qjfoidnh/BaiduPCS-Go"
  exit 1
fi

echo "=========================================="
echo "  ClassNode v${VERSION} → 百度网盘"
echo "  源目录: $(cd "$SRC_DIR" && pwd)"
echo "  目标:   ${REMOTE_DIR}/v${VERSION}/"
echo "=========================================="

# 检查登录状态
if ! BaiduPCS-Go loglist 2>&1 | grep -q "百度\|Baidu"; then
  echo "未登录，请先执行: BaiduPCS-Go login"
  exit 1
fi

# 创建远程目录（如果不存在）
echo ""
echo "创建远程目录 ${REMOTE_DIR}/v${VERSION}/ ..."
BaiduPCS-Go mkdir "${REMOTE_DIR}/v${VERSION}" 2>/dev/null || true

# 递归上传整个目录
echo ""
echo "开始上传 ..."
BaiduPCS-Go upload --slice-size 104857600 "$SRC_DIR" "${REMOTE_DIR}/v${VERSION}/"

echo ""
echo "=========================================="
echo "  上传完成!"
echo "  https://pan.baidu.com/ 查看"
echo "=========================================="
