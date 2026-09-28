#!/usr/bin/env bash
# lock-holders.sh — WHO HOLDS A LOCK, confirmed rather than merely named.
# T1 ruling 1352/1353, M7 findings row 80. Sourced by with-locks.sh and
# gate.sh; also runnable directly for doors (`lock-holders.sh state <path>`).
#
# THE DEFECT THIS REPLACES. `/proc/locks` does not see a lock held through the
# campaign's own `exec N>file; flock -n N` idiom — which is exactly how
# heavy-slot.sh, with-locks.sh and gate.sh itself hold `.suite-lock`. Measured
# by lane D three times: the hold is real (a fresh `flock -n` on the same
# path fails) but `/proc/locks` has ZERO rows for it. The reason: `flock -n N`
# there targets an ALREADY-OPEN fd rather than a path — it forks the `flock`
# binary, which locks the shared open file description and exits at once
# (no command follows), so the pid `/proc/locks` would have attributed the
# lock to is gone a moment later. The lock persists — the parent shell's own
# copy of the fd keeps the open file description alive, and its own
# `/proc/<pid>/fdinfo/<fd>` carries the lock line regardless of which process
# actually issued the syscall (measured: the PARENT's fdinfo shows it even
# though a transient forked `flock` child did the acquiring) — but the
# listing does not, because it names a PROCESS and that process is gone.
# Contrast `flock <path> <command>`, which execs the command directly and
# keeps the SAME pid alive — that form DOES leave a `/proc/locks` row. Both
# are the identical advisory lock at the kernel level; only the listing's
# ATTRIBUTION differs.
#
# So ANY holder-detector that trusts `/proc/locks` alone reads a genuinely
# held lock as free the moment it is held this way — which is what let
# with-locks.sh and gate.sh each self-deadlock waiting on a lock their own
# ancestor held (row 80).
#
# THE RULE, AND WHY NAMING ALONE IS NOT ENOUGH EVEN WITH A GLOBAL PROBE. A
# first version of this file paired (a) an fd-scan naming every process with
# the lock file open with (b) one global `flock -n <file> true` probe
# confirming SOMETHING holds it. That over-reports the moment more than one
# process has the file open — which is not rare: `gate.sh`'s own fallback
# calls this AFTER its own `exec 9>path; flock -n 9` has already failed, so
# the CHECKING process itself is one of the openers the scan finds. A second
# gate colliding with a first was misread as ANCESTOR of ITSELF (the pid
# comparison in the walk starts from its own pid), because the global probe
# says "held" and the scan cannot tell the checker's own failed-to-acquire fd
# apart from the real holder's. Doored as the regression in
# `gate-holder-sidecar.test.ts`.
#
# THE FIX IS PER-CANDIDATE, NOT GLOBAL: `/proc/<pid>/fdinfo/<fd>` carries a
# `lock:` line ONLY while THAT SPECIFIC fd currently holds an active flock —
# present the instant it is acquired, gone the instant it is released
# (`flock -u`), even though the fd itself stays open (measured empirically
# while writing this). So a candidate is a confirmed holder iff its OWN
# matching fd shows the line — never "the file is held by someone and this
# process happens to have it open too". This is the exact fact `/proc/locks`
# cannot supply for this shape, and it disambiguates every opener, including
# the checker's own.
#
# `/proc/locks` is not consulted here at all — this is a REPLACEMENT for that
# read, not a layer on top of it, for the two campaign readers whose OWN
# correctness (not merely a courtesy message) depends on getting this right:
# with-locks.sh's suite-lock ancestor check, and gate.sh's (which ALSO keeps
# its existing /proc/locks classifier as the first attempt, both because that
# classifier has its own doors for a real historical bug — S9G1's blocked-
# waiter-vs-holder row parsing — and because it is the CHEAPER read; this
# file's fd-scan is the fallback for what it cannot see, not its replacement).
# `scripts/stories/lock-guard.mjs` is EXPLICITLY OUT OF SCOPE (lane D's own
# fix, #911, is landing there) — this file is never sourced from JS and
# never imports it.
set -u

# Computed ONCE: every candidate pid is checked against it, and `id -u` is a
# fork gate.sh/with-locks.sh would otherwise pay per pid on a box with
# thousands of processes.
LOCK_HOLDERS_UID="$(id -u)"

