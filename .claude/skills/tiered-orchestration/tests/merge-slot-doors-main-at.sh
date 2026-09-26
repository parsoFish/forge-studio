#!/usr/bin/env bash
# merge-slot-doors-main-at.sh — MAIN_AT capture / MAIN-MOVED doors for
# `merge-slot.sh` (forge-8vfn.7.6.111, T1 1040/1041). Split out of the former
# single-file merge-slot-doors.sh by forge-8vfn.8.1.29 / T1 ruling 1649; the
# shared harness (world() fixture, the SUBJECT_SHA/MSP_SHA pins, ok/bad
# counters) lives in the sourced merge-slot-doors-lib.sh — this file holds
# only the MAIN_AT / MAIN-MOVED doors below.
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
# `PIN_GATE_LOG=none` is NOT a test hook — it is the documented declaration from
# §15.434, used here for what it means: this run has no pin precondition.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/merge-slot-doors-lib.sh"

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

printf '\nmerge-slot-doors: %d ok, %d FAILED\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
