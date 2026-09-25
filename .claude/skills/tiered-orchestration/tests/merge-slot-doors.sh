#!/usr/bin/env bash
# merge-slot-doors.sh — the doors for `merge-slot.sh`'s MAIN_AT capture
# (`forge-8vfn.7.6.111`, T1 1040/1041). Re-runnable, non-zero on drift.
#
# WHAT IS UNDER TEST. `merge-slot.sh` used to DERIVE the base a green was
# measured on: `base_of` read `.parents[1].sha // .parents[0].sha` of the tested
# head. That holds for ONE `gh pr update-branch` and fails at the second merge
# shape — a lane that merged main itself, which T1's 1021/1028 now makes every
# lane do — because then `parents[1]` is a BRANCH commit. `now = BASE` can never
# be true, MAIN-MOVED fires for a race that does not exist, the loop burns all
# three attempts and the third HOLDS the slot across a CI wait. The fix records
# main's sha inside the update-branch slot instead.
#
# THE THREE SHAPES ARE REAL TRACES, not invented cases:
#   T1's  #755  branch-side parents[1], main unchanged   -> must STOP firing
#   D's   #754  update-branch head, main really moved    -> must STILL fire
#   D's   #758  wrapper-merged head, main unchanged      -> must NOT fire
# The middle one is the reason this file exists in the shape it does: a fix
# validated only by "MAIN-MOVED stopped firing" would look green while having
# deleted the 550 guard that saved #754 twice.
#
# WHY IT NEEDS A TEST SEAM, and why the seam is three env reads rather than a
# rewrite. `merge-slot.sh` took the REAL `.merge-slot`, cloned the REAL repo and
# ran the REAL `ci-terminal.sh`, so it could not be exercised without taking the
# live merge slot — the hazard `forge-8vfn.7.6.90` exists to prevent. Precedent:
# `gate.sh` takes `FORGE_PROC_LOCKS`, `save-instrument.sh` takes
# `SAVE_INSTRUMENT_PROCDIR` / `SAVE_INSTRUMENT_LOCK`. Defaults are the
# production paths, so an unset environment behaves exactly as before.
#
# `PIN_GATE_LOG=none` is NOT a test hook — it is the documented declaration from
# §15.434, used here for what it means: this run has no pin precondition.
set -u
# SKILL-COPY MOVE (M7 findings row 37): `merge-slot.sh` ships as this file's
# own sibling now — `.claude/skills/tiered-orchestration/scripts/merge-slot.sh`
# — so the default resolves relative to THIS file's own location rather than
# naming the campaign directory it used to live beside. `_1.0/` is gitignored
# campaign state (CLAUDE.md); a committed file cannot cite a path inside it —
# and a self-location the doors could not resolve in CI would make this suite
# skip forever, which is a gate that never runs, not a green one.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MS="${MS:-$HERE/../scripts/merge-slot.sh}"

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
SUBJECT_SHA="${SUBJECT_SHA:-df8b875ddb789b77}"
subject_now="$(sha256sum "$MS" 2>/dev/null | cut -c1-16)"
if [ "$subject_now" != "$SUBJECT_SHA" ]; then
  printf 'merge-slot-doors: REFUSING — %s is %s, these doors were proven against %s.\n' \
    "$MS" "${subject_now:-UNREADABLE}" "$SUBJECT_SHA"
  printf '  Not a pass (they did not run) and not a failure (nothing is known broken): UNKNOWN.\n'
  printf '  Either the subject moved and this file owes the same edit, or a paired save landed half.\n'
  exit 2
fi

# EVERY SLEEP INTERVAL merge-slot.sh SUPPORTS, ZEROED (M7 findings row 37).
# 31 shapes through the real production intervals (12s+8s minimum per attempt,
# up to three attempts) would cost minutes `npm test` does not have to spend;
# these numbers are a courtesy to GitHub's own API, not a correctness
# requirement the fake `gh`/`ci-terminal` stubs below need. Exported ONCE, so
# every `bash "$MS"` call in this file inherits them — the fixture campaign
# dir (below) still varies per world and is set at each call site.
export MERGE_SLOT_HEAD_RETRY_SLEEP_SECS=0
export MERGE_SLOT_POST_UPDATE_SLEEP_SECS=0
export MERGE_SLOT_MAIN_MOVED_RETRY_SLEEP_SECS=0
export MERGE_SLOT_MERGE_RETRY_SLEEP_SECS=0
export MERGE_SLOT_FINAL_SETTLE_SLEEP_SECS=0

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
  # ALONE-RERUN waiver doors (7.6.89, below) match against — the same path they
  # have always named — so those doors stay self-contained rather than reading
  # whatever the live register happens to hold today.
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

echo "forge-8vfn.7.6.111 — MAIN_AT is RECORDED, not derived"

# 1. T1's #755: parents[1] is a branch-side merge and MAIN NEVER MOVES.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"; run "$T" > "$T/log"
if [ "$(moved "$T/log")" = 0 ] && [ "$(attempts "$T/log")" = 1 ] && [ -s "$T/fix/merges" ]; then
  ok "a branch-side parents[1] no longer trips MAIN-MOVED when main is unchanged (one attempt, merged)"
