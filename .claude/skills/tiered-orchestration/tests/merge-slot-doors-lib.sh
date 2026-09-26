# merge-slot-doors-lib.sh — shared harness for the merge-slot-doors-*.sh
# suites (forge-8vfn.8.1.29, T1 ruling 1649). Sourced, not run directly: no
# shebang-invoked entry point of its own, no `set -e`/exit of its own beyond
# the two pin refusals below, which intentionally end the SOURCING file's
# process the same way a `set -u` violation would.
#
# WHY THIS FILE EXISTS. `merge-slot-doors.sh` grew to 847 lines proving
# `merge-slot.sh`'s merge protocol across 37 real-trace shapes (row 124 added
# the last group) — over the 800-line cap `scripts/check-file-size.mjs` now
# also enforces for `.sh` files, the same cap that split `merge-slot.sh` and
# `merge-state-precheck.sh` apart (forge-8vfn.8.1.26, cited below). The world()
# fixture, the SUBJECT_SHA/MSP_SHA pins and the ok/bad bookkeeping are used by
# EVERY concern group, so splitting the doors by concern without this file
# would duplicate the fixture seven times over — the exact drift risk pin
# comments elsewhere in this campaign warn about. Each `merge-slot-doors-*.sh`
# file sources this one and is a complete, independently runnable suite: the
# pin checks below run again on every sourcing, so a concern file run alone
# still refuses if `merge-slot.sh` or `merge-state-precheck.sh` drifted out
# from under it.
#
# WHAT IS UNDER TEST, overall: `merge-slot.sh`'s merge protocol. See the
# per-concern files for the specific shapes and their own rationale —
# merge-slot-doors-main-at.sh (MAIN_AT capture, forge-8vfn.7.6.111),
# merge-slot-doors-gate.sh (gate-log marker parsing + ALONE-RERUN waivers),
# merge-slot-doors-update-branch.sh (update-branch conflicts + rename paths),
# merge-slot-doors-out-guard.sh (the <out> refusal), merge-slot-doors-
# changed-set.sh (the List-files changed-set API), merge-slot-doors-pin-
# since-gate.sh (pinned-path-since-gate), merge-slot-doors-exit-codes.sh
# (per-class exit codes), merge-slot-doors-merge-state.sh (mergeStateStatus
# ordering, forge-8vfn.8.1.26 / T1 1633).
set -u
# SKILL-COPY MOVE (M7 findings row 37): `merge-slot.sh` ships as this file's
# own sibling now — `.claude/skills/tiered-orchestration/scripts/merge-slot.sh`
# — so the default resolves relative to THIS file's own location rather than
# naming the campaign directory it used to live beside. `_1.0/` is gitignored
# campaign state (CLAUDE.md); a committed file cannot cite a path inside it —
# and a self-location the doors could not resolve in CI would make this suite
# skip forever, which is a gate that never runs, not a green one. `HERE` is
# THIS file's own directory (`${BASH_SOURCE[0]}` at a file's own top level
# names that file, sourced or not), which is the same `tests/` directory every
# concern file lives in, so `MS`/`MSP` resolve identically whichever concern
# file sources this one.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MS="${MS:-$HERE/../scripts/merge-slot.sh}"
# forge-8vfn.8.1.26: merge-slot.sh's own SIBLING (`$HERE`-resolved by
# merge-slot.sh, same idiom as `ci-terminal.sh`/`pin-precheck.sh`) that
# answers the mergeStateStatus question — split out so merge-slot.sh could
# stay under the 800-line cap. Pinned separately from `MS` below, not folded
# into one combined digest: the two files change independently, and a single
# hash would refuse (or worse, stay silent) on the wrong file's edit.
MSP="${MSP:-$HERE/../scripts/merge-state-precheck.sh}"

