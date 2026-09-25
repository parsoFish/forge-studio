#!/usr/bin/env bash
# lane-heartbeat-daemon.sh — an out-of-process instrument for the lane's OWN quiet stretches.
#
# THE PROBLEM (campaign row 84). lane-protocol.md §2 heartbeats through heartbeat.sh at every
# STEP — but a lane waiting on a long detached job (a gate run, a merge-slot attempt, a funded
# story run) or mid a long in-process worker turn goes quiet BETWEEN steps, and
# watch-heartbeats.sh flags it as a stall though it is working. One lane hand-built a background
# loop for exactly this, untested and hardcoded to its own scratchpad. This is that loop,
# promoted into the skill with every path an argument.
#
#   lane-heartbeat-daemon.sh <campaign-dir> <lane> [--job-pattern REGEX] [--worktree-glob GLOB]
#                            [--exclude-tree DIR] [--log-glob GLOB ...] [--interval SECONDS]
#                            [--recent-min MINUTES] [--stop-file FILE] [--once]
#
# Every --interval seconds: count live processes whose argv matches --job-pattern (a detached job
# still running), and separately check whether any file under --worktree-glob changed in the last
# --recent-min minutes (an in-process worker still writing) — maxdepth 6, pruning node_modules and
# --exclude-tree (itself and everything below it). If either is true, call heartbeat.sh — the ONE
# writer of a heartbeat file (see its own header); this script never writes one itself — naming
# the job count, whether a worktree is active, and the last meaningful line of the newest matching
# --log-glob file, passing that log as the declared liveness path. If neither is true, the beat is
# silent: the lane's own real heartbeats already cover "nothing detached is running".
#
#   --job-pattern REGEX    ERE, matched against each live process's full argv (/proc/<pid>/cmdline).
#                          Default: the skill's own detached job scripts (gate.sh, merge-slot.sh,
#                          heavy-slot.sh, with-locks.sh, gh-slot.sh, ci-terminal.sh, pin-precheck.sh,
#                          pin-reconcile.sh, bead-preflight.sh, owner-census.sh) — generic to any
#                          lane, never one lane's own script name.
#   --worktree-glob GLOB   A shell glob, expanded by THIS script — may match more than one
#                          directory. Default: $HOME/forge-<lane>-* (the fix/worker worktrees a
#                          lane cuts for its own sub-work, distinct from its T1-launched worktree
#                          $HOME/forge-<lane>).
#   --exclude-tree DIR     Pruned from the worktree scan, itself and everything below it. Default:
#                          $HOME/forge-<lane>-run (the lane's own run/harness tree — its churn is
#                          not evidence of a WORKER being active, and left unpruned it would mask
#                          a real stall; it commonly also matches --worktree-glob's own pattern,
#                          which is exactly why this exists as a separate, explicit prune).
#   --log-glob GLOB        Repeatable. Every match across every occurrence is a candidate; the
#                          newest regular file wins. Default: <campaign>/reports/*.log (gate.sh's
#                          own log convention).
#   --interval SECONDS     Default 540 (comfortably inside watch-heartbeats.sh's 30 min ceiling,
#                          room for more than one missed poll).
#   --recent-min MINUTES   Default 10.
#   --stop-file FILE       Checked at the top of every iteration. Default
#                          <campaign>/heartbeat/<lane>.hb-stop; `lanes.sh kill` touches it (and
#                          this daemon's pid file) to retire it.
#   --once                 Run exactly one iteration and exit — for tests.
#
# Test seam: LANE_HB_DAEMON_HEARTBEAT_SH overrides which heartbeat.sh this script calls (default:
# its own sibling, $HERE/heartbeat.sh) — the same HERE-relative-plus-env-override shape
# merge-slot.sh already uses for MERGE_SLOT_PIN_PRECHECK/pin-precheck.sh.
#
# Writes ONLY its own pid, to <campaign>/heartbeat/<lane>.hb-daemon.pid, and refuses to start
# while that pid is alive — one daemon per lane, never stacked silently by a re-launch.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEARTBEAT_SH="${LANE_HB_DAEMON_HEARTBEAT_SH:-$HERE/heartbeat.sh}"

