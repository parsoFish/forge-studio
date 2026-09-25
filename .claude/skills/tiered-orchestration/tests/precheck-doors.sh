#!/usr/bin/env bash
# precheck-doors.sh — the doors for `pin-precheck.sh` (7.6.80 half two) and
# `merge-slot.sh`'s verdict reader (7.6.86). Re-runnable, non-zero on drift.
#
# T1 908(2): a door run once by hand is decoration on the next edit. The
# by-hand transcripts in _1.0/evidence/m6-c-7680-7686-doors/ were the evidence
# at save time; THIS is the thing that keeps them true.
#
# EVERY SHAPE BUILDS ITS OWN FIXTURE. The first by-hand pass reused one campaign
# across shapes and silently mutated it — a later shape rewrote a manifest's
# globs and an earlier one's "regression" then read rc 0 where it wanted rc 2.
# Measuring against a fixture a previous case edited is the same error as
# reconciling a dirty tree, and it produced a false regression report before it
# produced a real one.
set -u
# SKILL-COPY MOVE (M7 findings row 37): `pin-precheck.sh` ships as this file's
# own sibling now — `.claude/skills/tiered-orchestration/scripts/pin-precheck.sh`
# — so the default resolves relative to THIS file's own location rather than
# naming the campaign directory it used to live beside. `_1.0/` is gitignored
# campaign state (CLAUDE.md); a committed file cannot cite a path inside it.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PP="${PP:-$HERE/../scripts/pin-precheck.sh}"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s — %s\n' "$1" "$2"; }

fixture() {                       # -> echoes a fresh campaign+repo root
  local T; T="$(mktemp -d)"
  mkdir -p "$T/camp/gate-manifests" "$T/repo/src"
  echo a > "$T/repo/src/a.ts"; echo b > "$T/repo/src/b.ts"
  local n
  for n in MINE OTHER; do
    (cd "$T/repo" && sha256sum src/a.ts) > "$T/camp/gate-manifests/$n.sha256"
    echo "paths=1 head=deadbeef owner=$n" > "$T/camp/gate-manifests/$n.counts"
    echo 'src/*.ts' > "$T/camp/gate-manifests/$n.globs"
  done
  { echo "== pins =="
    echo "PIN_MANIFESTS=$(sha256sum "$T"/camp/gate-manifests/*.sha256 "$T"/camp/gate-manifests/*.counts | sha256sum | cut -c1-16)"
    for n in MINE OTHER; do
      echo "PIN_MANIFEST $n=$(sha256sum "$T/camp/gate-manifests/$n.sha256" "$T/camp/gate-manifests/$n.counts" | sha256sum | cut -c1-16)"
    done
    echo "MINE.sha256: 0 FAILED of 1 — tree at deadbeef; last verified at deadbeef"
    echo "OTHER.sha256: 0 FAILED of 1 — tree at deadbeef; last verified at deadbeef"
  } > "$T/gate.log"
  echo "$T"
}
move() { echo "paths=1 head=cafe1234 owner=$2" > "$1/camp/gate-manifests/$2.counts"; }
rc_of() { bash "$PP" "$@" >/dev/null 2>&1; echo $?; }

echo "7.6.80 half two — the relevant set"

T="$(fixture)"; move "$T" OTHER; echo README.md > "$T/c.txt"
[ "$(rc_of "$T/gate.log" "$T/repo" "$T/camp" --changed-paths-file "$T/c.txt")" = 0 ] \
  && ok "sibling moved, merge touches nothing of theirs -> proceeds" \
  || bad "sibling moved" "expected rc 0"
bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" --changed-paths-file "$T/c.txt" 2>&1 | grep -q '^PIN_SIBLING_MOVED OTHER' \
  && ok "...and says PIN_SIBLING_MOVED" || bad "sibling moved" "no PIN_SIBLING_MOVED line"
rm -rf "$T"

T="$(fixture)"; move "$T" MINE; echo README.md > "$T/c.txt"
[ "$(rc_of "$T/gate.log" "$T/repo" "$T/camp" --expect-pin-fail MINE:src/a.ts --changed-paths-file "$T/c.txt")" = 2 ] \
  && ok "merge DECLARES the manifest that moved -> refuses" || bad "declared+moved" "expected rc 2"
rm -rf "$T"

T="$(fixture)"; move "$T" OTHER; echo src/b.ts > "$T/c.txt"
[ "$(rc_of "$T/gate.log" "$T/repo" "$T/camp" --changed-paths-file "$T/c.txt")" = 2 ] \
  && ok "undeclared but TOUCHES a claimed path -> refuses" || bad "touches a claim" "expected rc 2"
