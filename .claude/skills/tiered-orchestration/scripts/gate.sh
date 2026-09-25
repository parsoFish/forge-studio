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

# T1 1352/1353, M7 findings row 80. `lock_confirmed_holders` — the fallback
# `suite_lock_state` below reaches for when `/proc/locks` names nobody, since
# that listing cannot see a lock held through an inherited fd (this file's own
# `exec 9>"$FORGE_SUITE_LOCK"; flock -n 9`, heavy-slot.sh's identical idiom on
# its own fd). See that file's header for the measured reason.
. "$(dirname "${BASH_SOURCE[0]}")/lock-holders.sh"

# forge-8vfn.7.6.79 — whether THIS gate is the one holding the suite-lock right
# now, so the trap below removes only a sidecar it wrote itself and never a
# sibling's (an ANCESTOR that declines to re-take the lock must not clean up
# the outer holder's sidecar out from under it).
SUITE_LOCK_HELD=0

# T1 ruling 1104 (D's finding). `merge-slot.sh` reads `GATE_SH_EXIT=<rc>` out of
# the handed gate log to tell a REFUSAL (exit 3 with zero FAIL rows — a step
# never ran, §15.92, unwaivable) from a green gate. Nothing here wrote that
# line; one lane's private wrapper did, so for every other lane the check
# could not fire. The verdict is written by the thing that reached it, on EVERY
# exit path, as the LAST stdout line — never appended by a wrapper afterwards.
trap 'ec=$?; [ "$SUITE_LOCK_HELD" = 1 ] && rm -f "${FORGE_SUITE_LOCK:-}.holder" 2>/dev/null; echo "GATE_SH_EXIT=$ec"' EXIT

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
die() { echo "gate.sh: $*" >&2; exit 2; }

LIST=0
if [ "${1:-}" = "--list" ]; then LIST=1; shift; fi

# `--lock-state <lockfile>` — classify one lock and exit, running no step.
# It exists so `suite_lock_state`'s three-way verdict is REACHABLE from a door:
# the bug this answers (`forge-s9g1`) lives in the two-row case, and a door
# cannot put a chosen holder and a chosen waiter into the real `/proc/locks`.
# Paired with `FORGE_PROC_LOCKS` it makes the classifier testable without
# running a suite.
#
# ONLY THE FLAG IS READ HERE. My first draft inlined copies of
# `lock_holder_pids` and `is_ancestor` so the verb could exit before they are
# defined — a SECOND implementation of the classification this whole bead is
# about, which would have drifted from the real one the first time either
# changed. The verb is answered after the one definition instead, a hundred and
# fifty lines below. Read only as `$1`, exactly as `--list` is, so
# `forge-8vfn.6.9`'s refusal still covers it.
LOCK_STATE_F=""
if [ "${1:-}" = "--lock-state" ]; then
  shift
  LOCK_STATE_F="${1:?usage: gate.sh --lock-state <lockfile>}"
  shift
  set -- "${PWD}" "" "$@"          # keep the positional contract below intact
fi

