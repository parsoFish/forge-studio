#!/usr/bin/env bash
# lock-state.sh — WHO HOLDS A LOCK, as distinct from who merely has it open.
#
# THE DEFECT THIS REPLACES (`forge-8vfn.7.6.96`). §15.483 said "only an fd is
# evidence of a holder". An fd is evidence of an OPEN. `flock FILE cmd` opens the
# file and THEN blocks acquiring it, so a process that has QUEUED for twenty-five
# minutes and one that has HELD for twenty-five minutes are byte-identical to an
# fd census. Measured 2026-09-13 15:12:06Z:
#
#   fd census      .suite-lock "held by" 3982239(m6-a) 4031545(m6-c) 4031666(m6-c)
#   /proc/locks    no row for the lock's inode at all — NOBODY HELD IT
#
# Three lanes were backing off a free lock. The same census reported one job's
# 25-minute QUEUE (14:42:35 -> 15:07:36) as a 28-minute HOLD; it held for 2m10s.
# That misreading became ruling 946, retracted at 948.
#
# AND THE OTHER INSTRUMENT IS BLIND THE OTHER WAY (C's §15.481). A lock taken on
# a descriptor inherited from a parent — `exec 9>lock; flock -n 9` — has no
# nameable owner in `/proc/locks`, so a `/proc/locks`-only reader calls a
# genuinely held lock FREE. Measured on the same box at 15:22:06Z:
#
#   probe          HELD (not acquirable)
#   /proc/locks    no rows for the inode
#   fd census      35881(m6-c) 3740(m6-d) 4185769(m6-a)
#
# So each instrument alone misreads, in OPPOSITE directions: the fd census
# OVER-attributes (queuers read as holders), `/proc/locks` UNDER-attributes (some
# held locks unnameable). The truth needs all three, labelled:
#
#   flock -n probe   is it held?      THE FACT
#   /proc/locks      by whom?         THE ATTRIBUTION, when it can
#   fd census        who else is on it?  HOLDERS **AND** WAITERS, never one alone
#
#   lock-state.sh held <lockfile>   FREE, or HELD with the holder named
#   lock-state.sh open <lockfile>   one line per pid: pid cwd elapsed LABEL
#   lock-state.sh say  <lockfile>   one line carrying both readings
#
# THE PROBE COSTS SOMETHING AND THIS SAYS SO: `flock -n` acquires and releases,
# so probing a free lock takes it for microseconds and can win a race against a
# waiter already blocked. `-n` means it NEVER queues, so this tool can never
# become the thing it is measuring — which is precisely the failure 946 was.
#
# Inert: it reads and reports. It takes no lock for longer than the probe, runs
# nothing, and has no launch path (§15.494). Every path is an argument — a tool
# that resolves its inputs from its own location answers a different question in
# each checkout (§15.148).
#
# EXIT: 0 the lock is FREE · 3 the lock is HELD · 2 usage. The code is the
# machine contract, so a caller never has to parse prose to branch.
set -u

usage() {
  echo "usage: lock-state.sh held|open|say <lockfile>" >&2
  exit 2
}

MODE="${1:-}"; F="${2:-}"
[ -n "$MODE" ] && [ -n "$F" ] || usage
case "$MODE" in held|open|say) ;; *) echo "lock-state.sh: unknown verb '$MODE'" >&2; usage ;; esac
[ -e "$F" ] || { echo "lock-state.sh: no such lock file: $F" >&2; exit 2; }

INO=$(stat -c %i "$F" 2>/dev/null) || { echo "lock-state.sh: cannot stat $F" >&2; exit 2; }

# Is it held? The ONLY question `flock` can answer without waiting.
is_held() { flock -n "$F" true 2>/dev/null && return 1 || return 0; }

# Field 5 of a /proc/locks row is the pid, field 6 is MAJ:MIN:INODE. The inode is
# matched as a whole field — a bare grep for the number also matches pids,
# offsets and other inodes that merely contain those digits.
naming_pids() {
  awk -v ino="$INO" '{ n = split($6, a, ":"); if (n == 3 && a[3] == ino) print $5 }' /proc/locks 2>/dev/null | sort -u
}

cwd_of() { readlink "/proc/$1/cwd" 2>/dev/null || echo '(gone)'; }
# A pid can die BETWEEN the census and this read — measured: a row came out as
# `1252913((gone),OPEN/WAITING,)` because `ps` printed nothing and the field that
# should have held the elapsed time silently vanished, shifting every field after
# it. `|| echo` cannot catch that: `ps` fails but `tr` succeeds, so the pipeline's
# status is `tr`'s. The value is captured and defaulted instead, so a row always
# has four fields and a reader downstream can never mis-column one.
elapsed_of() {
  local e; e=$(ps -o etime= -p "$1" 2>/dev/null | tr -d ' ')
  [ -n "$e" ] && printf '%s' "$e" || printf '%s' '(gone)'
}

# Every pid with this exact path open — holders AND waiters, indistinguishable
# here by construction, which is why the label comes from `/proc/locks`.
open_pids() {
  local pid fd t
  for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    for fd in /proc/"$pid"/fd/*; do
      t=$(readlink "$fd" 2>/dev/null) || continue
      [ "$t" = "$F" ] && { echo "$pid"; break; }
    done
  done
}

held_line() {
  if ! is_held; then echo "FREE"; return 0; fi
  local pids out=""
  pids=$(naming_pids)
  if [ -z "$pids" ]; then
    echo "HELD (unnameable — inherited fd)"
  else
    for p in $pids; do out="$out $p(cwd $(cwd_of "$p"))"; done
    echo "HELD$out"
  fi
  return 3
}

case "$MODE" in
  held)
    held_line
    ;;

  open)
    # LABELLED, never bare. A pid is a HOLDER only when /proc/locks says so;
    # everything else on the file is OPEN/WAITING, which is the distinction the
    # whole tool exists to make.
    holders=" $(naming_pids | tr '\n' ' ')"
    for p in $(open_pids); do
      case "$holders" in *" $p "*) label=HOLDER ;; *) label=OPEN/WAITING ;; esac
      printf '%s %s %s %s\n' "$p" "$(cwd_of "$p")" "$(elapsed_of "$p")" "$label"
    done
    is_held && exit 3 || exit 0
    ;;

  say)
    h=$(held_line); hrc=$?
    o=$("$0" open "$F"); :
    n=$(printf '%s' "$o" | grep -c . || true)
    if [ "$n" = "0" ]; then opens="none"
    else opens=$(printf '%s' "$o" | awk '{printf " %s(%s,%s,%s)", $1, $2, $3, $4}'); fi
    printf 'lock %s inode=%s %s OPEN:%s\n' "$(basename "$F")" "$INO" "$h" "$opens"
    exit "$hrc"
    ;;
esac