else
  bad "#755 shape" "MAIN-MOVED=$(moved "$T/log") attempts=$(attempts "$T/log") merged=$([ -s "$T/fix/merges" ] && echo y || echo n)"
fi
rm -rf "$T"

# 2. D's #754: main REALLY moves between the capture and the merge re-read. The
#    guard must still fire, and the next attempt must recapture and merge.
# `parents` is the FIRST main sha, not a placeholder: this shape is the head
# `gh pr update-branch` built, so its second parent really IS main. A first
# draft passed "ignored" here, which made the OLD code refuse `BASE-UNREAD`
# before attempt 1 — red against the unfixed script for a reason that had
# nothing to do with the guard, and a red like that is worth less than no red.
#
# THIS DOOR IS FORWARD-ONLY AND CANNOT BE RED-FIRST COMPARED. I predicted it
# would be green against the unfixed script too, as a preserved-behaviour door,
# and MEASURED THAT WRONG TWICE. The cause is structural, not a fixture nit:
# the sequence below is consumed one entry per `commits/main` call, and the two
# scripts make DIFFERENT NUMBERS OF THEM — the fix reads main twice an attempt
# (capture, then re-read), the old code once (re-read only). So the old code
# takes `aaaa0000` as its re-read, finds it equal to the base it derived from
# `parents`, and merges at once with MAIN-MOVED=0. "Main moved between the
# capture and the re-read" is not expressible against a script that has no
# capture. What this door is FOR is unchanged and is the reason it exists: on
# the fix, it is the only thing stopping the other three being satisfied by a
# change that simply never fires.
T="$(world aaaa0000aaaa0000 ignored aaaa0000aaaa0000 bbbb0000bbbb0000 bbbb0000bbbb0000 bbbb0000bbbb0000 bbbb0000bbbb0000 bbbb0000bbbb0000)"
run "$T" > "$T/log"
if [ "$(moved "$T/log")" = 1 ] \
   && grep -q 'MAIN-MOVED aaaa0000aaaa0000 -> bbbb0000bbbb0000' "$T/log" \
   && grep -q 'MAIN_AT=bbbb0000bbbb0000' "$T/log" && [ -s "$T/fix/merges" ]; then
  ok "a REAL move still trips MAIN-MOVED, and the next attempt recaptures and merges (550 intact)"
else
  bad "#754 shape" "MAIN-MOVED=$(moved "$T/log") $(grep -m1 'MAIN-MOVED' "$T/log")"
fi
rm -rf "$T"

# 3. The derivation is GONE, not merely unused. A fallback that is never
#    consulted is still a second wrong answer waiting for a caller.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"; run "$T" >/dev/null
if [ "$(grep -c 'parents' "$T/fix/gh-calls")" = 0 ]; then
  ok "the head's parents are never asked for — base_of and its // fallback are gone"
else
  bad "parents still read" "$(grep -c 'parents' "$T/fix/gh-calls") call(s): $(grep -m1 parents "$T/fix/gh-calls")"
fi
rm -rf "$T"

# 4. A FAILED CAPTURE REFUSES, with its OWN word. `MAIN-UNREAD` already means
#    "the re-read inside the merge slot failed"; two causes under one word is
#    the species this campaign keeps paying for.
#
#    THIS DOOR FOUND A SECOND DEFECT WHILE BEING WRONG ABOUT ITS OWN REASON.
#    Against the unfixed script this world reaches the merge slot, fails the
#    re-read, prints `MAIN-UNREAD` — and then reports `RESULT=HEAD-CHANGED`,
#    because the case folded `HEAD-MOVED|HEAD-UNREAD|MAIN-UNREAD` into one word.
#    So the door's red was real and ATTRIBUTABLE TO THE WRONG THING. C ruled it
#    folded into this bead rather than deferred, on the argument that makes it
#    more than tidiness: leaving it would leave this door's own red-first result
#    contaminated — right that the old code refuses, wrong about why, and
#    correctable only in prose. `MAIN-UNREAD` now has its own result word; the
#    two HEAD causes keep the shared one, being one fact.
T="$(world deadbeefdeadbeef "")"; run "$T" > "$T/log"
if grep -q 'RESULT=MAIN_AT-UNREAD' "$T/log" \
   && ! grep -q 'RESULT=MAIN-UNREAD' "$T/log" \
   && [ ! -s "$T/fix/merges" ]; then
  ok "an unreadable capture REFUSES as MAIN_AT-UNREAD and merges nothing (not MAIN-UNREAD)"
else
  bad "capture failure" "$(grep -m1 'MARKER=done' "$T/log") merged=$([ -s "$T/fix/merges" ] && echo y || echo n)"
fi
rm -rf "$T"