# ---- THE SUITE LOCK IS THIS TOOL'S TO HOLD (bead forge-8vfn.7.6.48, T1 841) ----
#
# Until now this script only EXPORTED the lock's name, twenty lines above, so
# the repo's `npm test` guard could read it — and every caller was trusted to
# TAKE it. Twenty campaign wrappers did. One lane had no wrapper at all and
# invoked this script directly, so its gates ran every heavy step
# unserialised; ruling 778 measured the result at 3.2x with nine timeouts,
# with BOTH runs believing they held the lock. A guarantee that depends on
# each caller remembering is not a guarantee, and this tool is the one place
# that knows a gate is about to run.
#
# THREE STATES, because "just take it" would deadlock the twenty wrappers that
# already hold it: `flock` in a child opens its OWN fd, so an inner acquire
# under an outer holder blocks until its `-w` expires. A tool that hung every
# correct caller in order to fix the incorrect ones would be a worse bug than
# the one it fixes.
# HOLDERS ONLY, AND NEVER BY POSITION (`forge-s9g1`). Shipped in 7.6.48 as
#
#     awk -v ino=":$ino " '$0 ~ ino {print $5}' /proc/locks
#
# and it printed garbage in production twice:
#
#     suite-lock: WAITING on stranger pid(s) 3048432 WRITE — another lane's suite holds it
#
# A HOLDER row is `6: FLOCK ADVISORY WRITE 784079 08:30:2025251 0 EOF`, where $5
# IS the pid. A BLOCKED WAITER is a CONTINUATION row — `2: -> FLOCK ADVISORY
# WRITE 1677053 …` — and the `->` shifts every field by one, so $5 there is the
# literal string `WRITE` and the pid sits at $6. Cosmetic while `is_ancestor`
# compares `WRITE` against numeric pids and never matches; NOT cosmetic the
# moment anything downstream reads the list as pids, and not cosmetic even now
# once the pids are right — a blocked WAITER that happens to be this gate's own
# ancestor would classify as ANCESTOR for a lock nobody holds.
#
# So: skip continuation rows, because a waiter is not a holder and this function
# is named for what it returns; and find the pid as the field BEFORE the
# MAJ:MIN:INODE token rather than counting from the left, so no future field can
# shift it again. POSITION WAS NEVER THE PROPERTY — the same lesson this file
# already states 120 lines above, about reading the guard's refusal line BY NAME
# and never by position.
#
# `FORGE_PROC_LOCKS` is a TEST SEAM and says so: `/proc/locks` cannot be made to
# hold a chosen row, so the two-row case this bug lives in is unreachable without
# one. It defaults to the real file and no caller in the campaign sets it —
# `lock-guard.mjs` earned its twelve doors the same way, with `procRoot`.
lock_holder_pids() {
  local f="$1" ino
  ino="$(stat -c '%i' "$f" 2>/dev/null)" || return 0
  awk -v ino="$ino" '
    $2 == "->" { next }                 # a blocked waiter is not a holder
    {
      for (i = 2; i <= NF; i++) {
        n = split($i, a, ":")
        if (n == 3 && a[3] == ino) { print $(i - 1); next }
      }
    }' "${FORGE_PROC_LOCKS:-/proc/locks}"
}
# PPid FROM `status`, NOT FIELD 4 OF `stat` (§15.480). `/proc/<pid>/stat` is
# `pid (comm) state ppid …` and `comm` may contain SPACES and PARENS, so field
# 4 is the ppid only when it does not. Measured while writing this: the walk
# returned the literal `S` — the state field — and the comparison died with
# "integer expression expected". A misread ppid reclassifies an ANCESTOR as a
# STRANGER, which is this gate waiting out its full bound on a lock its own
# caller holds: exactly the deadlock the three states exist to avoid.
is_ancestor() {
  local want="$1" p=$$ guard=0
  while [ "$p" -gt 1 ] && [ "$guard" -lt 64 ]; do
    [ "$p" = "$want" ] && return 0
    p="$(awk '/^PPid:/{print $2}' /proc/$p/status 2>/dev/null)"
    [ -n "$p" ] || return 1
    guard=$((guard+1))
  done
  return 1
}
suite_lock_state() {
  local f="$1" pids pid live=""
  pids="$(lock_holder_pids "$f")"
  # T1 1361 (D's CI measurement, #911): a listed pid that has since EXITED is
  # not a holder — a standard kernel (unlike WSL2) keeps the /proc/locks row
  # under the now-dead pid that originally called flock() and exited, so
  # "the listing named someone" is not "a live process holds it". Filtered
  # the same way D's `suiteLockVerdict` fix filters `holders` for lock-guard.mjs.
  for pid in $pids; do
    lock_pid_alive "$pid" && live="$live $pid"
  done
  pids="${live# }"
  if [ -z "$pids" ]; then
    # `/proc/locks` names nobody LIVE — either genuinely FREE, or the
    # invisible inherited-fd shape (row 80): the lock IS held, but the pid
    # the listing would have attributed it to exited the instant it acquired
    # (WSL2: no row at all; a standard kernel: a row naming that dead pid,
    # just filtered above). Confirm via the fd-scan + fresh-probe rule
    # (`lock-holders.sh`) before believing FREE — this is the SAME real
    # file, so a probe that fails now means something holds it even though
    # the listing cannot see (or cannot usefully name) it. Kept as a
    # FALLBACK rather than a replacement: `lock_holder_pids` carries its own
    # doors for a real, separate bug (forge-s9g1's blocked-waiter-vs-holder
    # row parsing) and stays authoritative whenever it names a LIVE holder.
    pids="$(lock_confirmed_holders "$f")"
    [ -z "$pids" ] && { echo FREE; return; }
  fi
  for pid in $pids; do
    is_ancestor "$pid" && { echo "ANCESTOR:$pid"; return; }
  done
  echo "STRANGER:$(echo $pids | tr '\n' ' ' | sed 's/ $//')"
}

# `--lock-state`, answered by the ONE classifier above rather than a copy of it.
if [ -n "$LOCK_STATE_F" ]; then
  # A query verb answers a question on stdout that callers PARSE; it reaches no
  # verdict, so it carries no verdict marker (1104: the marker is for gate runs).
  trap - EXIT
  suite_lock_state "$LOCK_STATE_F"
  exit 0
fi
R="${1:?usage: gate.sh <worktree> [campaign-dir] | gate.sh --list <worktree>}"
CAMP="${2:-}"
# REFUSE what it does not understand (bead `forge-8vfn.6.9`). `--list` is read
# only as `$1`, so `gate.sh <worktree> <camp> --list` put the flag in `$3`,
# where it was ignored IN SILENCE and the full gate ran instead — a build,
# `npm test` and `test:ui`. That is indistinguishable from a hang, and it is
# exactly how it was reported: lane M6-C opened by filing "`--list` HANGS,
# killed at 20 s and at 120 s", and built a parallel gate on the strength of it.
# T1 reproduced the same shape from the main checkout. Nothing was broken; a
# tool that answers an unrecognised argument with a ten-minute suite cannot be
# told apart from one that is, and the operator's next move is to work around a
# fault that was never there.
# T1 693(ii) — a lane that KNOWS a pin will fail (its own amendment, or a sibling
# re-pin it will reconcile) declares it; anything else fails the gate. Same shape
# as the campaign's `pin-precheck.sh`, so one declaration serves both.
EXPECTED_PIN_FAILS=""
shift 2 2>/dev/null || shift $# 
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-pin-fail)
      [ $# -ge 2 ] || die "--expect-pin-fail needs <manifest>[:<path>]"
      EXPECTED_PIN_FAILS="$EXPECTED_PIN_FAILS $2"; shift 2 ;;
    # A TYPO IN A FLAG THAT GATES A MERGE MUST NOT READ AS "no expectations
    # declared" — that is bead 8vfn.6.9's shape with a merge riding on it.
    *) die "unexpected argument: '$1'. Usage: gate.sh <worktree> [campaign-dir] [--expect-pin-fail <manifest>[:<path>]]... | gate.sh --list <worktree> (the flag comes FIRST)" ;;
  esac
