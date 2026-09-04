#!/usr/bin/env bash
# gate.sh — the campaign exit gate for one worktree.
#
#   gate.sh <worktree> [campaign-dir]   run every gate; exit 0 only if all of them pass
#   gate.sh --list <worktree>           print the step list it would run, and what it would not
#
# §15.37: a lane's gate block is the CI job's list, not the subset it remembers — knowledge ran
# 4 of 15 steps and lost a round-trip to markdownlint; library ran only `test:ui` and lost one to
# check-file-size; projects lost one to unused imports by not re-running `build`. So this script
# carries NO list. It reads the `run:` lines out of `<worktree>/.github/workflows/ci.yml`, which
# is the tree whose verdict is being written.
#
# What it does not run, it NAMES (§15.92 — a check whose negative result is indistinguishable
# from "nothing to report" is not a check):
#   SKIP        `npm ci` (a worktree has its own install) and any multi-line `run: |` block
#   OTHER JOB   every step of every other job — the run-lock jobs (stories, ui-walkthrough,
#               deadpaths) which need a free 4123/4124 and are run by the lane under its own lock
#
# Every path is an argument: `gate-M4.sh`, which this generalises, hard-coded a repo root for its
# helper tools and one session's scratchpad for its logs, so it answered a different question in
# each checkout (§15.148).
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
die() { echo "gate.sh: $*" >&2; exit 2; }

LIST=0
if [ "${1:-}" = "--list" ]; then LIST=1; shift; fi
R="${1:?usage: gate.sh <worktree> [campaign-dir] | gate.sh --list <worktree>}"
CAMP="${2:-}"
[ -d "$R" ] || die "no such worktree: $R"
CI="$R/.github/workflows/ci.yml"
[ -f "$CI" ] || die "no .github/workflows/ci.yml under $R — nothing to derive a gate list from"

# --- read the step list out of the tree's own ci.yml ----------------------------------------
# One awk pass: track the job whose steps we are in, and the `- name:` of the current step, so a
# skipped step can be reported by the name its author gave it.
steps() {
  awk '
    /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { job = $1; sub(/:$/, "", job); next }
    /^[[:space:]]*- name:[[:space:]]*/ { name = $0; sub(/^[[:space:]]*- name:[[:space:]]*/, "", name); next }
    /^[[:space:]]*run:[[:space:]]*\|[[:space:]]*$/ { print "SKIP\t" job "\t" name "\t(multi-line run: block)"; next }
    /^[[:space:]]*run:[[:space:]]*/ {
      cmd = $0; sub(/^[[:space:]]*run:[[:space:]]*/, "", cmd)
      print "STEP\t" job "\t" name "\t" cmd
    }
  ' "$CI"
}

MAIN_JOB="${LANES_GATE_JOB:-build-and-test}"
if [ "$LIST" = 1 ]; then
  steps | while IFS=$'\t' read -r kind job name cmd; do
    if [ "$job" != "$MAIN_JOB" ]; then
      echo "OTHER JOB $job: ${cmd:-$name} — a separate CI job; run it under the campaign run-lock, not here"
    elif [ "$kind" = "SKIP" ]; then
      echo "SKIP $name $cmd — not run here"
    elif [ "$cmd" = "npm ci" ]; then
      echo "SKIP $name npm ci — a worktree already has its own install"
    else
      echo "RUN $cmd"
    fi
  done
  exit 0
fi

# --- the verdict is void unless this tree measured itself (§15.13) ---------------------------
cd "$R" || die "cannot enter $R"
link="$(readlink -f node_modules/@forge/kernel 2>/dev/null || true)"
echo "== gate on $(git rev-parse --short HEAD 2>/dev/null || echo '?') ($(date '+%FT%T%z')) in $R =="
echo "kernel link: ${link:-<none>}"
case "$link" in
  "$R"/*) ;;
  *) echo "BORROWED node_modules — this tree is running another tree's install; verdict void (§15.13)"; exit 2 ;;
esac

LOGS="${CAMP:+$CAMP/reports}"; [ -n "$LOGS" ] && mkdir -p "$LOGS" || LOGS="$(mktemp -d)"
echo "logs: $LOGS"
fail=0
while IFS= read -r cmd; do
  [ -n "$cmd" ] || continue
  name="$(printf '%s' "$cmd" | tr -cs 'A-Za-z0-9' '-' | sed 's/^-//; s/-$//' | cut -c1-60)"
  t0=$(date +%s)
  if ( eval "$cmd" ) > "$LOGS/gate-$name.log" 2>&1; then
    echo "PASS  $cmd  ($(( $(date +%s) - t0 ))s)"
  else
    echo "FAIL  $cmd  ($(( $(date +%s) - t0 ))s)  → $LOGS/gate-$name.log"
    fail=1
  fi
done < <("$0" --list "$R" | sed -n 's/^RUN //p')

echo "== steps this gate did NOT run (named, never silent) =="
"$0" --list "$R" | grep -vE '^RUN ' || true

echo "== production totals, by the repo's own productionFiles() =="
node "$HERE/prod-lines.mjs" "$R" || fail=1
echo "== boundary rows by owner =="
( cd "$R" && node "$HERE/boundary-share.mjs" ) | head -12 || fail=1

echo "== proving commands =="
echo "guards:        $(ls "$R"/scripts/check-*.mjs 2>/dev/null | wc -l)"
echo "SKILL.md:      $(git -C "$R" ls-tree -r --name-only HEAD | grep -c 'skills/[^/]*/SKILL.md')"
echo "CI run: steps: $(grep -c 'run:' "$CI")"
echo "tests/stories: $(git -C "$R" status --porcelain -- tests/stories | wc -l) uncommitted path(s)"

if [ -n "$CAMP" ] && [ -d "$CAMP/gate-manifests" ]; then
  echo "== pins =="
  for m in "$CAMP"/gate-manifests/*.sha256; do
    [ -f "$m" ] || continue
    # Count FAILED lines only: `grep -vc ': OK$'` also counts sha256sum's WARNING line (§15.105).
    echo "$(basename "$m"): $(cd "$R" && sha256sum -c "$m" 2>&1 | grep -cE ': FAILED|No such file') FAILED of $(wc -l < "$m")"
  done
fi
exit $fail
