#!/usr/bin/env bash
# merge-slot-doors-changed-set.sh — the changed-set doors for `merge-slot.sh`
# (forge-8vfn.7.6.145): the CHANGED_ONLY verb reads the changed set from the
# List-files API, cross-checked against `changedFiles` so a stopped-short
# pagination is caught rather than silently truncated. Split out of the
# former single-file merge-slot-doors.sh by forge-8vfn.8.1.29 / T1 ruling
# 1649; the shared harness (world() fixture, the SUBJECT_SHA/MSP_SHA pins,
# ok/bad counters) lives in the sourced merge-slot-doors-lib.sh — this file
# holds only the doors below.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/merge-slot-doors-lib.sh"

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

printf '\nmerge-slot-doors: %d ok, %d FAILED\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