done
[ -d "$R" ] || die "no such worktree: $R"
# RESOLVE, or REFUSE — never degrade in silence (bead `forge-e8dn`). A RELATIVE
# campaign dir used to be accepted and then quietly mean three different wrong
# things: `$CAMP/gate-manifests` did not exist, so the pins section was skipped
# with NO output; `FORGE_SUITE_LOCK`/`FORGE_RUN_LOCK` pointed inside the
# WORKTREE at paths nothing creates, and `lock-guard.mjs` reads a missing lock
# as "nobody is running", so the whole suite ran outside both campaign locks
# believing it held them; and `mkdir -p "$LOGS"` MINTED `<worktree>/_1.0/`,
# which being gitignored kept out of `git status` entirely (§15.374). Measured
# on M6-A's own gates, twice, before anyone noticed.
#
# §15.375: `lanes.sh`, ten lines away in this directory, already resolves
# `camp`, `prompt` and `cwd` before using any of them and says why — "a relative
# path passed both and launched a promptless session — $0.00, 0 context, an
# empty box, twice" (bead `forge-uowf`, §15.60). This is that lesson, not a new
# one; it simply had not travelled between two files in the same folder.
R="$(cd "$R" && pwd)"
if [ -n "$CAMP" ]; then
  [ -d "$CAMP" ] || die "no such campaign dir: '$CAMP'. It names the pin manifests, the step logs and BOTH campaign locks, so a path that does not resolve is refused rather than silently half-applied."
  CAMP="$(cd "$CAMP" && pwd)"
fi
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
  trap - EXIT # --list is a query verb too: the step list is the whole answer
  exit 0
fi

# --- the verdict is void unless this tree measured itself (§15.13) ---------------------------
cd "$R" || die "cannot enter $R"
link="$(readlink -f node_modules/@forge/kernel 2>/dev/null || true)"
echo "== gate on $(git rev-parse --short HEAD 2>/dev/null || echo '?') ($(date '+%FT%T%z')) in $R =="
echo "kernel link: ${link:-<none>}"
# WHICH CHECKOUT IS THIS? (`forge-8vfn.7.6.36`, T1 757, §15.433.)
#
# `#670` merged `PIN_MANIFESTS=` into this file and `main` carried it — the blob
# grepped 1. But every lane's gate invokes
# `/home/parso/forge/.claude/…/gate.sh` BY ABSOLUTE PATH, and that shared
# checkout was a merge behind with the OLD copy, grep 0. A `pin-precheck.sh`
# restore on "main has it" would have refused every gate log on the box, with no
# re-gate able to fix it, because the tool that emits the line was not on disk.
# M6-C found it by paying: rebased so their gate would emit it, verified their
# own worktree greps 1, launched, and watched it invoke the shared copy anyway.
#
# It is run 12's shape at a different scale — an INTENT said "#667 is on main"
# and #667 WAS on main; the run executed a worktree forked before it. A
# dependency satisfied on `main` is not a dependency satisfied in the tree that
# RUNS. So the tree that runs names itself, in the header, before any step.
GATE_CHECKOUT_SHA="$(git -C "$R" rev-parse --short=8 HEAD 2>/dev/null || echo '?')"
echo "GATE_CHECKOUT=$GATE_CHECKOUT_SHA"

# THE TREE IS PINNED HERE AND RE-READ BEFORE THE VERDICT (forge-8vfn.7.6.129,
# T1 1118; D's `tree-pin.sh` is the reference). Two lanes voided their own gates
# in one day by editing a file while the suite ran: the suite spanned the edit
# and reported green about a tree that exists in no commit, and only a wrapper's
# porcelain-0 guard on PR creation stopped it becoming a merge. §15.540 was a
# rule; this is the assertion. HEAD plus a HASH of the porcelain — hashed, never
# counted, because an edit that swaps one dirty file for another keeps the count.
# `git status` runs IN the tree so the porcelain is about that tree's index.
tree_pin() {
  local h p
  h=$(git -C "$R" rev-parse HEAD 2>/dev/null) || return 1
  p=$( (cd "$R" && git status --porcelain 2>/dev/null) | sha256sum | cut -c1-16) || return 1
  printf '%s %s' "$h" "$p"
}
# A FAILED OR ABSENT READ IS NAMED, NOT SILENTLY SKIPPED (§15.92, line 13): a
# tree that is not a git work tree cannot be pinned, and the log SAYS so; a git
# work tree whose HEAD or porcelain cannot be read is UNKNOWN and refuses.
if git -C "$R" rev-parse --git-dir >/dev/null 2>&1; then
  PIN0=$(tree_pin) || { echo "GATE_TREE_UNREADABLE: cannot read $R's HEAD or porcelain — an unreadable tree is not an unchanged one (§15.504)"; exit 3; }
  echo "GATE_TREE_PINNED head=${PIN0%% *} porcelain=${PIN0##* }"
else
  PIN0=""
  echo "GATE_TREE_UNPINNED: $R is not a git work tree — movement under this gate is not checked, so this log does not say whether its tree held still"