rm -rf "$T"

T="$(fixture)"; grep -v '^PIN_MANIFEST ' "$T/gate.log" > "$T/old.log"; echo README.md > "$T/c.txt"
[ "$(rc_of "$T/old.log" "$T/repo" "$T/camp" --changed-paths-file "$T/c.txt")" = 2 ] \
  && ok "gate log with no per-manifest lines -> refuses, no aggregate fallback" || bad "no per-manifest lines" "expected rc 2"
rm -rf "$T"

echo "7.6.80 half two — UNKNOWN never resolves toward proceeding (§15.504)"

T="$(fixture)"; echo src/b.ts > "$T/c.txt"
[ "$(rc_of "$T/gate.log" "$T/repo-missing" "$T/camp" --changed-paths-file "$T/c.txt")" = 2 ] \
  && ok "unreadable repo -> refuses (no glob can be expanded)" || bad "unreadable repo" "expected rc 2"
rm -rf "$T"

T="$(fixture)"
for e in sha256 counts globs; do cp "$T/camp/gate-manifests/MINE.$e" "$T/camp/gate-manifests/NEW.$e"; done
echo README.md > "$T/c.txt"
[ "$(rc_of "$T/gate.log" "$T/repo" "$T/camp" --changed-paths-file "$T/c.txt")" = 0 ] \
  && ok "manifest absent from the gate log, untouched -> reported, proceeds" || bad "absent+untouched" "expected rc 0"
echo src/b.ts > "$T/c2.txt"
[ "$(rc_of "$T/gate.log" "$T/repo" "$T/camp" --changed-paths-file "$T/c2.txt")" = 2 ] \
  && ok "manifest absent from the gate log, TOUCHED -> refuses" || bad "absent+touched" "expected rc 2"
rm -rf "$T"

T="$(fixture)"; move "$T" OTHER
[ "$(rc_of "$T/gate.log" "$T/repo" "$T/camp" --changed-paths-file "$T/nope.txt")" = 2 ] \
  && ok "missing --changed-paths-file -> refuses (an unreadable diff is not an empty one)" || bad "missing changed file" "expected rc 2"
rm -rf "$T"

echo "7.6.101 — pin-precheck CONSUMES the gate's classification (T1 980/980a)"

# A fixture whose repo is a REAL git repo with a parsoFish/main ref, because
# every shape below turns on "do these bytes still equal main's" and a fixture
# without main can only test the paths that never ask.
gitfixture() {
  local T; T="$(fixture)"
  ( cd "$T/repo" \
    && git init -q -b work \
    && git config user.email f@x.invalid && git config user.name f \
    && git add -A && git commit -qm base \
    && git update-ref refs/remotes/parsoFish/main HEAD ) >/dev/null 2>&1
  # `head=` must name a sha THIS TREE CONTAINS, or the skew check refuses before
  # any of these shapes is reached — the fixture's `deadbeef` made all four read
  # rc 4 on a question they were not asking. A fixture that cannot reach the
  # code under test is a door that proves nothing (A's R3).
  # MINE pins a DIFFERENT file from OTHER. The shared fixture points both at
  # `src/a.ts`, so breaking the sibling's row broke MINE's too and the shape
  # under test never ran alone — a fixture collision, not a code defect.
  (cd "$T/repo" && sha256sum src/b.ts) > "$T/camp/gate-manifests/MINE.sha256"
  local base; base="$(cd "$T/repo" && git rev-parse HEAD)"
  local n
  for n in MINE OTHER; do
    echo "paths=1 head=$base owner=$n" > "$T/camp/gate-manifests/$n.counts"
  done
  echo "$T"
}
# Make OTHER's pinned row FAIL, exactly as a sibling's merge does: the bytes on
# main move, the manifest still pins the old hash.
break_other() {
  echo "moved by the sibling's merge" > "$1/repo/src/a.ts"
  ( cd "$1/repo" && git add -A && git commit -qm "sibling merge" \
    && git update-ref refs/remotes/parsoFish/main HEAD ) >/dev/null 2>&1
  # OTHER's manifest still pins the OLD bytes — that is the stale pin — but its
  # `head=` advances with the tree, because the skew question ("can this tree
  # answer") and the drift question ("whose change is this") are different and
  # this shape is about the second.
  local base; base="$(cd "$1/repo" && git rev-parse HEAD)"
  echo "paths=1 head=$base owner=OTHER" > "$1/camp/gate-manifests/OTHER.counts"
}
# THE GATE LOG MUST DESCRIBE THE STATE THE GATE SAW, and rebuilding it is not a
# convenience: `pin-precheck`'s other two checks compare the log's FAILED counts
# and manifest fingerprints against the tree NOW, and both fire before anything
# 7.6.101 touches. My first fixture wrote the log before breaking the file, so
# two shapes read a true refusal about a question they were not asking. Third
# time tonight that a fixture could not reach the code under test (A's R3).
regen_log() {                      # regen_log <root> <OTHER's FAILED count>
  local T="$1" otherfail="$2" n
  { echo "== pins =="
    echo "PIN_MANIFESTS=$(sha256sum "$T"/camp/gate-manifests/*.sha256 "$T"/camp/gate-manifests/*.counts | sha256sum | cut -c1-16)"
    for n in MINE OTHER; do
      echo "PIN_MANIFEST $n=$(sha256sum "$T/camp/gate-manifests/$n.sha256" "$T/camp/gate-manifests/$n.counts" | sha256sum | cut -c1-16)"
    done
    echo "MINE.sha256: 0 FAILED of 1 — tree at deadbeef; last verified at deadbeef"
    echo "OTHER.sha256: $otherfail FAILED of 1 — tree at deadbeef; last verified at deadbeef"
  } > "$T/gate.log"
}
stale_line() { echo "  PIN_SIBLING_STALE $1 — matches main abc12345; owner $2 owes a reconcile" >> "$3/gate.log"; }

