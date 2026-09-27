#!/usr/bin/env bash
# merge-slot-doors-merge-state.sh — mergeStateStatus-ordering doors for
# `merge-slot.sh` (forge-8vfn.8.1.26 / T1 1633): mergeStateStatus is read
# FIRST, before any check wait — DIRTY refuses at once, UNKNOWN retries a
# bounded number of times then refuses if it never settles, CLEAN/BLOCKED
# proceed to the existing flow. Split out of the former single-file
# merge-slot-doors.sh by forge-8vfn.8.1.29 / T1 ruling 1649; the shared
# harness (world() fixture, the SUBJECT_SHA/MSP_SHA pins, ok/bad counters)
# lives in the sourced merge-slot-doors-lib.sh — this file holds only the
# doors below.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/merge-slot-doors-lib.sh"

echo "forge-8vfn.8.1.26 (T1 1633) — mergeStateStatus is read FIRST, before any check wait"

# 1. DIRTY refuses immediately with its own rc and reason; no CI wait, no
#    update-branch at all — GitHub runs no checks on a DIRTY head (D's #971,
#    a QUARRY.md conflict), so nothing after this read may run.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
printf 'DIRTY' > "$T/fix/merge_state"
cat > "$T/bin/ci-terminal" <<'STUB'
#!/usr/bin/env bash
echo waited >> "${MERGE_SLOT_FIXTURE:?}/ci-waits"; echo "TERMINAL_SUCCESS 4/4 ${3:0:8}"
STUB
chmod +x "$T/bin/ci-terminal"
run "$T" > "$T/log"; rc=$RC
if [ "$rc" = 18 ] && grep -q 'RESULT=MERGE-STATE-DIRTY' "$T/log" \
   && [ ! -s "$T/fix/ci-waits" ] \
   && ! grep -q 'update-branch' "$T/fix/gh-calls" \
   && [ ! -s "$T/fix/merges" ]; then
  ok "DIRTY refuses rc 18, MERGE-STATE-DIRTY, before update-branch or any CI wait"
else
  bad "DIRTY" "rc=$rc ci-waits=$([ -s "$T/fix/ci-waits" ] && echo y || echo n) $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

# 2. UNKNOWN settling to CLEAN on a later read is not itself a refusal — the
#    bounded retry proceeds once GitHub finishes computing it.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
printf 'UNKNOWN\nCLEAN\n' > "$T/fix/merge_state_seq"
run "$T" > "$T/log"; rc=$RC
if [ "$rc" = 0 ] && grep -q 'mergeStateStatus=CLEAN' "$T/log" && [ -s "$T/fix/merges" ]; then
  ok "UNKNOWN settling to CLEAN on a later read proceeds and merges"
else
  bad "UNKNOWN-then-CLEAN" "rc=$rc $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

# 3. UNKNOWN on every read exhausts the bounded retry and refuses with its own
#    word — never DIRTY's, and never a silent proceed (§6.15: unknown is never
#    a safe default).
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
printf 'UNKNOWN\nUNKNOWN\nUNKNOWN\nUNKNOWN\n' > "$T/fix/merge_state_seq"
run "$T" > "$T/log"; rc=$RC
if [ "$rc" = 19 ] && grep -q 'RESULT=MERGE-STATE-UNKNOWN' "$T/log" \
   && ! grep -q 'update-branch' "$T/fix/gh-calls" && [ ! -s "$T/fix/merges" ]; then
  ok "persistent UNKNOWN refuses rc 19, MERGE-STATE-UNKNOWN, after the bounded retry, nothing merged"
else
  bad "persistent UNKNOWN" "rc=$rc $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

# 4. gh itself fails on every read (mergeStateStatus never comes back at all):
#    an unreadable field is UNKNOWN, never CLEAN — same bounded retry, same
#    refusal, never a proceed.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
: > "$T/fix/merge_state_fail"
run "$T" > "$T/log"; rc=$RC
if [ "$rc" = 19 ] && grep -q 'RESULT=MERGE-STATE-UNKNOWN' "$T/log" \
   && ! grep -q 'update-branch' "$T/fix/gh-calls" && [ ! -s "$T/fix/merges" ]; then
  ok "gh failing to read mergeStateStatus refuses rc 19, MERGE-STATE-UNKNOWN — never proceeds on it"
else
  bad "gh read failure" "rc=$rc $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

# 5. CLEAN reaches the existing flow unchanged, stated explicitly (every door
#    above this bead already relies on this being the unset default).
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
printf 'CLEAN' > "$T/fix/merge_state"
run "$T" > "$T/log"; rc=$RC
if [ "$rc" = 0 ] && grep -q 'mergeStateStatus=CLEAN' "$T/log" && [ -s "$T/fix/merges" ]; then
  ok "CLEAN proceeds to the existing flow and merges"
else
  bad "CLEAN" "rc=$rc $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

# 6. BLOCKED ("checks or reviews pending" — the normal pre-merge state) also
#    reaches the existing flow: update-branch runs, the CI wait runs, it merges.
T="$(world deadbeefdeadbeef cafe1111cafe1111)"
printf 'BLOCKED' > "$T/fix/merge_state"
run "$T" > "$T/log"; rc=$RC
if [ "$rc" = 0 ] && grep -q 'mergeStateStatus=BLOCKED' "$T/log" \
   && grep -q 'update-branch' "$T/fix/gh-calls" && [ -s "$T/fix/merges" ]; then
  ok "BLOCKED (checks/reviews pending) proceeds to the existing flow and merges"
else
  bad "BLOCKED" "rc=$rc $(grep -m1 'MARKER=done' "$T/log")"
fi
rm -rf "$T"

printf '\nmerge-slot-doors: %d ok, %d FAILED\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