# THE DOORS AND THEIR SUBJECT MOVE TOGETHER, OR NOTHING RUNS (C, on the save).
#
# A PAIRED SAVE IS NOT ATOMIC AND NOTHING REPORTED THE HALF-STATE. This file was
# created while `merge-slot.sh` was still its pre-image — `save-instrument.sh`
# correctly REFUSED the script half because another lane was executing it — and
# for as long as that lasted, running these doors produced TWO REDS that read as
# "merge-slot.sh has regressed" about a file that was exactly as its last save
# left it. Each save call was individually correct; the PAIR has an invariant
# neither call knows about. The reverse half-state (fix without doors) is merely
# silent; this direction MANUFACTURES A FALSE ACCUSATION, in the tool three
# lanes' merges run through.
#
# So the subject is PINNED, and a mismatch is UNKNOWN — exit 2, neither green
# nor red. It is not a pass (these doors did not run) and not a failure (nothing
# is known to be broken). Same instinct as `runner-source.mjs` refusing rather
# than slicing the wrong module: an instrument that cannot identify its subject
# has no verdict to give.
#
# WHEN `merge-slot.sh` LEGITIMATELY CHANGES, this constant is updated in the same
# edit — that cost IS the point, and it is the cost the campaign already pays for
# every pin. `SUBJECT_SHA` can be overridden to exercise a CANDIDATE before it is
# saved, which is how these doors were proven; it must be STATED, never defaulted.
# `df8b875ddb789b77` is the skill copy as landed by M7 findings row 37 — NOT the
# `fd4c288b36663f05` the pre-move `_1.0/merge-slot.sh` carried; the move itself
# is a legitimate change (six hardcoded paths became arguments/env vars, §15.148,
# plus the sleep intervals below), so this pin moved with it in the same edit.
# `f7bc97b01b1aa7e5` is forge-8vfn.8.1.26 / T1 1633's mergeStateStatus
# precheck AFTER the rc-mapping call was split out to `merge-state-
# precheck.sh` (below) to bring this file back under the 800-line cap; it
# calls the sibling and maps its rc 0/18/19 to MARKER=done RESULT=… — moved
# here in the same edit that added the mergeStateStatus doors now in
# merge-slot-doors-merge-state.sh.
SUBJECT_SHA="${SUBJECT_SHA:-f7bc97b01b1aa7e5}"
subject_now="$(sha256sum "$MS" 2>/dev/null | cut -c1-16)"
if [ "$subject_now" != "$SUBJECT_SHA" ]; then
  printf 'merge-slot-doors: REFUSING — %s is %s, these doors were proven against %s.\n' \
    "$MS" "${subject_now:-UNREADABLE}" "$SUBJECT_SHA"
  printf '  Not a pass (they did not run) and not a failure (nothing is known broken): UNKNOWN.\n'
  printf '  Either the subject moved and this file owes the same edit, or a paired save landed half.\n'
  exit 2
fi

# THE SIBLING IS PINNED TOO (forge-8vfn.8.1.26) — the same reasoning as MS
# above, applied to the file that now HOLDS the mergeStateStatus rationale,
# the bounded retry and the DIRTY/UNKNOWN classification. A doors file that
# proved merge-slot.sh's rc-mapping but never re-pinned the sibling would let
# the sibling's own logic drift untested — exactly the gap this bead exists
# to close, one file over. `MSP_SHA` is `merge-state-precheck.sh` as landed in
# the same edit that split it out and updated `SUBJECT_SHA` above.
MSP_SHA="${MSP_SHA:-f278e4547dc29904}"
msp_now="$(sha256sum "$MSP" 2>/dev/null | cut -c1-16)"
if [ "$msp_now" != "$MSP_SHA" ]; then
  printf 'merge-slot-doors: REFUSING — %s is %s, these doors were proven against %s.\n' \
    "$MSP" "${msp_now:-UNREADABLE}" "$MSP_SHA"
  printf '  Not a pass (they did not run) and not a failure (nothing is known broken): UNKNOWN.\n'
  printf '  Either the sibling moved and this file owes the same edit, or a paired save landed half.\n'
  exit 2
fi

# EVERY SLEEP INTERVAL merge-slot.sh SUPPORTS, ZEROED (M7 findings row 37).
# 31 shapes through the real production intervals (12s+8s minimum per attempt,
# up to three attempts) would cost minutes `npm test` does not have to spend;
# these numbers are a courtesy to GitHub's own API, not a correctness
# requirement the fake `gh`/`ci-terminal` stubs below need. Exported ONCE, so
# every `bash "$MS"` call in every concern file that sources this lib inherits
# them — the fixture campaign dir (below) still varies per world and is set at
# each call site.
export MERGE_SLOT_HEAD_RETRY_SLEEP_SECS=0
export MERGE_SLOT_POST_UPDATE_SLEEP_SECS=0
export MERGE_SLOT_MAIN_MOVED_RETRY_SLEEP_SECS=0
export MERGE_SLOT_MERGE_RETRY_SLEEP_SECS=0
export MERGE_SLOT_FINAL_SETTLE_SLEEP_SECS=0
export MERGE_SLOT_MERGEABLE_RETRY_SLEEP_SECS=0

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s — %s\n' "$1" "$2"; }