fi
case "$link" in
  "$R"/*) ;;
  *) echo "BORROWED node_modules — this tree is running another tree's install; verdict void (§15.13)"; exit 2 ;;
esac

# ---- WORKSPACE LINK PREFLIGHT (M7 findings row 79) -------------------------
# The kernel-only check above voids a verdict when node_modules/@forge/kernel
# is BORROWED, but a worktree whose install merely PREDATES a package added
# on main has no borrowed link at all — it has NO link, for a package
# `require()` has never heard of. `[ ! -e … ]` never reaches that check's
# `readlink -f` comparison, so nothing above this caught it: the gate ran the
# full suite against a stale install and the result was VOID, indistinguishable
# in the log from a green one.
#
# Generalised here to every workspace package, not one hard-coded name: for
# each `packages/*/package.json` in THIS tree, `node_modules/<its own "name"
# field>` — e.g. `@forge/stations` — must EXIST and REALPATH to that
# package's own `packages/<dir>`, never a missing link and never a link into
# another checkout. Any miss REFUSES before a single step runs, naming every
# missing/mis-pointed package and the fix. Same refusal CLASS as the kernel
# check three lines up — "this install cannot be trusted, void before it
# runs" — so it shares that check's exit code (2) rather than minting a new
# one: this file's codes are not one-per-refusal (GATE_TREE_UNREADABLE,
# GATE_CHECKOUT_STALE and GATE_TREE_MOVED all already share exit 3), and the
# message text is what a reader greps, not the number.
WORKSPACE_LINK_ISSUES=""
for pkg_json in "$R"/packages/*/package.json; do
  [ -f "$pkg_json" ] || continue
  pkg_dir="$(dirname "$pkg_json")"
  # BY NAME, NEVER BY POSITION (this file's own recurring lesson): the
  # package's declared "name" field, not the directory it happens to live in
  # — `packages/foo` need not produce `@forge/foo`.
  pkg_name="$(sed -n 's/^[[:space:]]*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$pkg_json" | head -1)"
  [ -n "$pkg_name" ] || continue
  want="$(cd "$pkg_dir" && pwd)"
  pkg_link="$R/node_modules/$pkg_name"
  if [ ! -e "$pkg_link" ]; then
    WORKSPACE_LINK_ISSUES="$WORKSPACE_LINK_ISSUES
  missing: node_modules/$pkg_name — wants $pkg_dir. Fix: npm ci (or npm install) in $R"
  else
    got="$(readlink -f "$pkg_link" 2>/dev/null || true)"
    if [ "$got" != "$want" ]; then
      WORKSPACE_LINK_ISSUES="$WORKSPACE_LINK_ISSUES
  mis-pointed: node_modules/$pkg_name -> ${got:-<unresolvable>} — wants $pkg_dir. Fix: npm ci (or npm install) in $R"
    fi
  fi
done
if [ -n "$WORKSPACE_LINK_ISSUES" ]; then
  echo "GATE_WORKSPACE_LINKS_STALE: this tree's node_modules does not match its own packages/* — a gate run here would measure a stale or borrowed install and the result would be void (§15.13, M7 findings row 79).$WORKSPACE_LINK_ISSUES"
  exit 2
fi

# IS IT BEHIND? A gate from a checkout that does not contain `parsoFish/main` is
# a verdict produced by a tool nobody merged, and the reader cannot tell from the
# log. Named `GATE_CHECKOUT_STALE`, rc 3, and it prints the sha to advance TO so
# the remedy is in the refusal rather than in someone's head.
#
# A FAILED OR ABSENT READ DOES NOT REFUSE — it is NAMED (§15.92, line 13 of this
# file). A network blip must not turn every gate on the box into an outage: that
# is the "a precondition introduced as an outage is one that gets removed" trap.
# An unanswerable question and a clean answer must look different, and they do —
# one prints `GATE_CHECKOUT_UNKNOWN`. A statement is not an absence; only the
# absence is forbidden.
if git -C "$R" rev-parse --verify --quiet parsoFish/main >/dev/null 2>&1; then
  git -C "$R" fetch parsoFish --quiet >/dev/null 2>&1 \
    || echo "GATE_CHECKOUT_UNKNOWN: \`git fetch parsoFish\` failed — comparing against the ref as it stands, which may itself be stale (§15.296)"
  gate_main="$(git -C "$R" rev-parse --short=8 parsoFish/main 2>/dev/null || echo '')"
  if [ -n "$gate_main" ] && ! git -C "$R" merge-base --is-ancestor parsoFish/main HEAD >/dev/null 2>&1; then
    echo "GATE_CHECKOUT_STALE: this checkout does not contain parsoFish/main ($gate_main) — every verdict below would come from a tool that is behind what merged, and a lane reading this log cannot tell. Advance $R to $gate_main and re-run."
    exit 3
  fi
else
  echo "GATE_CHECKOUT_UNKNOWN: no parsoFish/main ref in $R — staleness not checked, so this log does not say whether its tooling is current"
fi
# A wall-clock delta is a proxy, and `date +%s` is not a safe one on this host:
# `_1.0/reports/m7-c-clockprobe-1.log` measured CLOCK_REALTIME stepping
# BACKWARDS ~2.85s every ~29.6s regardless of load (WSL2's clocksource). A step
# landing between a step's `t0=$(date +%s)` and this function's own `date +%s`
# read a negative delta and printed `?s (clock stepped)` — the mechanism behind
# the flake register's `gate-refusal.test.ts:132` (699's REFUSED-line door
# expects `\(\d+s\)` and intermittently got `?s`; reproduced on demand in
# `gate-elapsed-clock.test.ts`). `build-guard.mjs` hit the SAME clock on the
# SAME host and fixed it by reading `performance.now()` instead of
# `Date.now()` (forge-8vfn.7.6.50); the bash equivalent of a monotonic clock
# is `/proc/uptime`'s FIRST field — seconds since boot, kernel jiffies, never
# adjusted by NTP or a manual step — never `$EPOCHREALTIME`, which is still
# wall-clock and would carry the exact same bug forward.
#
# `FORGE_UPTIME_FILE` is the test seam, same idiom as `FORGE_PROC_LOCKS` above:
# `/proc/uptime` cannot be made to hold a chosen value, so a door proving the
# step no longer reaches `secs()` points at the wall clock (`date +%s` on
# PATH) instead, in `gate-elapsed-clock.test.ts`.
#
# A monotonic source cannot go backward by construction, so the
# `?s (clock stepped)` fallback is dropped rather than kept as dark code — a
# check that can no longer fire is the "state that looks like nothing to
# report" trap this file already names at §15.92.
now_ticks() { awk '{print $1}' "${FORGE_UPTIME_FILE:-/proc/uptime}" 2>/dev/null; }
secs() {
  local now d
  now="$(now_ticks)"
  [ -n "$now" ] || { echo "?s (uptime unreadable)"; return; }
  d="$(awk -v a="$1" -v b="$now" 'BEGIN{printf "%d", b - a}')"
  echo "${d}s"
}

# T1 ruling 639 / bead `forge-8vfn.7.6.13`. `npm test` refuses while a story run
# holds the run-lock, and it learns WHICH lock from the environment — the guard
# lives in the repo and a permanent artifact never cites a path inside the
# campaign directory, so the caller that KNOWS the campaign names it. This is
# that caller: `$CAMP` is already an argument, and both names are derived from
# it, never written literally.
#
# Exported even when `$CAMP` is empty is NOT the same as unset: the guard treats
# an unnamed lock as "not configured" and says so out loud, which is the honest
# reading for a gate run outside a campaign. So the export happens only when
# there IS a campaign to name.
if [ -n "$CAMP" ]; then
  export FORGE_SUITE_LOCK="$CAMP/.suite-lock"
  export FORGE_RUN_LOCK="$CAMP/.run-lock"
fi

# forge-8vfn.7.6.79 — the sidecar `gate-vs-gate` reads when a collision cannot
# be named from `/proc/locks` at all (the inherited-fd take below writes no row
# there). One line, read back BY NAME never by position, same discipline as
# every other marker in this file: pid, the checkout this gate is running
# ($R, already resolved), the commit it measured, and when it took the lock.
# Called only from the two branches that actually hold fd 9 themselves — never
# from the ANCESTOR branch, which explicitly does not re-take it.
write_suite_lock_holder() {
  printf 'pid=%s cwd=%s head=%s since=%s\n' "$$" "$R" "$GATE_CHECKOUT_SHA" "$(date -u +%FT%TZ)" \
    > "$FORGE_SUITE_LOCK.holder" 2>/dev/null || true
  SUITE_LOCK_HELD=1
}

# The UNNAMEABLE branch's COURTESY, never its guarantee (§15.488: the wait
# below is the guarantee regardless of what this prints). Returns 1 with
# nothing printed when there is no sidecar to read, so the caller falls back to
# the original generic line rather than inventing one. PID REUSE is an accepted
# risk here, the same shape as `is_ancestor`'s pid walk above: a bare `kill -0`
# cannot tell a live holder from a dead pid some unrelated process has since
# reclaimed.
read_suite_lock_holder() {
  local f="$FORGE_SUITE_LOCK.holder" line pid cwd head since
  [ -f "$f" ] || return 1
  line="$(cat "$f" 2>/dev/null)" || return 1
  pid="$(printf '%s\n' "$line" | sed -n 's/.*pid=\([0-9]*\).*/\1/p')"
  [ -n "$pid" ] || return 1
  cwd="$(printf '%s\n' "$line" | sed -n 's/.*cwd=\([^ ]*\).*/\1/p')"
  head="$(printf '%s\n' "$line" | sed -n 's/.*head=\([^ ]*\).*/\1/p')"
  since="$(printf '%s\n' "$line" | sed -n 's/.*since=\([^ ]*\).*/\1/p')"
  if kill -0 "$pid" 2>/dev/null; then
    echo "suite-lock: HELD BY gate pid=$pid cwd=$cwd head=$head since $since"
  else
    # THE FLOCK ITSELF IS THE TRUTH; THE SIDECAR NEVER GATES. A dead pid does
    # not mean the lock is free — falls through to the same wait as any other
    # unclassified hold, unchanged.
    echo "suite-lock: STALE-SIDECAR (pid $pid gone) — removed"
    rm -f "$f"
  fi
  return 0
}