# 5. THE NEIGHBOURING WORD, folded in under C's ruling. The CAPTURE succeeds and
#    the merge slot's RE-READ fails: that is a third distinct cause, and before
#    this bead it reported `RESULT=HEAD-CHANGED` — "I could not read main" told
#    to the operator as "the head changed", a thing that did not happen stated
#    as fact. Without this door the new word is an unasserted claim, and door 4
#    cannot tell it apart from the capture failing.
T="$(world aaaa0000aaaa0000 ignored aaaa0000aaaa0000 "")"; run "$T" > "$T/log"
if grep -q 'RESULT=MAIN-UNREAD' "$T/log" \
   && ! grep -q 'RESULT=HEAD-CHANGED' "$T/log" \
   && ! grep -q 'RESULT=MAIN_AT-UNREAD' "$T/log" \
   && [ ! -s "$T/fix/merges" ]; then
  ok "a failed RE-READ says MAIN-UNREAD — not HEAD-CHANGED, and not the capture's word"
else
  bad "re-read failure" "$(grep -m1 'MARKER=done' "$T/log") merged=$([ -s "$T/fix/merges" ] && echo y || echo n)"
fi
rm -rf "$T"

echo "T1 1104 / #778 — a gate log WITHOUT GATE_SH_EXIT= is UNKNOWN, not not-red"
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
# 1. A pre-#778 log: 20 PASS rows, no FAIL, no marker. Before, this read as a
#    clean gate; now it is refused by name and nothing is merged.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
printf 'PASS  npm run build  (30s)\nPASS  npm test  (98s)\nPIN_SIBLING_STALE_COUNT=0\n' > "$T/gate.log"
run_with_log "$T" "$T/gate.log" > "$T/log"
if grep -q 'RESULT=GATE-EXIT-UNREAD' "$T/log" && [ ! -s "$T/fix/merges" ] && [ "$(attempts "$T/log")" = 0 ]; then
  ok "a gate log with no GATE_SH_EXIT= line is REFUSED as GATE-EXIT-UNREAD before any attempt, nothing merged"
else
  bad "marker absent" "$(grep -m1 'MARKER=done' "$T/log") attempts=$(attempts "$T/log") merged=$([ -s "$T/fix/merges" ] && echo y || echo n)"
fi
rm -rf "$T"
# 2. CONTROL: the same log WITH the marker proceeds past the check into attempt 1.
# GATE_CHECKOUT= is the base commit `world` already points parsoFish/main at,
# so forge-8vfn.7.6.130's pinned-path-since-gate check (T1 1121, below) sees
# nothing gained and is not what stops this control.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
printf 'PASS  npm run build  (30s)\nPASS  npm test  (98s)\nPIN_SIBLING_STALE_COUNT=0\nGATE_SH_EXIT=0\nGATE_CHECKOUT=%s\n' "$(cat "$T/fix/head")" > "$T/gate.log"
run_with_log "$T" "$T/gate.log" > "$T/log"
# The fixture's `gh` answers no `pr diff`, so the run cannot get PAST the pin
# precheck; what this control proves is ORDER — the marker door (and the
# pinned-path-since-gate check behind it) let this through and the NEXT door
# (the precheck) is the one that spoke.
if ! grep -q 'RESULT=GATE-EXIT-UNREAD' "$T/log" \
   && ! grep -q 'RESULT=GATE-CHECKOUT-UNREAD' "$T/log" \
   && ! grep -q 'RESULT=PINNED-PATH-GAINED-SINCE-GATE' "$T/log" \
   && grep -q 'PIN_PRECHECK' "$T/log"; then
  ok "CONTROL: the same log carrying GATE_SH_EXIT=0 (and a GATE_CHECKOUT= main hasn't moved past) reaches the pin precheck"
else
  bad "marker present" "$(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"
# 3. The marker with rc 3 and no FAIL row is still the 699 refusal — this change
#    added a door in front of that one, it did not replace it.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
printf 'PASS  npm run build  (30s)\nREFUSED npm test — run-lock held\nGATE_SH_EXIT=3\n' > "$T/gate.log"
run_with_log "$T" "$T/gate.log" > "$T/log"
if grep -q 'RESULT=GATE-REFUSED-NOT-RED' "$T/log" && [ ! -s "$T/fix/merges" ]; then
  ok "GATE_SH_EXIT=3 with no FAIL row is still GATE-REFUSED-NOT-RED (699 intact behind the new door)"
else
  bad "699 intact" "$(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

echo "forge-8vfn.7.6.89 — the ALONE-RERUN proof is accepted only where gate.sh writes it: before its final GATE_SH_EXIT="
# A register-listed name (known-flakes.md names this file), one FAIL row, gate exit 1.
FLK='scripts/stories/beats-waits.test.ts'
waiver_log() {                # waiver_log <world> <alone-line> <before|after> -> gate log path
  local T="$1" L="$2" where="$3" h; h="$(cat "$T/fix/head")"
  if [ "$where" = before ]; then
    printf 'PASS  npm run build  (30s)\nFAIL  npm test  (98s)\n%s\nPIN_SIBLING_STALE_COUNT=0\nGATE_CHECKOUT=%s\nGATE_SH_EXIT=1\n' "$L" "$h" > "$T/gate.log"
  else
    printf 'PASS  npm run build  (30s)\nFAIL  npm test  (98s)\nPIN_SIBLING_STALE_COUNT=0\nGATE_CHECKOUT=%s\nGATE_SH_EXIT=1\n%s\n' "$h" "$L" > "$T/gate.log"
  fi
  echo "$T/gate.log"
}
# 1. gate.sh's own line (inside the run, before GATE_SH_EXIT=) -> waived, reaches the pin precheck.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
GATE_RED_NAMED="$FLK" run_with_log "$T" "$(waiver_log "$T" "ALONE-RERUN $FLK 3/3" before)" > "$T/log"
if grep -q "GATE-RED-WAIVED: $FLK — alone-rerun PERFORMED by gate.sh" "$T/log" && ! grep -q 'RESULT=GATE-RED' "$T/log" && grep -q 'PIN_PRECHECK' "$T/log"; then
  ok "a gate-written ALONE-RERUN k/k before GATE_SH_EXIT= waives the single named red and reaches the precheck"
