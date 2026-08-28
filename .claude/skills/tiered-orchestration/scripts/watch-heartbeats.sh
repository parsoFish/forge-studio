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
#   HB/<lane>.tmux.log   the lane's tmux pane output (lanes.sh pipe-pane) — a lane that
#                        forgets to heartbeat is still judged live while its pane moves
#   liveness = max(mtime of the two logs); ceiling 30 min from max(arm-time, liveness)
#   stall    → HB/STALL-<lane> written (T1 polls, relays, deletes); recovery removes it
#   arm      → HB/.watcher-armed re-stamped whenever ACTIVE changes (grace for new lanes)
set -euo pipefail
HB="${1:-}"; [ -n "$HB" ] && [ -d "$HB" ] || exit 0
CEILING_S=$((30 * 60))
ARM="$HB/.watcher-armed"; SNAP="$HB/.active-snapshot"
active_raw="$(cat "$HB/ACTIVE" 2>/dev/null || echo NONE)"
active="$(printf '%s' "$active_raw" | tr ',' ' ')"
now="$(date -u +%s)"
prev="$(cat "$SNAP" 2>/dev/null || echo '')"
if [ "$active_raw" != "$prev" ]; then printf '%s' "$now" > "$ARM"; printf '%s' "$active_raw" > "$SNAP"; fi
arm="$(cat "$ARM" 2>/dev/null || printf '%s' "$now")"
for lane in $active; do
  [ "$lane" = "NONE" ] && continue
  last="$arm"
  for f in "$HB/$lane.log" "$HB/$lane.tmux.log"; do
    [ -f "$f" ] || continue
    m="$(stat -c %Y "$f")"; [ "$m" -gt "$last" ] && last="$m"
  done
  ref="$last"; [ "$arm" -gt "$ref" ] && ref="$arm"
  gap=$((now - ref)); flag="$HB/STALL-$lane"
  if [ "$gap" -gt "$CEILING_S" ]; then
    {
      echo "STALL $lane gap=$((gap / 60))min ceiling=$((CEILING_S / 60))min"
      echo "now=$(date -u -d "@$now" +%FT%TZ) last_activity=$(date -u -d "@$last" +%FT%TZ)"
      [ -f "$HB/$lane.log" ] && echo "last_heartbeat: $(tail -1 "$HB/$lane.log")"
      [ -f "$HB/$lane.tmux.log" ] && echo "last_pane: $(tail -c 300 "$HB/$lane.tmux.log" | tr -d '\r' | tail -1)"
    } > "$flag"
  else
    [ -f "$flag" ] && rm -f "$flag"
  fi
done
exit 0
