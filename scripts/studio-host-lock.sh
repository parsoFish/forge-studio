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
# whose evidence on disk does not identify it as forge's own bridge or its
# Next server — a foreign process holding 4123/4124 is reported, never killed.
#
#   ./scripts/studio-host-lock.sh status   # who holds the ports
#   ./scripts/studio-host-lock.sh stop     # release (verifies before killing)
#   ./scripts/studio-host-lock.sh start    # bring `forge studio` back up
#   ./scripts/studio-host-lock.sh classify <cmdline> <cwd>
#                                          # dry-run the identity decision;
#                                          # finds nothing, signals nothing
#
# Safety properties, deliberately:
#   - kills by PID only, never by pattern (`pkill -f` matches the caller's own
#     command line — a documented footgun in this repo's orchestration notes);
#   - identifies a process from evidence on disk (the checkout its argv and
#     its cwd point into), never from a name alone;
#   - all-or-nothing: every holder is verified before any is signalled, so a
#     refusal never leaves the lock half released;
#   - refuses to run `stop` while a cycle is in flight, since a journey run
#     would contend with it.
#
# The identity decision itself is `classify_evidence` below, split out
# process-free and covered by scripts/studio-host-lock.test.ts.

set -euo pipefail

FORGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE_PORT=4123
UI_PORT=4124

# forge's own layout, named once. A candidate checkout must carry all of it,
# and the bridge's argv must name one of the two entrypoints.
UI_DIR_NAME=forge-ui
CLI_ENTRY=orchestrator/cli.ts
BIN_ENTRY=bin/forge.mjs
STUDIO_SUBCOMMAND=studio

# --- the identity decision -------------------------------------------------
#
# classify_evidence is the WHOLE safety decision, and it is process-free: it
# takes a process's command line and its resolved working directory, reads
# files on disk, and says yes or no. It touches no /proc, enumerates nothing,
# and signals nothing. Everything that can kill lives outside it. That split
# exists so the decision can be exercised against synthetic evidence in
# scripts/studio-host-lock.test.ts without a real process anywhere near it —
# this script shipped untested precisely because the decision was welded to
# /proc and to `kill`.
#
# Exposed as `classify <cmdline> <cwd>` so an operator (or a test) can ask
# "would you signal this?" and get the answer without anything dying.
#
# WHY THE EVIDENCE IS SHAPED THIS WAY (forge-pxef, 2026-08-24)
#
# It used to demand that a Next server's cwd be literally
# "$FORGE_ROOT/forge-ui", and FORGE_ROOT is derived from where THIS FILE sits.
# Run the script from a lane worktree (/home/parso/forge-b4) against a Studio
# serving the primary checkout (/home/parso/forge) and the comparison fails:
# the bridge was stopped, its Next server was refused, and the lock came back
# HALF released — which then looks like a harness bug, not a lock bug.
#
# The check must therefore identify "a forge checkout's Studio", not "*this*
# checkout's Studio". It does that POSITIVELY, from files on disk: the
# directory in evidence must carry forge's own entrypoints and forge's own
# package names, read from OUR tree so there is no literal to drift. A sibling
# worktree and an independent clone both satisfy it; a stranger's process does
# not, whatever it is called or wherever it lives. Nothing here is a name
# match — the refusal that makes this script worth having is intact.
#
# Considered and rejected: relating the evidence to us with `git rev-parse
# --git-common-dir`. It is wrong in both directions — too wide, since every
# directory in the repo shares one common dir, so a Next server in
# projects/<x> would qualify; and too narrow, since a second clone of forge is
# genuinely forge and would not.
#
# Also rejected: probing :4124 for the UI's identity. The port is exactly what
# is in dispute; evidence must come from somewhere the suspect does not serve.
classify_evidence() {
  local cmdline="$1" cwd="$2"
  [ -n "$cmdline" ] || return 1
  is_forge_bridge "$cmdline" "$cwd" && return 0
  case "$cmdline" in
    # forge's UI: a Next server whose cwd is a forge checkout's root or its
    # forge-ui workspace. No other directory counts, not even a sibling of
    # forge-ui inside a real checkout.
    *next-server*|*"next start"*|*"next dev"*) is_forge_ui_cwd "$cwd" ;;
    *) return 1 ;;
  esac
}