else
  bad "gate-written waiver" "$(grep -m1 -E 'MARKER=done|GATE-RED' "$T/log")"
fi
rm -rf "$T"
# 2. The SAME line appended after GATE_SH_EXIT= (a hand, after the run) -> refused by name, nothing merged.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
GATE_RED_NAMED="$FLK" run_with_log "$T" "$(waiver_log "$T" "ALONE-RERUN $FLK 3/3" after)" > "$T/log"
if grep -q 'RESULT=GATE-RED-ALONE-PROOF-NOT-GATE-WRITTEN' "$T/log" && [ ! -s "$T/fix/merges" ] && [ "$RC" = 10 ]; then
  ok "an ALONE-RERUN line after the final GATE_SH_EXIT= is refused rc 10, GATE-RED-ALONE-PROOF-NOT-GATE-WRITTEN, nothing merged"
else
  bad "hand-appended line" "rc=$RC $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"
# 3. gate.sh's own FAILED rerun (j/k FAILED) is no proof -> refused, nothing merged.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
GATE_RED_NAMED="$FLK" run_with_log "$T" "$(waiver_log "$T" "ALONE-RERUN $FLK 2/3 FAILED" before)" > "$T/log"
if grep -q 'RESULT=GATE-RED-NO-ALONE-PROOF' "$T/log" && [ ! -s "$T/fix/merges" ]; then
  ok "a gate-written ALONE-RERUN j/k FAILED is refused as GATE-RED-NO-ALONE-PROOF, nothing merged"
else
  bad "failed rerun" "$(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

echo "T1 1275 — update-branch conflicts refuse by name; a rename's source path is in the changed set"
# 1. update-branch cannot merge main in -> rc 17 UPDATE-BRANCH-CONFLICT, before any CI wait, nothing merged.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
: > "$T/fix/ub_conflict"
cat > "$T/bin/ci-terminal" <<'STUB'
#!/usr/bin/env bash
echo waited >> "${MERGE_SLOT_FIXTURE:?}/ci-waits"; echo "TERMINAL_SUCCESS 4/4 ${3:0:8}"
STUB
chmod +x "$T/bin/ci-terminal"
run "$T" > "$T/log"
if grep -q 'RESULT=UPDATE-BRANCH-CONFLICT' "$T/log" && [ "$RC" = 17 ] && [ ! -s "$T/fix/merges" ] && [ ! -s "$T/fix/ci-waits" ]; then
  ok "a conflicting update-branch refuses rc 17, UPDATE-BRANCH-CONFLICT, with no CI wait and nothing merged"
else
  bad "update-branch conflict" "rc=$RC ci-waits=$([ -s "$T/fix/ci-waits" ] && echo y || echo n) $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"
# 2. CONTROL: the same world without the conflict reaches the CI wait (the door above is not merely "never waits").
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
cat > "$T/bin/ci-terminal" <<'STUB'
#!/usr/bin/env bash
echo waited >> "${MERGE_SLOT_FIXTURE:?}/ci-waits"; echo "TERMINAL_SUCCESS 4/4 ${3:0:8}"
STUB
chmod +x "$T/bin/ci-terminal"
run "$T" > "$T/log"
if ! grep -q 'UPDATE-BRANCH-CONFLICT' "$T/log" && [ -s "$T/fix/ci-waits" ]; then
  ok "CONTROL: a clean update-branch proceeds to the CI wait"
else
  bad "update-branch control" "rc=$RC $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"
# 3. A rename row (new<TAB>old) counts once against changedFiles and yields BOTH paths.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
printf 'src/moved.ts\tsrc/a.ts\nREADME.md\t\n' > "$T/fix/files"; printf '2' > "$T/fix/changedFiles"
out="$(MERGE_SLOT_CHANGED_ONLY=1 MERGE_SLOT_FIXTURE="$T/fix" MERGE_SLOT_CAMPAIGN_DIR="$T/campaign" PATH="$T/bin:$PATH" bash "$MS" 999 "$T/unused.log" 2>/dev/null)"; r=$?
if [ "$r" = 0 ] && printf '%s\n' "$out" | grep -qx 'src/a.ts' && printf '%s\n' "$out" | grep -qx 'src/moved.ts' && printf '%s\n' "$out" | grep -qx 'README.md' && [ "$(printf '%s\n' "$out" | grep -c .)" = 3 ]; then
  ok "a rename's previous_filename joins the changed set (3 paths from 2 rows, count checked on rows)"
