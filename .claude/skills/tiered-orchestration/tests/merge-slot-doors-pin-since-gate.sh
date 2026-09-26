#!/usr/bin/env bash
# merge-slot-doors-pin-since-gate.sh — the pinned-path-since-gate doors for
# `merge-slot.sh` (forge-8vfn.7.6.130): has main gained a PINNED path since
# the gate's own GATE_CHECKOUT, and — the amendment — does THIS PR's own
# changed set also touch it ("gained AND touched", not gain alone). Split
# out of the former single-file merge-slot-doors.sh by forge-8vfn.8.1.29 /
# T1 ruling 1649; the shared harness (world() fixture, the SUBJECT_SHA/
# MSP_SHA pins, ok/bad counters) lives in the sourced
# merge-slot-doors-lib.sh — this file holds only the doors below, plus the
# dedicated `pin_since_gate_world`/`run_pin_since_gate` helpers this concern
# alone needs (real git history on top of `world`'s repo, not stubbed text —
# same instinct as `m6-d-merge-preflight-doors.sh`).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/merge-slot-doors-lib.sh"

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

printf '\nmerge-slot-doors: %d ok, %d FAILED\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
