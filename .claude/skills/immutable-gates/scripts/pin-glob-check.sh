#!/usr/bin/env bash
# pin-glob-check.sh — a pin manifest is DERIVED from the glob that defines it.
#
#   pin-glob-check.sh <repo> <campaign-dir> <manifest-glob>
#     e.g. pin-glob-check.sh ~/forge ~/forge/_1.0 'M5-B'
#
# Each `<gate-manifests>/<name>.sha256` may carry a sibling `<name>.globs`: one repo-relative
# glob per line (`#` comments and blank lines ignored) naming the scope that manifest was pinned
# from. This expands every declared glob and REFUSES if the repo holds a matching file the
# manifest does not list, naming each one.
#
# Bought by a measurement (M5-B session 7). The M5-B pin's stated scope included
# `scripts/stories/*.mjs` + `*.test.ts`; merged main held 28 such files and the manifest listed
# 21 — and `sha256sum -c` printed `0 FAILED` throughout, because A FILE THAT IS NOT LISTED CANNOT
# FAIL. Absence of red mistaken for presence of green, one layer above the merge gate. All seven
# had arrived legitimately: a split at the 800-line cap, or a new test. One of them held the very
# waits the milestone's P1 bead exists to fix, and was editable without the pin noticing.
#
# It only ever REFUSES. Adopting the file is a human decision, recorded in an amendment — which is
# exactly why this is NOT `pin-reconcile.sh`'s job: that script never re-globs and never adds a
# path, on purpose, because a re-glob that ADOPTS silently is how a pin grows to cover whatever
# appeared since it was taken. The two are complementary: reconcile rehashes what is listed; this
# one says what should be listed and is not.
#
# Exit codes are distinct on purpose — "nothing was checked" and "everything checked out" must
# never share one (§15.92, and the very trap above):
#   0  every matched manifest declares globs, and every match is listed
#   1  DRIFT — at least one matching file is unlisted (each named)
#   2  usage error, or no manifest matched the glob
#   3  at least one matched manifest declares no globs (nothing to check for it)
#
# Every path is an argument. A tool that resolves its inputs from its own location answers a
# different question in each checkout (§15.148).
set -uo pipefail
# `**` in a declared glob must mean "recursively", which is what a brief means when it writes
# `packages/projects/**/*.test.ts`. Without this bash treats it as a single `*` and the check
# silently narrows to one directory — the exact failure mode it exists to catch.
shopt -s globstar

R="${1:?repo root}"; CAMP="${2:?campaign dir}"; GLOB="${3:?manifest glob, e.g. 'M5-B' or 'M5-*'}"
G="$CAMP/gate-manifests"
[ -d "$G" ] || { echo "pin-glob-check.sh: no gate-manifests dir: $G" >&2; exit 2; }
[ -d "$R" ] || { echo "pin-glob-check.sh: no repo: $R" >&2; exit 2; }

found=0; drift=0; undeclared=0; checked=0
for f in "$G"/$GLOB.sha256; do
  [ -f "$f" ] || continue
  found=1
  n=$(basename "$f" .sha256)
  gl="$G/$n.globs"
  if [ ! -f "$gl" ]; then
    echo "$n: NO GLOBS DECLARED — this manifest states no scope, so nothing can be checked against it (write $n.globs)"
    undeclared=1
    continue
  fi
  # What the manifest lists, with sha256sum's optional binary `*` prefix stripped.
  listed=$(awk '{ p=$2; sub(/^\*/,"",p); if (p != "") print p }' "$f" | sort -u)
  unlisted=""
  count=0
  while IFS= read -r pattern; do
    case "$pattern" in ''|'#'*) continue;; esac
    # Expand in the repo, not here: the glob is repo-relative by contract.
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      count=$((count + 1))
      printf '%s\n' "$listed" | grep -Fxq -- "$hit" || unlisted="$unlisted$hit"$'\n'
    done <<EOF
$(cd "$R" && eval "ls -1 -d -- $pattern" 2>/dev/null || true)
EOF
  done < "$gl"
  checked=$((checked + count))
  if [ -n "$unlisted" ]; then
    drift=1
    echo "$n: DRIFT — $(printf '%s' "$unlisted" | grep -c . ) file(s) match this manifest's own globs and are NOT listed:"
    printf '%s' "$unlisted" | sed 's/^/    /'
    echo "    A file that is not listed cannot fail. Add each with an amendment (coverage only tightens)."
  else
    echo "$n: OK — $count file(s) match its declared globs, every one listed"
  fi
done

[ "$found" = 1 ] || { echo "pin-glob-check.sh: no manifest matched $G/$GLOB.sha256" >&2; exit 2; }
[ "$drift" = 0 ] || exit 1
[ "$undeclared" = 0 ] || exit 3
echo "pin-glob-check: PASS — $checked file(s) across every matched manifest, no unlisted match"
exit 0
