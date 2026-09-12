#!/usr/bin/env bash
# lock-state.sh — the shell entry point. THE READER IS `scripts/stories/lock-state.mjs`.
#
# This file was a second `/proc` walker in shell until T1 970. It is now a shim,
# and the reason is worth keeping where the next person will look: the walk is
# the cheap half, and the SUBTLE half is deciding what a pid IS. A waiter has the
# descriptor open exactly like a holder does, so no fd census separates them —
# only `/proc/locks`, and only if its blocked-waiter rows are read.
# `lock-guard.mjs` has done that with doors and a `procRoot` seam all along, and
# I wrote a second classifier in shell without looking for the first. One walker
# and two classifiers is 948's error with a second place to recur.
#
# Kept as a shell path because callers already point here and T1's manifest globs
# this directory. Every argument is forwarded verbatim.
set -u
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd -- "$HERE/../../../.." && pwd)
READER="$REPO/scripts/stories/lock-state.mjs"
[ -f "$READER" ] || { echo "lock-state.sh: no reader at $READER" >&2; exit 2; }
exec node "$READER" "$@"
