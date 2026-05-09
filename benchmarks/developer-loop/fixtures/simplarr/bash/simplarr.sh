#!/usr/bin/env bash
# simplarr — bash entry point.
set -euo pipefail

cmd="${1:-help}"
shift || true

case "$cmd" in
  init)   exec "$(dirname "$0")/cmd_init.sh" "$@" 2>/dev/null || { echo "init not implemented" >&2; exit 2; } ;;
  apply)  exec "$(dirname "$0")/cmd_apply.sh" "$@" ;;
  revert) exec "$(dirname "$0")/cmd_revert.sh" "$@" 2>/dev/null || { echo "revert not implemented" >&2; exit 2; } ;;
  *)      echo "usage: simplarr {init|apply|revert}" >&2; exit 2 ;;
esac
