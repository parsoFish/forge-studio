#!/usr/bin/env bash
# gh-slot.sh — serialise `gh` calls across lanes through one named slot file.
#
#   gh-slot.sh <slot-file> -- <gh args...>
#
# WHY IT EXISTS (M7 findings row 16). Each lane that needed to serialise `gh`
# calls hand-rolled its own copy (`_1.0/m6-a-gh-slot.sh`, untracked, lane-local
# — never shared, never tested). This is the promotion: ONE `gh-slot.sh` lives
# in the skill so the next lane inherits it instead of re-deriving it.
#
# EVERY PATH IS AN ARGUMENT (§15.148): the slot file is given by the caller,
# never resolved from this script's own location or a hardcoded campaign path
# — the old lane-local copy hardcoded `/home/parso/forge/_1.0/.merge-slot`,
# which is exactly why it could not be shared across campaigns or tests.
#
# SCOPE: this wrapper holds the named slot, runs `gh` with the given
# arguments, and passes its exit code through unchanged. It does not judge
# which `gh` subcommands need serialising (the old lane-local copy special-
# cased `gh pr create/merge/...` as WRITES and refused `gh pr view/list/...`
# as READS that must never hold a campaign lock) — that policy is the
# caller's; a caller that wants it calls `gh` bare for reads and only reaches
# for gh-slot.sh around a mutation.
set -u

usage() { echo "usage: gh-slot.sh <slot-file> -- <gh args...>" >&2; }

SLOT="${1:-}"
if [ -z "$SLOT" ]; then
  echo "gh-slot.sh: refusing — no slot-file given" >&2
  usage
  exit 2
fi
shift

if [ "${1:-}" != "--" ]; then
  echo "gh-slot.sh: refusing — expected '--' before the gh args, got '${1:-<nothing>}'" >&2
  usage
  exit 2
fi
shift

if [ $# -eq 0 ]; then
  echo "gh-slot.sh: refusing — no gh args given after '--'" >&2
  usage
  exit 2
fi

SLOT_WAIT="${GH_SLOT_WAIT:-2400}"

mkdir -p "$(dirname "$SLOT")" || {
  echo "gh-slot.sh: refusing — could not create the slot file's directory: $(dirname "$SLOT")" >&2
  exit 2
}

exec flock -w "$SLOT_WAIT" "$SLOT" gh "$@"