wait_for_suite_lock() {
  if flock -w "$SUITE_LOCK_WAIT" 9; then
    echo "suite-lock: TAKEN by this gate (pid $$) — the steps below are serialised against every other suite on this box"
    write_suite_lock_holder
  else
    echo "suite-lock: NOT TAKEN after ${SUITE_LOCK_WAIT}s — refusing rather than running a suite beside another one (the 3.2x case, ruling 778)"
    exit 75
  fi
}
SUITE_LOCK_WAIT="${FORGE_SUITE_LOCK_WAIT:-2400}"
if [ -z "${FORGE_SUITE_LOCK:-}" ]; then
  # §15.92: a gate outside a campaign is legitimate and genuinely unserialised.
  # What must never happen is that state looking like "nothing to report".
  echo "suite-lock: NOT CONFIGURED — no campaign was named, so these steps are NOT serialised against other suites"
else
  # TRY FIRST, CLASSIFY ONLY IF REFUSED. The order matters and the reason is a
  # measured property of `/proc/locks` rather than a preference:
  #
  #   a lock held through an INHERITED fd — the `( flock 9; … ) 9>file` idiom,
  #   where `flock(1)` locks and exits while the caller's fd keeps the hold —
  #   IS STILL HELD and is INVISIBLE in /proc/locks.
  #
  # Measured both ways while writing this: another opener is blocked (so the
  # hold is real) and the inode has ZERO rows (so the listing cannot see it).
  # /proc/locks lists a lock against the process that created it; once that
  # `flock` has exited there is no such process. A design that consulted the
  # listing FIRST would read "FREE" for a held lock and then block on it.
  #
  # So the non-blocking acquire is the authority on WHETHER it is held, and
  # the listing is consulted only to say WHO — which is exactly the question
  # the listing can still answer for the wrapper form every campaign wrapper
  # uses.
  exec 9>"$FORGE_SUITE_LOCK"
  if flock -n 9; then
    echo "suite-lock: TAKEN by this gate (pid $$) — the steps below are serialised against every other suite on this box"
    write_suite_lock_holder
  else
    SUITE_LOCK_STATE="$(suite_lock_state "$FORGE_SUITE_LOCK")"
    case "$SUITE_LOCK_STATE" in
      ANCESTOR:*)
        echo "suite-lock: held by ancestor pid ${SUITE_LOCK_STATE#ANCESTOR:} — not re-taken, because an inner flock would block on our own caller"
        ;;
      STRANGER:*)
        echo "suite-lock: WAITING on stranger pid(s) ${SUITE_LOCK_STATE#STRANGER:} — another lane's suite holds it"
        # A kernel that lists the inherited-fd hold (CI's does; WSL2's does not)
        # lands here, not below — so the sidecar is read on both paths.
        read_suite_lock_holder || true
        wait_for_suite_lock
        ;;
      *)
        # HELD, BY SOMEONE THE LISTING CANNOT NAME — the inherited-fd shape
        # above. forge-8vfn.7.6.79: read the sidecar first — the common case on
        # this box is that the holder is another gate.sh — and fall back to the
        # original generic line only when there is nothing to read. Either way
        # the wait below is unchanged: a bounded, explained failure instead of
        # a hang, never a guess about whether it is our own caller.
        read_suite_lock_holder || echo "suite-lock: HELD BY AN UNNAMEABLE HOLDER — the lock is taken but /proc/locks has no row for it, which is the inherited-fd shape; waiting, and refusing at the bound rather than guessing whether it is our own caller"
        wait_for_suite_lock
        ;;
    esac
  fi
