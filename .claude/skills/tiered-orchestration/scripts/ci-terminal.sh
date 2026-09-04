#!/usr/bin/env bash
# ci-terminal.sh — the one CI predicate a lane's merge waits on.
#
#   ci-terminal.sh <pr> <expected-head-sha>                 one probe, one line
#   ci-terminal.sh --wait <pr> <expected-head-sha> [max-s]  poll every 30 s until terminal
#   ci-terminal.sh classify <want-head> <got-head> < rows   the classifier alone, rows on stdin
#
# Rows are `name|status|conclusion`, one per line — exactly what `gh pr view --json
# statusCheckRollup` yields. `classify` is a PURE function of those rows plus the two SHAs: no
# network, no `gh`, no `jq`. That is what makes it testable (scripts/ci-terminal.test.ts) and it
# is why the outcomes below are ordered the way they are.
#
#   TERMINAL_SUCCESS <n>/<n> <head>   every check COMPLETED + SUCCESS on the expected head  exit 0
#   TERMINAL_FAILURE <names> <head>   at least one check COMPLETED and not SUCCESS           exit 1
#   PENDING <done>/<total> <head>     a check not COMPLETED — an EMPTY conclusion is pending exit 2
#   NO_CHECKS <head>                  zero checks reported — never a green gate              exit 2
#   API_UNAVAILABLE                   the read returned nothing — retryable, not a state     exit 2
#   HEAD_MISMATCH want=<sha> got=<sha>  the PR head moved                                    exit 3
#
# PRECEDENCE, and why (each line is an incident):
#   1 API_UNAVAILABLE — an empty read is not a state (§15.103: `until [ "$(gh …)" != "OPEN" ]`
#     fired FALSE-positive on an API flap and claimed a merge).
#   2 HEAD_MISMATCH  — checks about another commit say nothing about this one, however green
#     (§15.92: a waiter matching the previous head's checks looked like a finished run).
#   3 NO_CHECKS      — a gate that reports nothing is not a green gate.
#   4 TERMINAL_FAILURE — a failure cannot be undone by a sibling finishing (§15.154: PENDING 3/4
#     reported for 45 minutes on a head whose build-and-test had already FAILED).
#   5 PENDING        — only once nothing above can still change the answer.
#   6 TERMINAL_SUCCESS.
#
# Never a standalone `jq`: it is not installed on the campaign host, and an undefined command
# silently takes the failure branch — a predicate that cannot be satisfied is indistinguishable
# from work still running (§15.84). `gh --jq` is gh's own embedded filter and does work.
set -u

# classify <want-head> <got-head>, rows on stdin. The whole decision, and nothing else.
classify() {
  local want="$1" got="$2" rows total=0 done_=0 fails="" name status concl
  [ -n "$got" ] || { echo "API_UNAVAILABLE"; return 2; }
  case "$got" in "$want"*) ;; *) echo "HEAD_MISMATCH want=${want:0:8} got=${got:0:8}"; return 3 ;; esac
  rows="$(cat)"
  while IFS='|' read -r name status concl; do
    [ -n "$name" ] || continue
    total=$((total + 1))
    if [ "$status" = "COMPLETED" ] && [ -n "$concl" ]; then
      done_=$((done_ + 1))
      [ "$concl" != "SUCCESS" ] && fails="$fails $name:$concl"
    fi
  done <<< "$rows"
  [ "$total" -eq 0 ] && { echo "NO_CHECKS ${got:0:8}"; return 2; }
  [ -n "$fails" ] && { echo "TERMINAL_FAILURE$fails (done $done_/$total) ${got:0:8}"; return 1; }
  [ "$done_" -lt "$total" ] && { echo "PENDING $done_/$total ${got:0:8}"; return 2; }
  echo "TERMINAL_SUCCESS $done_/$total ${got:0:8}"; return 0
}

case "${1:-}" in
  classify)
    shift; classify "${1:?want head}" "${2-}"; exit $? ;;
  --wait)
    shift
    maxs="${3:-3600}"; t0=$(date +%s)
    while :; do
      out="$("$0" "$1" "$2")"; rc=$?
      echo "$(date '+%H:%M:%S') $out"
      [ $rc -ne 2 ] && exit $rc
      if [ $(( $(date +%s) - t0 )) -ge "$maxs" ]; then
        # A waiter that reaches its ceiling reports "predicate never true" as a DISTINCT
        # outcome — never as "still pending" (§15.84).
        echo "WAIT_TIMEOUT after ${maxs}s (predicate never true — §15.84)"; exit 4
      fi
      sleep 30
    done ;;
esac

pr="${1:?usage: ci-terminal.sh <pr> <expected-head-sha> | --wait <pr> <sha> [max-s] | classify <want> <got> < rows}"
want="${2:?expected head sha}"
out="$(gh pr view "$pr" --json headRefOid,statusCheckRollup \
        --jq '.headRefOid + "\n" + ([.statusCheckRollup[] | "\(.name // .context)|\(.status // "")|\(.conclusion // "")"] | join("\n"))' 2>/dev/null)" || out=""
head="$(printf '%s\n' "$out" | head -1)"
printf '%s\n' "$out" | tail -n +2 | classify "$want" "$head"
exit $?
