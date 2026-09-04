#!/usr/bin/env bash
# heartbeat.sh — the ONE writer of a lane's liveness signal.
#
#   heartbeat.sh <campaign-dir> <lane> "<state>" [job-log ...|--clear]
#
# Liveness is two files (see watch-heartbeats.sh): <lane>.log carries the lane's own real state,
# <lane>.liveness DECLARES which job logs count as proof of life while the lane is parked on a
# detached run. A rule applied in two places is one keystroke from being applied in one: §15.143
# (library, 2026-09-04) — its Monitor loops stamped `library.liveness` every poll while
# `library.log` sat 40 minutes old, and the fresh file hid the stale one. So both files are
# written here, from ONE `date`, and nothing else writes either of them. §15.80's shape: a fix
# with nothing separate to forget.
#
#   state       required, and required to be REAL — fail/timeout counts, the row or PR reached.
#               An empty state is refused; an optimistic label is what lane-protocol.md §2 forbids
#               and this script cannot detect, so it insists at least that something was said.
#   job-log ... re-declares the liveness paths (one per line). Passing NONE leaves the existing
#               declaration and its mtime untouched, so a mid-run beat cannot silently undeclare
#               a job that is still running. `--clear` ends the declaration explicitly, because
#               silence must not do it.
#
# Never writes <campaign>/heartbeat/ACTIVE — T1 owns that (lanes.sh launch/kill).
set -euo pipefail

die() { echo "heartbeat.sh: $*" >&2; exit 2; }

camp="${1:-}"; lane="${2:-}"; state="${3-}"
[ -n "$camp" ] && [ -n "$lane" ] || die "usage: heartbeat.sh <campaign-dir> <lane> \"<state>\" [job-log ...|--clear]"
[ $# -ge 3 ] || die "usage: heartbeat.sh <campaign-dir> <lane> \"<state>\" [job-log ...|--clear]"
shift 3
hb="$camp/heartbeat"
[ -d "$hb" ] || die "no campaign heartbeat dir: $hb"
[ -n "${state//[[:space:]]/}" ] || die "empty state — a heartbeat carries real state (fail/timeout counts, the row or PR reached), never a label"

# ONE date. Everything below is stamped with this instant, which is what the watcher cross-checks
# the log's last stamp against.
now="$(date -u +%FT%TZ)"

printf '%s %s\n' "$now" "$state" >> "$hb/$lane.log"

if [ $# -gt 0 ]; then
  live="$hb/$lane.liveness"
  if [ "$1" = "--clear" ]; then
    : > "$live"
  else
    printf '%s\n' "$@" > "$live"
  fi
  # Same instant as the log line, so the pair can never drift apart by construction.
  touch -d "$now" "$live"
fi