else
  bad "rename source" "rc=$r out=$(printf '%s' "$out" | tr '\n' ' ')"
fi
rm -rf "$T"

echo "forge-8vfn.7.6.138 — an existing <out> is refused, never truncated"
# 1. A non-empty <out> from another run: refused before the first write, bytes untouched.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
printf 'MERGE-SLOT pid=1 cwd=/x pr=781 started=then\nSTATE=MERGED mergedAt=then MERGE_SHA=3d61c42e\n' > "$T/out.log"
before=$(sha256sum "$T/out.log" | cut -c1-16)
err=$( MERGE_SLOT_FIXTURE="$T/fix" MERGE_SLOT_LOCK="$T/lock" MERGE_SLOT_REPO_FOR_CAPS="$T/repo" MERGE_SLOT_CI_TERMINAL="$T/bin/ci-terminal" MERGE_SLOT_CAMPAIGN_DIR="$T/campaign" PIN_GATE_LOG=none PATH="$T/bin:$PATH" timeout 60 bash "$MS" 999 "$T/out.log" 2>&1 >/dev/null ); rc=$?
after=$(sha256sum "$T/out.log" | cut -c1-16)
if [ "$rc" = 2 ] && printf '%s' "$err" | grep -q 'RESULT=OUT-EXISTS' && [ "$before" = "$after" ] && [ ! -s "$T/fix/merges" ]; then
  ok "an existing non-empty <out> is refused as OUT-EXISTS, rc 2, bytes identical, nothing merged"
else
  bad "out exists" "rc=$rc before=$before after=$after err=$(printf '%s' "$err" | head -1 | cut -c1-120)"
fi
rm -rf "$T"
# 2. CONTROL: an ABSENT <out> proceeds exactly as before (the whole file above is that control), and an
#    explicit MERGE_SLOT_OVERWRITE_OUT=1 gets past the refusal.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
printf 'stale\n' > "$T/out.log"
MERGE_SLOT_OVERWRITE_OUT=1 MERGE_SLOT_FIXTURE="$T/fix" MERGE_SLOT_LOCK="$T/lock" MERGE_SLOT_REPO_FOR_CAPS="$T/repo" MERGE_SLOT_CI_TERMINAL="$T/bin/ci-terminal" MERGE_SLOT_CAMPAIGN_DIR="$T/campaign" PIN_GATE_LOG=none PATH="$T/bin:$PATH" timeout 180 bash "$MS" 999 "$T/out.log" >/dev/null 2>&1
if ! grep -q '^stale$' "$T/out.log" && grep -q '^MERGE-SLOT pid=' "$T/out.log"; then
  ok "CONTROL: MERGE_SLOT_OVERWRITE_OUT=1 is the explicit way past — the stale line is gone and the run wrote its own header"
else
  bad "overwrite control" "$(head -2 "$T/out.log" | tr '\n' ' ' | cut -c1-120)"
fi
rm -rf "$T"

echo "forge-8vfn.7.6.145 — the changed set comes from the List-files API, cross-checked against changedFiles"
q() {  # q <world> -> stdout of the CHANGED_ONLY verb; rc in $?
  local T="$1"
  MERGE_SLOT_CHANGED_ONLY=1 MERGE_SLOT_FIXTURE="$T/fix" MERGE_SLOT_CAMPAIGN_DIR="$T/campaign" PATH="$T/bin:$PATH" timeout 60 bash "$MS" 999 "$T/unused.log" 2>&1
}
# 1. 315 paths, changedFiles 315 — past gh pr diff's 300 cap — complete, rc 0, every path printed, <out> untouched.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"; seq 1 315 | sed 's|^|demos/e2e/f|' > "$T/fix/files"; echo 315 > "$T/fix/changedFiles"
out=$(q "$T"); rc=$?
if [ "$rc" = 0 ] && [ "$(printf '%s\n' "$out" | grep -c .)" = 315 ] && [ ! -e "$T/unused.log" ]; then
  ok "315 files with changedFiles=315 -> complete set, rc 0, 315 paths, <out> not written"
else
  bad "complete set" "rc=$rc lines=$(printf '%s\n' "$out" | grep -c .) out-exists=$([ -e "$T/unused.log" ] && echo y || echo n)"
fi
rm -rf "$T"
# 2. a pagination that stopped short: 300 paths but the PR says 315 -> INCOMPLETE, rc 2, both counts named.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"; seq 1 300 | sed 's|^|demos/e2e/f|' > "$T/fix/files"; echo 315 > "$T/fix/changedFiles"
out=$(q "$T"); rc=$?
if [ "$rc" = 2 ] && printf '%s' "$out" | grep -q 'CHANGED-SET-INCOMPLETE' && printf '%s' "$out" | grep -q '300 path' && printf '%s' "$out" | grep -q '315 changed'; then
  ok "300 of 315 -> CHANGED-SET-INCOMPLETE, rc 2, both counts named (a partial set fails like an empty one)"
else
  bad "incomplete set" "rc=$rc out=$(printf '%s' "$out" | head -1 | cut -c1-140)"
