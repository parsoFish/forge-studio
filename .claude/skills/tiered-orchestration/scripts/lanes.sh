#!/usr/bin/env bash
# lanes.sh — T1 lane launcher / relay for tiered-orchestration campaigns.
#
# A lane is one fresh `claude` session running inside a detached tmux session
# named forge-<lane>, started in the main checkout with a rendered kickoff
# prompt. T1 launches, peeks, relays into and retires lanes from its own shell;
# the operator attaches (`tmux attach -t forge-<lane>`, detach with C-b d) to
# interact with the lane directly. Lanes are real sessions, so they can spawn
# their own T3 subagents (in-process subagents cannot nest) and keep their own
# context, model tier and /session-report.
#
# Usage (help = run with no args):
#   lanes.sh render <kickoffs.md> <heading-regex> <out-file> [PARAM=VALUE ...]
#       Extract the first ```text block under the heading matching <heading-regex>
#       into <out-file>; fill each PARAM (its "PARAMETER — set before pasting" line
#       and every "$PARAM" reference).
#   lanes.sh launch <campaign-dir> <lane> <prompt-file> [--model M] [--permission-mode P] [--cwd DIR] [--open]
#       Start tmux session forge-<lane> in DIR (default /home/parso/forge), pipe the
#       pane to <campaign-dir>/heartbeat/<lane>.tmux.log (liveness signal for the
#       watcher), run `claude --model M --permission-mode P "<prompt>"`, add <lane>
#       to <campaign-dir>/heartbeat/ACTIVE. --open also opens a Windows Terminal
#       tab attached to the session (WSL). Refuses if the session already exists.
#   lanes.sh peek <lane> [N]         Last N pane lines (default 40).
#   lanes.sh send <lane> <text>      Type <text> + Enter into the lane (the relay
#                                    for park-point rulings: "approved: H2 run 1").
#   lanes.sh open <lane> [DIR]       Windows Terminal tab attached to the session.
#   lanes.sh list [campaign-dir]     forge-* sessions, ACTIVE set, STALL flags.
#   lanes.sh kill <campaign-dir> <lane>   End the session; drop <lane> from ACTIVE.
#   lanes.sh events <campaign-dir> [ledger]  Forever: one line per actionable event — new ledger
#                                    OUTCOME/park/NOT MET lines, STALL flags, a lane session gone,
#                                    a lane whose claude exited to the shell, a lane idle at its prompt
#                                    with a stale heartbeat (LANE_IDLE — the relay hole). Feed it to a Monitor.
#
# Env overrides: LANES_MODEL (opus), LANES_PERMISSION_MODE (auto),
#                LANES_CWD (/home/parso/forge), LANES_CLAUDE_BIN (resolved `claude`).
set -euo pipefail

die() { echo "lanes.sh: $*" >&2; exit 2; }
sess() { printf '%s%s' "${LANES_SESSION_PREFIX:-forge-}" "$1"; }

# --- relay confirmation -------------------------------------------------------
# CONFIRM A RELAY BY ITS EFFECT, NEVER BY THE PAYLOAD'S PRESENCE.
# Measured 2026-08-29 (_1.0/ledger.md, three instances in one afternoon): `send`
# printed "sent to forge-m1-d" and `launch` printed "launched forge-m1-a" over a
# payload that was STAGED and never submitted -- `â¯ [Pasted text #1 +1 lines]`,
# $0.00 session, 0 context -- because nothing looked. Reproduced deterministically
# against a real Claude TUI: tmux delivers every byte, but a terminator landing in
# the SAME read chunk as the payload is taken as pasted CONTENT rather than a
# keypress. So the payload and its terminator are written separately, the gap
# between them is a condition (the payload is on the input line) and not a sleep,
# and the input line is then watched until the payload LEAVES it.
CONFIRM_TIMEOUT_S="${LANES_CONFIRM_TIMEOUT_S:-45}"   # how long an effect may take to appear
SETTLE_S="${LANES_SETTLE_S:-8}"                      # how long the payload may take to reach the input line
GLYPH=$'\xe2\x9d\xaf'                                 # the lane TUI's input-line marker

