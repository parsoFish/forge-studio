#!/usr/bin/env bash
# shellcheck disable=SC2034
set -euo pipefail

cmd_apply() {
  local dry_run=0
  local manifest=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) dry_run=1; shift ;;
      *) manifest="$1"; shift ;;
    esac
  done
  if [[ -z "$manifest" ]]; then
    echo "usage: simplarr apply [--dry-run] <manifest>" >&2
    return 2
  fi
  if (( dry_run )); then
    echo "[DRY-RUN] would create: $manifest.applied"
    return 0
  fi
  echo "[APPLY] writing $manifest.applied"
  : > "$manifest.applied"
}