# dev:inode, not the path string — a bind mount or a relative-vs-absolute
# spelling can name the same file two different ways.
lock_dev_ino() { stat -c '%d:%i' -- "$1" 2>/dev/null; }

# T1 1370 — BOUND THE SCAN. Measured under host contention (three CPU
# burners pinned alongside a real suite): the full `/proc/[0-9]*` walk this
# file's fallback does is too slow for `gate.sh`'s own bound the moment it is
# reached. Two cheap pre-filters shrink it to the pids that could plausibly
# hold OUR flock: a campaign process never runs as a different user (a
# stray other-user process cannot hold a lock any of our tools would take),
# and a kernel thread never holds a userspace flock at all (it has no
# backing executable — `readlink /proc/$pid/exe` fails for exactly this
# reason, the standard, cheap way to tell one apart from a real process).
# Neither filter is a correctness requirement — `lock_fd_holds_flock` below
# is what confirms a hold — this is purely what makes the scan CHEAP enough
# to reach that confirmation in time.
lock_pid_scannable() {
  local pid="$1" uid
  uid="$(awk '/^Uid:/{print $2; exit}' "/proc/$pid/status" 2>/dev/null)"
  [ "$uid" = "$LOCK_HOLDERS_UID" ] || return 1
  readlink "/proc/$pid/exe" >/dev/null 2>&1
}

# T1 1361 (D's CI measurement, #911, `b5235313`): kernels DIFFER on this exact
# shape. `exec N>file; flock -n N` forks the `flock` binary against the
# already-open fd; it locks the shared open file description and exits at
# once. WSL2 then shows NO `/proc/locks` row for it at all (this file's own
# header). A standard kernel — measured on the GitHub Actions runner — shows
# the row, but keyed to that now-EXITED pid. Either way no LIVE process is the
# one the listing names, so a reader of `/proc/locks` that only asks "is the
# list empty" is right on WSL and wrong on a standard kernel: it would report
# a genuine ancestor's hold as a STRANGER (the dead, listed pid), waiting on a
# pid that can never release anything. `-d /proc/$pid` alone is not enough — a
# zombie still has an entry there — so this checks state too, the same pair
# heavy-slot.sh's own `pid_is_live` already uses for the identical reason.
lock_pid_alive() {
  local pid="$1" state
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ -d "/proc/$pid" ] || return 1
  # State is the field right after the LAST ')' — `comm` can itself contain
  # spaces and parens (heavy-slot.sh's own `pid_state`; ported, not re-learned).
  state="$(sed 's/.*) //' "/proc/$pid/stat" 2>/dev/null | awk '{print $1}')"
  [ -n "$state" ] && [ "$state" != "Z" ]
}