fi
rm -rf "$T"
# 3. gh cannot answer at all (no fixture) -> UNREADABLE, rc 1.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
out=$(q "$T"); rc=$?
if [ "$rc" = 1 ] && printf '%s' "$out" | grep -q 'CHANGED-SET-UNREADABLE'; then
  ok "gh failing -> CHANGED-SET-UNREADABLE, rc 1"
else
  bad "unreadable set" "rc=$rc out=$(printf '%s' "$out" | head -1 | cut -c1-140)"
fi
rm -rf "$T"

echo "forge-8vfn.7.6.130 — has main gained a PINNED path since the gate's own GATE_CHECKOUT?"
# A dedicated world: on top of `world`'s repo (base commit has the two caps
# scripts), add a pinned file and an unpinned file, then branch `parsoFish/main`
# away from the gate's own checkout so the three shapes below are real git
# history, not stubbed text — same instinct as `m6-d-merge-preflight-doors.sh`,
# whose logic this reuses rather than reinvents.
#
#   touch=pinned/unpinned/none — what main's OWN advance (beyond the gate's
#     checkout) touches.
#   own=0/1 — whether the PR's OWN branch (the gate's checkout) itself also
#     touched the pinned file, beyond what main has. Real only when `own=1`.
#   changed... — this PR's OWN changed set (forge-8vfn.7.6.130's amendment: the
#     gained-path loop now runs AFTER the changed set, and a gained pinned path
#     refuses only when it is ALSO in this set — "gained AND touched").
pin_since_gate_world() {              # pin_since_gate_world <touch> <own> <changed...> -> world dir
  local touch="$1" own="$2"; shift 2
  local T; T="$(world deadbeefdeadbeef cafe1111cafe1111)"
  mkdir -p "$T/manifests"
  ( cd "$T/repo" && printf 'base\n' > pinned.txt && printf 'base\n' > unpinned.txt \
    && git add -A && git commit -qm "add pin fixtures" ) >/dev/null 2>&1
  local BASE; BASE="$(git -C "$T/repo" rev-parse HEAD)"
  if [ "$own" = 1 ]; then
    ( cd "$T/repo" && printf 'my own change\n' > pinned.txt && git add -A && git commit -qm "PR's own change to pinned.txt" ) >/dev/null 2>&1
  fi
  local GATE_SHA; GATE_SHA="$(git -C "$T/repo" rev-parse HEAD)"
  case "$touch" in
    pinned)   ( cd "$T/repo" && git checkout -q -b mainline "$BASE" && printf 'moved by a sibling\n' > pinned.txt && git add -A && git commit -qm "sibling moves pinned.txt" ) >/dev/null 2>&1 ;;
    unpinned) ( cd "$T/repo" && git checkout -q -b mainline "$BASE" && printf 'moved by a sibling\n' > unpinned.txt && git add -A && git commit -qm "sibling moves unpinned.txt" ) >/dev/null 2>&1 ;;
    none)     ( cd "$T/repo" && git branch -q mainline "$BASE" ) >/dev/null 2>&1 ;;
  esac
  local MAIN_SHA; MAIN_SHA="$(git -C "$T/repo" rev-parse mainline)"
  git -C "$T/repo" update-ref refs/remotes/parsoFish/main "$MAIN_SHA"
  ( cd "$T/repo" && git checkout -q "$GATE_SHA" ) >/dev/null 2>&1
  ( cd "$T/repo" && sha256sum pinned.txt ) > "$T/manifests/OWNER.sha256"
  printf 'GATE_CHECKOUT=%s\nPASS  npm test  (1s)\nGATE_SH_EXIT=0\n' "$GATE_SHA" > "$T/gate.log"
  # This PR's OWN changed set — needed FIRST now, since the gained-path loop
  # runs after it and asks "is this path also in here".
  printf '%s\n' "$@" > "$T/fix/files"
  grep -c . "$T/fix/files" > "$T/fix/changedFiles"
  printf '%s' "$T"
}
run_pin_since_gate() {                # run_pin_since_gate <world> -> the script's own OUT log; sets $RC
  local T="$1"
  MERGE_SLOT_FIXTURE="$T/fix" MERGE_SLOT_LOCK="$T/lock" \
  MERGE_SLOT_REPO_FOR_CAPS="$T/repo" MERGE_SLOT_CI_TERMINAL="$T/bin/ci-terminal" \
  MERGE_SLOT_CAMPAIGN_DIR="$T/campaign" \
  MERGE_SLOT_MANIFEST_DIR="$T/manifests" PIN_GATE_LOG="$T/gate.log" PATH="$T/bin:$PATH" \
    timeout 180 bash "$MS" 999 "$T/out.log" >/dev/null 2>&1
  RC=$?
  cat "$T/out.log"
}

# 1. main gained a PINNED path since the gate, AND this PR's own changed set
#    ALSO touches it ("gained AND touched") -> refuse, rc 11, named.
T="$(pin_since_gate_world pinned 0 pinned.txt)"; run_pin_since_gate "$T" > "$T/log"; rc=$RC
if [ "$rc" = 11 ] && grep -q 'RESULT=PINNED-PATH-GAINED-SINCE-GATE' "$T/log" \
   && grep -q 'pinned.txt' "$T/log" && grep -q 'manifest OWNER' "$T/log" && [ ! -s "$T/fix/merges" ]; then
  ok "main gained a pinned path since GATE_CHECKOUT AND this PR touches it -> refuse rc 11, PINNED-PATH-GAINED-SINCE-GATE, named"