# forge's bridge: some word of the command line resolves to a forge checkout's
# own entrypoint, and the word straight after it is the `studio` subcommand.
#
# Anchoring on the RESOLVED FILE rather than on a literal argv shape is what
# makes this work in the field: the bridge is launched through `bin/forge.mjs`
# directly, through `orchestrator/cli.ts`, or through an `npm link` / `npx`
# shim whose argv reads .../node_modules/.bin/forge — a symlink into a
# checkout's bin/forge.mjs. All three are the same program and resolve to the
# same file; only the string differs. The previous cmdline-substring test
# recognised the first two and called the live, npx-launched bridge FOREIGN.
#
# This is STRONGER than the substring test it replaces, not weaker: that one
# took the bridge on a name in its command line with no corroborating evidence
# at all. Here the file has to exist, inside a directory that has to be a
# forge checkout, and `studio` has to be the subcommand — an editor with
# `orchestrator/cli.ts` and `studio.md` in its argv is refused.
is_forge_bridge() {
  local cmdline="$1" cwd="$2" word next resolved root i
  local -a words=()
  read -r -a words <<<"$cmdline" || true
  for i in "${!words[@]}"; do
    word="${words[$i]}"
    next="${words[$((i + 1))]:-}"
    [ "$next" = "$STUDIO_SUBCOMMAND" ] || continue
    resolved="$(resolve_against "$cwd" "$word")" || continue
    case "$resolved" in
      */"$CLI_ENTRY") root="${resolved%"/$CLI_ENTRY"}" ;;
      */"$BIN_ENTRY") root="${resolved%"/$BIN_ENTRY"}" ;;
      *) continue ;;
    esac
    is_forge_checkout "$root" && return 0
  done
  return 1
}

# Resolve an argv word to the absolute path of an existing FILE, following
# symlinks. A relative word is resolved against the process's OWN cwd, never
# against ours — the evidence has to be read in the frame of the process it
# describes. Anything that is not an existing file yields nothing.
resolve_against() {
  local base="$1" word="$2" path
  [ -n "$word" ] || return 1
  case "$word" in
    /*) path="$word" ;;
    *)  [ -n "$base" ] || return 1
        path="$base/$word" ;;
  esac
  path="$(readlink -f "$path" 2>/dev/null || true)"
  [ -n "$path" ] && [ -f "$path" ] || return 1
  printf '%s' "$path"
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

# Positive identification of a forge checkout: forge's own entrypoints, and
# forge's own package names — every expected value read from OUR tree, so
# there is no literal to drift. Four independent markers; any missing piece is
# a refusal.
is_forge_checkout() {
  local dir="$1"
  [ -n "$dir" ] && [ -d "$dir" ] || return 1
  [ -f "$dir/$CLI_ENTRY" ] || return 1
  [ -f "$dir/$BIN_ENTRY" ] || return 1
  names_match "$(package_name "$FORGE_ROOT")" "$(package_name "$dir")" || return 1
  names_match "$(package_name "$FORGE_ROOT/$UI_DIR_NAME")" "$(package_name "$dir/$UI_DIR_NAME")" || return 1
}

# Two package names match only if BOTH were actually read. An unreadable or
# malformed package.json — ours included — yields the empty string, and empty
# must never match empty: the failure mode of this script is "report, do not
# signal".
names_match() {
  [ -n "$1" ] && [ -n "$2" ] && [ "$1" = "$2" ]
}

# `name` from a directory's package.json, parsed as JSON rather than grepped.
# If node is missing or the file is malformed this yields nothing, and
# names_match then refuses.
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
  nohup node --experimental-strip-types "$CLI_ENTRY" studio \
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

main() {
  case "${1:-status}" in
    status)   cmd_status ;;
    stop)     cmd_stop ;;
    start)    cmd_start ;;
    classify) shift; cmd_classify "$@" ;;
    *) echo "usage: $0 {status|stop|start|classify <cmdline> <cwd>}" >&2; exit 64 ;;
  esac
}

# Executing this file dispatches a subcommand; SOURCING it defines the
# functions and runs nothing. scripts/studio-host-lock.test.ts sources it to
# drive cmd_stop over a synthetic holder list, which is the only way to prove
# from a test that a refusal signals nothing — the property this script exists
# for, and the one that had never been asserted anywhere.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
