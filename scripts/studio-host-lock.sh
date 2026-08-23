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
#   ./scripts/studio-host-lock.sh status   # who holds the ports, and whose
#   ./scripts/studio-host-lock.sh stop     # release (verifies before killing)
#   ./scripts/studio-host-lock.sh start    # bring back the Studio `stop` took
#   ./scripts/studio-host-lock.sh classify <cwd> [argv...]
#                                          # dry-run the identity decision on
#                                          # one process's evidence; finds
#                                          # nothing, signals nothing
#
# Safety properties, deliberately:
#   - kills by PID only, never by pattern (`pkill -f` matches the caller's own
#     command line — a documented footgun in this repo's orchestration notes);
#   - identifies a process from evidence on disk — the checkout its real argv
#     and its cwd point into — never from a name alone;
#   - all-or-nothing: every holder is verified before any is signalled, so a
#     refusal never leaves the lock half released;
#   - refuses to run `stop` while a cycle is in flight — in OUR checkout or in
#     any checkout we are about to stop;
#   - restores the checkout it stopped, not the one it was invoked from.
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
# `next` overwrites its own argv with this title in startServer(), for
# `next start` and `next dev` alike, so it is the UI's own claim about itself
# rather than something an argument can imitate.
UI_TITLE_PREFIX='next-server'
# Where `stop` records what it took down, so `start` can put back THAT
# checkout's Studio rather than the caller's.
STOPPED_RECORD="$FORGE_ROOT/_logs/studio-host-lock.stopped-roots"

# --- the identity decision -------------------------------------------------
#
# classify_evidence is the WHOLE safety decision, and it is process-free: it
# takes a process's working directory and its REAL argv, reads files on disk,
# and prints the forge checkout that process belongs to (or fails). It touches
# no /proc, enumerates nothing, and signals nothing. Everything that can kill
# lives outside it. That split exists so the decision can be exercised against
# synthetic evidence in scripts/studio-host-lock.test.ts without a real
# process anywhere near it — this script shipped untested precisely because
# the decision was welded to /proc and to `kill`.
#
# Exposed as `classify <cwd> [argv...]` so an operator (or a test) can ask
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
# not, whatever it is called or wherever it lives.
#
# ARGV IS READ WITH ITS REAL BOUNDARIES, never as a joined string. A review of
# the first cut of this fix showed why: with `tr '\0' ' '` and re-splitting on
# whitespace, `my-supervisor --restart-command "<checkout>/bin/forge.mjs
# studio"` — one single argument — classified as forge's bridge from any cwd
# on the machine. Whole-command-line `case` patterns cannot tell a program
# from one of its arguments, so this file does not use them for identity.
#
# Considered and rejected: relating the evidence to us with `git rev-parse
# --git-common-dir`. It is wrong in both directions — too wide, since every
# directory in the repo shares one common dir, so a Next server in
# projects/<x> would qualify; and too narrow, since a second clone of forge is
# genuinely forge and would not.
#
# Also rejected: probing :4124 for the UI's identity. The port is exactly what
# is in dispute; evidence must come from somewhere the suspect does not serve.
#
# Known and accepted: the four markers are files, and files can be forged by
# anyone who can write four of them. Identity by content is forgeable by
# content — that is what "a forge checkout" means. A sweep of this host found
# 70 directories satisfying the fingerprint, every one a real forge worktree.
classify_evidence() {
  local cwd="$1" root
  shift
  [ "$#" -gt 0 ] || return 1
  if root="$(bridge_checkout "$cwd" "$@")"; then printf '%s' "$root"; return 0; fi
  case "$1" in
    "$UI_TITLE_PREFIX"*)
      if root="$(ui_checkout "$cwd")"; then printf '%s' "$root"; return 0; fi ;;
  esac
  return 1
}

