#!/usr/bin/env bash
# Compatibility entry point. Prefer: ./release.sh <target>
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-full}" in
  full|win) target=all ;;
  mac) target=mac ;;
  arm64) target=mac-arm64 ;;
  intel) target=mac-intel ;;
  -h|--help) exec bash "$ROOT_DIR/release.sh" --help ;;
  *) echo "错误: 未知旧版发布模式 $1" >&2; exit 2 ;;
esac
exec bash "$ROOT_DIR/release.sh" "$target"
