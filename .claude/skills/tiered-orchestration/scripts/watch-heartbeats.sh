#!/usr/bin/env bash
# watch-heartbeats.sh — out-of-process stall watcher for a tiered-orchestration campaign.
# Runs from host cron so it outlives every Claude session (an in-process watcher dies
# with the host it watches — measured: a 384-minute gap was invisible).
#
#   crontab: */5 * * * * /home/parso/forge/.claude/skills/tiered-orchestration/scripts/watch-heartbeats.sh /home/parso/forge/_1.0/heartbeat
#
# Contract (HB = the campaign's heartbeat dir, argument 1):
#   HB/ACTIVE            space/comma-separated live lane ids, or NONE (lanes.sh maintains it)
#   HB/<lane>.log        the lane's own heartbeat (real fail/timeout state, never a label)
#   HB/<lane>.liveness   optional: one path/glob per line the lane declares as proof of life
#                        (e.g. its cycle's events.jsonl) — for a lane parked on a detached job
#   liveness = max(mtime of <lane>.log and every declared path). The tmux pane log is NOT a
#   liveness signal: an idle Claude TUI redraws its status bar, so the pane never goes quiet
#   (measured 2026-08-28: a 2-hour idle lane never flagged).
#   ceiling 30 min from max(that lane's OWN arm-time, its liveness)
#   stall    → HB/STALL-<lane> written (T1 polls, relays, deletes); recovery removes it
#   arm      → HB/.armed-<lane>, stamped when THAT lane first appears in ACTIVE, dropped when
#              it leaves. Per-lane on purpose: a single global arm stamp re-stamped on every
#              ACTIVE change meant one lane finishing well silently re-armed all the others,
#              and the watcher went blind for 79 minutes (2026-08-29, forge-8vfn.2.14).
#              A lane's liveness reference must not be derivable from a file another lane writes.
set -euo pipefail
HB="${1:-}"
# A watcher that cannot see its campaign must say so. Exiting 0 here would be the
# same fail-open it exists to catch; cron captures stderr to .watcher-cron.log.
if [ -z "$HB" ] || [ ! -d "$HB" ]; then
  echo "watch-heartbeats.sh: not a heartbeat dir: ${1:-<no argument>}" >&2
  exit 2