# forge's bridge: some argv WORD resolves to a forge checkout's own entrypoint
# and the word straight after it is the `studio` subcommand. Prints that
# checkout.
#
# Anchoring on the RESOLVED FILE rather than on a literal argv shape is what
# makes this work in the field: the bridge is launched through `bin/forge.mjs`
# directly, through `orchestrator/cli.ts`, or through an `npm link` / `npx`
# shim whose argv reads .../node_modules/.bin/forge — a symlink into a
# checkout's bin/forge.mjs. All three are the same program and resolve to the
# same file; only the string differs. The cmdline-substring test this replaces
# recognised the first two and called the live, npx-launched bridge FOREIGN.
bridge_checkout() {
  local cwd="$1" resolved root i j ok
  shift
  local -a argv=("$@")
  for ((i = 0; i + 1 < ${#argv[@]}; i++)); do
    [ "${argv[$((i + 1))]}" = "$STUDIO_SUBCOMMAND" ] || continue
    # The word has to be the PROGRAM being run, not an argument that happens
    # to name one: either argv[0] itself (a shebang exec), or the script a
    # node interpreter was handed, with nothing but flags in between. Without
    # this, `some-supervisor --restart-command <entry> studio` is a bridge.
    if [ "$i" -gt 0 ]; then
      case "$(basename "${argv[0]}")" in
        node|nodejs) ;;
        *) continue ;;
      esac
      ok=1
      for ((j = 1; j < i; j++)); do
        case "${argv[$j]}" in -*) ;; *) ok=0; break ;; esac
      done
      [ "$ok" = 1 ] || continue
    fi
    resolved="$(resolve_against "$cwd" "${argv[$i]}")" || continue
    case "$resolved" in
      */"$CLI_ENTRY") root="${resolved%"/$CLI_ENTRY"}" ;;
      */"$BIN_ENTRY") root="${resolved%"/$BIN_ENTRY"}" ;;
      *) continue ;;
    esac
    if is_forge_checkout "$root"; then printf '%s' "$root"; return 0; fi
  done
  return 1
}

# forge's UI: a Next server whose cwd is a forge checkout's root or its
# forge-ui workspace. Prints that checkout. No other directory counts, not
# even a sibling of forge-ui inside a real checkout.
ui_checkout() {
  local cwd="$1" dir
  [ -n "$cwd" ] || return 1
  dir="$(readlink -f "$cwd" 2>/dev/null || true)"
  [ -n "$dir" ] && [ -d "$dir" ] || return 1
  # The cwd itself first: a checkout may itself be named forge-ui, and
  # stripping the basename before trying it walks one level too far.
  if is_forge_checkout "$dir"; then printf '%s' "$dir"; return 0; fi
  [ "$(basename "$dir")" = "$UI_DIR_NAME" ] || return 1
  dir="$(dirname "$dir")"
  if is_forge_checkout "$dir"; then printf '%s' "$dir"; return 0; fi
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

# The forge checkout a live PID belongs to, or failure. This is the only place
# /proc is read, and it reads argv with its real NUL boundaries.
holder_checkout() {
  local pid="$1" cwd
  local -a argv=()
  mapfile -d '' -t argv < "/proc/$pid/cmdline" 2>/dev/null || true
  [ "${#argv[@]}" -gt 0 ] || return 1
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  classify_evidence "$cwd" "${argv[@]}"
}

# A PID may only be signalled if its evidence on disk classifies as forge's.
is_forge_process() {
  holder_checkout "$1" >/dev/null
}

port_holders() {
  ss -lptn "sport = :$BRIDGE_PORT or sport = :$UI_PORT" 2>/dev/null \
    | grep -oP 'pid=\K[0-9]+' | sort -u
}

# Cycles in flight in `dir`, 0 for a directory that has no queue at all.
in_flight_count() {
  ls "$1/_queue/in-flight" 2>/dev/null | grep -c '\.md$' || true
}

# Refuse if `dir` has a cycle in flight. Called for our own checkout AND for
# every checkout `stop` is about to signal into: the kill scope reaches across
# checkouts, so the guard has to reach exactly as far. Guarding only our own
# meant a lane could stop a Studio mid-cycle that the cycle's own checkout
# would have refused to stop.
refuse_if_in_flight() {
  local dir="$1" inflight
  inflight="$(in_flight_count "$dir")"
  [ "${inflight:-0}" -gt 0 ] || return 0
  echo "refusing: ${inflight} cycle(s) in flight in $dir — a journey run would contend with them" >&2
  echo "park _queue/pending and wait for the cycle to reach a terminal state first" >&2
  exit 2
}

cmd_status() {
  local found=0 pid root
  for pid in $(port_holders || true); do
    found=1
    root="$(holder_checkout "$pid" || true)"
    printf '%-8s %-7s %-28s %s\n' "$pid" \
      "$([ -n "$root" ] && echo forge || echo FOREIGN)" \
      "${root:--}" \
      "$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-80)"
  done
  [ "$found" = 1 ] || echo "ports $BRIDGE_PORT/$UI_PORT are free"
  echo "in-flight cycles (here): $(in_flight_count "$FORGE_ROOT")"
}

cmd_stop() {
  # `|| true`: port_holders ends in a grep that exits 1 when the ports are
  # free, and under `set -e` a bare assignment adopts that status — which made
  # `stop` on an already-free pair of ports die silently with exit 1 instead
  # of reporting that there was nothing to do.
  local pid holders root killed=0
  holders="$(port_holders || true)"

  refuse_if_in_flight "$FORGE_ROOT"

  # Verify EVERY holder before signalling ANY of them, recording the checkout
  # each belongs to. Refusing part-way through the kill loop leaves the lock
  # half released — one port free, one held — which is how forge-pxef
  # presented and is strictly worse than a clean refusal: the next harness run
  # fails on the surviving port and looks like a harness fault. Either all of
  # them are forge's, or nothing is signalled.
  # One snapshot, verified then signalled: re-enumerating between the two
  # loops would let an unverified PID into the kill list.
  local -A roots=()
  for pid in $holders; do
    if root="$(holder_checkout "$pid")"; then
      roots["$root"]=1
    else
      echo "REFUSING to signal $pid — not a forge process:" >&2
      tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-160 >&2 || true
      echo "nothing was signalled; the ports are untouched" >&2
      exit 3
    fi
  done

  for root in ${roots[@]+"${!roots[@]}"}; do
    refuse_if_in_flight "$root"
  done

  for pid in $holders; do
    echo "stopping forge process $pid"
    kill "$pid" 2>/dev/null || true
    killed=$((killed + 1))
  done

  # Record what was taken down so `start` restores THAT checkout's Studio.
  mkdir -p "$(dirname "$STOPPED_RECORD")"
  : > "$STOPPED_RECORD"
  for root in ${roots[@]+"${!roots[@]}"}; do
    printf '%s\n' "$root" >> "$STOPPED_RECORD"
  done

  local waited=0
  while [ -n "$(port_holders || true)" ] && [ "$waited" -lt 20 ]; do
    sleep 0.5
    waited=$((waited + 1))
  done

  if [ -n "$(port_holders || true)" ]; then
    echo "ports still held after $((waited / 2))s — not escalating; inspect with 'status'" >&2
    exit 4
  fi
  echo "released ports $BRIDGE_PORT/$UI_PORT (stopped $killed process(es))"
}

# The checkout `start` should bring up: the one `stop` took down, falling back
# to ours when nothing has been stopped. Two different checkouts stopped in
# one run is ambiguous and refuses rather than guessing — restarting the wrong
# tree is silent and looks like nothing happened.
start_root() {
  local -a recorded=()
  if [ -f "$STOPPED_RECORD" ]; then
    mapfile -t recorded < "$STOPPED_RECORD" 2>/dev/null || true
  fi
  local -a roots=()
  local line
  for line in ${recorded[@]+"${recorded[@]}"}; do
    [ -n "$line" ] && roots+=("$line")
  done
  case "${#roots[@]}" in
    0) printf '%s' "$FORGE_ROOT" ;;
    1) printf '%s' "${roots[0]}" ;;
    *) return 1 ;;
  esac
}

