#!/usr/bin/env bash
# owner-census.sh — every pinned file owned by more than one gate manifest.
#
#   owner-census.sh <campaign>
#
# WHY IT EXISTS (M7 findings row 33). "41 of 559 pinned files have more than
# one owning manifest" (M7 brief row 33) and the M7-C re-derivation ("47
# files... the invariant... still holds by construction... nothing automates
# this census going forward; it only holds because someone re-derives it by
# hand") were both hand audits. This makes the census a command.
#
# THIS IS A REPORT, NOT A GATE. A file may legitimately have several owning
# manifests when every owner's gate actually reads it (SKILL.md's rule);
# deciding that is a human/T1 judgement this script does not make, so it
# always exits 0 — do not wire it into gate.sh (row 33 says so explicitly).
#
# EVERY PATH IS AN ARGUMENT (§15.148): the campaign dir is given, never
# resolved from this script's own location.
set -u

CAMPAIGN="${1:?usage: owner-census.sh <campaign>}"
[ -d "$CAMPAIGN" ] || { echo "owner-census.sh: no such campaign dir: $CAMPAIGN" >&2; exit 2; }
[ $# -le 1 ] || { echo "owner-census.sh: unexpected argument '$2' — this tool takes one campaign dir and nothing else" >&2; exit 2; }

MANIFEST_DIR="$CAMPAIGN/gate-manifests"
[ -d "$MANIFEST_DIR" ] || { echo "owner-census.sh: no gate-manifests dir under $CAMPAIGN" >&2; exit 2; }

shopt -s nullglob
MANIFESTS=("$MANIFEST_DIR"/*.txt)
shopt -u nullglob

# path -> space-separated list of owning manifest names (basename, no .txt),
# in the order each manifest was scanned.
declare -A OWNERS
for m in "${MANIFESTS[@]}"; do
  name=$(basename "$m" .txt)
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if [ -n "${OWNERS[$path]:-}" ]; then
      OWNERS["$path"]="${OWNERS[$path]} $name"
    else
      OWNERS["$path"]="$name"
    fi
  done < "$m"
done

REPORT=()
for path in "${!OWNERS[@]}"; do
  owners="${OWNERS[$path]}"
  n=$(wc -w <<<"$owners")
  if [ "$n" -gt 1 ]; then
    sorted=$(tr ' ' '\n' <<<"$owners" | sort | paste -sd ',' -)
    REPORT+=("$path owners: ${sorted//,/, }")
  fi
done

COUNT=${#REPORT[@]}
if [ "$COUNT" -gt 0 ]; then
  printf '%s\n' "${REPORT[@]}" | sort
fi
echo "MULTI_OWNER_COUNT=$COUNT"
exit 0