# ---------------------------------------------------------------------------
# One throwaway world per door. EVERY SHAPE BUILDS ITS OWN: a fixture reused
# across shapes is measured against a world a previous case edited, which is the
# same error as reconciling a dirty tree (precheck-doors.sh learned this first).
world() {                        # world <parents-answer> <main-answer> [main-seq...]
  local parents="$1" main="$2"; shift 2
  local T; T="$(mktemp -d /tmp/merge-slot-door-XXXXXX)"
  mkdir -p "$T/fix" "$T/repo" "$T/bin" "$T/campaign"
  # THE FIXTURE CAMPAIGN, NOT THE REAL ONE (M7 findings row 37). `merge-slot.sh`
  # requires `MERGE_SLOT_CAMPAIGN_DIR` and, unless overridden, derives its known-
  # flakes register and pin manifests dir from it. A door suite that pointed this
  # at whatever campaign directory happens to be live on the host would make
  # every door's correctness depend on production state nobody in this file
  # controls — exactly
  # what "EVERY SHAPE BUILDS ITS OWN FIXTURE" (above) already refuses to do for
  # the repo and the `gh` stub. `known-flakes.md` carries the ONE line the
  # ALONE-RERUN waiver doors (forge-8vfn.7.6.89, in merge-slot-doors-gate.sh)
  # match against — the same path they have always named — so those doors stay
  # self-contained rather than reading whatever the live register happens to
  # hold today.
  cat > "$T/campaign/known-flakes.md" <<'FLAKES'
## `scripts/stories/beats-waits.test.ts:456` — wall-clock under host load

A timing assertion that goes the wrong way when the host is contended. Fixture
copy for the merge-slot doors (M7 findings row 37) — not the live register.
FLAKES
  printf '%s' "$parents" > "$T/fix/parents"
  printf '%s' "$main"    > "$T/fix/main"
  : > "$T/fix/merge_out"; : > "$T/fix/gh-calls"; : > "$T/fix/merges"; : > "$T/lock"
  if [ "$#" -gt 0 ]; then printf '%s\n' "$@" > "$T/fix/main_seq"; else : > "$T/fix/main_seq"; fi

  # A REAL REPO, because `cap_check_head` degrades to `CAPS=UNCHECKED … return 0`
  # on every failure path: a door run against a missing repo would SKIP the caps
  # and still reach the loop, and a door that reaches its subject through a
  # skipped step is measuring a path nobody runs.
  ( cd "$T/repo" && git init -q -b main \
    && git config user.email f@x.invalid && git config user.name f \
    && mkdir -p scripts \
    && printf 'process.exit(0);\n' > scripts/check-file-size.mjs \
    && printf 'process.exit(0);\n' > scripts/check-package-caps.mjs \
    && git add -- scripts/check-file-size.mjs scripts/check-package-caps.mjs \
    && git commit -qm base ) >/dev/null 2>&1
  # The PR head IS that commit, so the caps check finds it locally instead of
  # taking its fetch path and reaching the network.
  ( cd "$T/repo" && git rev-parse HEAD ) | tr -d '\n' > "$T/fix/head"
  # forge-8vfn.7.6.130's PINNED-PATH-GAINED-SINCE-GATE check reads
  # `refs/remotes/parsoFish/main` in `$REPO_FOR_CAPS` (three-dot, from main's
  # side). A world that never sets it still needs the ref to RESOLVE — so it
  # defaults to the same base commit, i.e. "main has not moved since the gate".
  # Doors that need main to have moved update this ref themselves afterward.
  ( cd "$T/repo" && git update-ref refs/remotes/parsoFish/main HEAD ) >/dev/null 2>&1

  cat > "$T/bin/gh" <<'STUB'
#!/usr/bin/env bash
# A `gh` that replays what the fixture says and RECORDS what it was asked.
# It answers only the calls merge-slot.sh makes and dies loudly on anything
# else: a door must never pass because a call silently returned empty.
set -u
FIX="${MERGE_SLOT_FIXTURE:?}"
printf '%s\n' "$*" >> "$FIX/gh-calls"
n() { cat "$FIX/$1" 2>/dev/null; }
case "$1 $2" in "auth token") echo "gh-stub-token"; exit 0 ;; esac
case "$*" in
  "pr view "*" --json headRefOid --jq .headRefOid") n head; exit 0 ;;
  "api repos/parsoFish/forge-studio/pulls/"*"/files --paginate --jq .[] | [.filename, (.previous_filename // \"\")] | @tsv") n files || exit 22; exit 0 ;;
  "pr view "*" --json changedFiles --jq .changedFiles") n changedFiles || exit 22; exit 0 ;;
  "api repos/parsoFish/forge-studio/commits/main --jq .sha")
      # Main can MOVE between reads — the capture is inside the update-branch
      # slot and the re-read inside the merge slot, so the healthy shape needs a
      # real move between the two. An exhausted sequence is an ERROR, never a
      # fallback: a door whose script ran short must not quietly become a
      # different door.
      if [ -s "$FIX/main_seq" ]; then
        line="$(head -1 "$FIX/main_seq")"
        [ -n "$line" ] || { echo "gh-stub: main_seq exhausted" >&2; exit 96; }
        sed -i 1d "$FIX/main_seq"; printf '%s' "$line"; exit 0
      fi
      n main; exit 0 ;;
  "api repos/parsoFish/forge-studio/commits/"*" --jq .parents[1].sha // .parents[0].sha")
      n parents; exit 0 ;;
  "pr view "*" --json mergeStateStatus --jq .mergeStateStatus")
      # forge-8vfn.8.1.26: a sequence, like main_seq above, so a world can prove
      # UNKNOWN-then-settled without a second stub. `merge_state_fail` answers
      # the "gh itself failed" door with a genuine non-zero exit and no stdout —
      # never a fabricated string. UNSET DEFAULTS TO CLEAN, so every door that
      # predates this bead and never mentions merge state sees exactly what it
      # saw before.
      if [ -f "$FIX/merge_state_fail" ]; then exit 12; fi
      if [ -s "$FIX/merge_state_seq" ]; then
        line="$(head -1 "$FIX/merge_state_seq")"
        [ -n "$line" ] || { echo "gh-stub: merge_state_seq exhausted" >&2; exit 96; }
        sed -i 1d "$FIX/merge_state_seq"; printf '%s' "$line"; exit 0
      fi
      if [ -s "$FIX/merge_state" ]; then n merge_state; else printf 'CLEAN'; fi
      exit 0 ;;
  "pr update-branch "*) if [ -f "$FIX/ub_conflict" ]; then echo "X Cannot update PR branch due to conflicts"; exit 1; fi; echo "✓ PR branch updated"; exit 0 ;;
  "pr view "*" --json state,mergedAt,mergeCommit"*)
      # `force_open_after_merge` is a doors-only override (forge-8vfn.7.6.145):
      # `gh pr merge` can say rc=0 and STILL not have landed — the closing
      # re-derivation is what merge-slot.sh now trusts, never the rc alone.
      if [ -f "$FIX/force_open_after_merge" ]; then printf 'STATE=OPEN MERGE_SHA=null'
      elif [ -s "$FIX/merges" ]; then printf 'STATE=MERGED MERGE_SHA=%s' "$(n head)"
      else printf 'STATE=OPEN MERGE_SHA=null'; fi; exit 0 ;;
  "pr merge "*" --merge") if [ -f "$FIX/merge_fails" ]; then echo "GraphQL: Base branch was modified (mergePullRequest)"; exit 1; fi; echo merged >> "$FIX/merges"; n merge_out; exit 0 ;;