cmd_start() {
  if [ -n "$(port_holders || true)" ]; then
    echo "ports already held — refusing to start a second Studio:" >&2
    cmd_status >&2
    exit 5
  fi
  local root
  if ! root="$(start_root)"; then
    echo "refusing: the last stop took down more than one checkout's Studio:" >&2
    cat "$STOPPED_RECORD" >&2
    echo "start the one you want from its own checkout" >&2
    exit 6
  fi
  if ! is_forge_checkout "$root"; then
    echo "refusing: $root is not a forge checkout — not starting anything" >&2
    exit 6
  fi
  cd "$root"
  mkdir -p "$root/_logs"
  nohup node --experimental-strip-types "$CLI_ENTRY" studio \
    > "$root/_logs/studio-host-lock.log" 2>&1 &
  rm -f "$STOPPED_RECORD"
  echo "started forge studio in $root (pid $!); log: $root/_logs/studio-host-lock.log"
}

cmd_classify() {
  if [ "$#" -lt 2 ]; then
    echo "usage: $0 classify <cwd> [argv...]" >&2
    exit 64
  fi
  local cwd="$1" root
  shift
  if root="$(classify_evidence "$cwd" "$@")"; then
    echo "forge $root"
  else
    echo FOREIGN
    exit 1
  fi
}

main() {
  case "${1:-status}" in
    status)   cmd_status ;;
    stop)     cmd_stop ;;
    start)    cmd_start ;;
    classify) shift; cmd_classify "$@" ;;
    *) echo "usage: $0 {status|stop|start|classify <cwd> [argv...]}" >&2; exit 64 ;;
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
