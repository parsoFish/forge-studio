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
echo "GATE_CHECKOUT=$(git -C "$R" rev-parse --short=8 HEAD 2>/dev/null || echo '?')"
case "$link" in
  "$R"/*) ;;
  *) echo "BORROWED node_modules — this tree is running another tree's install; verdict void (§15.13)"; exit 2 ;;
esac

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
# A wall-clock delta is a proxy, and a proxy that can report an impossible number is a broken
# measurement, not a fast step (§15.48: `real 0m0.000s` for 2 s of work). If the clock stepped
# under us the duration is reported as `?s`, never as a plausible-looking lie.
secs() { local d=$(( $(date +%s) - $1 )); if [ "$d" -lt 0 ]; then echo "?s (clock stepped)"; else echo "${d}s"; fi; }

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
lock_holder_pids() {
  local f="$1" ino
  ino="$(stat -c '%i' "$f" 2>/dev/null)" || return 0
  awk -v ino=":$ino " '$0 ~ ino {print $5}' /proc/locks
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
  local f="$1" pids pid
  pids="$(lock_holder_pids "$f")"
  [ -z "$pids" ] && { echo FREE; return; }
  for pid in $pids; do
    is_ancestor "$pid" && { echo "ANCESTOR:$pid"; return; }
  done
  echo "STRANGER:$(echo $pids | tr '\n' ' ' | sed 's/ $//')"
}
wait_for_suite_lock() {
  if flock -w "$SUITE_LOCK_WAIT" 9; then
    echo "suite-lock: TAKEN by this gate (pid $$) — the steps below are serialised against every other suite on this box"
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
  else
    SUITE_LOCK_STATE="$(suite_lock_state "$FORGE_SUITE_LOCK")"
    case "$SUITE_LOCK_STATE" in
      ANCESTOR:*)
        echo "suite-lock: held by ancestor pid ${SUITE_LOCK_STATE#ANCESTOR:} — not re-taken, because an inner flock would block on our own caller"
        ;;
      STRANGER:*)
        echo "suite-lock: WAITING on stranger pid(s) ${SUITE_LOCK_STATE#STRANGER:} — another lane's suite holds it"
        wait_for_suite_lock
        ;;
      *)
        # HELD, BY SOMEONE THE LISTING CANNOT NAME — the inherited-fd shape
        # above. Named rather than guessed: if this is an ancestor we will sit
        # out the bound and refuse, which is a bounded, explained failure
        # instead of a hang.
        echo "suite-lock: HELD BY AN UNNAMEABLE HOLDER — the lock is taken but /proc/locks has no row for it, which is the inherited-fd shape; waiting, and refusing at the bound rather than guessing whether it is our own caller"
        wait_for_suite_lock
        ;;
    esac
  fi
fi

LOGS="${CAMP:+$CAMP/reports}"; [ -n "$LOGS" ] && mkdir -p "$LOGS" || LOGS="$(mktemp -d)"
echo "logs: $LOGS"
fail=0
refused=0
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
  t0=$(date +%s)
  # Written to a temp file and renamed: `rename(2)` is atomic within a
  # filesystem, so a reader either sees the previous complete log or this one,
  # never a half-written file — and a gate already executing this script keeps
  # its own inode rather than following a path that changed underneath it.
  if ( eval "$cmd" ) > "$log.part" 2>&1; then
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
      echo "REFUSED  $cmd  ($(secs "$t0")) — $(grep -m1 -F '[test-guard]' "$log" 2>/dev/null | sed 's/^\[[^]]*\] *//')"
      refused=1
    else
      echo "FAIL  $cmd  ($(secs "$t0"))  → $log"
      fail=1
    fi
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

# NAMED, never silent — this script's own line 13 (§15.92). A pins section that
# simply does not appear is indistinguishable from one that found nothing wrong,
# which is exactly how `forge-e8dn` survived two full gates.
echo "== pins =="
if [ -z "$CAMP" ]; then
  echo "SKIP no campaign dir was named — there are no manifests to check, and this gate wrote its logs to a temp dir"
elif [ ! -d "$CAMP/gate-manifests" ]; then
  echo "SKIP $CAMP has no gate-manifests/ — no manifests to check"
