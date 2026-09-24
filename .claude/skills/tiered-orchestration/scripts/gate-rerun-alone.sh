#!/usr/bin/env bash
# gate-rerun-alone.sh — gate.sh's own ALONE-RERUN proof (forge-8vfn.7.6.89).
#
# Why: 7.6.86's waiver condition (i) requires an ALONE-RERUN <test> k/k line in
# the gate log before a single red step can be waived, but the line was
# APPENDED BY THE LANE — a claim a lane can type without doing the rerun (C,
# 908, stated as a limit rather than smoothed). Unforgeable needs the rerun to
# happen inside the gate wrapper and write its own line, so this script is
# never invoked by a lane; `gate.sh` calls it, once, right after its own step
# loop, and this script's stdout lands in the same captured gate log — the
# same relationship `prod-lines.mjs` and `boundary-share.mjs` already have to
# that log, four steps below in the same file.
#
# gate.sh passes its OWN count of FAILED (never REFUSED) steps and the one
# failing command it saw, rather than this script re-reading the step list —
# two readers of one list can drift, and this bead is about a claim that must
# not be able to.
#
#   gate-rerun-alone.sh <target-test-file> <fail-count> <failing-cmd>
#
# Run from the worktree root (gate.sh already `cd`s there before calling this).
set -u

K=3 # forge-8vfn.7.6.89: "k=3, default" — named once, here, nowhere else.

target="${1:?usage: gate-rerun-alone.sh <target-test-file> <fail-count> <failing-cmd>}"
n="${2:?}"
cmd="${3:-}"

refuse() { echo "ALONE-RERUN $target REFUSED — $*"; exit 0; }

# THE WAIVER THIS PROVES IS FOR A SINGLE RED STEP. Zero failures means nothing
# to rerun; two or more means this run's evidence cannot be pinned to the one
# step GATE_RERUN_ALONE is about.
case "$n" in
  ''|*[!0-9]*) refuse "fail-count '$n' is not a number — gate.sh always passes one, so this is a caller bug, not a result" ;;
esac
[ "$n" -eq 1 ] || refuse "$n step(s) failed, not exactly one"

# THE SAME RUNNER THE STEP USED, never a re-derived one — a second guess at
# the runner would be exactly the unforgeable-evidence problem this bead
# exists to close, one function later. `npm test` and `npm run test:ui` are
# named because they are this repo's own two wrapper steps (root `node --test`
# corpus and apps/studio's vitest, respectively; see COMMON) and each wraps
# MANY files, so rerunning the wrapper alone would not isolate the named one.
# Anything else is trusted to already name its own file(s) directly, and
# "covers" means the target is one of its own space-separated arguments.
case "$cmd" in
  'npm test')
    case "$target" in
      apps/studio/*) rerun="" ;;
      *) rerun="node --test --experimental-strip-types $target" ;;
    esac
    ;;
  'npm run test:ui')
    case "$target" in
      apps/studio/*) rerun="cd apps/studio && npx vitest run ${target#apps/studio/}" ;;
      *) rerun="" ;;
    esac
    ;;
  *)
    case " $cmd " in
      *" $target "*) rerun="$cmd" ;;
      *) rerun="" ;;
    esac
    ;;
esac
[ -n "$rerun" ] || refuse "the single failing step's command does not cover $target: '$cmd'"

ok=0
for _ in $(seq 1 "$K"); do
  ( eval "$rerun" ) > /dev/null 2>&1 && ok=$((ok + 1))
done
if [ "$ok" -eq "$K" ]; then
  echo "ALONE-RERUN $target $K/$K"
else
  echo "ALONE-RERUN $target $ok/$K FAILED"
fi