die() { echo "lane-heartbeat-daemon.sh: $*" >&2; exit 2; }

# The skill's own detached job scripts — never one lane's script name (nothing here is specific
# to any lane, scratchpad or user).
DEFAULT_JOB_PATTERN='(gate\.sh|merge-slot\.sh|heavy-slot\.sh|with-locks\.sh|gh-slot\.sh|ci-terminal\.sh|pin-precheck\.sh|pin-reconcile\.sh|bead-preflight\.sh|owner-census\.sh)'
# Blank lines, and pure filler/progress-bar lines — never a job's own bead of state.
NOISE_REGEX='^[[:space:]]*$|^[[:space:]]*[.#=-]{3,}[[:space:]]*$'

if [ $# -lt 2 ]; then sed -n '2,53p' "$0"; exit 1; fi
CAMP="$1"; LANE="$2"; shift 2

JOB_PATTERN="$DEFAULT_JOB_PATTERN"
WORKTREE_GLOB=""
EXCLUDE_TREE=""
LOG_GLOBS=()
INTERVAL=540
RECENT_MIN=10
STOP_FILE_ARG=""
ONCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --job-pattern)   [ $# -ge 2 ] || die "--job-pattern needs a value"; JOB_PATTERN="$2"; shift 2 ;;
    --worktree-glob) [ $# -ge 2 ] || die "--worktree-glob needs a value"; WORKTREE_GLOB="$2"; shift 2 ;;
    --exclude-tree)  [ $# -ge 2 ] || die "--exclude-tree needs a value"; EXCLUDE_TREE="$2"; shift 2 ;;
    --log-glob)      [ $# -ge 2 ] || die "--log-glob needs a value"; LOG_GLOBS+=("$2"); shift 2 ;;
    --interval)      [ $# -ge 2 ] || die "--interval needs a value"; INTERVAL="$2"; shift 2 ;;
    --recent-min)    [ $# -ge 2 ] || die "--recent-min needs a value"; RECENT_MIN="$2"; shift 2 ;;
    --stop-file)     [ $# -ge 2 ] || die "--stop-file needs a value"; STOP_FILE_ARG="$2"; shift 2 ;;
    --once)          ONCE=1; shift ;;
    *) die "unknown flag $1" ;;
  esac
done

[ -d "$CAMP" ] || die "no campaign dir: $CAMP"
HB="$CAMP/heartbeat"
mkdir -p "$HB"

WORKTREE_GLOB="${WORKTREE_GLOB:-$HOME/forge-$LANE-*}"
EXCLUDE_TREE="${EXCLUDE_TREE:-$HOME/forge-$LANE-run}"
[ ${#LOG_GLOBS[@]} -gt 0 ] || LOG_GLOBS=("$CAMP/reports/*.log")
STOP_FILE="${STOP_FILE_ARG:-$HB/$LANE.hb-stop}"

case "$INTERVAL" in ''|*[!0-9]*) die "--interval must be a whole number of seconds, got '$INTERVAL'" ;; esac
case "$RECENT_MIN" in ''|*[!0-9]*) die "--recent-min must be a whole number of minutes, got '$RECENT_MIN'" ;; esac

# One daemon per lane. A pid file naming a DEAD pid is stale, not a duplicate — that is the
# ordinary shape after a host restart or a kill -9, and it must not block a re-launch forever.
PIDFILE="$HB/$LANE.hb-daemon.pid"
if [ -f "$PIDFILE" ]; then
  existing="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "$existing" ] && [ -d "/proc/$existing" ]; then
    die "refusing to start: $PIDFILE names pid $existing, which is alive — one daemon per lane (stop it, or lanes.sh kill $CAMP $LANE, first)"
  fi
fi
printf '%s\n' "$$" > "$PIDFILE"
# Only ever remove OUR OWN entry: a fresher daemon's pid file, written after this one lost a race,
# is not this process's to delete.
cleanup() { [ "$(cat "$PIDFILE" 2>/dev/null || true)" = "$$" ] && rm -f "$PIDFILE"; }
trap cleanup EXIT

