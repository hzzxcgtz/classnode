#!/usr/bin/env bash
# Trigger the Windows GitHub Actions build and reliably identify its run.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPOSITORY="${CLASSNODE_GITHUB_REPOSITORY:-hzzxcgtz/classnode}"
BRANCH="${CLASSNODE_RELEASE_BRANCH:-main}"
ARCH="${1:-both}"
WAIT=true
RUN_ID_FILE=""

shift || true
while (($#)); do
  case "$1" in
    --no-wait) WAIT=false; shift ;;
    --run-id-file)
      [[ $# -ge 2 ]] || { echo "错误: --run-id-file 缺少路径" >&2; exit 2; }
      RUN_ID_FILE="$2"; shift 2 ;;
    *) echo "错误: 未知参数 $1" >&2; exit 2 ;;
  esac
done

case "$ARCH" in
  all|both|x64|arm64) ;;
  -h|--help)
    echo "用法: scripts/build-windows.sh [both|x64|arm64] [--no-wait] [--run-id-file <path>]"
    exit 0 ;;
  *) echo "错误: 未知架构 $ARCH" >&2; exit 2 ;;
esac

command -v gh >/dev/null || { echo "错误: 缺少 GitHub CLI (gh)" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "错误: 请先执行 gh auth login" >&2; exit 1; }

cd "$ROOT_DIR"
dispatched_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "[windows] 触发 ${REPOSITORY}/build.yml（${ARCH}）"
gh workflow run build.yml --repo "$REPOSITORY" --ref "$BRANCH" --field "arch=$ARCH"

run_id=""
for _ in $(seq 1 20); do
  run_id="$(gh run list \
    --repo "$REPOSITORY" \
    --workflow build.yml \
    --branch "$BRANCH" \
    --event workflow_dispatch \
    --limit 20 \
    --json databaseId,createdAt \
    --jq "map(select(.createdAt >= \"$dispatched_at\")) | .[0].databaseId // empty")"
  [[ -n "$run_id" ]] && break
  sleep 2
done

[[ -n "$run_id" ]] || { echo "错误: 未找到刚触发的 workflow run" >&2; exit 1; }
[[ -z "$RUN_ID_FILE" ]] || printf '%s\n' "$run_id" > "$RUN_ID_FILE"
echo "[windows] https://github.com/$REPOSITORY/actions/runs/$run_id"

if [[ "$WAIT" == false ]]; then
  exit 0
fi

gh run watch "$run_id" --repo "$REPOSITORY" --exit-status
version="$(node -p 'require("./package.json").version')"
release_url="$(gh release view "v$version" --repo "$REPOSITORY" --json url --jq .url 2>/dev/null || true)"
[[ -z "$release_url" ]] || echo "[windows] Draft release: $release_url"
