#!/usr/bin/env bash
# merge-slot-doors-out-guard.sh — the <out> refusal doors for `merge-slot.sh`
# (forge-8vfn.7.6.138): an existing, non-empty <out> from another run is
# refused rather than truncated, and MERGE_SLOT_OVERWRITE_OUT=1 is the
# explicit way past. Split out of the former single-file
# merge-slot-doors.sh by forge-8vfn.8.1.29 / T1 ruling 1649; the shared
# harness (world() fixture, the SUBJECT_SHA/MSP_SHA pins, ok/bad counters)
# lives in the sourced merge-slot-doors-lib.sh — this file holds only the
# doors below.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/merge-slot-doors-lib.sh"

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

printf '\nmerge-slot-doors: %d ok, %d FAILED\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