# HOLDERS ONLY, AND NEVER BY POSITION (`forge-s9g1`), moved here from `gate.sh`
# at row 151 (bead `forge-8vfn.8.1.53`) — `suite_lock_state` there reads BOTH
# `.suite-lock` and `.run-lock` through this ONE `/proc/locks` classifier, so
# it belongs beside its sibling candidate-gatherer below rather than living a
# second place. Shipped in 7.6.48 as
#
#     awk -v ino=":$ino " '$0 ~ ino {print $5}' /proc/locks
#
# and it printed garbage in production twice:
#
#     suite-lock: WAITING on stranger pid(s) 3048432 WRITE — another lane's suite holds it
#
# A HOLDER row is `6: FLOCK ADVISORY WRITE 784079 08:30:2025251 0 EOF`, where $5
# IS the pid. A BLOCKED WAITER is a CONTINUATION row — `2: -> FLOCK ADVISORY
# WRITE 1677053 …` — and the `->` shifts every field by one, so $5 there is the
# literal string `WRITE` and the pid sits at $6. Cosmetic while a caller's own
# `is_ancestor` compares `WRITE` against numeric pids and never matches; NOT
# cosmetic the moment anything downstream reads the list as pids, and not
# cosmetic even once the pids are right — a blocked WAITER that happens to be
# the caller's own ancestor would classify as ANCESTOR for a lock nobody holds.
#
# So: skip continuation rows, because a waiter is not a holder and this
# function is named for what it returns; and find the pid as the field BEFORE
# the MAJ:MIN:INODE token rather than counting from the left, so no future
# field can shift it again. POSITION WAS NEVER THE PROPERTY.
#
# ROW 151, THE SECOND POSITION BUG: bare INODE was never the property either.
# A real gate run under host contention printed `STRANGER:3914347 3914347` —
# the SAME pid twice. An inode number is unique only PER DEVICE, and a busy
# box's `/proc/locks` legitimately lists several files, on several devices,
# held by one pid (measured live: one pid held flocks on two devices at once).
# A collision between the target's inode and some unrelated file's, on a
# different device, misattributes that unrelated row to the same holder — or
# worse, to a DIFFERENT pid that never touched this lock at all. So the match
# is now the FULL `MAJOR:MINOR:INODE` triple a `/proc/locks` row already
# carries, never the inode alone — `%Hd`/`%Ld` (GNU `stat`'s own major/minor of
# `st_dev`, decimal) formatted `%02x:%02x` to match the width the kernel prints
# for the row, since `/proc/locks` gives no other way to derive it. The loop
# still dedupes the pid list on top of that — `flock()` is per
# open-file-description, and two compatible (shared) locks on the one file
# from the one process are a real, if rare, shape — but that dedupe is a
# SECOND, narrower property: on its own, applied to the OLD inode-only match,
# it would still have kept a different, unconfirmed pid that merely shared the
# bare inode. The device check is the fix at the source; the dedupe is not a
# stand-in for it.
#
# `FORGE_PROC_LOCKS` is a TEST SEAM and says so: `/proc/locks` cannot be made to
# hold a chosen row, so the two-row case both bugs above live in is unreachable
# without one. It defaults to the real file and no caller in the campaign sets
# it — `lock-guard.mjs` earned its twelve doors the same way, with `procRoot`.
lock_holder_pids() {
  local f="$1" ino major minor want pid seen=""
  ino="$(stat -c '%i' "$f" 2>/dev/null)" || return 0
  major="$(stat -c '%Hd' "$f" 2>/dev/null)" || return 0
  minor="$(stat -c '%Ld' "$f" 2>/dev/null)" || return 0
  want="$(printf '%02x:%02x' "$major" "$minor")"
  for pid in $(awk -v ino="$ino" -v want="$want" '
    $2 == "->" { next }                 # a blocked waiter is not a holder
    {
      for (i = 2; i <= NF; i++) {
        n = split($i, a, ":")
        if (n == 3 && a[3] == ino && (a[1] ":" a[2]) == want) { print $(i - 1); next }
      }
    }' "${FORGE_PROC_LOCKS:-/proc/locks}"); do
    case " $seen " in *" $pid "*) continue ;; esac
    seen="$seen $pid"
    printf '%s\n' "$pid"
  done
}

# Candidates only: "<pid> <fd>" pairs whose fd resolves (dev+inode) to the
# lock file — NOT yet a hold (see the header: naming alone over-reports both
# a stale opener and, critically, ANY co-opener including the checker's own).
# Full-host scan, the same shape `lock-guard.mjs`'s own fd-census fallback
# already uses for the identical reason (T1 970's "one walker" note): no
# cheaper read tells "has this fd open" apart from "holds the flock" — that
# is `lock_fd_holds_flock`'s job, per candidate, below.
lock_fd_candidates() {
  local lockfile="$1" want di pid fdpath
  want="$(lock_dev_ino "$lockfile")"
  [ -n "$want" ] || return 0
  for pid in /proc/[0-9]*; do
    pid="${pid#/proc/}"
    lock_pid_scannable "$pid" || continue
    [ -d "/proc/$pid/fd" ] || continue
    for fdpath in "/proc/$pid/fd"/*; do
      di="$(stat -c '%d:%i' -L -- "$fdpath" 2>/dev/null)" || continue
      [ "$di" = "$want" ] && printf '%s %s\n' "$pid" "${fdpath##*/}"
    done
  done
}

