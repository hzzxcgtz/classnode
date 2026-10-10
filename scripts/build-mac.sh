#!/usr/bin/env bash
# 兼容入口：本机桌面构建统一由 build-desktop.mjs 实现。
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT_DIR/scripts/build-desktop.mjs" "$@"
