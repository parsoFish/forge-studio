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
[ -n "$HB" ] && [ -d "$HB" ] || { echo "watch-heartbeats.sh: not a heartbeat dir: ${1:-<no argument>}" >&2; exit 2; }
CEILING_S=$((30 * 60))
now="$(date -u +%s)"
active="$(tr ',' ' ' < "$HB/ACTIVE" 2>/dev/null || echo NONE)"
for lane in $active; do
  [ "$lane" = "NONE" ] && continue
  arm="$HB/.armed-$lane"
  [ -f "$arm" ] || printf '%s' "$now" > "$arm"     # grace, from this lane's own arrival
  last="$(cat "$arm")"
  paths="$HB/$lane.log"
  [ -f "$HB/$lane.liveness" ] && paths="$paths $(tr '\n' ' ' < "$HB/$lane.liveness")"
  for pat in $paths; do
    for f in $pat; do
      [ -f "$f" ] || continue
      m="$(stat -c %Y "$f")"; [ "$m" -gt "$last" ] && last="$m"
    done
  done
  gap=$((now - last)); flag="$HB/STALL-$lane"
  if [ "$gap" -gt "$CEILING_S" ]; then
    {
      echo "STALL $lane gap=$((gap / 60))min ceiling=$((CEILING_S / 60))min"
      echo "now=$(date -u -d "@$now" +%FT%TZ) last_activity=$(date -u -d "@$last" +%FT%TZ)"
      [ -f "$HB/$lane.log" ] && echo "last_heartbeat: $(tail -1 "$HB/$lane.log")"
    } > "$flag"
  else
    [ -f "$flag" ] && rm -f "$flag"
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
