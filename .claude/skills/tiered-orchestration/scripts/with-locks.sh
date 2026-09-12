#!/usr/bin/env bash
# with-locks.sh — take the campaign's locks in the ONE ratified order, bounded,
# then run a command with them held. `forge-8vfn.7.6.83`.
#
#   with-locks.sh <campaign-dir> <suite|run|both> [--wait-secs N] -- <cmd...>
#
# THE ORDER IS THE POINT: suite-lock first, run-lock INSIDE it. Every lane takes
# these two and every lane hand-rolled the ordering, and the same defect arrived
# three ways in one day (874, 882, §15.499):
#
#   - a launcher waited for the suite-lock, then queued for the run-lock; a
#     sibling took the suite-lock in between and the story runner refused;
#   - a gate job waited for the run-lock, then queued for the suite-lock; a
#     sibling took the run-lock in between and `npm test` refused;
#   - the post-merge family flocked the suite-lock and never waited for the
#     run-lock at all, while running `npm test`, which refuses while a story run
#     holds it. Nothing was ever refused there — luck, not design.
#
# In all three the measurement was taken BEFORE a wait and described a box that
# had since changed. Fixing it per-script is how it recurred: the second script
# had not learned what the first did. So it is one writer, the way `heartbeat.sh`
# is one writer — and a lane that calls this cannot produce the shape.
#
# BOUNDED, ALWAYS. A lock is never held while sleeping unbounded on another: the
# wait is `flock -w` on both, default 600 s, and failing to get one exits a code
# that NAMES it rather than a generic 1.
#
# INERT OF SPEND (§15.494): it runs what it is given. The spend step lives in the
# caller, which is the only place that can hold a funding ruling.
#
# NEVER NAME A LOCK THE COMMAND ITSELF TAKES. Measured by deadlocking a gate:
# `gate.sh` takes `.suite-lock` on its own and detects "held by an ancestor pid"
# so an inner `flock` cannot block on its own caller — and that detection reads
# the INHERITED descriptor. This script closes both descriptors for the child
# (it must, or a killed wrapper never releases), so the ancestor becomes
# invisible: `gate.sh` reported "suite-lock: HELD BY AN UNNAMEABLE HOLDER — the
# inherited-fd shape" and waited on a lock its own caller held.
#
# The two properties are in genuine tension and both are wanted, so the rule is
# at the call site instead: name only the locks the command does NOT take. For a
# gate that is `run` — the lock `npm test` refuses under and `gate.sh` never
# takes — and the suite-lock stays gate.sh's own. Deliberately NOT enforced here:
# this script cannot know what its command locks, and a test for "do not do
# this" would have to deadlock to prove it.
#
# ON THE FIRST ARGUMENT. The bead writes `<worktree>`; this takes the CAMPAIGN
# dir, because that is where `.suite-lock` and `.run-lock` live and a tool given
# the worktree would have to resolve the campaign dir implicitly — §15.148's
# defect exactly, and the reason `gate.sh` takes both paths rather than deriving
# one. The command runs in the caller's cwd, so the worktree is the caller's to
# choose and never this file's to guess.
set -u

EX_USAGE=2
EX_NO_SUITE=71     # could not take .suite-lock within the bound
EX_NO_RUN=72       # could not take .run-lock within the bound

usage() {
  echo "usage: with-locks.sh <campaign-dir> <suite|run|both> [--wait-secs N] -- <cmd...>" >&2
  exit "$EX_USAGE"
}

CAMP="${1:-}"; MODE="${2:-}"
[ -n "$CAMP" ] && [ -n "$MODE" ] || usage
[ -d "$CAMP" ] || { echo "with-locks.sh: no such campaign dir: $CAMP" >&2; exit "$EX_USAGE"; }
case "$MODE" in suite|run|both) ;; *) echo "with-locks.sh: mode must be suite, run or both — got '$MODE'" >&2; usage ;; esac
shift 2

WAIT=600
while [ $# -gt 0 ]; do
  case "$1" in
    --wait-secs)
      [ $# -ge 2 ] || usage
      case "$2" in ''|*[!0-9]*) echo "with-locks.sh: --wait-secs takes a whole number of seconds, got '$2'" >&2; usage ;; esac
      WAIT="$2"; shift 2 ;;
    --) shift; break ;;
    # A TYPO IN A FLAG MUST NOT READ AS "no options given" — `gate.sh` carries
    # the same refusal for the same reason (`forge-8vfn.6.9`).
    *) echo "with-locks.sh: unexpected argument '$1' before --" >&2; usage ;;
  esac
