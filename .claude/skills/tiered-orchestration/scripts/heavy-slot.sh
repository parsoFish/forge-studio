#!/usr/bin/env bash
# heavy-slot.sh — one fair, memory-aware admission queue for heavy jobs sharing
# `.suite-lock`. park m7-c-004 §A (rows 32/53/44), T1 ruling 1227: BUILD it and
# its tests; wire nothing — no existing script or doc calls this yet.
#
#   heavy-slot.sh <campaign-dir> <suite|story> -- <cmd> [args…]
#   heavy-slot.sh <campaign-dir> status
#
# THE PROBLEM MEASURED. A bare `flock` on `.suite-lock` gives its waiters no
# ordering: measured a 6-deep queue same day, a waiter's position invisible,
# and a bounded wait losing to a LATER arrival because `flock`'s internal
# kernel queue is not FIFO. This tool fixes that by never letting more than
# one heavy-slot CONTENDER attempt the lock at a time: everyone except the
# lowest live ticket just waits on POSITION, never touching the lock at all.
# Only the ticket at the front ever calls `flock`, so the ordering the ticket
# file names IS the ordering that runs — the kernel's own queue among
# heavy-slot's contenders never gets a vote.
#
# EVERY EXISTING BARE-`flock` USER KEEPS EXCLUDING THIS TOOL, ON PURPOSE: the
# admitted ticket takes the SAME `.suite-lock`, so a sibling script that has
# never heard of tickets still serialises correctly against it, in both
# directions.
#
# GATE ON A MONOTONIC FACT, NEVER A SNAPSHOT (§15.393/407/424, M6-COMMON): this
# file never announces "the lock is free, take it" and then takes it in a
# second step — the only fact it ever acts on is the return of its OWN
# non-blocking `flock -n` call, which is atomic. Position and memory are read
# fresh on every poll and decide only whether to ATTEMPT that call, never
# whether the attempt is presumed to succeed. Reporting who currently holds
# the lock (for the WAITING line) goes through `lock-state.sh`, which is
# already careful about the §15.422 trap this file must not re-add: an fd open
# on a lock is not a hold, only `/proc/locks`' holder rows (no `->`) are.
#
# NEVER THE WALL CLOCK for any bound or age (this host's clock steps back
# ~2.9s every ~30s). Every elapsed-time decision here reads `/proc/uptime`;
# `ts()` below is cosmetic log-line dressing only, exactly as it is in
# `gate.sh` and `with-locks.sh`, and decides nothing.
#
# TWO BOUNDS, ONE EXIT CODE. `HEAVY_SLOT_MAX_WAIT` (default 3600s) bounds the
# whole wait, from ticket creation. `HEAVY_SLOT_LOCK_WAIT` (default 2400s,
# `gate.sh`'s own `SUITE_LOCK_WAIT` default) bounds only the time spent
# eligible-but-refused-the-lock-itself — the "flock held by a stranger" state.
# Either expiring is release-and-requeue (ruling 946: never hold-and-wait) —
# it removes its own ticket and exits 75, never leaving a queue position held
# by a process that gave up.
set -u

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOCK_STATE="$HERE/lock-state.sh"

EX_USAGE=2
EX_BOUNDED=75

die() { echo "heavy-slot.sh: $*" >&2; exit "$EX_USAGE"; }
usage() {
  cat >&2 <<'EOF'
usage:
  heavy-slot.sh <campaign-dir> <suite|story> -- <cmd> [args...]
  heavy-slot.sh <campaign-dir> status
EOF
  exit "$EX_USAGE"
}
# Wall-clock, for the human-readable prefix on log lines ONLY. Nothing below
# ever compares this value to anything — see the header note on why.
ts() { date -u +%H:%M:%S; }

# ---- monotonic time and process facts, never the wall clock ---------------

# Whole seconds since boot. `/proc/uptime` does not step backward on this box;
# `date` does.
now_s() { awk 'NR==1{printf "%d", $1}' /proc/uptime; }

# `state` is the field immediately after the LAST ')' in /proc/<pid>/stat — the
# `comm` field can itself contain spaces and parentheses, so counting fields
# from the left mis-columns it (gate.sh §"PPid FROM status, NOT FIELD 4").
pid_state() { sed 's/.*) //' "/proc/$1/stat" 2>/dev/null | awk '{print $1}'; }

