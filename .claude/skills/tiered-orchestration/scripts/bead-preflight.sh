#!/usr/bin/env bash
# bead-preflight — run BEFORE writing a bead id into a commit, a PR, or a close.
#
# WHY THIS IS A SCRIPT AND NOT A LINE IN THE PROTOCOL. Lane M6-D closed M6-C's
# `forge-8vfn.7.6.56` with its own reason text, having INVENTED the id. The rule
# "check whose bead it is before you write to it" was then written down as
# §15.464 — and the same lane did it again, to M6-C's `7.6.60`, with that rule
# on the record and named for the first instance. A rule you have to remember is
# not a mechanism. The failure mode is not carelessness: an invented id RESOLVES,
# to a real record, that looks plausible, because the tree is dense and the
# numbers are adjacent.
#
#   bead-preflight.sh <id> --expect "<text you believe is in the record>"
#   bead-preflight.sh --new "<title>" <parent> [type] [priority]
#
# `--expect` is REQUIRED and takes no default. The whole defect is a human
# reading a title and seeing what they expected to see, so the caller states
# what they believe FIRST and the tool compares — an assertion made before the
# answer is visible is the only kind that can fail. A missing `--expect` refuses
# rather than falling back to "print it and let them look", which is the
# behaviour that lost two beads.
#
# EXIT: 0 the id resolves AND matches · 2 usage · 3 does not resolve · 4 resolves
# to something else (the 7.6.56/7.6.60 shape, and the one worth a distinct code).
set -u
BD="${BEAD_PREFLIGHT_BD:-bd}"   # injectable so this file has a door that does
                                # not need a beads database to run.
usage() {
  echo "usage: bead-preflight.sh <bead-id> --expect \"<text you believe is in the record>\"" >&2
  echo "       bead-preflight.sh --new \"<title>\" <parent> [type] [priority]" >&2
  exit 2
}

case "${1:-}" in
  --new)
    shift
    TITLE="${1:-}"; PARENT="${2:-}"
    # The parent is an ARGUMENT. The lane version of this script hardcoded one
    # lane's subtree, which is exactly the kind of default that mints a bead in
    # the wrong place and then reads back as if it had always belonged there.
    [ -n "$TITLE" ] && [ -n "$PARENT" ] || usage
    exec $BD create "$TITLE" -t "${3:-task}" -p "${4:-3}" --parent "$PARENT" ;;
  ""|-*) usage ;;
esac

ID="$1"; shift
EXPECT=""
HAVE_EXPECT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --expect) [ $# -ge 2 ] || usage; EXPECT="$2"; HAVE_EXPECT=1; shift 2 ;;
    # A TYPO IN A FLAG THAT GUARDS AN ATTRIBUTION MUST NOT READ AS "no
    # expectation stated" — that is this script's own defect, arriving through
    # its argument parser.
    *) echo "bead-preflight.sh: unexpected argument '$1'" >&2; usage ;;
  esac
done
[ "$HAVE_EXPECT" -eq 1 ] && [ -n "$EXPECT" ] || usage

OUT=$($BD show "$ID" 2>&1) || {
  echo "REFUSING: \`$BD show $ID\` failed — the id does not resolve. Mint one with --new."
  exit 3
}

# Case-insensitive substring, because the caller is stating a belief about a
# title, not quoting one: requiring an exact match would train the user to
# paste the title back out of the record, which asserts nothing at all.
if printf '%s' "$OUT" | grep -qiF -- "$EXPECT"; then
  printf '%s\n' "$OUT" | head -3
  # SHOW THE LINE THAT MATCHED, not just the verdict. Found by dogfooding this
  # script on `forge-8vfn.7.6.19`: it printed the first three lines and said
  # "contains \"ledger\"" when the word appears further down, in the body. A
  # tool whose evidence and whose claim are about different text is the exact
  # thing this script exists to stop — a reader checks the visible half and
  # believes the invisible one.
  echo "MATCH: $ID contains \"$EXPECT\", here:"
  printf '%s\n' "$OUT" | grep -inF -- "$EXPECT" | head -3 | sed 's/^/  /'
  echo "Safe to attribute."
  exit 0
fi

printf '%s\n' "$OUT" | head -3
echo "---"
echo "REFUSING: $ID RESOLVES, but nothing in it contains \"$EXPECT\"."
echo "This is the 7.6.56/7.6.60 shape exactly: an id that was invented, resolved"
echo "to a real record belonging to someone else, and read as plausible. Do not"
echo "write to this id. Find the right one, or mint one with --new."
exit 4
