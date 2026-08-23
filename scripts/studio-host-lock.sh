#!/usr/bin/env bash
# studio-host-lock.sh — take and release the host-global journey lock.
#
# `ui:journey`, `ui:deadpaths` and `ui:walkthrough:gate --boot` all bind the
# fixed Studio ports (bridge 4123, UI 4124), so they cannot run while
# `forge studio` holds them. This script is the ONLY sanctioned way to drop
# and restore Studio for a gate run.
#
# It exists so the permission grant can be narrow: one auditable command,
# instead of a blanket `kill` allowance. It REFUSES to signal any process
# whose command line is not recognisably forge's own bridge or its Next
# server — a foreign process holding 4123/4124 is reported, never killed.
#
#   ./scripts/studio-host-lock.sh status   # who holds the ports
#   ./scripts/studio-host-lock.sh stop     # release (verifies before killing)
#   ./scripts/studio-host-lock.sh start    # bring `forge studio` back up
#
# Safety properties, deliberately:
#   - kills by PID only, never by pattern (`pkill -f` matches the caller's own
#     command line — a documented footgun in this repo's orchestration notes);
#   - verifies each PID's /proc cmdline against forge's own signatures first;
#   - refuses to run `stop` while a cycle is in flight, since a journey run
#     would contend with it.

set -euo pipefail

FORGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE_PORT=4123
UI_PORT=4124

# A PID may only be signalled if its command line matches one of these.
is_forge_process() {
  local pid="$1" cmdline
  cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [ -n "$cmdline" ] || return 1
  case "$cmdline" in
    *orchestrator/cli.ts*studio*) return 0 ;;
    *next-server*|*next*start*) [ -e "/proc/$pid/cwd" ] && [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$(readlink -f "$FORGE_ROOT/forge-ui" 2>/dev/null)" ] && return 0
                                [ -e "/proc/$pid/cwd" ] && [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$FORGE_ROOT" ] && return 0
                                return 1 ;;
    *) return 1 ;;
  esac
}

port_holders() {
  ss -lptn "sport = :$BRIDGE_PORT or sport = :$UI_PORT" 2>/dev/null \
    | grep -oP 'pid=\K[0-9]+' | sort -u
}

cmd_status() {
  local found=0 pid
  for pid in $(port_holders); do
    found=1
    printf '%-8s %-6s %s\n' "$pid" \
      "$(is_forge_process "$pid" && echo forge || echo FOREIGN)" \
      "$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-100)"
  done
  [ "$found" = 1 ] || echo "ports $BRIDGE_PORT/$UI_PORT are free"
  local inflight
  inflight="$(ls "$FORGE_ROOT/_queue/in-flight" 2>/dev/null | grep -c '\.md$' || true)"
  echo "in-flight cycles: ${inflight:-0}"
}

cmd_stop() {
  local inflight
  inflight="$(ls "$FORGE_ROOT/_queue/in-flight" 2>/dev/null | grep -c '\.md$' || true)"
  if [ "${inflight:-0}" -gt 0 ]; then
    echo "refusing: ${inflight} cycle(s) in flight — a journey run would contend with them" >&2
    echo "park _queue/pending and wait for the cycle to reach a terminal state first" >&2
    exit 2
  fi

  local pid killed=0
  for pid in $(port_holders); do
    if is_forge_process "$pid"; then
      echo "stopping forge process $pid"
      kill "$pid" 2>/dev/null || true
      killed=$((killed + 1))
    else
      echo "REFUSING to signal $pid — not a forge process:" >&2
      tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-160 >&2 || true
      exit 3
    fi
  done

  local waited=0
  while [ -n "$(port_holders)" ] && [ "$waited" -lt 20 ]; do
    sleep 0.5
    waited=$((waited + 1))
  done

  if [ -n "$(port_holders)" ]; then
    echo "ports still held after $((waited / 2))s — not escalating; inspect with 'status'" >&2
    exit 4
  fi
  echo "released ports $BRIDGE_PORT/$UI_PORT (stopped $killed process(es))"
}

cmd_start() {
  if [ -n "$(port_holders)" ]; then
    echo "ports already held — refusing to start a second Studio:" >&2
    cmd_status >&2
    exit 5
  fi
  cd "$FORGE_ROOT"
  mkdir -p "$FORGE_ROOT/_logs"
  nohup node --experimental-strip-types orchestrator/cli.ts studio \
    > "$FORGE_ROOT/_logs/studio-host-lock.log" 2>&1 &
  echo "started forge studio (pid $!); log: _logs/studio-host-lock.log"
}

case "${1:-status}" in
  status) cmd_status ;;
  stop)   cmd_stop ;;
  start)  cmd_start ;;
  *) echo "usage: $0 {status|stop|start}" >&2; exit 64 ;;
esac