input_line() { # <session> — the last input line the pane is showing, if any
  tmux capture-pane -p -t "$1" 2>/dev/null | { grep "^[[:space:]]*$GLYPH" || true; } | tail -1
}
# 0 = the input line is holding something, 1 = present and empty, 2 = no input line
input_state() { # <session>
  local l
  l="$(input_line "$1")"
  [ -n "$l" ] || return 2
  l="${l#*"$GLYPH"}"
  [ -n "$(printf '%s' "$l" | tr -d '[:space:]')" ]
}
await_state() { # <session> <wanted 0|1> <deadline-epoch>
  local s="$1" want="$2" deadline="$3" rc
  while :; do
    input_state "$s" && rc=0 || rc=$?
    [ "$rc" = "$want" ] && return 0
    [ "$(date +%s)" -ge "$deadline" ] && return 1
    sleep 0.3
  done
}
# Drive the terminator until the input line drains. Silent on success; dies naming
# the lane when the effect cannot be confirmed. NEVER reports success it did not see.
#   require_pending=1 (send): the payload we just wrote must appear on the input line
#     first -- otherwise "empty" only means the pane has not caught up, and treating
#     that as submitted would be the very fail-open this function exists to close.
#   require_pending=0 (launch): the prompt arrives as argv, so a lane that already
#     submitted it shows an empty line and is working; one still holding it is driven.
confirm_submitted() { # <session> <lane> <what> <require_pending>
  local s="$1" lane="$2" what="$3" need="$4" attempt=0 rc
  if ! await_state "$s" 0 "$(( $(date +%s) + SETTLE_S ))"; then
    input_state "$s" && rc=0 || rc=$?
    [ "$need" = 0 ] && [ "$rc" = 1 ] && return 0
    [ "$rc" = 2 ] && die "$what NOT CONFIRMED for $lane: $s never showed an input line within ${SETTLE_S}s, so submission cannot be confirmed. Attach with 'tmux attach -t $s'."
    die "$what NOT CONFIRMED for $lane: the payload never reached $s's input line within ${SETTLE_S}s. Attach with 'tmux attach -t $s'."
  fi
  while [ "$attempt" -lt 2 ]; do
    tmux send-keys -t "$s" Enter
    await_state "$s" 1 "$(( $(date +%s) + CONFIRM_TIMEOUT_S ))" && return 0
    attempt=$((attempt + 1))
  done
  die "$what NOT CONFIRMED for $lane: the payload is still on $s's input line, unsubmitted after ${CONFIRM_TIMEOUT_S}s and 2 terminators. Attach with 'tmux attach -t $s' and submit it by hand."
}

active_add() { # <campaign-dir> <lane>
  local f="$1/heartbeat/ACTIVE" cur
  mkdir -p "$1/heartbeat"; [ -f "$f" ] || : > "$f"
  cur="$(tr ',' ' ' < "$f" | tr -s ' \n' ' ' | sed 's/\bNONE\b//g; s/^ *//; s/ *$//')" || cur=""
  case " $cur " in *" $2 "*) ;; *) cur="${cur:+$cur }$2" ;; esac
  printf '%s\n' "${cur:-NONE}" > "$f"
}
active_drop() { # <campaign-dir> <lane>
  local f="$1/heartbeat/ACTIVE" cur
  [ -f "$f" ] || return 0
  cur="$(tr ',' ' ' < "$f" | tr -s ' \n' ' ' | sed "s/\b$2\b//g; s/\bNONE\b//g" | tr -s ' ' | sed 's/^ *//; s/ *$//')" || cur=""
  printf '%s\n' "${cur:-NONE}" > "$f"
}

cmd_render() {
  local src="$1" re="$2" out="$3"; shift 3
  [ -f "$src" ] || die "no such file: $src"
  awk -v re="${re//\\/\\\\}" '
    !found && $0 ~ re { found=1; next }
    found && !inblock && /^```text/ { inblock=1; next }
    inblock && /^```$/ { exit }
    inblock { print }
  ' "$src" > "$out"
  [ -s "$out" ] || die "no \`\`\`text block found under /$re/ in $src"
  local kv k v
  for kv in "$@"; do
    k="${kv%%=*}"; v="${kv#*=}"
    sed -i -E "s/^PARAMETER — set before pasting: $k = .*/PARAMETER: $k = $v/; s/\\\$$k\\b/$v/g" "$out"
  done
  echo "rendered $out ($(wc -l < "$out") lines)"
}

