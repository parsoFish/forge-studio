#!/usr/bin/env bash
# pin-reconcile.sh — rehash the pin entries a merge touched, and say what changed.
#
#   pin-reconcile.sh <repo> <campaign-dir> <manifest-glob> <from-sha> <to-sha> "<label>"
#     e.g. pin-reconcile.sh ~/forge ~/forge/_1.0 'M5-*' 61491050 b2d1c640 'harness #401 (PR 1)'
#
# §15.105: a pin goes stale at a SIBLING lane's merge, not only at its owner's. Whoever merges
# something under `scripts/` or `tests/stories/` invalidates every live manifest that names the
# files it touched — so this runs after every merge, over every live manifest, not only the
# merging lane's. It rehashes ONLY the entries the merge touched: it never re-globs and never
# adds a path, because a re-glob silently adopts whatever appeared since the pin was taken.
#
# It appends one amendment line per pin touched to that pin's newest `amend-*.md`, and prints
# FAILED before → after so the number is read from the command's output and never written into
# the record before the command has printed it (§15.105 again — T1 once mis-read that count).
# Backups: `<manifest>.pre-<to>`.
#
# Every path is an argument. A tool that resolves its inputs from its own location answers a
# different question in each checkout (§15.148).
set -euo pipefail

R="${1:?repo root}"; CAMP="${2:?campaign dir}"; GLOB="${3:?manifest glob, e.g. 'M5-*'}"
FROM="${4:?from sha}"; TO="${5:?to sha}"; LABEL="${6:?label}"
G="$CAMP/gate-manifests"
[ -d "$G" ] || { echo "pin-reconcile.sh: no gate-manifests dir: $G" >&2; exit 2; }

# Bead forge-8vfn.6.9.2 (ruling 258). §15.169 says to reconcile only from a tree asserted AT the
# to-sha, and it fired on its own author: a confident `0 -> 0` produced from the MERGE'S PARENT,
# for a merge that changed five pinned files. The rehash below reads `sha256sum` of the WORKING
# TREE, so a tree one commit behind hashes the old bytes and prints a clean verdict for a pin it
# has just made wrong. A rule that lives only in prose is decoration; this puts it in the script.
# A SHORT to-sha is accepted when it names this very commit — the operator writes `a63322a2`.
HEAD_SHA=$(git -C "$R" rev-parse HEAD 2>/dev/null || true)
case "$HEAD_SHA" in
  "$TO"*) ;;
  *)
    echo "pin-reconcile.sh: REFUSING — the tree at $R is HEAD $HEAD_SHA, not the to-sha $TO." >&2
    echo "  This script rehashes the WORKING TREE, so reconciling from anywhere else records the" >&2
    echo "  wrong bytes and prints a clean verdict for a pin it just made wrong (§15.169)." >&2
    echo "  Advance that tree to $TO and re-run." >&2
    exit 2
    ;;
esac

T=$(mktemp); trap 'rm -f "$T"' EXIT
git -C "$R" diff --name-only "$FROM" "$TO" > "$T"
found=0
for f in "$G"/$GLOB.sha256; do
  [ -f "$f" ] || continue
  found=1
  n=$(basename "$f" .sha256)
  touched=$(awk '{print $2}' "$f" | sed 's#^\*##' | grep -Fxf "$T" || true)
  [ -n "$touched" ] || continue
  cp "$f" "$f.pre-${TO:0:8}"
  # Count FAILED lines, never `grep -vc ': OK$'` — that also counts the WARNING line (§15.105).
  before=$(cd "$R" && sha256sum -c --quiet "$f" 2>&1 | grep -c FAILED || true)
  for p in $touched; do
    if [ -f "$R/$p" ]; then
      h=$(cd "$R" && sha256sum "$p" | cut -d' ' -f1)
      awk -v p="$p" -v h="$h" '{ q=$2; sub(/^\*/,"",q); if (q==p) print h "  " p; else print }' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    else
      echo "  $n: $p DELETED by the merge — entry left in place (the gate reads it as missing, which is the honest state)"
    fi
  done
  after=$(cd "$R" && sha256sum -c --quiet "$f" 2>&1 | grep -c FAILED || true)
  # T1 ruling 707 — ADVANCE `head=` IN THE SAME EDIT THAT REHASHES.
  #
  # A manifest whose `.sha256` was rehashed while its `.counts` still names an
  # older sha describes a tree it does not describe, and EVERY lane's skew test
  # reads that field: C's precheck named M6-D's `agent-dispatch-containment.test.ts`
  # as C's drift for exactly this reason. Only manifests this run rehashed are
  # touched — a `head=` advanced on a manifest nobody verified is the same lie
  # pointing the other way.
  #
  # `head=` means "last verified 0-FAILED against", so it is written ONLY when
  # the rehash actually reached zero. A manifest still failing (a pinned path the
  # merge DELETED, left in place above) records why instead.
  counts="${f%.sha256}.counts"
  if [ "$after" = "0" ]; then
    if [ -f "$counts" ] && grep -q 'head=[0-9a-f]\{7,40\}' "$counts"; then
      sed -i "s/head=[0-9a-f]\{7,40\}/head=${TO:0:8}/" "$counts"
    elif [ -f "$counts" ]; then
      printf '%s head=%s\n' "$(head -1 "$counts")" "${TO:0:8}" > "$counts.tmp"
      tail -n +2 "$counts" >> "$counts.tmp"; mv "$counts.tmp" "$counts"
    else
      # Created per ruling 680's format. `paths` and `manifest` are measured
      # here; `owner` is not knowable from this script and is left to the lane.
      printf 'paths=%s manifest=%s head=%s tree=%s\n' \
        "$(grep -c . "$f")" "$(sha256sum "$f" | cut -c1-16)" "${TO:0:8}" "$R" > "$counts"
      printf '# Created by pin-reconcile.sh (T1 ruling 707, format per 680). head= is the sha this\n# manifest was last verified 0-FAILED against.\n' >> "$counts"
    fi
    echo "  $n: head= -> ${TO:0:8} (rehashed to 0 FAILED against this tree)"
  else
    [ -f "$counts" ] || printf 'paths=%s tree=%s\n' "$(grep -c . "$f")" "$R" > "$counts"
    grep -q 'head-not-advanced' "$counts" || \
      printf '# head= NOT advanced to %s: still FAILED %s after the rehash (a pinned path the merge\n# deleted, or bytes this tree does not hold). head-not-advanced=%s\n' \
        "${TO:0:8}" "$after" "${TO:0:8}" >> "$counts"
    echo "  $n: head= NOT advanced — still FAILED $after after the rehash"
  fi
  log=$(ls "$G"/"$n".amend-*.md 2>/dev/null | tail -1 || true); [ -n "$log" ] || log="$G/$n.amend-1.md"
  printf '\n## Amendment (at `%s`, §15.105, pin-reconcile.sh) after %s: %s rehashed — FAILED %s → %s.\n' \
    "${TO:0:8}" "$LABEL" "$(echo "$touched" | tr '\n' ' ')" "$before" "$after" >> "$log"
  echo "$n: [$(echo "$touched" | tr '\n' ' ')] FAILED $before → $after"
done
# A run that matched no manifest is a distinct outcome, not silence (§15.92).
[ "$found" = 1 ] || { echo "pin-reconcile.sh: no manifest matched $G/$GLOB.sha256" >&2; exit 2; }
