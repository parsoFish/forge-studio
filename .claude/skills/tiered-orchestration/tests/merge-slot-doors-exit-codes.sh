#!/usr/bin/env bash
# merge-slot-doors-exit-codes.sh — per-class exit code doors for
# `merge-slot.sh` (forge-8vfn.7.6.145): every refusal owns its OWN class's
# exit code (CI-NOT-GREEN at both the plain and HELD-third-attempt sites,
# CAP-BREACHED-AT-MERGE, MAIN_AT-UNREAD, MERGE-UNVERIFIED, STARVED), and rc=0
# is earned only when the closing re-derivation itself reads STATE=MERGED.
# Split out of the former single-file merge-slot-doors.sh by
# forge-8vfn.8.1.29 / T1 ruling 1649; the shared harness (world() fixture,
# the SUBJECT_SHA/MSP_SHA pins, ok/bad counters) lives in the sourced
# merge-slot-doors-lib.sh — this file holds only the doors below.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/merge-slot-doors-lib.sh"

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
