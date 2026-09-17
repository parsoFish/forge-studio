#!/usr/bin/env bash
# reproducible.sh <story-id> — run a COSTLESS story twice on one tree and prove
# `story.json` comes out byte-identical (`forge-8vfn.26` part c).
#
# WHY A SECOND RUN AND NOT A CHECK FOR THE TWO KNOWN CAUSES. The artifact was
# non-reproducible for two reasons found by reading a diff: absolute worktree
# paths, and a binding that followed whichever project card the running checkout
# rendered first. A guard asserting the absence of those two would pass the
# third cause, and the third cause is the one nobody has seen yet. A second run
# asserts REPRODUCIBILITY ITSELF, so it fails for the right reason whatever the
# cause turns out to be — and it fails for a cause that did not exist when it
# was written, which is the only kind of guard worth the wall-clock.
#
# IT REFUSES ON ABSENCE. Two missing files are byte-identical to `diff`, and a
# run that wrote nothing would otherwise read as perfectly reproducible — the
# `PORCELAIN_AFTER_STORIES=0` shape from this very bead, where a zero produced
# by not-measuring was read as a measurement.
#
# COSTLESS ONLY. This runs the story TWICE; pointing it at a story with a budget
# would spend twice. The refusal below reads the story's own declared budget
# rather than a list of ids kept here, which would go stale the first time a
# story's ground changed.
set -u
ID="${1:?usage: reproducible.sh <story-id>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ART="$ROOT/demos/stories/$ID/story.json"
TMP="$(mktemp -d /tmp/story-reproducible-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

budget="$(node --input-type=module -e "
import { loadStory } from '$ROOT/scripts/stories/story-file.mjs';
const s = await loadStory('$ROOT/tests/stories/$ID.story.mjs');
process.stdout.write(String(s.ground?.budget_usd ?? 'unknown'));
" 2>/dev/null)"
case "$budget" in
  0) ;;
  *) echo "reproducible.sh: REFUSING — story '$ID' declares budget_usd=${budget:-unread}, and this runs it TWICE. Costless stories only."; exit 2 ;;
esac

run_once() {
  ( cd "$ROOT" && npm run stories -- --story "$ID" ) > "$TMP/run$1.log" 2>&1
  local rc=$?
  [ "$rc" = 0 ] || {
    echo "reproducible.sh: run $1 of story '$ID' exited $rc — a story that did not pass says nothing about reproducibility:"
    tail -20 "$TMP/run$1.log"; return 1; }
  [ -f "$ART" ] || { echo "reproducible.sh: run $1 wrote no $ART. Two missing files are byte-identical; that is not a pass."; return 1; }
  cp "$ART" "$TMP/story$1.json"
}

run_once 1 || exit 1
run_once 2 || exit 1

if diff -u "$TMP/story1.json" "$TMP/story2.json" > "$TMP/diff"; then
  echo "reproducible.sh: $ID — two runs on one tree wrote a byte-identical story.json ($(wc -c < "$TMP/story1.json") bytes)"
  exit 0
fi
echo "reproducible.sh: $ID — story.json DIFFERS between two runs on the same tree."
echo "  Anything that differs here is the running checkout leaking into a committed artifact."
sed -n '1,40p' "$TMP/diff"
exit 1