cmd_launch() {
  local camp="$1" lane="$2" prompt="$3"; shift 3
  local model="${LANES_MODEL:-opus}" pm="${LANES_PERMISSION_MODE:-auto}" cwd="${LANES_CWD:-/home/parso/forge}" open=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --model) model="$2"; shift 2 ;;
      --permission-mode) pm="$2"; shift 2 ;;
      --cwd) cwd="$2"; shift 2 ;;
      --open) open=1; shift ;;
      *) die "unknown flag $1" ;;
    esac
  done
  local s; s="$(sess "$lane")"
  [ -d "$camp" ] || die "no campaign dir: $camp"
  [ -s "$prompt" ] || die "prompt file missing or empty: $prompt"
  [ -d "$cwd" ] || die "no cwd: $cwd"
  tmux has-session -t "$s" 2>/dev/null && die "session $s already exists (lanes.sh peek $lane / kill)"
  local bin="${LANES_CLAUDE_BIN:-$(command -v claude || true)}"
  [ -n "$bin" ] || die "claude not on PATH (set LANES_CLAUDE_BIN)"
  mkdir -p "$camp/heartbeat"
  tmux new-session -d -s "$s" -c "$cwd" -x 200 -y 50
  tmux pipe-pane -o -t "$s" "cat >> '$camp/heartbeat/$lane.tmux.log'"
  tmux send-keys -t "$s" "$bin --model $model --permission-mode $pm \"\$(cat '$prompt')\"" Enter
  confirm_submitted "$s" "$lane" "launch" 0
  active_add "$camp" "$lane"
  echo "launched $s and confirmed working  model=$model permission-mode=$pm cwd=$cwd"
  echo "attach:  tmux attach -t $s   (detach: C-b d)"
  echo "peek:    $0 peek $lane"
  echo "log:     $camp/heartbeat/$lane.tmux.log"
  [ "$open" = 1 ] && cmd_open "$lane" "$cwd"
  return 0
}

cmd_peek() { tmux capture-pane -p -t "$(sess "$1")" -S "-${2:-40}"; }

cmd_send() {
  local lane="$1" s; s="$(sess "$1")"; shift
  tmux has-session -t "$s" 2>/dev/null || die "no session $s"
  # Refuse a pane whose input line is already occupied. Measured 2026-08-29: an
  # operator's own draft sat unsubmitted in m1-d's pane when T1 arrived to relay a
  # ruling. Pasting onto it would submit two people's text as one message, and the
  # drain would look exactly like success.
  if input_state "$s"; then
    die "refusing to relay to $lane: $s's input line already holds an unsent draft ($(input_line "$s")). Attach with 'tmux attach -t $s' and submit or clear it (C-u) first."
  fi
  # An explicit bracketed paste declares where the payload ends, so the consumer
  # does not have to guess from timing; the terminator is a separate write.
  printf '%s' "$*" | tmux load-buffer -b lanes-relay -
  tmux paste-buffer -p -b lanes-relay -t "$s"
  tmux delete-buffer -b lanes-relay 2>/dev/null || true
  confirm_submitted "$s" "$lane" "send" 1
  echo "sent to $s and confirmed submitted: $*"
}

cmd_open() {
  local s; s="$(sess "$1")" cwd="${2:-${LANES_CWD:-/home/parso/forge}}"
  local wt; wt="$(command -v wt.exe || ls /mnt/c/Users/*/AppData/Local/Microsoft/WindowsApps/wt.exe 2>/dev/null | head -1 || true)"
  if [ -z "$wt" ]; then echo "no wt.exe — attach by hand: tmux attach -t $s"; return 0; fi
  nohup "$wt" -w 0 new-tab --title "$s" wsl.exe -d "${WSL_DISTRO_NAME:-Ubuntu}" --cd "$cwd" -- tmux attach -t "$s" >/dev/null 2>&1 &
  echo "opened Windows Terminal tab attached to $s"
}

cmd_list() {
  local camp="${1:-}"
  echo "== tmux forge-* sessions =="
  tmux ls -F '#{session_name} created=#{t:session_created} attached=#{session_attached} windows=#{session_windows}' 2>/dev/null | grep '^forge-' || echo "(none)"
  if [ -n "$camp" ]; then
    echo "== ACTIVE == $(cat "$camp/heartbeat/ACTIVE" 2>/dev/null || echo '(no file)')"
    echo "== STALL flags =="; ls "$camp"/heartbeat/STALL-* 2>/dev/null || echo "(none)"
  fi
}

