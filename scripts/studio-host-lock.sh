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
#   ./scripts/studio-host-lock.sh classify <cmdline> <cwd>   # dry-run the
#                                          # identity decision, kill nothing
#
# Safety properties, deliberately:
#   - kills by PID only, never by pattern (`pkill -f` matches the caller's own
#     command line — a documented footgun in this repo's orchestration notes);
#   - verifies each PID's /proc cmdline (and, for the Next server, the forge
#     checkout its cwd sits in) against forge's own signatures first;
#   - all-or-nothing: every holder is verified before any is signalled, so a
#     refusal never leaves the lock half released;
#   - refuses to run `stop` while a cycle is in flight, since a journey run
#     would contend with it.
#
# The identity decision itself is `classify_evidence` below, split out pure
# and covered by scripts/studio-host-lock.test.ts.

set -euo pipefail

FORGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE_PORT=4123
UI_PORT=4124
UI_DIR_NAME=forge-ui

# --- the identity decision -------------------------------------------------
#
# classify_evidence is the WHOLE safety decision, and it is pure: it takes a
# process's command line and its resolved working directory and says yes or
# no. It touches no /proc and signals nothing. Everything that can kill lives
# outside it. That split exists so the decision can be exercised against
# synthetic evidence in scripts/studio-host-lock.test.ts without a real
# process anywhere near it — this script shipped untested precisely because
# the decision was welded to /proc and to `kill`.
#
# Exposed as `classify <cmdline> <cwd>` so an operator (or a test) can ask
# "would you signal this?" and get the answer without anything dying.
#
# WHY THE cwd TEST IS SHAPED THIS WAY (forge-pxef, 2026-08-23)
#
# It used to demand that a Next server's cwd be literally
# "$FORGE_ROOT/forge-ui", and FORGE_ROOT is derived from where THIS FILE sits.
# Run the script from a lane worktree (/home/parso/forge-b4) against a Studio
# serving the primary checkout (/home/parso/forge) and the comparison fails:
# the bridge was stopped, its Next server was refused, and the lock came back
# HALF released — which then looks like a harness bug, not a lock bug.
#
# The check must therefore identify "a forge checkout's Next server", not
# "*this* checkout's Next server". It does that POSITIVELY, from files on
# disk: the cwd must resolve to a directory carrying forge's own marker files
# (orchestrator/cli.ts, the forge-ui workspace) whose package name is
# identical to ours. A sibling worktree and an independent clone both satisfy
# it; a stranger's Next server does not, whatever it is called or wherever it
# lives. Nothing here is a name match — the refusal that makes this script
# worth having is intact.
#
# Considered and rejected: relating the cwd to us with `git rev-parse
# --git-common-dir` (the bead's first suggestion). It is wrong in both
# directions — too wide, since every directory in the repo shares one common
# dir, so a Next server in projects/<x> would qualify; and too narrow, since a
# second clone of forge is genuinely forge and would not. The marker files
# answer the question actually being asked. That worktrees pass is a
# consequence of them being forge checkouts, not a rule about git.
#
# Also rejected: probing :4124 for the UI's identity. The port is exactly what
# is in dispute; evidence must come from somewhere the suspect does not serve.
classify_evidence() {
  local cmdline="$1" cwd="$2"
  [ -n "$cmdline" ] || return 1
  case "$cmdline" in
    # forge's bridge: our CLI (or its `forge` launcher) running the `studio`
    # subcommand. Anchored on the space so `studio.md` in some editor's
    # argument list is not mistaken for the subcommand.
    *"orchestrator/cli.ts studio "*|*"orchestrator/cli.ts studio") return 0 ;;
    *"bin/forge.mjs studio "*|*"bin/forge.mjs studio")             return 0 ;;
    # forge's UI: a Next server whose cwd is a forge checkout's root or its
    # forge-ui workspace. No other directory counts, not even a sibling of
    # forge-ui inside a real checkout.
    *next-server*|*next*start*) is_forge_ui_cwd "$cwd" ;;
    *) return 1 ;;
  esac
}

# The two directories `next` is ever started from for forge's UI.
is_forge_ui_cwd() {
  local cwd="$1" root
  [ -n "$cwd" ] || return 1
  root="$(readlink -f "$cwd" 2>/dev/null || true)"
  [ -n "$root" ] && [ -d "$root" ] || return 1
  [ "$(basename "$root")" = "$UI_DIR_NAME" ] && root="$(dirname "$root")"
  is_forge_checkout "$root"
}

# Positive identification of a forge checkout: forge's own files, and forge's
# own package name — read from OUR package.json, so there is no literal to
# drift. Any missing piece is a refusal.
is_forge_checkout() {
  local dir="$1" name ours
  [ -n "$dir" ] && [ -d "$dir" ] || return 1
  [ -f "$dir/orchestrator/cli.ts" ] || return 1
  [ -f "$dir/$UI_DIR_NAME/package.json" ] || return 1
  ours="$(package_name "$FORGE_ROOT")" || return 1
  name="$(package_name "$dir")" || return 1
  [ -n "$ours" ] && [ "$name" = "$ours" ]
}

# `name` from a package.json, parsed as JSON rather than grepped. If node is
# missing or the file is malformed this yields nothing, and every caller then
# refuses — the failure mode is "report, do not kill".
package_name() {
  local file="$1/package.json"
  [ -f "$file" ] || return 1
  node -e 'try{const n=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).name;if(typeof n==="string")process.stdout.write(n)}catch{}' \
    "$file" 2>/dev/null
}

# A PID may only be signalled if its evidence on disk classifies as forge's.
is_forge_process() {
  local pid="$1" cmdline cwd
  cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  classify_evidence "$cmdline" "$cwd"
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

  # Verify EVERY holder before signalling ANY of them. Refusing part-way
  # through the kill loop leaves the lock half released — one port free, one
  # held — which is how forge-pxef presented and is strictly worse than a
  # clean refusal: the next harness run fails on the surviving port and looks
  # like a harness fault. Either all of them are forge's, or nothing is
  # signalled.
  # One snapshot, verified then signalled: re-enumerating between the two
  # loops would let an unverified PID into the kill list.
  local pid killed=0 holders
  holders="$(port_holders)"

  for pid in $holders; do
    is_forge_process "$pid" && continue
    echo "REFUSING to signal $pid — not a forge process:" >&2
    tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-160 >&2 || true
    echo "nothing was signalled; the ports are untouched" >&2
    exit 3
  done

  for pid in $holders; do
    echo "stopping forge process $pid"
    kill "$pid" 2>/dev/null || true
    killed=$((killed + 1))
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

cmd_classify() {
  if [ "$#" -ne 2 ]; then
    echo "usage: $0 classify <cmdline> <cwd>" >&2
    exit 64
  fi
  if classify_evidence "$1" "$2"; then echo forge; else echo FOREIGN; exit 1; fi
}

case "${1:-status}" in
  status)   cmd_status ;;
  stop)     cmd_stop ;;
  start)    cmd_start ;;
  classify) shift; cmd_classify "$@" ;;
  *) echo "usage: $0 {status|stop|start|classify <cmdline> <cwd>}" >&2; exit 64 ;;
esac