# Does fd <2> of process <1> hold an ACTIVE flock right now? THE
# DISAMBIGUATION: present only while that exact fd holds the lock, gone the
# instant it releases (`flock -u`) even with the fd still open — a fact
# `/proc/locks` cannot supply for the invisible-fd shape, and the one thing a
# blind fd-scan (or a single global probe) cannot tell apart from "merely has
# it open".
lock_fd_holds_flock() {
  grep -q '^lock:' "/proc/$1/fdinfo/$2" 2>/dev/null
}

# A fast bail-out, never the sole authority: skips the full-host scan above
# when nothing holds the lock at all. `flock -n <file> true` opens its OWN
# fresh fd, acquires-and-releases on success, so probing a free lock costs
# microseconds and can never queue (`-n`) — `lock-state.mjs`'s own `isHeld`,
# the "probe is the fact" idiom, ported to shell so a bash caller needs no
# node dependency for it. Correctness here rests on `lock_fd_holds_flock`
# above, not on this probe; dropping this function only costs the fast path.
lock_probe_held() {
  ! flock -n "$1" true >/dev/null 2>&1
}

# NAMED AND HOLDING: the confirmed holder, if any. Reports a candidate ONLY
# when its OWN matching fd's fdinfo shows the lock — a stale opener
# (released, fd still open) and a co-opener (has it open, never acquired it
# — includes the checking process's own failed `flock -n` attempt) are both
# excluded, never just "someone besides me holds it somewhere".
#
# STOPS AT THE FIRST CONFIRMED HOLDER (T1 1370) — not an optimisation that
# trades away correctness for speed, but a property of what this file locks:
# every campaign lock taken through this idiom is `flock -n` EXCLUSIVE, so at
# most one live process can ever be a confirmed holder at once. `read` over a
# process-substitution pipe consumes output as it streams, so a match found
# early lets this function return before the producer (`lock_fd_candidates`,
# still iterating `/proc`) has finished — the producer's own remaining work
# then completes asynchronously and exits on its own; nothing is left
# running past that beyond the tail of a scan already in flight.
lock_confirmed_holders() {
  local lockfile="$1" pid fd
  lock_probe_held "$lockfile" || return 0
  while read -r pid fd; do
    [ -n "${pid:-}" ] || continue
    if lock_fd_holds_flock "$pid" "$fd"; then
      printf '%s\n' "$pid"
      return 0
    fi
  done < <(lock_fd_candidates "$lockfile")
}

# Is $1 an ancestor of THIS shell? Ppid read from `status`, never field 4 of
# `stat` — `comm` may contain spaces/parens (gate.sh's own `is_ancestor`
# comment; ported rather than re-learned). `$$` is the SOURCING shell's own
# pid when this file is sourced, and this CLI's own pid in direct-run mode —
# both are the process whose ancestry the caller actually wants walked.
lock_is_ancestor() {
  local want="$1" p=$$ guard=0
  while [ "$p" -gt 1 ] && [ "$guard" -lt 64 ]; do
    [ "$p" = "$want" ] && return 0
    p="$(awk '/^PPid:/{print $2}' /proc/$p/status 2>/dev/null)"
    [ -n "$p" ] || return 1
    guard=$((guard + 1))
  done
  return 1
}

# FREE | ANCESTOR:<pid> | STRANGER:<pid pid ...> — confirmed holders only.
lock_state() {
  local f="$1" pids pid
  pids="$(lock_confirmed_holders "$f")"
  [ -z "$pids" ] && { echo FREE; return; }
  for pid in $pids; do
    lock_is_ancestor "$pid" && { echo "ANCESTOR:$pid"; return; }
  done
  echo "STRANGER:$(echo $pids | tr '\n' ' ' | sed 's/ $//')"
}

# CLI, for doors and for any caller that would rather shell out than source.
# `${BASH_SOURCE[0]}" = "$0"` is true only when this file is the one actually
# invoked — a sourcing script's `$0` stays its own path, so `with-locks.sh`
# sourcing this never trips it.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  case "${1:-}" in
    state)   lock_state "${2:?usage: lock-holders.sh state <lockfile>}" ;;
    holders) lock_confirmed_holders "${2:?usage: lock-holders.sh holders <lockfile>}" ;;
    *) echo "usage: lock-holders.sh state|holders <lockfile>" >&2; exit 2 ;;
  esac
fi