esac
echo "gh-stub: UNEXPECTED CALL: $*" >&2
exit 97
STUB
  cat > "$T/bin/ci-terminal" <<'STUB'
#!/usr/bin/env bash
set -u
echo "TERMINAL_SUCCESS 4/4 ${3:0:8}"
exit 0
STUB
  chmod +x "$T/bin/gh" "$T/bin/ci-terminal"
  echo "$T"
}

run() {                          # run <world> -> the script's own OUT log; sets $RC
  local T="$1"
  MERGE_SLOT_FIXTURE="$T/fix" MERGE_SLOT_LOCK="$T/lock" \
  MERGE_SLOT_REPO_FOR_CAPS="$T/repo" MERGE_SLOT_CI_TERMINAL="$T/bin/ci-terminal" \
  MERGE_SLOT_CAMPAIGN_DIR="$T/campaign" \
  PIN_GATE_LOG=none PATH="$T/bin:$PATH" \
    timeout 180 bash "$MS" 999 "$T/out.log" >/dev/null 2>&1
  RC=$?
  cat "$T/out.log"
}
moved()    { grep -c 'MAIN-MOVED' "$1"; }
attempts() { grep -c '=== attempt' "$1"; }

# Like run(), but with an explicit gate log (PIN_GATE_LOG) rather than "none" —
# shared by merge-slot-doors-gate.sh (the gate-log marker and ALONE-RERUN
# doors, its own reason for existing) and merge-slot-doors-pin-since-gate.sh's
# GATE-CHECKOUT-UNREAD door (forge-8vfn.7.6.130 #5), which needs a gate log
# with a verdict but no GATE_CHECKOUT= line — the same runner, two concerns.
run_with_log() {              # run_with_log <world> <gate-log> -> the script's own OUT log; sets $RC
  local T="$1" LOG="$2"
  MERGE_SLOT_FIXTURE="$T/fix" MERGE_SLOT_LOCK="$T/lock" \
  MERGE_SLOT_REPO_FOR_CAPS="$T/repo" MERGE_SLOT_CI_TERMINAL="$T/bin/ci-terminal" \
  MERGE_SLOT_CAMPAIGN_DIR="$T/campaign" \
  PIN_GATE_LOG="$LOG" PATH="$T/bin:$PATH" \
    timeout 180 bash "$MS" 999 "$T/out.log" >/dev/null 2>&1
  RC=$?
  cat "$T/out.log"
}
