#!/usr/bin/env bash
# pin-extension-gap.sh — a file CLASS with no glob, beside a class that has
# one, is invisible to every pin check on the box (bead `forge-8vfn.7.6.115`).
#
#   pin-extension-gap.sh <repo> <campaign-dir>
#
# `pin-glob-check.sh` (this directory) asks each manifest "does your OWN
# declared scope still match what it once did" — a question about ONE glob's
# drift. This asks a different one: a manifest's globs cover a CLASS of file
# in a directory, and the classes they do NOT cover are invisible to every
# check the campaign has, because nothing ever asks the TREE what is there
# rather than the manifest what it has. Three instances found by accident in
# one day (13 `scripts/check-*.test.ts` guard doors pinned by nobody beside
# fully-pinned `check-*.mjs` guards; a docs file carrying provenance data
# pinned by nobody; `scripts/stories/reproducible.sh`, the ONLY `.sh` in a
# directory whose `.mjs`/`.test.ts` were both globbed, unnoticed because its
# class had no glob to drift) generalise to one shape: *.mjs drifts loudly
# right next to a `.sh` that is silent, because THE APPARATUS LOOKS COMPLETE
# FROM INSIDE THE COVERED CLASS. This is the check the M6-D census (`_1.0/
# evidence/m6-d-7.6.114-extension-gap/`) ran by hand, made reusable.
#
# TWO SCOPE RULES, both measured necessary or it cries wolf:
#
#   1. A directory is only "touched" by a DIRECTORY-SCOPED glob — one whose
#      pattern contains a literal `*`. A manifest that merely names ONE file
#      (`package.json`) does not put that file's whole directory in scope:
#      "having one file in a directory is not owning it." Without this,
#      any manifest pinning a root-level file makes `LICENSE`, `.nvmrc`,
#      `.gitignore` etc. read as uncovered extensions for every manifest that
#      names anything at repo root.
#
#   2. Coverage is judged across the WHOLE MANIFEST SET, never per manifest.
#      `scripts/request-path-sinks.baseline.txt` is pinned by a DIFFERENT
#      manifest than the one whose glob touches its directory — a check
#      scoped to one manifest would flag it anyway, putting the manifest back
#      in the loop through the side door the whole-tree direction exists to
#      avoid.
#
# Every path is an argument (§15.148); every extension in the tree is a
# literal filesystem listing, the same as `pin-glob-check.sh` reads matches —
# a directory's CONTENT, not its git index, is the thing a class can hide in.
#
# Exit codes, distinct on purpose (§15.92):
#   0  every extension in every touched directory is covered by some manifest
#   1  at least one (directory, extension) gap — each one named
#   2  usage error, or no `*.globs` file exists to check
set -uo pipefail
shopt -s globstar

R="${1:?repo root}"; CAMP="${2:?campaign dir}"
G="$CAMP/gate-manifests"
[ -d "$R" ] || { echo "pin-extension-gap.sh: no repo: $R" >&2; exit 2; }
[ -d "$G" ] || { echo "pin-extension-gap.sh: no gate-manifests dir: $G" >&2; exit 2; }

covered=$(mktemp)
touched_dirs=$(mktemp)
trap 'rm -f "$covered" "$touched_dirs"' EXIT

any_globs=0
for gl in "$G"/*.globs; do
  [ -f "$gl" ] || continue
  any_globs=1
  while IFS= read -r pattern; do
    case "$pattern" in ''|'#'*) continue ;; esac
    hits=$(cd "$R" && eval "ls -1 -d -- $pattern" 2>/dev/null || true)
    [ -n "$hits" ] || continue
    printf '%s\n' "$hits" >> "$covered"
    # RULE 1: only a glob whose PATTERN contains `*` puts its matches'
    # directories in scope — a literal single-file line never does, no matter
    # how many files it happens to match via shell quirks.
    case "$pattern" in
      *'*'*)
        while IFS= read -r hit; do
          [ -n "$hit" ] || continue
          dirname -- "$hit"
        done <<< "$hits" >> "$touched_dirs"
        ;;
    esac
  done < "$gl"
done
[ "$any_globs" = 1 ] || { echo "pin-extension-gap.sh: no *.globs file under $G — nothing to check" >&2; exit 2; }

sort -u -o "$touched_dirs" "$touched_dirs"
sort -u -o "$covered" "$covered"

# A file directly IN `d` (never a subdirectory — the same one-level scope a
# directory-scoped glob like `dir/*.ext` names) is COVERED when it appears
# anywhere in the whole-set union above, by name. Bash `case` patterns, not
# regex: a directory name can hold characters a regex would need escaping.
covered_at() {
  local d="$1" ext="$2" line rest
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    if [ "$d" = "." ]; then
      case "$line" in
        */*) continue ;;
        *".$ext") return 0 ;;
      esac
    else
      case "$line" in
        "$d"/*)
          rest="${line#"$d"/}"
          case "$rest" in
            */*) continue ;;
            *".$ext") return 0 ;;
          esac
          ;;
      esac
    fi
  done < "$covered"
  return 1
}

gap=0
while IFS= read -r d; do
  [ -n "$d" ] || continue
  files=$(cd "$R" && find "$d" -maxdepth 1 -type f 2>/dev/null || true)
  [ -n "$files" ] || continue
  exts=$(printf '%s\n' "$files" | while IFS= read -r p; do
    b=$(basename -- "$p")
    case "$b" in *.*) echo "${b##*.}" ;; esac
  done | sort -u)
  while IFS= read -r ext; do
    [ -n "$ext" ] || continue
    if ! covered_at "$d" "$ext"; then
      echo "$d  .$ext — touched by a directory-scoped glob, covered by none in this manifest set"
      gap=1
    fi
  done <<< "$exts"
done < "$touched_dirs"

[ "$gap" = 0 ] || exit 1
echo "pin-extension-gap: PASS — every extension in every directory-scoped glob's directory is covered by some manifest"
exit 0