done
[ $# -ge 1 ] || { echo "with-locks.sh: no command after --" >&2; usage; }

ts() { date -u +%H:%M:%S; }

# §15.483 — a FREE reading is the absence of an ATTRIBUTABLE holder. `/proc/locks`
# rows carry a pid; a holder that cannot be attributed is named UNNAMEABLE rather
# than reported as absent, because "nobody holds it" and "I cannot tell who does"
# are different statements and only one of them is safe to act on.
name_holder() {
  local path="$1" ino pid cwd out=""
  ino=$(stat -c %i "$path" 2>/dev/null) || { printf 'UNNAMEABLE (cannot stat the lock file)'; return; }
  while read -r _ _ _ _ pid _ minor _; do
    case "$minor" in *":$ino") ;; *) continue ;; esac
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
    out="$out $pid(cwd ${cwd:-gone})"
  done < <(awk '{print $1, $2, $3, $4, $5, $6, $6, $7}' /proc/locks 2>/dev/null | sed 's/$//')
  [ -n "$out" ] && printf '%s' "$out" || printf 'UNNAMEABLE (no /proc/locks row names an owner)'
}

take() { # take <fd> <path> <label> <failure-exit>
  local fd="$1" path="$2" label="$3" code="$4"
  eval "exec $fd>\"\$path\"" || { echo "$(ts) with-locks: cannot open $path" >&2; exit "$code"; }
  if flock -w "$WAIT" "$fd"; then
    echo "$(ts) with-locks: $label taken"
    return 0
  fi
  # NAME THE LOCK, never a generic failure: a caller retrying blind cannot tell
  # which of two waits it lost, and the two have different remedies.
  echo "$(ts) with-locks: TIMED OUT after ${WAIT}s waiting for $label — held by:$(name_holder "$path")" >&2
  exit "$code"
}

# The trap releases explicitly on the way out, including SIGTERM. Process exit
# would close the descriptors anyway; the trap is what makes a killed wrapper
# release PROMPTLY rather than whenever its children happen to finish.
trap 'flock -u 8 2>/dev/null; flock -u 9 2>/dev/null' EXIT

# THE ORDER. Suite first, run inside it. `both` is the only mode where the order
# can be got wrong, which is why the order lives here and not in eleven callers.
case "$MODE" in
  suite) take 8 "$CAMP/.suite-lock" ".suite-lock" "$EX_NO_SUITE" ;;
  run)   take 9 "$CAMP/.run-lock"   ".run-lock"   "$EX_NO_RUN"   ;;
  both)  take 8 "$CAMP/.suite-lock" ".suite-lock" "$EX_NO_SUITE"
         take 9 "$CAMP/.run-lock"   ".run-lock"   "$EX_NO_RUN"   ;;
esac

# THE CHILD MUST NOT INHERIT THE LOCK DESCRIPTORS. `exec 8>` opens an fd that a
# child inherits, and an inherited fd keeps the lock alive after this wrapper
# dies — so a killed wrapper would "release" in its trap and the lock would stay
# held by `sleep`/`npm`/whatever it started, with no row naming this script. That
# is worse than not trapping at all: the holder becomes unattributable. Closing
# both fds for the child (`8>&- 9>&-`) makes the wrapper the only holder, which
# is what lets the trap below mean what it says.
# RUN IT IN THE BACKGROUND AND `wait`. A bash trap does NOT fire while a
# FOREGROUND child runs — it is deferred until that child exits — so a wrapper
# holding a lock around `sleep 30` would sit on the lock for the full 30 s after
# a SIGTERM, and "the trap releases it" would be a claim its own door disproves.
# `wait` is interruptible, so the handler runs at once: it kills the child (an
# orphan outliving the wrapper is the worse failure) and exits.
"$@" 8>&- 9>&- &
CHILD=$!
trap 'kill -TERM "$CHILD" 2>/dev/null; wait "$CHILD" 2>/dev/null; exit 143' TERM
trap 'kill -INT  "$CHILD" 2>/dev/null; wait "$CHILD" 2>/dev/null; exit 130' INT
wait "$CHILD"
RC=$?
echo "$(ts) with-locks: command exited $RC; releasing"
exit "$RC"