else
  bad "pinned gain (touched)" "rc=$rc $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

# 2. main gained a PINNED path since the gate, but this PR does NOT change it
#    -> NOTED, not refused, and the run proceeds past the check (reaches the
#    precheck below). T1 measured FIVE refusals in a row on gain alone before
#    this amendment — every sibling PR touches SOME pinned test under M6-C's
#    globs, so refusing on gain alone refused every merge.
T="$(pin_since_gate_world pinned 0 some_other_file.txt)"; run_pin_since_gate "$T" > "$T/log"; rc=$RC
if ! grep -q 'RESULT=PINNED-PATH-GAINED-SINCE-GATE' "$T/log" \
   && grep -q 'PINNED-PATH-GAINED-SINCE-GATE (noted, not refused) — main gained pinned.txt' "$T/log" \
   && grep -q 'this PR does not change it' "$T/log" \
   && grep -q 'RESULT=PINS-NOT-ACCOUNTED' "$T/log" && [ ! -s "$T/fix/merges" ]; then
  ok "main gained a pinned path this PR does NOT change -> NOTED, not refused, reaches the precheck"
else
  bad "pinned gain (not touched)" "rc=$rc $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

# 3. main gained only an UNPINNED path -> proceeds (falls through to the next
#    check; never even reaches `pinned_owner`, so no note either — the point
#    is ONLY that PINNED-PATH-GAINED-SINCE-GATE never fires).
T="$(pin_since_gate_world unpinned 0 some_other_file.txt)"; run_pin_since_gate "$T" > "$T/log"; rc=$RC
if ! grep -q 'RESULT=PINNED-PATH-GAINED-SINCE-GATE' "$T/log" \
   && ! grep -q '(noted, not refused)' "$T/log" \
   && grep -q 'pinned-path-since-gate: 1 path' "$T/log"; then
  ok "main gained only unpinned paths -> proceeds past the pinned-path check"
else
  bad "unpinned gain" "rc=$rc $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

# 4. THE PR's OWN change to the pinned path (present on the gate's checkout,
#    absent from main's gain) must NOT trigger — the load-bearing property
#    three-dot exists for. A two-dot diff would see this as "main gained
#    pinned.txt" and refuse every merge that touches a pinned file.
T="$(pin_since_gate_world none 1 pinned.txt)"; run_pin_since_gate "$T" > "$T/log"; rc=$RC
if ! grep -q 'RESULT=PINNED-PATH-GAINED-SINCE-GATE' "$T/log" \
   && ! grep -q '(noted, not refused)' "$T/log" \
   && grep -q 'pinned-path-since-gate: 0 path' "$T/log"; then
  ok "the PR's OWN pinned change does not make its own gate stale (three-dot, not two)"
else
  bad "own change" "rc=$rc $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

# 5. A gate log with a real verdict but NO GATE_CHECKOUT= line refuses rather
#    than skip — rc 10, GATE-CHECKOUT-UNREAD.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
printf 'PASS  npm test  (1s)\nGATE_SH_EXIT=0\n' > "$T/gate.log"
run_with_log "$T" "$T/gate.log" > "$T/log"; rc=$RC
if [ "$rc" = 10 ] && grep -q 'RESULT=GATE-CHECKOUT-UNREAD' "$T/log" && [ ! -s "$T/fix/merges" ]; then
  ok "a gate log with a verdict but no GATE_CHECKOUT= line refuses rc 10, GATE-CHECKOUT-UNREAD, rather than skip"
else
  bad "GATE-CHECKOUT-UNREAD" "rc=$rc $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

echo "forge-8vfn.7.6.145 — every refusal owns its OWN class's exit code, and rc=0 is earned only at STATE=MERGED"

# rc 12 — CI-NOT-GREEN at the plain (non-held) site.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
printf '#!/usr/bin/env bash\nexit 9\n' > "$T/bin/ci-terminal"; chmod +x "$T/bin/ci-terminal"
run "$T" > "$T/log"; rc=$RC
if [ "$rc" = 12 ] && grep -q 'RESULT=CI-NOT-GREEN' "$T/log" && [ "$(attempts "$T/log")" = 1 ] && [ ! -s "$T/fix/merges" ]; then
  ok "a red CI_TERMINAL refuses rc 12, CI-NOT-GREEN (plain site)"
else
  bad "CI-NOT-GREEN (plain)" "rc=$rc attempts=$(attempts "$T/log")"
fi
rm -rf "$T"