T="$(gitfixture)"; break_other "$T"; regen_log "$T" 1; stale_line "OTHER:src/a.ts" OTHER "$T"; echo README.md > "$T/c.txt"
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" --changed-paths-file "$T/c.txt" 2>&1)"; r=$?
[ "$r" = 0 ] && printf '%s' "$out" | grep -q '^PIN_ACCOUNTED OTHER:src/a.ts — PIN_SIBLING_STALE in the gate log' \
  && ok "classified row, bytes still == main -> ACCOUNTED, rc 0" \
  || bad "consume" "rc=$r out=$(printf '%s' "$out" | tail -2)"
rm -rf "$T"

# The skew case: the gate excused it, then THIS tree diverged from main after
# the gate ran. The classification is not re-derived; the row is refused on the
# question this file owns, and the message says which.
T="$(gitfixture)"; break_other "$T"; regen_log "$T" 1; stale_line "OTHER:src/a.ts" OTHER "$T"; echo README.md > "$T/c.txt"
echo "edited in this tree after the gate" > "$T/repo/src/a.ts"
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" --changed-paths-file "$T/c.txt" 2>&1)"; r=$?
[ "$r" = 3 ] && printf '%s' "$out" | grep -q 'NO LONGER equal parsoFish/main' \
  && printf '%s' "$out" | grep -q 'SKEW check refusing, not the classification' \
  && ok "excused row whose bytes drifted since the gate -> refused, and NAMES the skew check" \
  || bad "skew override" "rc=$r out=$(printf '%s' "$out" | tail -2)"
rm -rf "$T"

# The row that started this: a foreign FAILED row with NO classification in the
# log. It must refuse, and it must NOT offer --expect-pin-fail, because that is
# a claim about this PR's own diff and this PR does not touch the path.
T="$(gitfixture)"; break_other "$T"; regen_log "$T" 1; echo README.md > "$T/c.txt"
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" --changed-paths-file "$T/c.txt" 2>&1)"; r=$?
[ "$r" = 3 ] && printf '%s' "$out" | grep -q "owner OTHER owes a reconcile" \
  && printf '%s' "$out" | grep -q "DO NOT declare another owner's row" \
  && ! printf '%s' "$out" | grep -q 'declare it with --expect-pin-fail OTHER:src/a.ts' \
  && ok "foreign unclassified row -> refused, names the owner, NEVER suggests --expect-pin-fail" \
  || bad "foreign row remedy" "rc=$r out=$(printf '%s' "$out" | tail -2)"
rm -rf "$T"

# And the case where the suggestion IS right: the PR's own diff touches it.
T="$(gitfixture)"; break_other "$T"; regen_log "$T" 1; printf 'src/a.ts\n' > "$T/c.txt"
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" --changed-paths-file "$T/c.txt" 2>&1)"; r=$?
[ "$r" = 3 ] && printf '%s' "$out" | grep -q 'CHANGES that path without declaring it' \
  && printf '%s' "$out" | grep -q -- '--expect-pin-fail OTHER:src/a.ts' \
  && ok "row in THIS PR's diff -> refused, and --expect-pin-fail IS the remedy offered" \
  || bad "own-diff remedy" "rc=$r out=$(printf '%s' "$out" | tail -2)"
rm -rf "$T"

