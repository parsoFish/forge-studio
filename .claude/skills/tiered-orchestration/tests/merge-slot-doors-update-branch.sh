#!/usr/bin/env bash
# merge-slot-doors-update-branch.sh — update-branch doors for `merge-slot.sh`
# (T1 1275): conflicts refuse by name before any CI wait, and a rename row's
# source path counts once toward the changed set. Split out of the former
# single-file merge-slot-doors.sh by forge-8vfn.8.1.29 / T1 ruling 1649; the
# shared harness (world() fixture, the SUBJECT_SHA/MSP_SHA pins, ok/bad
# counters) lives in the sourced merge-slot-doors-lib.sh — this file holds
# only the doors below.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/merge-slot-doors-lib.sh"

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

printf '\nmerge-slot-doors: %d ok, %d FAILED\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