else
  # WHICH MANIFESTS THIS VERDICT IS ABOUT (`forge-8vfn.7.6.32`, T1 738).
  # Measured 2026-09-11: M6-C amended `M6-C.sha256` fourteen seconds after a
  # lane's `pin-precheck` read this block, and the precheck reported two
  # undeclared failures that re-derived `OK` on a direct check seconds later.
  # Neither instrument was wrong; each was correct about a different instant.
  # `pin-precheck` already guards the TREE moving between here and the merge —
  # nothing carried the identity of the MANIFESTS forward, so its `:145`
  # diagnosis blamed a tree that had not moved.
  #
  # The asymmetry is the reason this matters: that instance printed a loud false
  # REFUSAL. An amendment that ADDED rows instead of rehashing them would have
  # produced `PIN_PRECHECK_OK` against a manifest already disagreeing with the
  # tree, and the merge would have gone through on it.
  #
  # SCOPE: `*.sha256` AND `*.counts`, and the second half is not obvious. The
  # verdict is computed from `.sha256`, so a first draft covered only that —
  # but `pin-precheck.sh:107` reads `${m%.sha256}.counts` for `head=`, and
  # `:129` uses `head=` to choose rc 4 (unreadable across skew, proceeds loudly)
  # over rc 3 (undeclared drift, blocks). Opposite outcomes at the merge slot.
  # `.globs` and `amend-*.md` stay out, measured: nothing in this block or in
  # `pin-precheck` reads them (grep, both files, zero hits). If this block ever
  # grows a `pin-glob-check` call, `.globs` reaches the log and this line must
  # widen with it.
  echo "PIN_MANIFESTS=$(sha256sum "$CAMP"/gate-manifests/*.sha256 "$CAMP"/gate-manifests/*.counts 2>/dev/null | sha256sum | cut -c1-16)"
  # 7.6.80 (T1 879) — AND ONE PER MANIFEST, over the same two files each.
  #
  # The aggregate answers "did anything move", which is the right question for
  # a log and the wrong one for a merge: any lane's reconcile moves it, so
  # `pin-precheck` refuses every merge whose gate finished first. Measured on
  # three consecutive merges in one evening, and in all of them the refusing
  # lane's OWN manifest was untouched. A merge's pin precondition is about the
  # manifests it declares and touches; the precheck cannot compare that subset
  # against a single number, so the subset has to be printed.
  #
  # The aggregate STAYS. It is still the one-line answer, and a log carrying
  # only it must stay readable until every lane's gate emits these.
  for pin_m in "$CAMP"/gate-manifests/*.sha256; do
    [ -e "$pin_m" ] || continue
    pin_name="$(basename "$pin_m" .sha256)"
    echo "PIN_MANIFEST $pin_name=$(sha256sum "$pin_m" "${pin_m%.sha256}.counts" 2>/dev/null | sha256sum | cut -c1-16)"
  done
  # SKEW MAKES A **FAILED** COUNT AMBIGUOUS -- IT DOES NOT INVALIDATE A CLEAN ONE
  # (T1 ruling 684, correcting this block's first draft; §15.381 credited to M6-C).
  # `sha256sum -c` verifies HASHES, so `0 FAILED` from a tree AHEAD of the pin is a
  # true statement -- the pinned bytes still hold here. Only a NON-ZERO count is
  # unreadable across skew, because a MISSING or DIFF line can be a file the pin
  # predates rather than drift. The first draft SKIPPED on any skew and threw the
  # real verification away with the ambiguous one.
  #
  # MEASURED, and reported wrongly before it was understood: this block printed
  # `M6-C.sha256: 13 FAILED of 198` from a tree one merge behind, and it went
  # upward as a sibling lane's drift. C's tree was 0 FAILED / 0 MISSING; seven of
  # the nine were files that did not exist in this checkout yet.
  #
  # THE NO-`head=` BRANCH IS NOT DECORATION. Only three of the campaign's fourteen
  # `.counts` carry `head=`; a check keyed on it that stayed QUIET for the other
  # eleven would rebuild `forge-e8dn` eleven manifests over.
  head_now="$(git -C "$R" rev-parse HEAD 2>/dev/null || echo '')"
  short="${head_now:0:8}"
  # A FAILED count the lane did not declare fails the gate (693(ii), §15.388):
  # D's gate was rc=0, 20/20, with `M6-T1.sha256: 2 FAILED of 14` in the same
  # log. Declarations are matched by MANIFEST or by `MANIFEST:path`, so a lane
  # can account for one amended file without blanketing the whole manifest.
  # 7.6.97 — A SIBLING'S STALE PIN IS NOT THIS GATE'S RED.
  #
  # `gate.sh` verifies EVERY manifest against the checkout, and §15.105 makes a
  # pin stale the moment a SIBLING merges. With three lanes merging every few
  # minutes the window in which all manifests agree with newest main is shorter
  # than one gate run, so a lane's gate goes red on another lane's pin while
  # every one of its own steps passes — D twice in six minutes (953: C's
  # `reap.test.ts`; 954: A's #726 six files, four minutes after C reconciled).
  # The merge slot already separates this case (7.6.80's `PIN_SIBLING_MOVED` —
  # reported, not refused); the gate did not.
  #
  # THREE CONDITIONS, ALL REQUIRED, and each is there to keep a different thing
  # red:
  #   owner != this lane   — my own stale pin is mine to reconcile, not to excuse
  #   path not in the diff — a path this PR touches must be DECLARED (7.6.43)
  #   bytes == main's      — the change is a merge on main, NOT tampering here
  # A row failing any one of them stays a red UNDECLARED. The third is the one
  # that makes this safe: "a sibling owns it" alone would excuse an edit made in
  # this tree to a file this lane does not own.
  #
  # THIS IS THE BACKSTOP, NEVER THE CHANNEL (T1 956). 954's rule is that a
  # merging lane forwards `pin-reconcile`'s own `REFUSED — owner=X …` line to
  # each owner at merge time; this classification covers the window between that
  # merge and that message, and a reported row is not a reason to stop sending.
  #
  # UNSET `FORGE_LANE` TURNS THE CLASSIFICATION OFF AND SAYS SO. Without a lane
  # identity there is no `owner != mine` to test, and a feature that quietly
  # stopped classifying would print exactly the same clean pin block as one that
  # found no stale siblings (§15.504). `pin-reconcile.sh` refuses outright for
  # the same reason; a gate cannot refuse, so it announces.
  sibling_stale_n=0
  pr_diff_paths="|"
  pr_diff_ok=0
  if [ -n "${gate_main:-}" ] && git -C "$R" rev-parse --verify --quiet parsoFish/main >/dev/null 2>&1; then
    if pr_diff_list="$(git -C "$R" diff --name-only parsoFish/main..HEAD 2>/dev/null)"; then
      pr_diff_ok=1
      while IFS= read -r pr_f; do
        [ -n "$pr_f" ] && pr_diff_paths="$pr_diff_paths$pr_f|"
      done <<< "$pr_diff_list"
    fi
  fi
  if [ -z "${FORGE_LANE:-}" ]; then
    echo "  PIN_SIBLING_STALE classification OFF: FORGE_LANE is unset, so this gate cannot tell a sibling's stale pin from drift in this tree — every FAILED row below stays UNDECLARED"
  elif [ "$pr_diff_ok" -eq 0 ]; then
    echo "  PIN_SIBLING_STALE classification OFF: this PR's diff against parsoFish/main could not be computed, and a row cannot be excused without knowing whether this PR touched it"
  fi

  manifest_owner() {
    local c="$CAMP/gate-manifests/$1.counts"
    [ -f "$c" ] || return 1
    grep -o 'owner=[^ ]*' "$c" | head -1 | cut -d= -f2
  }

  # True only when all three hold. Every `return 1` here is a row that stays red.
  sibling_stale() {
    local man="$1" p="$2" owner main_blob here_blob
    [ -n "${FORGE_LANE:-}" ] || return 1
    [ "$pr_diff_ok" -eq 1 ] || return 1
    owner="$(manifest_owner "$man")" || return 1
    [ -n "$owner" ] || return 1
    [ "$owner" != "$FORGE_LANE" ] || return 1
    case "$pr_diff_paths" in *"|$p|"*) return 1 ;; esac
    main_blob="$(git -C "$R" rev-parse --verify --quiet "parsoFish/main:$p" 2>/dev/null)" || return 1
    here_blob="$(cd "$R" && git hash-object -- "$p" 2>/dev/null)" || return 1
    [ -n "$main_blob" ] && [ "$main_blob" = "$here_blob" ]
  }

  pin_fail() {
    local man="$1" manifest="$2" undeclared=0 p
    case " $EXPECTED_PIN_FAILS " in *" $man "*) echo "  declared: every failure in $man is accounted for by this PR"; return 0 ;; esac
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      case " $EXPECTED_PIN_FAILS " in
        *" $man:$p "*) echo "  declared: $man:$p"; continue ;;
      esac
      if sibling_stale "$man" "$p"; then
        echo "  PIN_SIBLING_STALE $man:$p — matches main ${gate_main:-unknown}; owner $(manifest_owner "$man") owes a reconcile"
        sibling_stale_n=$((sibling_stale_n + 1))
      else
        echo "  UNDECLARED: $man:$p"; undeclared=1
      fi
    done < <(cd "$R" && sha256sum -c "$manifest" 2>/dev/null | sed -n 's/^\(.*\): FAILED$/\1/p')
    [ "$undeclared" -eq 0 ] || fail=1
  }
  # 7.6.43 — A DECLARATION THAT NAMES NOTHING REFUSES.
  #
  # C's case (773): `--expect-pin-fail M6-C:tests/stories/S7.story.mjs` was
  # accepted in silence although only `M1-C-S7` pins that path, and it surfaced
  # only because a REAL undeclared failure happened to sit beside it. A
  # declaration is the PR's claim about ITSELF, and `--expect-pin-fail` is the
  # flag that turns a red gate green — so a claim matching nothing must not be
  # indistinguishable from one that matched.
  #
  # THE MESSAGE NAMES WHICH OF THREE, because a refusal that catches only the
  # third leaves two more ways to write a declaration that looks like cover:
  #   1. the manifest does not exist at all
  #   2. the path is pinned by no manifest anywhere (a typo)
  #   3. manifest and path are both real but WRONG PAIR  <- C's, and the worst,
  #      since a reader checking either half in isolation finds it
  for decl in $EXPECTED_PIN_FAILS; do
    [ -n "$decl" ] || continue
    dman="${decl%%:*}"
    if [ ! -f "$CAMP/gate-manifests/$dman.sha256" ]; then
      echo "  declaration names nothing: $decl — no manifest named '$dman' in $CAMP/gate-manifests"
      refused=1; continue
    fi
    [ "$decl" = "$dman" ] && continue          # manifest-level, and it exists
    dpath="${decl#*:}"
    if awk '{ q=$2; sub(/^\*/,"",q); print q }' "$CAMP/gate-manifests/$dman.sha256" \
         | grep -Fxq "$dpath"; then continue; fi
    holder=""
    for other in "$CAMP"/gate-manifests/*.sha256; do
      [ -f "$other" ] || continue
      if awk '{ q=$2; sub(/^\*/,"",q); print q }' "$other" | grep -Fxq "$dpath"; then
        holder="$holder $(basename "$other" .sha256)"
      fi
    done
    if [ -n "$holder" ]; then
      echo "  declaration names nothing: $decl — '$dman' does not pin that path;$holder does. Wrong pair."
    else
      echo "  declaration names nothing: $decl — no manifest pins '$dpath' at all (typo?)"
    fi
    refused=1
  done

  for m in "$CAMP"/gate-manifests/*.sha256; do
    [ -f "$m" ] || continue
    counts="${m%.sha256}.counts"
    pinned=""
    [ -f "$counts" ] && pinned="$(grep -o 'head=[0-9a-f]\{7,40\}' "$counts" | head -1 | cut -d= -f2)"
    # Count FAILED lines only: `grep -vc ': OK$'` also counts sha256sum's WARNING line (§15.105).
    n="$(cd "$R" && sha256sum -c "$m" 2>&1 | grep -cE ': FAILED|No such file')"
    total="$(wc -l < "$m")"
    man="$(basename "$m" .sha256)"
    # SKEW IS AN ANCESTRY QUESTION, NOT A STRING ONE (M6-C, verified on a real
    # tree: HEAD `82bb8bf4` is a DESCENDANT of pin `df473067`, so it contains
    # every pinned commit and can answer perfectly — and a prefix match called
    # it skew). With the rc riding on this, a prefix match would refuse a lane
    # one commit ahead and hand it advice it has already followed.
    readable=1
    if [ -n "$pinned" ] && ! git -C "$R" merge-base --is-ancestor "$pinned" HEAD 2>/dev/null; then readable=0; fi
    if [ -z "$pinned" ]; then
      echo "$man.sha256: $n FAILED of $total — tree at ${short:-unknown} (no head= in $(basename "$counts") — skew unknown)"
      [ "$n" -gt 0 ] && pin_fail "$man" "$m" || true
    elif [ "$n" -gt 0 ] && [ "$readable" -eq 0 ]; then
      echo "$man.sha256: $n FAILED of $total — tree at $short; last verified at $pinned — skew: reconcile from a tree at $pinned or later before reading these as drift (§15.381)"
    else
      echo "$man.sha256: $n FAILED of $total — tree at ${short:-unknown}; last verified at $pinned"
      [ "$n" -gt 0 ] && pin_fail "$man" "$m" || true
    fi
  done
fi
# 7.6.97: COUNTED SEPARATELY so a reader sees how many siblings are stale rather
# than inferring it from the absence of reds. Zero prints too — a count that
# appears only when non-zero cannot be told from one nobody took.
if [ -n "${sibling_stale_n:-}" ]; then
  echo "PIN_SIBLING_STALE_COUNT=$sibling_stale_n"
fi
# A real failure outranks a refusal: a gate that both lost a step AND was
# refused another is red, not "try again later".
if [ "$fail" -ne 0 ]; then exit "$fail"; fi
[ "$refused" -eq 0 ] || exit 3
exit 0