# ---------------------------------------------------------------------------
# forge-8vfn.7.6.106 — THE CHANGED SET IS AN INPUT, AND AN ABSENT ONE IS NOT AN
# EMPTY ONE. Six shapes. The derivation path has NO live caller (`merge-slot.sh`
# always passes the flag), so these doors are its entire contract — if they go,
# nothing else states what the path does.
#
# `dirty()` and `commit_change()` exist so the union's two halves are testable
# apart: a door that only ever saw a committed diff would pass with the
# working-tree terms deleted.
commit_change() {                   # commit_change <root> <path> <text>
  printf '%s\n' "$3" > "$1/repo/$2"
  ( cd "$1/repo" && git add -- "$2" && git commit -qm "change $2" ) >/dev/null 2>&1
}

# 1. DERIVES THE COMMITTED DIFF. The flag is absent and the answer is still the
#    PR's own paths — the shape that produced "this PR does not touch" about a
#    file that was the entire diff.
T="$(gitfixture)"; break_other "$T"; commit_change "$T" src/a.ts "mine, committed after the base"; regen_log "$T" 1
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" 2>&1)"; r=$?
printf '%s' "$out" | grep -q 'DERIVED 1 changed path' \
  && printf '%s' "$out" | grep -q 'CHANGES that path without declaring it' \
  && ok "no flag -> derives the committed diff, and src/a.ts reads as THIS PR's own" \
  || bad "derive committed" "rc=$r out=$(printf '%s' "$out" | tail -3)"
rm -rf "$T"

# 2. THE UNION'S SECOND HALF. The same path uncommitted. Delete the working-tree
#    terms and this is the door that goes red while shape 1 stays green.
T="$(gitfixture)"; break_other "$T"; regen_log "$T" 1
printf 'mine, not committed\n' > "$T/repo/src/a.ts"
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" 2>&1)"; r=$?
printf '%s' "$out" | grep -q 'CHANGES that path without declaring it' \
  && ok "no flag -> an UNCOMMITTED change is in the derived set (the union's second half)" \
  || bad "derive worktree" "rc=$r out=$(printf '%s' "$out" | tail -3)"
rm -rf "$T"

# 2b. A RENAME IS DELETE + ADD (T1 1275, C's #868). `git mv` the pinned path:
#    with rename detection the derived set names only the new path and the
#    pinned OLD path reads as untouched.
T="$(gitfixture)"; break_other "$T"; regen_log "$T" 1
( cd "$T/repo" && git mv src/a.ts src/moved.ts && git commit -qm "move a" ) >/dev/null 2>&1
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" 2>&1)"; r=$?
printf '%s' "$out" | grep -q 'DERIVED 2 changed path' \
  && printf '%s' "$out" | grep -q 'CHANGES that path without declaring it' \
  && ok "no flag -> a git mv puts the pinned OLD path in the derived set (delete + add, --no-renames)" \
  || bad "derive rename" "rc=$r out=$(printf '%s' "$out" | tail -3)"
rm -rf "$T"

# 3. NO parsoFish/main -> REFUSES, NAMED. One `update-ref -d` from the fixture,
#    which is why the derivation cases cost a line each rather than a fixture.
T="$(gitfixture)"; ( cd "$T/repo" && git update-ref -d refs/remotes/parsoFish/main ) >/dev/null 2>&1
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" 2>&1)"; r=$?
[ "$r" = 2 ] && printf '%s' "$out" | grep -q 'parsoFish/main does not resolve' \
  && ok "no flag + no parsoFish/main -> refused, and names the missing base" \
  || bad "no base refusal" "rc=$r out=$(printf '%s' "$out" | tail -2)"
rm -rf "$T"

# 4. A NON-GIT REPO -> REFUSES, NAMED. `fixture` (not `gitfixture`) never runs
#    `git init`, so this is the same tree minus the repo.
T="$(fixture)"
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" 2>&1)"; r=$?
[ "$r" = 2 ] && printf '%s' "$out" | grep -q 'not a readable git work tree' \
  && ok "no flag + not a git work tree -> refused, and says which step could not run" \
  || bad "non-git refusal" "rc=$r out=$(printf '%s' "$out" | tail -2)"
rm -rf "$T"

# 5. AN EMPTY EXPLICIT FILE -> REFUSES, WITH THE OTHER MESSAGE. `merge-slot`
#    guards `gh pr diff`'s exit status, not its content, so "succeeded and wrote
#    nothing" reaches here. The two refusals must stay distinguishable: fix the
#    environment versus fix the caller.
T="$(gitfixture)"; : > "$T/c.txt"
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" --changed-paths-file "$T/c.txt" 2>&1)"; r=$?
[ "$r" = 2 ] && printf '%s' "$out" | grep -q 'exists and is EMPTY' \
  && printf '%s' "$out" | grep -q 'fix the caller' \
  && ! printf '%s' "$out" | grep -q 'cannot be derived' \
  && ok "empty --changed-paths-file -> refused with the CALLER message, not the derivation one" \
  || bad "empty file refusal" "rc=$r out=$(printf '%s' "$out" | tail -2)"
