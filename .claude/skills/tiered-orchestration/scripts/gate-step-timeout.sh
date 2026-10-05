#!/usr/bin/env bash
# gate-step-timeout.sh — bound one gate step (gate.sh was at its 800-line cap).
#
# Why: a hung `npm test` held a gate and the suite-lock for 64 minutes, because
# the step had no timeout. This runs the command in its OWN process group,
# waits, and on expiry kills that whole group — SIGTERM, a short grace, then
# SIGKILL — so a SIGTERM-ignoring grandchild cannot outlive the step.
#
#   gate-step-timeout.sh <seconds> -- <cmd> [args…]
#
# Exit: the command's own exit code; 124 on timeout, after exactly one stderr
# line `TIMEOUT after <n>s: <cmd>`. Grace: GATE_STEP_TIMEOUT_GRACE_SECS (10).
# Kills by the RECORDED pgid only — never by name.
set -u

secs="${1:?usage: gate-step-timeout.sh <seconds> -- <cmd> [args…]}"
[ "${2:-}" = "--" ] || { echo "usage: gate-step-timeout.sh <seconds> -- <cmd> [args…]" >&2; exit 2; }
shift 2
[ "$#" -gt 0 ] || { echo "gate-step-timeout.sh: no command given" >&2; exit 2; }
case "$secs" in ''|*[!0-9]*) echo "gate-step-timeout.sh: seconds must be an integer, got '$secs'" >&2; exit 2 ;; esac
grace="${GATE_STEP_TIMEOUT_GRACE_SECS:-10}"

# setsid makes the child a session + group leader: its pid IS its pgid.
setsid "$@" &
child=$!
pgid="$child"

# Poll rather than a background `sleep`, so the helper leaves nothing behind.
deadline=$((SECONDS + secs))
while kill -0 "$child" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do
  sleep 0.2
done

if kill -0 "$child" 2>/dev/null; then
  echo "TIMEOUT after ${secs}s: $*" >&2
  kill -TERM -- "-$pgid" 2>/dev/null
  gdeadline=$((SECONDS + grace))
  while kill -0 "$child" 2>/dev/null && [ "$SECONDS" -lt "$gdeadline" ]; do
    sleep 0.2
  done
  kill -KILL -- "-$pgid" 2>/dev/null
  wait "$child" 2>/dev/null
  exit 124
fi

wait "$child"