# rc 12 (the OTHER site) — CI-NOT-GREEN under the HELD third attempt. CI is
# green for attempts 1 and 2 (MAIN-MOVED burns them without ever reaching a
# merge) so attempt 3 is genuinely reached, and only THEN does CI_TERMINAL
# fail. Before this bead the held subshell's own exit was discarded — `break`
# ran unconditionally — so this used to fall straight through to the closing
# `gh pr view` with NO refusal at all.
T="$(world aaaa0000aaaa0000 ignored aaaa0000aaaa0000 bbbb0000bbbb0000 bbbb0000bbbb0000 cccc0000cccc0000 cccc0000cccc0000)"
cat > "$T/bin/ci-terminal" <<'STUB'
#!/usr/bin/env bash
set -u
FIX="${MERGE_SLOT_FIXTURE:?}"
CF="$FIX/ci_calls"
n=0; [ -f "$CF" ] && n=$(cat "$CF")
n=$((n+1)); echo "$n" > "$CF"
[ "$n" -lt 3 ] || exit 9
echo "TERMINAL_SUCCESS 4/4 ${3:0:8}"
STUB
chmod +x "$T/bin/ci-terminal"
run "$T" > "$T/log"; rc=$RC
if [ "$rc" = 12 ] && grep -q 'RESULT=CI-NOT-GREEN' "$T/log" && [ "$(attempts "$T/log")" = 3 ] && [ ! -s "$T/fix/merges" ]; then
  ok "a red CI_TERMINAL under the HELD third attempt ALSO refuses rc 12 (used to fall through unrefused)"
else
  bad "CI-NOT-GREEN (held)" "rc=$rc attempts=$(attempts "$T/log") merged=$([ -s "$T/fix/merges" ] && echo y || echo n)"
fi
rm -rf "$T"

# rc 13 — CAP-BREACHED-AT-MERGE: the post-update head fails check-file-size.mjs.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
( cd "$T/repo" && printf 'process.exit(1);\n' > scripts/check-file-size.mjs && git add -A && git commit -qm "breach" ) >/dev/null 2>&1
( cd "$T/repo" && git rev-parse HEAD ) | tr -d '\n' > "$T/fix/head"
run "$T" > "$T/log"; rc=$RC
if [ "$rc" = 13 ] && grep -q 'RESULT=CAP-BREACHED-AT-MERGE' "$T/log" && [ ! -s "$T/fix/merges" ]; then
  ok "a cap breach on the post-update head refuses rc 13, CAP-BREACHED-AT-MERGE"
else
  bad "CAP-BREACHED" "rc=$rc $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

# rc 14 — MAIN_AT-UNREAD: the capture itself cannot be read.
T="$(world deadbeefdeadbeef "")"; run "$T" > "$T/log"; rc=$RC
if [ "$rc" = 14 ] && grep -q 'RESULT=MAIN_AT-UNREAD' "$T/log" && [ ! -s "$T/fix/merges" ]; then
  ok "an unread MAIN_AT capture refuses rc 14, MAIN_AT-UNREAD"
else
  bad "MAIN_AT-UNREAD" "rc=$rc"
fi
rm -rf "$T"

# rc 16 — `gh pr merge` said rc=0, but the closing re-derivation reads
# STATE=OPEN: MERGE-UNVERIFIED, never a silent rc=0.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"; : > "$T/fix/force_open_after_merge"
run "$T" > "$T/log"; rc=$RC
if [ "$rc" = 16 ] && grep -q 'RESULT=MERGE-UNVERIFIED' "$T/log" && grep -q 'STATE=OPEN' "$T/log"; then
  ok "gh pr merge rc=0 with a non-MERGED closing re-derivation refuses rc 16, MERGE-UNVERIFIED"
else
  bad "MERGE-UNVERIFIED" "rc=$rc $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

# rc 0 — the success path is earned, not assumed: only when the closing
# re-derivation itself reads STATE=MERGED.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
run "$T" > "$T/log"; rc=$RC
if [ "$rc" = 0 ] && grep -q 'STATE=MERGED' "$T/log" && [ -s "$T/fix/merges" ]; then
  ok "the success path is rc 0 only when the closing re-derivation reads STATE=MERGED"
else
  bad "success" "rc=$rc $(grep -m1 'STATE=' "$T/log")"
fi
rm -rf "$T"

# rc 15 (STARVED) — the held third attempt is the last one, and a merge that
# fails even there must say STARVED. Attempts 1 and 2 lose to MAIN-MOVED (green
# CI, never a merge), attempt 3 holds the slot, CI is green, and `gh pr merge`
# itself refuses. Before this bead the STARVED line sat at the bottom of the
# loop where attempt 3 (always held, 635) could never reach it: this case fell
# through to the closing re-derivation and no refusal named it.
T="$(world aaaa0000aaaa0000 ignored aaaa0000aaaa0000 bbbb0000bbbb0000 bbbb0000bbbb0000 cccc0000cccc0000 cccc0000cccc0000)"
: > "$T/fix/merge_fails"
run "$T" > "$T/log"; rc=$RC
if [ "$rc" = 15 ] && grep -q 'RESULT=STARVED' "$T/log" && [ "$(attempts "$T/log")" = 3 ] && [ ! -s "$T/fix/merges" ]; then
  ok "a merge refused under the HELD third attempt is STARVED, rc 15 (was unreachable, fell through unnamed)"
else
  bad "STARVED (held merge refused)" "rc=$rc attempts=$(attempts "$T/log") merged=$([ -s "$T/fix/merges" ] && echo y || echo n)"
fi
rm -rf "$T"

printf '\nmerge-slot-doors: %d ok, %d FAILED\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