fi

# ---- host contention, bracketed (M7 findings row 15) --------------------------------------
# §2.6's finding: the suite-lock serialises gates against EACH OTHER but not
# against CPU — a costed story run (bridge + chromium + agents) held under
# `.run-lock` shares the box with a gate's steps, and a run measured load
# 8–12 during which three unrelated tests timed out; one of those surfaced as
# TEN misleading FAILs from a single mount timeout. This does not fix the
# contention — it NAMES it, so a reader of a red gate can tell "this measured
# something real" from "the host was starved" without re-deriving it from
# `_1.0/reports/`.
#
# `load_avg()` reports `load1 load5 load15`, the same shape `run-observe.mjs`
# already uses for a story's per-beat host record (`hostState()`), matched
# rather than invented a second time. `FORGE_LOADAVG_FILE` is the test seam,
# same idiom as `FORGE_PROC_LOCKS`: `/proc/loadavg` cannot be made to hold a
# chosen number, so a door proving the threshold and the stamp fire correctly
# points here instead.
load_avg() {
  awk '{print $1, $2, $3}' "${FORGE_LOADAVG_FILE:-/proc/loadavg}" 2>/dev/null
}

# THE THRESHOLD IS NAMED, not buried in a comparison a reader has to re-derive
# (§15.92's lesson one layer up): 2x nproc is generous headroom — this box
# idles under 3 on 12 cores — so crossing it means "something else is plainly
# running", not routine background noise. Overridable, same idiom as
# `FORGE_SUITE_LOCK_WAIT` below, for a host whose own idle load differs.
GATE_LOAD_THRESHOLD_MULT="${FORGE_GATE_LOAD_THRESHOLD_MULT:-2}"
GATE_NPROC="$(nproc 2>/dev/null || echo 1)"
GATE_LOAD_THRESHOLD="$(awk -v m="$GATE_LOAD_THRESHOLD_MULT" -v n="$GATE_NPROC" 'BEGIN{printf "%.2f", m*n}')"