fi
CEILING_S=$((30 * 60))
# The heartbeat interval lane-protocol.md §2 asks a lane for. Two checks below use it as their
# tolerance: a stamp further than this from its own file's mtime was not written by `date`, and
# a `.liveness` re-stamped inside it while `.log` sits outside it is the wrong-file heartbeat.
INTERVAL_S=$((10 * 60))
FUTURE_SKEW_S=60
now="$(date -u +%s)"
active="$(tr ',' ' ' < "$HB/ACTIVE" 2>/dev/null || echo NONE)"
epoch_of() { date -u -d "$1" +%s 2>/dev/null || true; }
iso_of() { date -u -d "@$1" +%FT%TZ; }
for lane in $active; do
  [ "$lane" = "NONE" ] && continue
  arm="$HB/.armed-$lane"
  [ -f "$arm" ] || printf '%s' "$now" > "$arm"     # grace, from this lane's own arrival
  last="$(cat "$arm")"
  log="$HB/$lane.log"
  live="$HB/$lane.liveness"
  reason=""

  # 1. The stamp is cross-checked against the file it was written into (bead forge-8vfn.2.35).
  #    Every gap below is computed from mtime, so a FABRICATED stamp never stalls a lane — it
  #    makes a stalled lane read fresh to whoever opens the log (2026-09-03: 09-03T11:4x typed
  #    into a file last written 09-02 23:4x). The stamp and the write time are two independent
  #    facts about the same event; when they disagree, one of them is a story.
  #    A log with no parseable stamp is not cross-checked — there is nothing to check it against;
  #    the gap check below still covers it.
  if [ -f "$log" ]; then
    stamp="$(tail -1 "$log" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z' | head -1)"
    if [ -n "$stamp" ]; then
      st="$(epoch_of "$stamp")"
      lm="$(stat -c %Y "$log")"
      if [ -n "$st" ]; then
        d=$((st - lm)); [ "$d" -lt 0 ] && d=$(( -d ))
        if [ "$st" -gt $((now + FUTURE_SKEW_S)) ]; then
          reason="stamp/mtime mismatch: last stamp $stamp is in the FUTURE (now $(iso_of "$now"))"
        elif [ "$d" -gt "$INTERVAL_S" ]; then
          reason="stamp/mtime mismatch: last stamp $stamp is $((d / 60))min from its own file's mtime $(iso_of "$lm") (interval $((INTERVAL_S / 60))min)"
        fi
      fi
    fi
  fi

  # 2. The wrong-file heartbeat (§15.143, library 2026-09-04): its Monitor loops stamped
  #    `library.liveness` every poll while `library.log` sat 40 minutes old, and the fresh file
  #    hid the stale one. `.liveness` DECLARES which job logs are proof of life; it is not itself
  #    proof of anything. So: a `.liveness` re-stamped within the interval, a `.log` outside it,
  #    and not one declared path fresh — that is a lane stamping the wrong file, named as such.
  if [ -z "$reason" ] && [ -f "$live" ]; then
    lvm="$(stat -c %Y "$live")"; logm=0; [ -f "$log" ] && logm="$(stat -c %Y "$log")"
    if [ $((now - lvm)) -le "$INTERVAL_S" ] && [ $((now - logm)) -gt "$INTERVAL_S" ]; then
      fresh=0
      for pat in $(tr '\n' ' ' < "$live"); do
        for f in $pat; do
          [ -f "$f" ] || continue
          [ $((now - $(stat -c %Y "$f"))) -le "$INTERVAL_S" ] && fresh=1
        done
      done
      [ "$fresh" = 0 ] && reason="liveness stamped without a live job: $lane.liveness written $((now - lvm))s ago, $lane.log $(( (now - logm) / 60 ))min old, no declared path fresher than $((INTERVAL_S / 60))min"
    fi
  fi

  # 3. liveness = max(mtime of <lane>.log and every declared path), then the ceiling.
  paths="$log"
  [ -f "$live" ] && paths="$paths $(tr '\n' ' ' < "$live")"
  for pat in $paths; do
    for f in $pat; do
      [ -f "$f" ] || continue
      m="$(stat -c %Y "$f")"; [ "$m" -gt "$last" ] && last="$m"
    done
  done
  gap=$((now - last)); flag="$HB/STALL-$lane"
  if [ -n "$reason" ]; then
    # A named failure is not a gap. §15.92: every check reports its failure branch as a DISTINCT
    # outcome — a mismatch flagged as "gap=0min" would read as a lane that just started.
    {
      echo "STALL $lane $reason"
      echo "now=$(iso_of "$now") last_activity=$(iso_of "$last")"
      [ -f "$log" ] && echo "last_heartbeat: $(tail -1 "$log")"
    } > "$flag"
  elif [ "$gap" -gt "$CEILING_S" ]; then
    {
      echo "STALL $lane gap=$((gap / 60))min ceiling=$((CEILING_S / 60))min"
      echo "now=$(iso_of "$now") last_activity=$(iso_of "$last")"
      [ -f "$log" ] && echo "last_heartbeat: $(tail -1 "$log")"
    } > "$flag"
  else
    rm -f "$flag"
  fi
done
# A lane that has left ACTIVE is no longer watched: drop its arm stamp and any flag,
# so T1 is never left polling a STALL flag for a lane that closed cleanly.
for f in "$HB"/.armed-*; do
  [ -f "$f" ] || continue
  lane="${f##*/.armed-}"
  case " $active " in *" $lane "*) ;; *) rm -f "$f" "$HB/STALL-$lane" ;; esac
done
exit 0