cmd_kill() {
  local camp="$1" lane="$2" s; s="$(sess "$lane")"
  tmux kill-session -t "$s" 2>/dev/null && echo "killed $s" || echo "no session $s"
  active_drop "$camp" "$lane"
  echo "ACTIVE = $(cat "$camp/heartbeat/ACTIVE")"
}

cmd_events() { # <campaign-dir> [ledger] — one stdout line per actionable event, forever (Monitor input)
  local camp="$1" ledger="${2:-$1/ledger.md}" n0 n1 lane b f last pane hb age seen_stall="" seen_gone="" seen_shell="" seen_idle=""
  n0="$(wc -l < "$ledger" 2>/dev/null || echo 0)"
  while true; do
    n1="$(wc -l < "$ledger" 2>/dev/null || echo 0)"
    [ "$n1" -lt "$n0" ] && n0=0
    if [ "$n1" -gt "$n0" ]; then
      sed -n "$((n0 + 1)),${n1}p" "$ledger" | { grep -E --line-buffered 'OUTCOME|PARK|NOT MET|STOP|\bH[1-9]\b|contract-ready|merged|MERGED' || true; } | cut -c1-300 | sed 's/^/LEDGER: /'
      n0="$n1"
    fi
    for f in "$camp"/heartbeat/STALL-*; do
      [ -f "$f" ] || continue; b="$(basename "$f")"
      case " $seen_stall " in *" $b "*) ;; *) echo "STALL: $(head -1 "$f")"; seen_stall="$seen_stall $b" ;; esac
    done
    for lane in $(tr ',' ' ' < "$camp/heartbeat/ACTIVE" 2>/dev/null); do
      [ "$lane" = NONE ] && continue
      if ! tmux has-session -t "forge-$lane" 2>/dev/null; then
        case " $seen_gone " in *" $lane "*) ;; *) echo "LANE_ENDED: forge-$lane session gone (still in ACTIVE)"; seen_gone="$seen_gone $lane" ;; esac
        continue
      fi
      pane="$(tmux capture-pane -p -t "forge-$lane" -S -40 2>/dev/null | { grep -v '^[[:space:]]*$' || true; })"
      last="$(printf '%s\n' "$pane" | tail -1)"
      if printf '%s' "$last" | grep -qE '^[^ ]+@[^ ]+:.*\$ ?$'; then
        case " $seen_shell " in *" $lane "*) ;; *) echo "LANE_SHELL: forge-$lane claude exited — pane is at a shell prompt"; seen_shell="$seen_shell $lane" ;; esac
        continue
      fi
      # Idle = the TUI shows a finished turn ("· done H:MM AM/PM") and the lane's heartbeat is > 10 min old.
      # This is the relay hole: a lane that launched a detached job and ended its turn never wakes by itself.
      hb="$camp/heartbeat/$lane.log"; age=999999
      [ -f "$hb" ] && age=$(( $(date +%s) - $(stat -c %Y "$hb") ))
      if printf '%s\n' "$pane" | tail -8 | grep -qE '· done [0-9]{1,2}:[0-9]{2} ?[AP]M' && [ "$age" -gt 600 ]; then
        case " $seen_idle " in *" $lane "*) ;; *) echo "LANE_IDLE: forge-$lane turn finished ($(printf '%s\n' "$pane" | grep -oE '· done [0-9:]+ ?[AP]M' | tail -1)), heartbeat $((age / 60)) min old — parked on a detached job? relay with lanes.sh send"; seen_idle="$seen_idle $lane" ;; esac
      else
        seen_idle="$(printf '%s' "$seen_idle" | sed "s/\b$lane\b//")"
      fi
    done
    sleep 30
  done
}

case "${1:-}" in
  render) shift; cmd_render "$@" ;;
  launch) shift; cmd_launch "$@" ;;
  peek)   shift; cmd_peek "$@" ;;
  send)   shift; cmd_send "$@" ;;
  open)   shift; cmd_open "$@" ;;
  list)   shift; cmd_list "$@" ;;
  kill)   shift; cmd_kill "$@" ;;
  events) shift; cmd_events "$@" ;;
  *) sed -n '2,35p' "$0"; exit 1 ;;
esac