# True (exit 0) iff the 1-minute figure in a `load_avg()` string exceeds the
# threshold. An unreadable/empty reading short-circuits to false: an UNKNOWN
# load must never manufacture a PROVISIONAL stamp.
load_over_threshold() {
  local one="${1%% *}"
  [ -n "$one" ] || return 1
  awk -v v="$one" -v t="$GATE_LOAD_THRESHOLD" 'BEGIN{exit !(v > t)}'
}

# THE RUN-LOCK'S HOLDER, reusing the ONE classifier this file already has
# rather than a second `/proc/locks` reader (this file's own §15.480-era
# lesson). `gate.sh` never takes `.run-lock` itself — `with-locks.sh`'s header
# states the opposite: `gate.sh` REFUSES UNDER it — so ANCESTOR is reachable
# only if a caller mis-wraps a gate inside its own run-lock hold, exactly the
# shape `with-locks.sh` refuses at launch.
runlock_holder() {
  if [ -z "${FORGE_RUN_LOCK:-}" ]; then
    echo "NOT CONFIGURED"
  else
    suite_lock_state "$FORGE_RUN_LOCK"
  fi
}

GATE_LOAD_START="$(load_avg)"
GATE_RUNLOCK_HOLDER_START="$(runlock_holder)"
echo "GATE_LOAD_START=${GATE_LOAD_START:-UNKNOWN}"
echo "GATE_RUNLOCK_HOLDER_START=$GATE_RUNLOCK_HOLDER_START"
GATE_LOAD_PROVISIONAL=0
load_over_threshold "$GATE_LOAD_START" && GATE_LOAD_PROVISIONAL=1

LOGS="${CAMP:+$CAMP/reports}"; [ -n "$LOGS" ] && mkdir -p "$LOGS" || LOGS="$(mktemp -d)"
echo "logs: $LOGS"
fail=0
refused=0
# forge-8vfn.7.6.89 — a COUNT and the one command, never re-derived from `fail`
# (a bare flag) — the ALONE-RERUN proof below needs to know it was EXACTLY one
# FAIL (never a REFUSAL) and which command that was.
FAIL_COUNT=0
FAIL_CMD=""; FAIL_LOG=""
# M7 findings row 76a — EVERY GATE_* VAR THIS SCRIPT READS AS CONFIGURATION,
# SCRUBBED FROM EACH STEP'S OWN ENVIRONMENT. `eval "$cmd"` below runs inside
# THIS shell's subshell, so it inherits this process's full environment —
# including any control var a caller exported for gate.sh's OWN behaviour,
# never meant for the tree being gated. `GATE_RERUN_ALONE` (read at
# `${GATE_RERUN_ALONE:-}` below, after this loop) is the one such var this
# file has today: a caller running gate.sh over the whole worktree with
# GATE_RERUN_ALONE set was handing that var straight to `npm test`, and
# `npm test` runs `gate-rerun-alone.test.ts`, whose own fixtures spawn NESTED
# gate.sh invocations that inherited the ambient var as if each fixture had
# asked for it itself — `gate-rerun-alone.test.ts:174` reds on the leak alone,
# with no code defect in the tree being gated. A LIST, not one `unset`, so a
# future GATE_* control var this file grows is scrubbed by construction
# rather than by remembering to extend a second copy.
GATE_CONTROL_VARS="GATE_RERUN_ALONE"
while IFS= read -r cmd; do
  [ -n "$cmd" ] || continue
  name="$(printf '%s' "$cmd" | tr -cs 'A-Za-z0-9' '-' | sed 's/^-//; s/-$//' | cut -c1-60)"
  # NAMESPACED BY THE TREE BEING GATED. `$LOGS` is the CAMPAIGN dir, shared by
  # every lane, and `$name` derives from the command alone — so before this,
  # four lanes gating concurrently all wrote `gate-npm-test.log` and the last
  # writer won. Bead 6.9 named it on 2026-09-04 and it sat unfixed until M6-D
  # read `# fail 10` out of that file seconds after its own gate passed: the
  # failures were lane A's, proved by `grep -oE "/home/parso/forge-m6-[a-d]"`
  # on the log and A's wrapper stamped seven seconds later. A lane came within
  # one message of reporting a sibling's failures as its own, and PR bodies
  # across the milestone had quoted counts from this path as evidence.
  # The wrapper's own PASS/FAIL line was always per-lane and always correct;
  # it is the STEP log that lied, which is the harder kind to notice.
  log="$LOGS/gate-$(basename "$R")-$name.log"
  t0=$(now_ticks)
  # Written to a temp file and renamed: `rename(2)` is atomic within a
  # filesystem, so a reader either sees the previous complete log or this one,
  # never a half-written file — and a gate already executing this script keeps
  # its own inode rather than following a path that changed underneath it.
  if ( unset $GATE_CONTROL_VARS; eval "$cmd" ) > "$log.part" 2>&1; then
    mv -f "$log.part" "$log"
    echo "PASS  $cmd  ($(secs "$t0"))"
  else
    rc=$?
    mv -f "$log.part" "$log"
    # A REFUSAL IS NOT A FAILURE (T1 ruling 699). 75 is `EX_TEMPFAIL`, which the
    # 7.6.13 lock guard exits when a sibling's story run holds `.run-lock`.
    # Recording that as `FAIL` is §15.92 one layer up: the guard names its
    # holder carefully and this line used to flatten it into the word it uses
    # for a suite that ran and went red. Named here, in the same idiom as SKIP
    # and OTHER JOB, with its own rc so no verdict reader has to open the log.
    if [ "$rc" -eq 75 ]; then
      # COLUMN 0, same shape as FAIL / SKIP / OTHER JOB, so `^REFUSED ` is a
      # stable grep (699 addendum, D's half): the rc alone is necessary and not
      # sufficient, because every lane's merge precondition reads the LOG, and a
      # refused gate still prints a pin block — a precondition would otherwise
      # run `pin-precheck.sh` over a log whose `npm test` never executed and
      # record the pins green.
      # BY NAME, NEVER BY POSITION. The first draft read LINE 1 of the step log
      # and printed an empty reason: npm's own banner (`> forge@0.9.0 pretest`)
      # sits there, and the guard's line is the fifth. Same defect as the
      # `head -3 <gate log>` recipe M6-C shipped an hour earlier, in the change
      # whose whole subject is not being silent — position was never the
      # property; "the line the guard wrote" is.
      # 7.6.100: ANY guard's marker, not `[test-guard]` alone. The build guard
      # writes `[build-guard]`, and a literal match on the one guard that
      # existed when this line was written would print an EMPTY reason for the
      # second — which is the defect the paragraph above records ("the first
      # draft read LINE 1 and printed an empty reason"), recurring one guard
      # later. The property is "the line the guard wrote"; the marker shape is
      # `[<name>-guard]` and matching it is what makes that property general.
      echo "REFUSED  $cmd  ($(secs "$t0")) — $(grep -m1 -E '^\[[a-z][a-z-]*-guard\]' "$log" 2>/dev/null | sed 's/^\[[^]]*\] *//')"
      refused=1
    else
      echo "FAIL  $cmd  ($(secs "$t0"))  → $log"
      fail=1
      FAIL_COUNT=$((FAIL_COUNT + 1))
      FAIL_CMD="$cmd"; FAIL_LOG="$log"
    fi
  fi