# A ticket's pid is LIVE iff /proc/<pid> exists AND it is not a zombie. A
# zombie has already exited; kill -0 would still succeed on it, which is
# exactly the trap the brief calls out — "gone or a zombie" are the same fact
# from this tool's point of view: neither can hold a flock.
pid_is_live() {
  local pid="$1" state
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ -d "/proc/$pid" ] || return 1
  state="$(pid_state "$pid")"
  [ -n "$state" ] && [ "$state" != "Z" ]
}

# Age from the KERNEL's own record of when the pid started (stat field 22,
# clock ticks since boot — field 20 of the string left after stripping
# "pid (comm) ", the same idiom `lanes.sh`'s `proc_start_epoch` already uses in
# this repo), against `/proc/uptime` now. Never derived from a value this tool
# wrote into a file earlier — that would be exactly the snapshot-as-fact shape
# §15.424 names.
pid_age_seconds() {
  local pid="$1" ticks hz
  case "$pid" in ''|*[!0-9]*) echo '?'; return ;; esac
  ticks="$(sed 's/.*) //' "/proc/$pid/stat" 2>/dev/null | awk '{print $20}')"
  case "$ticks" in ''|*[!0-9]*) echo '?'; return ;; esac
  hz="$(getconf CLK_TCK 2>/dev/null || echo 100)"
  case "$hz" in ''|*[!0-9]*|0) hz=100 ;; esac
  echo $(( $(now_s) - ticks / hz ))
}

# ---- memory: MemAvailable, never MemFree -----------------------------------

# `HEAVY_SLOT_MEMINFO` is a test seam, exactly like `FORGE_PROC_LOCKS` in
# gate.sh: `/proc/meminfo` cannot be made to hold a chosen value for a test, so
# a caller may point this at a fake file. No campaign wrapper sets it.
get_mem_available_kb() {
  awk '/^MemAvailable:/{print $2; f=1} END{if (!f) print ""}' "${HEAVY_SLOT_MEMINFO:-/proc/meminfo}" 2>/dev/null
}

floor_for_kind() {
  case "$1" in
    suite) echo "${HEAVY_SLOT_FLOOR_SUITE_KB:-4194304}" ;;  # 4 GiB
    story) echo "${HEAVY_SLOT_FLOOR_STORY_KB:-6291456}" ;;  # 6 GiB
  esac
}

# ---- the ticket file: <campaign>/queue/<seq>-<pid>.ticket ------------------

# Monotonic sequence, allocated under its OWN flock — never from the wall
# clock (the header's warning verbatim). The lock is `.seq`; the counter is a
# SEPARATE file, `.seq.count`, so a reader can `cat` the counter without racing
# the lock file's own open/flock dance. Run in a subshell so the fd and its
# lock are released the instant the subshell exits, win or lose.
allocate_seq() {
  local queue="$1"
  local lockf="$queue/.seq" countf="$queue/.seq.count"
  (
    exec 9>"$lockf" || exit 1
    flock -w 30 9 || { echo "heavy-slot.sh: could not take the ticket-sequence lock within 30s: $lockf" >&2; exit 1; }
    local cur=0
    if [ -f "$countf" ]; then
      read -r cur < "$countf" 2>/dev/null || cur=0
    fi
    case "$cur" in
      ''|*[!0-9]*)
        echo "heavy-slot.sh: WARNING — $countf held a non-numeric sequence '$cur'; resetting to 0" >&2
        cur=0 ;;
    esac
    local next=$((cur + 1))
    printf '%d\n' "$next" > "$countf.tmp.$$" && mv -f "$countf.tmp.$$" "$countf"
    printf '%d' "$next"
  )
}

# Argv, quoted for display — used ONLY for the ticket's `cmd=` line and
# `status`'s truncated column, never re-executed from disk.
quote_argv() {
  local out='' a q
  for a in "$@"; do printf -v q '%q' "$a"; out+=" $q"; done
  printf '%s' "${out# }"
}

