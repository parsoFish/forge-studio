#!/usr/bin/env bash
# merge-slot-doors-gate.sh — gate-log doors for `merge-slot.sh`: the
# GATE_SH_EXIT= marker (T1 1104 / #778) and the ALONE-RERUN waiver
# (forge-8vfn.7.6.89). Split out of the former single-file
# merge-slot-doors.sh by forge-8vfn.8.1.29 / T1 ruling 1649; the shared
# harness — including `run_with_log()`, the gate-log runner this concern
# needs (also used by merge-slot-doors-pin-since-gate.sh's
# GATE-CHECKOUT-UNREAD door) — lives in the sourced merge-slot-doors-lib.sh.
# This file holds only the doors below.
#
# BOTH CONCERNS SHARE ONE FIXTURE SHAPE (a `PIN_GATE_LOG`-pointed gate.log),
# which is why they are one file rather than two: a marker door and a waiver
# door disagreeing about what "the gate log" means would be the same drift
# risk the shared harness exists to prevent, one level down.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/merge-slot-doors-lib.sh"

echo "T1 1104 / #778 — a gate log WITHOUT GATE_SH_EXIT= is UNKNOWN, not not-red"
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
# so forge-8vfn.7.6.130's pinned-path-since-gate check (T1 1121, in
# merge-slot-doors-pin-since-gate.sh) sees nothing gained and is not what
# stops this control.
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

printf '\nmerge-slot-doors: %d ok, %d FAILED\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