rm -rf "$T"

# 7. DERIVED AND EMPTY IS STILL A REFUSAL. The derivation SUCCEEDED here — the
#    tree simply equals its merge base. Nothing merges zero paths, and an empty
#    set is the exact value the whole bead exists to stop being acted on, so it
#    must not reach the relevant-set computation just because git answered.
T="$(gitfixture)"
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" 2>&1)"; r=$?
[ "$r" = 2 ] && printf '%s' "$out" | grep -q 'derived changed set is EMPTY' \
  && ok "no flag + a tree identical to its merge base -> refused, not proceeded on nothing" \
  || bad "derived-empty refusal" "rc=$r out=$(printf '%s' "$out" | tail -2)"
rm -rf "$T"

# 6. THE FLAG STILL WINS. A populated file and a tree whose derived set would be
#    different: the file is what is used, and no derivation note is printed.
#    Without this, shapes 1-5 are equally satisfied by ignoring the flag.
T="$(gitfixture)"; break_other "$T"; commit_change "$T" src/a.ts "moved, but the caller says otherwise"; regen_log "$T" 1
printf 'README.md\n' > "$T/c.txt"
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" --changed-paths-file "$T/c.txt" 2>&1)"; r=$?
[ "$r" = 3 ] && printf '%s' "$out" | grep -q "does not touch that path" \
  && ! printf '%s' "$out" | grep -q 'DERIVED' \
  && ok "an explicit --changed-paths-file still wins, and derivation does not run behind it" \
  || bad "flag precedence" "rc=$r out=$(printf '%s' "$out" | tail -3)"
rm -rf "$T"

echo "7.6.126 — a declaration names a row THIS PR changed (C's gate 777, §15.566)"

# The shape that produced a green gate on a false claim: OTHER's row really is
# FAILED (its manifest is behind main), the PR does not touch it, and a deriver
# run against a stale base declared it anyway. Before: PIN_ACCOUNTED, rc 0.
T="$(gitfixture)"; break_other "$T"; regen_log "$T" 1; echo README.md > "$T/c.txt"
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" --expect-pin-fail OTHER:src/a.ts --changed-paths-file "$T/c.txt" 2>&1)"; r=$?
[ "$r" = 3 ] && printf '%s' "$out" | grep -q 'does NOT change src/a.ts' \
  && printf '%s' "$out" | grep -q 'stale base' \
  && ok "a declared row this PR does not change -> REFUSED, naming the path and the stale-base cause" \
  || bad "declared-not-changed" "rc=$r out=$(printf '%s' "$out" | tail -2)"
rm -rf "$T"

# CONTROL: the same declaration when the PR DOES change the path proceeds.
T="$(gitfixture)"; break_other "$T"; regen_log "$T" 1; printf 'src/a.ts\n' > "$T/c.txt"
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" --expect-pin-fail OTHER:src/a.ts --changed-paths-file "$T/c.txt" 2>&1)"; r=$?
[ "$r" = 0 ] && printf '%s' "$out" | grep -q '^PIN_ACCOUNTED OTHER:src/a.ts — declared by this PR' \
  && ! printf '%s' "$out" | grep -q 'does NOT change' \
  && ok "CONTROL: the same declaration with the path in the diff -> ACCOUNTED, rc 0" \
  || bad "declared-and-changed control" "rc=$r out=$(printf '%s' "$out" | tail -2)"
rm -rf "$T"

# The membership test is on the WHOLE path, not a substring: a PR changing
# src/a.ts.bak does not change src/a.ts.
T="$(gitfixture)"; break_other "$T"; regen_log "$T" 1; printf 'src/a.ts.bak\n' > "$T/c.txt"
out="$(bash "$PP" "$T/gate.log" "$T/repo" "$T/camp" --expect-pin-fail OTHER:src/a.ts --changed-paths-file "$T/c.txt" 2>&1)"; r=$?
[ "$r" = 3 ] && printf '%s' "$out" | grep -q 'does NOT change src/a.ts' \
  && ok "a changed path that merely CONTAINS the declared one does not satisfy it" \
  || bad "substring" "rc=$r out=$(printf '%s' "$out" | tail -2)"
rm -rf "$T"

printf '\nprecheck-doors: %d ok, %d FAILED\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