# A ticket's `key=value` line, read by stripping only the leading `key=` — the
# `cmd=` line's own value may itself contain `=` characters, so this must never
# split on every `=` in the file.
ticket_field() {
  grep -m1 "^$2=" "$1" 2>/dev/null | sed "s/^$2=//"
}

list_ticket_files() {
  local queue="$1" f
  ( shopt -s nullglob; for f in "$queue"/*.ticket; do printf '%s\n' "$f"; done ) | sort
}

# Dead tickets are reaped on every read, from every caller (`status` included).
# A ticket whose pid is gone or a zombie cannot hold anything and cannot be
# waited behind — leaving it would starve every ticket enqueued after it.
reap_dead_tickets() {
  local queue="$1" f pid
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    pid="$(ticket_field "$f" pid)"
    if ! pid_is_live "$pid"; then
      echo "$(ts) heavy-slot.sh: reaping dead ticket $(basename "$f") (pid ${pid:-?} gone or zombie)" >&2
      rm -f -- "$f"
    fi
  done < <(list_ticket_files "$queue")
}

# The one line naming who currently holds `.suite-lock`, via the shared reader
# rather than a second `/proc/locks` classifier — `lock-state.sh`'s own header
# is the reason a second one keeps recurring in this codebase.
lock_state_say() {
  local out
  out="$("$LOCK_STATE" say "$1" 2>/dev/null)"
  [ -n "$out" ] && printf '%s' "$out" || printf 'UNREADABLE (lock-state.sh produced no output)'
}

truncate_cmd() {
  local s="$1" max=60
  if [ "${#s}" -gt "$max" ]; then printf '%s…' "${s:0:$((max - 1))}"; else printf '%s' "$s"; fi
}

# ---- status -----------------------------------------------------------------

cmd_status() {
  local camp="$1" queue="$1/queue"
  mkdir -p "$queue" 2>/dev/null || true
  reap_dead_tickets "$queue"
  local files total=0
  files="$(list_ticket_files "$queue")"
  [ -n "$files" ] && total=$(printf '%s\n' "$files" | wc -l)
  echo "heavy-slot queue: $queue ($total waiting)"
  local i=0
  if [ -n "$files" ]; then
    while IFS= read -r f; do
      i=$((i + 1))
      local seq pid lane kind cmd age
      seq="$(basename "$f" .ticket)"; seq="${seq%%-*}"
      pid="$(ticket_field "$f" pid)"
      lane="$(ticket_field "$f" lane)"
      kind="$(ticket_field "$f" kind)"
      cmd="$(ticket_field "$f" cmd)"
      age="$(pid_age_seconds "$pid")"
      printf '  %d) seq=%s pid=%s lane=%s kind=%s age=%ss cmd=%s\n' "$i" "$seq" "$pid" "$lane" "$kind" "$age" "$(truncate_cmd "$cmd")"
    done <<< "$files"
  fi
  echo "flock .suite-lock: $(lock_state_say "$camp/.suite-lock")"
}

# ---- argument parsing -------------------------------------------------------

CAMP_ARG="${1:-}"; SUB="${2:-}"
[ -n "$CAMP_ARG" ] && [ -n "$SUB" ] || usage
CAMP="$(cd -- "$CAMP_ARG" 2>/dev/null && pwd)"
[ -n "$CAMP" ] || die "no such campaign directory: $CAMP_ARG — this tool never defaults a destination (row 29); pass an existing directory"
shift 2

if [ "$SUB" = "status" ]; then
  [ $# -eq 0 ] || die "status takes no further arguments, got '$*'"
  cmd_status "$CAMP"
  exit 0
fi

KIND="$SUB"
case "$KIND" in
  suite|story) ;;
  *) die "kind must be 'suite' or 'story' — got '$KIND'" ;;
esac

[ "${1:-}" = "--" ] || die "expected -- before the command, got '${1:-<nothing>}'"
shift
[ $# -ge 1 ] || die "no command after --"

# ---- enqueue -----------------------------------------------------------------

QUEUE="$CAMP/queue"
mkdir -p "$QUEUE" || die "cannot create queue dir $QUEUE"

SEQ="$(allocate_seq "$QUEUE")" || die "could not allocate a ticket sequence number under $QUEUE"
SEQ_PADDED="$(printf '%010d' "$SEQ")"
TICKET="$QUEUE/${SEQ_PADDED}-$$.ticket"

FLOOR="$(floor_for_kind "$KIND")"
case "$FLOOR" in
  ''|*[!0-9]*) die "HEAVY_SLOT_FLOOR_${KIND^^}_KB must be a whole number of KB, got '$FLOOR'" ;;
esac

MEM0="$(get_mem_available_kb)"
TMP="$QUEUE/.tmp.$$.$RANDOM"
{
  printf 'pid=%s\n' "$$"
  printf 'lane=%s\n' "${FORGE_LANE:-unknown}"
  printf 'kind=%s\n' "$KIND"
  printf 'cwd=%s\n' "$PWD"
  printf 'mem_avail_kb_at_enqueue=%s\n' "${MEM0:-unknown}"
  printf 'cmd=%s\n' "$(quote_argv "$@")"
} > "$TMP" || die "cannot write ticket $TMP"
mv -f "$TMP" "$TICKET" || die "cannot place ticket $TICKET"

# ---- signals: remove the ticket, kill the child BY PID, never pkill --------

CHILD_PID=""
REMOVED=0
remove_ticket() { [ "$REMOVED" = 1 ] && return 0; rm -f -- "$TICKET" 2>/dev/null; REMOVED=1; }

# ALWAYS SIGTERM THE CHILD, even when WE were sent SIGINT. Measured while
# writing this: `"$@" &` backgrounds the command asynchronously in a
# non-interactive, non-job-control shell, and POSIX requires such a shell to
# set SIGINT and SIGQUIT to IGNORED in that child BEFORE it execs — a
# disposition `sleep`/most tools never reset, so `kill -INT "$CHILD_PID"`
# silently does nothing to it. SIGTERM carries no such carve-out and is not
# ignored, so it is what actually reaches the child; the two entry points
# still differ in the exit code THIS process reports (143 vs 130), which is
# the part of the contract that names which signal we ourselves received.
kill_child() { [ -n "$CHILD_PID" ] && kill -TERM "$CHILD_PID" 2>/dev/null; }

on_term() {
  if [ -n "$CHILD_PID" ]; then
    echo "$(ts) heavy-slot.sh: SIGTERM — killing child $CHILD_PID and removing ticket $(basename "$TICKET")" >&2
    kill_child
    wait "$CHILD_PID" 2>/dev/null
  else
    echo "$(ts) heavy-slot.sh: SIGTERM while waiting — removing ticket $(basename "$TICKET")" >&2
  fi
  remove_ticket
  exit 143
}
on_int() {
  if [ -n "$CHILD_PID" ]; then
    echo "$(ts) heavy-slot.sh: SIGINT — killing child $CHILD_PID and removing ticket $(basename "$TICKET")" >&2
    kill_child
    wait "$CHILD_PID" 2>/dev/null
  else
    echo "$(ts) heavy-slot.sh: SIGINT while waiting — removing ticket $(basename "$TICKET")" >&2
  fi
  remove_ticket
  exit 130
}
trap on_term TERM
trap on_int INT
# Belt-and-braces release on any other exit path (die() inside the wait loop,
# an unexpected `set -u` trip): an fd never opened makes this a silent no-op.
trap 'flock -u 8 2>/dev/null' EXIT

# ---- the wait loop: position, then memory, then the lock itself -----------
#
# Opened ONCE, outside the loop, and polled with `flock -n` — never a single
# blocking `flock -w`. A blocking call would go silent for up to
# HEAVY_SLOT_LOCK_WAIT seconds, and the brief requires a WAITING line at least
# once a minute even in the "flock held by a stranger" state.
exec 8>"$CAMP/.suite-lock" || die "cannot open $CAMP/.suite-lock"

MAX_WAIT="${HEAVY_SLOT_MAX_WAIT:-3600}"
LOCK_WAIT="${HEAVY_SLOT_LOCK_WAIT:-2400}"
ENQ_S="$(now_s)"
ELIGIBLE_SINCE=""
PRINTED_FIRST=0
LAST_PRINT="$ENQ_S"
POLL_INTERVAL=0.3

while true; do
  reap_dead_tickets "$QUEUE"

  FILES="$(list_ticket_files "$QUEUE")"
  TOTAL=0; POSITION=0; AHEAD=""
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    TOTAL=$((TOTAL + 1))
    if [ "$f" = "$TICKET" ]; then
      POSITION=$TOTAL
    elif [ "$POSITION" -eq 0 ]; then
      AHEAD="$(basename "$f")"
    fi
  done <<< "$FILES"

  if [ "$POSITION" -eq 0 ]; then
    echo "$(ts) heavy-slot.sh: FATAL — our own ticket $(basename "$TICKET") is missing from the queue; refusing to guess why" >&2
    exit 1
  fi

  MEM_KB="$(get_mem_available_kb)"
  MEM_OK=1
  case "$MEM_KB" in
    ''|*[!0-9]*) MEM_OK=0 ;;
    *) [ "$MEM_KB" -ge "$FLOOR" ] || MEM_OK=0 ;;
  esac

  ADMITTED=0
  if [ "$POSITION" -ne 1 ]; then
    REASON="position ${POSITION}/${TOTAL}, waiting behind ${AHEAD:-?}"
    ELIGIBLE_SINCE=""
  elif [ "$MEM_OK" -eq 0 ]; then
    REASON="memory: MemAvailable=${MEM_KB:-unreadable}KB below the ${KIND} floor ${FLOOR}KB (override with HEAVY_SLOT_FLOOR_${KIND^^}_KB)"
    ELIGIBLE_SINCE=""
  else
    [ -n "$ELIGIBLE_SINCE" ] || ELIGIBLE_SINCE="$(now_s)"
    if flock -n 8; then
      ADMITTED=1
    else
      REASON="flock held by:$(lock_state_say "$CAMP/.suite-lock")"
    fi
  fi

  if [ "$ADMITTED" -eq 1 ]; then
    echo "$(ts) heavy-slot.sh: ADMITTED pos=1/${TOTAL} mem=${MEM_KB}KB floor=${FLOOR}KB — running" >&2
    break
  fi

  NOW="$(now_s)"
  ELAPSED=$((NOW - ENQ_S))
  if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
    echo "$(ts) heavy-slot.sh: BOUNDED WAIT EXCEEDED after ${ELAPSED}s (HEAVY_SLOT_MAX_WAIT=${MAX_WAIT}s) — releasing ticket and requeuing, never hold-and-wait (ruling 946); reason at expiry: $REASON" >&2
    remove_ticket
    exit "$EX_BOUNDED"
  fi
  if [ -n "$ELIGIBLE_SINCE" ]; then
    LOCK_ELAPSED=$((NOW - ELIGIBLE_SINCE))
    if [ "$LOCK_ELAPSED" -ge "$LOCK_WAIT" ]; then
      echo "$(ts) heavy-slot.sh: FLOCK WAIT EXCEEDED after ${LOCK_ELAPSED}s (HEAVY_SLOT_LOCK_WAIT=${LOCK_WAIT}s) — releasing ticket and requeuing; reason at expiry: $REASON" >&2
      remove_ticket
      exit "$EX_BOUNDED"
    fi
  fi

  if [ "$PRINTED_FIRST" -eq 0 ] || [ $((NOW - LAST_PRINT)) -ge 60 ]; then
    echo "$(ts) heavy-slot.sh: WAITING pos=${POSITION}/${TOTAL} ahead=${AHEAD:-none} reason=$REASON" >&2
    PRINTED_FIRST=1
    LAST_PRINT="$NOW"
  fi

  sleep "$POLL_INTERVAL"
done

# ---- run the command, fd 8 NOT inherited -----------------------------------
#
# `"$@" 8>&- &` closes fd 8 in the CHILD before it execs, without touching
# this shell's own fd 8 — so this script remains the sole holder for the
# child's whole run, and a killed child can never be mistaken for a lock
# holder with no row naming this script (with-locks.sh's own documented
# reason for the same idiom). Backgrounded and `wait`ed rather than run in the
# foreground so SIGTERM/SIGINT's trap fires at once instead of being deferred
# until the child exits.
"$@" 8>&- &
CHILD_PID=$!
wait "$CHILD_PID"
RC=$?
CHILD_PID=""
flock -u 8 2>/dev/null
remove_ticket
exit "$RC"