# count_jobs <ere-pattern> → how many OTHER live processes' full argv match it.
#
# TWO pids are excluded, not one, both because THIS DAEMON'S OWN invocation carries the pattern
# text — most directly its own `--job-pattern` flag value, but the same shape recurs for any
# pattern that happens to match a path already named on its command line:
#   $$        this script's own top-level process. It stays alive (and stays a plain match
#             candidate in /proc) for the daemon's whole run, and $$ is defined to report it
#             from EVERY scope, including a forked subshell — never the subshell's own pid.
#   $BASHPID  this call itself. Every call runs through a command substitution
#             (`jobs="$(count_jobs ...)"`), which bash runs in a FORKED subshell — a real, live
#             /proc entry with the SAME argv as the process it forked from (fork, no exec) —
#             and $BASHPID, unlike $$, names THAT subshell rather than the top-level script.
# Measured: with only one excluded, an "impossible" test pattern still matched — the OTHER of
# these two, whichever was left in.
count_jobs() {
  local pattern="$1" self_top="$$" self_sub="$BASHPID" n=0 p cmdline
  for p in /proc/[0-9]*; do
    p="${p#/proc/}"
    [ "$p" = "$self_top" ] && continue
    [ "$p" = "$self_sub" ] && continue
    [ -r "/proc/$p/cmdline" ] || continue
    cmdline="$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null || true)"
    [ -n "$cmdline" ] || continue
    printf '%s' "$cmdline" | grep -qE -- "$pattern" 2>/dev/null && n=$((n + 1))
  done
  printf '%s' "$n"
}

# recent_activity <glob> <exclude> <mins> → the first matching worktree with a file newer than
# <mins> minutes (maxdepth 6; node_modules and <exclude>, itself and below, are pruned), or empty.
recent_activity() {
  local pat="$1" exclude="$2" mins="$3" d
  # shellcheck disable=SC2086  # deliberate glob expansion: $pat is a pattern, not one literal path
  for d in $pat; do
    [ -d "$d" ] || continue
    if find "$d" -maxdepth 6 \( -path "$exclude" -o -path "$exclude/*" -o -name node_modules \) -prune \
         -o -type f -mmin "-$mins" -print -quit 2>/dev/null | grep -q .; then
      printf '%s' "$d"
      return 0
    fi
  done
  return 1
}

# newest_log <glob> ... → the newest regular file across every occurrence of every glob, or empty.
newest_log() {
  local newest="" newest_m=-1 pat f m
  for pat in "$@"; do
    # shellcheck disable=SC2086  # deliberate glob expansion
    for f in $pat; do
      [ -f "$f" ] || continue
      m="$(stat -c %Y "$f" 2>/dev/null || true)"
      [ -n "$m" ] || continue
      if [ "$m" -gt "$newest_m" ]; then newest_m="$m"; newest="$f"; fi
    done
  done
  printf '%s' "$newest"
}

# last_meaningful_line <file> → its last non-blank, non-noise line, ANSI stripped, <=120 chars.
last_meaningful_line() {
  local f="$1" line
  line="$(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$f" 2>/dev/null | grep -Ev "$NOISE_REGEX" | tail -1 || true)"
  printf '%s' "${line:0:120}"
}

beat() {
  local jobs worktree log state
  jobs="$(count_jobs "$JOB_PATTERN")"
  worktree="$(recent_activity "$WORKTREE_GLOB" "$EXCLUDE_TREE" "$RECENT_MIN")" || worktree=""
  { [ "$jobs" -gt 0 ] || [ -n "$worktree" ]; } || return 0

  state="auto: $jobs job proc(s)"
  [ -n "$worktree" ] && state="$state · worker active in $worktree"

  log="$(newest_log "${LOG_GLOBS[@]}")"
  if [ -n "$log" ]; then
    state="$state; $(basename "$log"): $(last_meaningful_line "$log")"
    "$HEARTBEAT_SH" "$CAMP" "$LANE" "$state" "$log"
  else
    "$HEARTBEAT_SH" "$CAMP" "$LANE" "$state"
  fi
}

while :; do
  [ -f "$STOP_FILE" ] && break
  beat
  [ "$ONCE" = 1 ] && break
  sleep "$INTERVAL"
done
