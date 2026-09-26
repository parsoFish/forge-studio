#!/usr/bin/env bash
# merge-state-precheck.sh <pr> — is this PR's head even capable of running checks?
#
# forge-8vfn.8.1.26, T1 ruling 1633. Split out of merge-slot.sh (which was
# pushing past the 800-line cap) the same way ci-terminal.sh and
# pin-precheck.sh already sit beside it: a SIBLING merge-slot.sh resolves via
# its own $HERE, never invented from this file's own location (§15.148).
#
#   merge-state-precheck.sh <pr>
#     exit 0   mergeStateStatus is CLEAN/BLOCKED/BEHIND/HAS_HOOKS/UNSTABLE —
#              proceed; one informational line on stdout
#     exit 18  DIRTY — the named MERGE-STATE-DIRTY reason on stdout
#     exit 19  UNKNOWN after the bounded retry, an unreadable `gh` call, or
#              any value this script does not recognise — the named
#              MERGE-STATE-UNKNOWN reason on stdout
#
# WHY THIS EXISTS. GitHub runs NO pull_request workflow at all on a head whose
# mergeStateStatus is DIRTY — not green, not red, NOTHING. D's #971 sat DIRTY
# on a QUARRY.md conflict with main and merge-slot.sh never noticed: a
# DIRTY-but-not-BEHIND head makes `gh pr update-branch` a no-op success (there
# is nothing behind to bring in), so merge-slot.sh's own UPDATE-BRANCH-
# CONFLICT door — which fires only when update-branch ITSELF meets a conflict
# (T1 1275) — never sees it, and the loop sailed straight into
# `ci-terminal.sh --wait`, which read NO_CHECKS every 30s for the FULL 2400s
# window before refusing CI-NOT-GREEN. True, but it hid a cause knowable from
# one read, first, for free.
#
# NOT THE §611/§15.339 QUESTION. merge-slot.sh's own comment above
# `cap_check_head` already refuses to trust `mergeStateStatus` for "has main
# moved since I measured" — "BEHIND is derived and can lag, and a stale CLEAN
# is the same lie in a friendlier voice" — and nothing here reopens that:
# this reads the SAME field for a different, narrower question ("can GitHub
# compute checks for this head AT ALL") that nothing else in the merge
# protocol answers. Only DIRTY says no. CLEAN, BLOCKED (checks or reviews
# pending — the ordinary pre-merge state), BEHIND (resolved by merge-slot.sh's
# own update-branch step), HAS_HOOKS and UNSTABLE all proceed.
#
# UNKNOWN IS NEVER A SAFE DEFAULT (§6.15). GitHub may still be computing the
# merge, so this re-reads a BOUNDED number of times with a short sleep before
# treating it as a verdict — proceeding on a computing PR would read CLEAN by
# accident, and refusing on the first UNKNOWN would park a PR that was going
# to settle in seconds. Only a merge state that is STILL unknown after the
# bound refuses, with its own word, never folded into DIRTY's.
#
# A FAILED OR EMPTY READ IS UNKNOWN, NEVER CLEAN — the same instinct as every
# empty-read refusal in merge-slot.sh (§15.296). `gh` failing here says
# nothing about the PR's merge state, so it takes the identical bounded retry
# and the identical refusal as a literal UNKNOWN string, never a silent
# fall-through into "proceed". Anything unrecognised (a future GitHub value)
# refuses the same way, for the same reason: unrecognised is exactly as
# unknown as no state at all.
#
# ENV, same idiom as every other knob in merge-slot.sh: overridable, with the
# production values as defaults, so an unset environment behaves exactly as
# designed and a door suite can zero the sleep without touching the code.
#   MERGE_SLOT_MERGEABLE_RETRIES            bounded re-read count (default 4)
#   MERGE_SLOT_MERGEABLE_RETRY_SLEEP_SECS   sleep between re-reads (default 15)
set -u
PR="${1:?usage: merge-state-precheck.sh <pr>}"
GH() { GH_TOKEN="$(gh auth token --user parsoFish)" gh "$@"; }
RETRIES="${MERGE_SLOT_MERGEABLE_RETRIES:-4}"
SLEEP_RETRY="${MERGE_SLOT_MERGEABLE_RETRY_SLEEP_SECS:-15}"
read_state() { GH pr view "$PR" --json mergeStateStatus --jq .mergeStateStatus 2>/dev/null; }

STATE=""
try=0
while :; do
  try=$((try + 1))
  STATE="$(read_state)"
  case "$STATE" in
    ''|UNKNOWN)
      [ "$try" -lt "$RETRIES" ] || break
      sleep "$SLEEP_RETRY" ;;
    *) break ;;
  esac
done

case "$STATE" in
  DIRTY)
    echo "MERGE-STATE-DIRTY — PR $PR has merge conflicts with its base — GitHub runs no checks on it; merge the base locally, resolve, re-gate"
    exit 18 ;;
  CLEAN|BLOCKED|BEHIND|HAS_HOOKS|UNSTABLE)
    echo "mergeStateStatus=$STATE — proceeding"
    exit 0 ;;
  *)
    echo "MERGE-STATE-UNKNOWN — PR $PR's mergeStateStatus read '${STATE:-<empty>}' after $try read(s); GitHub has not settled it (or gh could not be read), and unknown is never a safe default (§6.15). Re-run."
    exit 19 ;;
esac