done < <("$0" --list "$R" | sed -n 's/^RUN //p')

# forge-8vfn.7.6.89 — THE REPLAY IS THIS TOOL'S TO PERFORM, NOT THE LANE'S (a
# hand-typed ALONE-RERUN proves nothing). Called only here, after the loop's
# own final count, so the two can never disagree about what ran.
if [ -n "${GATE_RERUN_ALONE:-}" ]; then
  ( cd "$R" && "$HERE/gate-rerun-alone.sh" "$GATE_RERUN_ALONE" "$FAIL_COUNT" "$FAIL_CMD" "$FAIL_LOG" )
fi

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

# T1 1260 — the `== pins ==` block moved to `gate-pins.sh` at this file's
# 800-line cap: manifest loop, sibling_stale/own_stale/pin_fail and their
# counters, PIN_SIBLING_STALE_COUNT. SOURCED, not exec'd, because it reads and
# mutates THIS shell's own $R/$CAMP/$fail/$refused/$EXPECTED_PIN_FAILS/
# $gate_main directly — a subshell would get copies it could not mutate back.
# Located the same way `gate-rerun-alone.sh` is, four steps above.
source "$HERE/gate-pins.sh"
# THE TREE THAT REACHED THE VERDICT MUST BE THE TREE THAT STARTED (7.6.129). A
# moved tree makes every line above a claim about something nobody has; it
# outranks a red, because a red about the wrong tree is not even a red.
if [ -n "$PIN0" ]; then
  PIN1=$(tree_pin) || { echo "GATE_TREE_UNREADABLE: cannot re-read $R before the verdict — UNKNOWN, not a verdict"; exit 3; }
else
  PIN1="$PIN0"
fi
if [ "$PIN1" != "$PIN0" ]; then
  echo "GATE_TREE_MOVED: head ${PIN0%% *} -> ${PIN1%% *}, porcelain ${PIN0##* } -> ${PIN1##* } — the tree changed while this gate ran (§15.540), so every verdict above is about a tree that no longer exists. UNKNOWN, not red: commit or revert, then re-gate."
  exit 3
fi
# ---- host contention, the END bracket (M7 findings row 15) ---------------------------------
GATE_LOAD_END="$(load_avg)"
GATE_RUNLOCK_HOLDER_END="$(runlock_holder)"
echo "GATE_LOAD_END=${GATE_LOAD_END:-UNKNOWN}"
echo "GATE_RUNLOCK_HOLDER_END=$GATE_RUNLOCK_HOLDER_END"
load_over_threshold "$GATE_LOAD_END" && GATE_LOAD_PROVISIONAL=1
# A STAMP FOR THE READER, NEVER A LAUNDERING (M7 findings row 15): the exit
# code below is computed exactly as it always was, from `fail`/`refused`
# alone, and this line changes neither — it only tells a reader that host
# contention was observed at one end of this gate or the other, so a red (or
# a green) here may be about the host as much as the tree.
if [ "$GATE_LOAD_PROVISIONAL" -eq 1 ]; then
  echo "GATE_VERDICT=PROVISIONAL reason=load>${GATE_LOAD_THRESHOLD} (threshold ${GATE_LOAD_THRESHOLD_MULT}x nproc=${GATE_NPROC}, observed start=${GATE_LOAD_START:-UNKNOWN} end=${GATE_LOAD_END:-UNKNOWN})"
fi

# A real failure outranks a refusal: a gate that both lost a step AND was
# refused another is red, not "try again later".
if [ "$fail" -ne 0 ]; then exit "$fail"; fi
[ "$refused" -eq 0 ] || exit 3
exit 0
