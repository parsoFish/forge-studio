#!/usr/bin/env bash
# lanes.sh — T1 lane launcher for tiered-orchestration campaigns.
#
# A lane is one fresh `claude` session inside a detached tmux session named forge-<lane>,
# started in the main checkout with a rendered kickoff prompt. The session is NAMED
# (`claude -n forge-<lane>`), so T1 and the lane talk through Claude Code's own
# cross-session messaging — never through the pane:
#   T1 → lane   SendMessage(to: "forge-<lane>", notify_when_idle: true)    rulings, nudges
#   lane → T1   SendMessage(to: "<T1 session name>")                        PARK / STOP / OUTCOME
# An unattended lane cannot AskUserQuestion: lane-settings.json blocks the tool with a hook that
# points the lane back at T1, so the operator answers everything in T1's one session.
# The operator may still attach (`tmux attach -t forge-<lane>`, detach C-b d).
#
# Usage (help = run with no args):
#   lanes.sh render <kickoffs.md> <heading-regex> <out-file> [PARAM=VALUE ...]
#       Extract the first ```text block under the heading matching <heading-regex> into
#       <out-file>; fill each PARAM ("PARAMETER — set before pasting" line + every "$PARAM").
#   lanes.sh launch <campaign-dir> <lane> <prompt-file> [--model M] [--permission-mode P]
#                   [--cwd DIR] [--t1 NAME] [--attended] [--open]
#       Start tmux forge-<lane> in DIR (default /home/parso/forge), pane piped to
#       <campaign-dir>/heartbeat/<lane>.tmux.log, run the named claude session with the lane
#       protocol appended to its system prompt (lane-protocol.md) and the AskUserQuestion block
#       (lane-settings.json; --attended omits it for a session the operator sits in). T1's name
#       is found from this shell's own claude ancestor (or --t1 / LANES_T1). Confirmed by the
#       lane appearing in `claude agents --json`; adds <lane> to heartbeat/ACTIVE; records its
#       session id in heartbeat/<lane>.session (claude --resume <id> reopens it after retirement).
#       The tmux session ends when the claude session ends. --open pops a Windows Terminal tab.
#   lanes.sh list [campaign-dir]     sessions (claude agents --json), tmux forge-*, ACTIVE, STALL flags.
#   lanes.sh peek <lane> [N]         Last N pane lines (default 40) — diagnosis, not state.
#   lanes.sh open <lane> [DIR]       Windows Terminal tab attached to the session (WSL).
#   lanes.sh kill <campaign-dir> <lane>   Retire: end tmux, drop from ACTIVE, clear its stall
#                                    stamps, remove ~/forge-<lane> if clean (kept if dirty), prune.
#   lanes.sh reap <campaign-dir>     Retire every forge-* tmux session whose claude has exited;
#                                    name the live ones that are not in ACTIVE; prune worktrees.
#   lanes.sh events <campaign-dir>   Forever, one line per event, for a persistent Monitor:
#                                    STALL flag · LANE_GONE · LANE_EXITED · LANE_BLOCKED (status
#                                    `waiting`, with waitingFor) · LANE_IDLE (idle + heartbeat
#                                    > 10 min: the relay hole).
# Env: LANES_MODEL (opus) · LANES_PERMISSION_MODE (auto) · LANES_CWD (/home/parso/forge) ·
#      LANES_T1 · LANES_CLAUDE_BIN · LANES_WORKTREE_ROOT ($HOME) · LANES_CONFIRM_TIMEOUT_S (60).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${LANES_SESSION_PREFIX:-forge-}"
REPO="${LANES_CWD:-/home/parso/forge}"

die() { echo "lanes.sh: $*" >&2; exit 2; }
sess() { printf '%s%s' "$PREFIX" "$1"; }

# --- the roster: what Claude Code itself says is running ----------------------------------
roster() { ${LANES_ROSTER_CMD:-claude agents --json} 2>/dev/null || echo '[]'; }   # LANES_ROSTER_CMD: the test seam
# roster_row <session-name> → "status waitingFor pid sessionId", empty if not running.
# The keys are the ones `claude agents --json` really emits (measured on Claude Code v2.1.260,
# 2026-09-04, bead forge-8vfn.2.31): cwd kind name pid sessionId startedAt status — plus
# waitingFor, which appears only while status is `waiting`. There is NO `state` key; reading one
# is why the two `*blocked*` matches this script used to carry could never fire, and a lane
# parked on a dialog was reported as launched (both are gone; `row_is_waiting` replaces
# them). Status values seen: busy · idle · waiting.
# waitingFor values seen: "permission prompt" (a tool permission dialog) · "input needed"
# (an AskUserQuestion). Nothing anywhere emits the string "blocked".
roster_row() {
  roster | python3 -c '
import json, sys
for a in json.load(sys.stdin):
    if a.get("name") == sys.argv[1]:
        print(a.get("status", ""), a.get("waitingFor", "-"), a.get("pid", ""), a.get("sessionId", "")); break' "$1"
}
# A lane parked on a dialog only a terminal can answer. One predicate, used by launch and events.
# Only field 1 is read positionally: `waitingFor` contains a SPACE ("permission prompt"), so
# nothing may index past it. Anything that needs the pid asks for the pid.
row_is_waiting() { [ "${1%% *}" = waiting ]; }
# roster_pid <session-name> → its pid, straight from the JSON. Never parsed out of roster_row:
# a `waitingFor` of "permission prompt" shifts every positional field after it by one, and a
# retirement that reads the wrong field silently retires nothing (measured 2026-09-04).
roster_pid() {
  roster | python3 -c '
import json, sys
for a in json.load(sys.stdin):
    if a.get("name") == sys.argv[1]:
        print(a.get("pid", "")); break' "$1"
}
# The T1 session is the claude process this shell is running under (a Bash tool call).
t1_name() {
  if [ -n "${LANES_T1:-}" ]; then printf '%s' "$LANES_T1"; return 0; fi
  local pid=$$ chain=""
  while [ "$pid" -gt 1 ]; do
    chain="$chain $pid"
    pid="$(sed 's/.*) //' "/proc/$pid/stat" 2>/dev/null | awk '{print $2}')"; [ -n "$pid" ] || pid=1
  done
  roster | python3 -c '
import json, sys
chain = set(sys.argv[1].split())
for a in json.load(sys.stdin):
    if str(a.get("pid")) in chain:
        print(a.get("name", "")); break' "$chain"
}
pane_cmd() { tmux display -p -t "$1" '#{pane_current_command}' 2>/dev/null || true; }

# --- retiring processes: by PID found through /proc, never `pkill -f` ------------------------
# §15.100 (sessions s4): `kill` ended the tmux session and left an RC-attached claude alive with
# cwd `/home/parso/forge-sessions (deleted)`. §15.150: `pkill -f <pattern>` matches the shell
# running it. So: resolve cwd per pid, compare paths, kill the pids we resolved, and say which.

# proc_cwd <pid> → its cwd with the " (deleted)" suffix stripped (a removed worktree keeps it)
proc_cwd() { local c; c="$(readlink "/proc/$1/cwd" 2>/dev/null || true)"; printf '%s' "${c% (deleted)}"; }
# self_chain → this shell and every ancestor, so a retirement can never kill its own caller
self_chain() {
  local pid=$$ chain=""
  while [ "$pid" -gt 1 ]; do
    chain="$chain $pid"
    pid="$(sed 's/.*) //' "/proc/$pid/stat" 2>/dev/null | awk '{print $2}')"; [ -n "$pid" ] || pid=1
  done
  printf '%s' "$chain"
}
# retire_pid <pid> <why> → TERM, wait <=10s, KILL, verify /proc/<pid> is gone. Prints the pid.
retire_pid() {
  local pid="$1" why="$2"
  kill -TERM "$pid" 2>/dev/null || true
  local waited=0
  while [ "$waited" -lt 20 ] && [ -d "/proc/$pid" ]; do sleep 0.5; waited=$((waited + 1)); done
  if [ -d "/proc/$pid" ]; then kill -KILL "$pid" 2>/dev/null || true; sleep 1; fi
  if [ -d "/proc/$pid" ]; then echo "COULD NOT RETIRE pid $pid ($why) — still alive after TERM+KILL" >&2; return 1; fi
  echo "retired pid $pid ($why)"
}
# pids_under <path> → every pid, except this shell and its ancestors, whose cwd is <path> or below
pids_under() {
  local root="$1" chain p c
  chain=" $(self_chain) "
  for p in /proc/[0-9]*; do
    p="${p#/proc/}"
    case "$chain" in *" $p "*) continue ;; esac
    c="$(proc_cwd "$p")"; [ -n "$c" ] || continue
    case "$c" in "$root"|"$root"/*) echo "$p" ;; esac
  done
}
# pids_claude_in <cwd> <since-epoch> → claude processes in exactly <cwd> started at/after <since>.
# The start-time bound is what makes this safe in a SHARED cwd: an older session in the same
# directory (T1's own, say) is not ours to kill. /proc/<pid> mtime is the process start time.
pids_claude_in() {
  local cwd="$1" since="$2" chain p st
  chain=" $(self_chain) "
  for p in $(pgrep -x claude 2>/dev/null || true); do
    case "$chain" in *" $p "*) continue ;; esac
    [ "$(proc_cwd "$p")" = "$cwd" ] || continue
    st="$(stat -c %Y "/proc/$p" 2>/dev/null || echo 0)"
    [ "$st" -ge "$since" ] || continue
    echo "$p"
  done
}

# --- ACTIVE: the stall watcher's input. Written by launch/kill only; lanes never touch it. ---
active_add() {
  local f="$1/heartbeat/ACTIVE" cur
  mkdir -p "$1/heartbeat"; [ -f "$f" ] || : > "$f"
  cur="$(tr ',' ' ' < "$f" | tr -s ' \n' ' ' | sed 's/\bNONE\b//g; s/^ *//; s/ *$//')" || cur=""
  case " $cur " in *" $2 "*) ;; *) cur="${cur:+$cur }$2" ;; esac
  printf '%s\n' "${cur:-NONE}" > "$f"
}
active_drop() {
  local f="$1/heartbeat/ACTIVE" cur
  [ -f "$f" ] || return 0
  cur="$(tr ',' ' ' < "$f" | tr -s ' \n' ' ' | sed "s/\b$2\b//g; s/\bNONE\b//g" | tr -s ' ' | sed 's/^ *//; s/ *$//')" || cur=""
  printf '%s\n' "${cur:-NONE}" > "$f"
}
active_lanes() { tr ',' ' ' < "$1/heartbeat/ACTIVE" 2>/dev/null | tr -s ' \n' ' ' | sed 's/\bNONE\b//g'; }

cmd_render() {
  local src="$1" re="$2" out="$3"; shift 3
  [ -f "$src" ] || die "no such file: $src"
  # A heading regex that matches nothing used to leave `found` false, so the FIRST ```text block
  # in the file won — two wave-3 renders of kickoffs §11 silently produced the T1 kickoff block
  # (bead forge-uowf, §15.59). A miss is an error, and the file asked for is never written.
  local heading awkre="${re//\\/\\\\}"
  heading="$(awk -v re="$awkre" '$0 ~ re { print; exit }' "$src")"
  [ -n "$heading" ] || die "no heading matching /$re/ in $src — a miss is an error, never the first block (forge-uowf)"
  local tmp; tmp="$(mktemp)"
  awk -v re="$awkre" '
    !found && $0 ~ re { found=1; next }
    found && !inblock && /^```text/ { inblock=1; next }
    inblock && /^```$/ { exit }
    inblock { print }
  ' "$src" > "$tmp"
  if [ ! -s "$tmp" ]; then rm -f "$tmp"; die "no \`\`\`text block found under /$re/ in $src (heading matched: $heading)"; fi
  mv "$tmp" "$out"
  local kv k v
  for kv in "$@"; do
    k="${kv%%=*}"; v="${kv#*=}"
    sed -i -E "s/^PARAMETER — set before pasting: $k = .*/PARAMETER: $k = $v/; s/\\\$$k\\b/$v/g" "$out"
  done
  # The matched heading is printed so a render can be checked BEFORE a launch (§15.59).
  echo "rendered $out from heading: $heading ($(wc -l < "$out") lines)"
}

# die_launch <camp> <lane> <session> <lane-cwd> <t0> <message>
# The failure path undoes what the success path started (bead forge-8vfn.2.32, reproduced live
# 2026-09-04: `launch` printed NOT CONFIRMED and left the tmux session AND claude pid 421213
# running with ACTIVE still NONE — a live session with a full prompt, no orchestrator, no
# registry entry and no watcher signal). `active_add` has not run at this point, so ACTIVE is
# untouched by construction; the session and the process it started are not.
die_launch() {
  local camp="$1" lane="$2" s="$3" cwd="$4" t0="$5" msg="$6" p
  tmux kill-session -t "$s" 2>/dev/null && echo "ended tmux $s (undoing a launch that was never confirmed)" >&2
  for p in $(pids_claude_in "$cwd" "$t0"); do retire_pid "$p" "half-launched lane $lane" >&2 || true; done
  die "$msg"
}

cmd_launch() {
  local camp="$1" lane="$2" prompt="$3"; shift 3
  local model="${LANES_MODEL:-opus}" pm="${LANES_PERMISSION_MODE:-auto}" cwd="$REPO" t1="" attended=0 open=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --model) model="$2"; shift 2 ;;
      --permission-mode) pm="$2"; shift 2 ;;
      --cwd) cwd="$2"; shift 2 ;;
      --t1) t1="$2"; shift 2 ;;
      --attended) attended=1; shift ;;
      --open) open=1; shift ;;
      *) die "unknown flag $1" ;;
    esac
  done
  local s; s="$(sess "$lane")"
  [ -d "$camp" ] || die "no campaign dir: $camp"
  [ -s "$prompt" ] || die "prompt file missing or empty: $prompt"
  [ -d "$cwd" ] || die "no cwd: $cwd"
  # The -s check above ran in the LAUNCHER's cwd; the `cat` below runs inside the pane, in --cwd.
  # A relative path passed both and launched a promptless session — $0.00, 0 context, an empty
  # box, twice (bead forge-uowf, §15.60). Resolve everything to absolute before send-keys.
  camp="$(cd "$camp" && pwd)"
  prompt="$(cd "$(dirname "$prompt")" && pwd)/$(basename "$prompt")"
  cwd="$(cd "$cwd" && pwd)"
  tmux has-session -t "$s" 2>/dev/null && die "session $s already exists (lanes.sh peek $lane / kill)"
  [ -z "$(roster_row "$s")" ] || die "a claude session named $s is already running (claude agents --json)"
  [ -n "$t1" ] || t1="$(t1_name)"
  [ -n "$t1" ] || die "cannot tell which session is T1: run this from T1's own shell, or pass --t1 <name> (your name is on the first line of ListAgents)"
  local bin="${LANES_CLAUDE_BIN:-$(command -v claude || true)}"
  [ -n "$bin" ] || die "claude not on PATH (set LANES_CLAUDE_BIN)"
  local sid; sid="$(uuidgen)"
  mkdir -p "$camp/heartbeat" "$camp/prompts"
  local proto="$camp/prompts/$lane.protocol.md"
  sed -e "s|\$CAMPAIGN|$camp|g; s|\$LANE|$lane|g; s|\$T1|$t1|g" "$HERE/../lane-protocol.md" > "$proto"
  local settings=""
  [ "$attended" = 1 ] || settings="--settings '$HERE/../lane-settings.json'"
  local t0; t0="$(date +%s)"
  tmux new-session -d -s "$s" -c "$cwd" -x 200 -y 50
  tmux pipe-pane -o -t "$s" "cat >> '$camp/heartbeat/$lane.tmux.log'"
  # LANES_* reach the hook; `; exit` ends the tmux session when the claude session ends.
  tmux send-keys -t "$s" "LANES_LANE='$lane' LANES_T1='$t1' $bin -n '$s' --session-id $sid --model $model --permission-mode $pm $settings --append-system-prompt \"\$(cat '$proto')\" \"\$(cat '$prompt')\"; exit" Enter
  # Confirmed by effect: Claude Code lists the session. A pane showing text proves nothing.
  local deadline=$(( $(date +%s) + ${LANES_CONFIRM_TIMEOUT_S:-60} )) row=""
  while [ "$(date +%s)" -lt "$deadline" ]; do
    row="$(roster_row "$s")"; [ -n "$row" ] && break; sleep 2
  done
  if [ -z "$row" ]; then
    # No row at all is ALSO the trust-dialog state, measured 2026-09-04: a lane launched into a
    # never-opened directory sits on "Is this a project you trust?" and never reaches the roster,
    # while its process is alive in the lane's cwd. die_launch names and retires exactly those.
    die_launch "$camp" "$lane" "$s" "$cwd" "$t0" \
      "launch NOT CONFIRMED for $lane: no session named $s in 'claude agents --json' after ${LANES_CONFIRM_TIMEOUT_S:-60}s (a trust dialog looks exactly like this). Attach with 'tmux attach -t $s'."
  fi
  if row_is_waiting "$row"; then
    die_launch "$camp" "$lane" "$s" "$cwd" "$t0" \
      "launch NOT CONFIRMED for $lane: $s is up but waiting on a dialog [$row]. The second field is waitingFor — 'permission prompt' or 'input needed'. Attach with 'tmux attach -t $s' to answer it."
  fi
  active_add "$camp" "$lane"
  printf '%s\n' "$sid" > "$camp/heartbeat/$lane.session"
  echo "launched $s  [$row]  model=$model permission-mode=$pm cwd=$cwd t1=$t1 attended=$attended"
  echo "talk:    SendMessage(to: \"$s\", notify_when_idle: true)"
  echo "attach:  tmux attach -t $s   (detach: C-b d)     later: claude --resume $sid"
  echo "log:     $camp/heartbeat/$lane.tmux.log"
  [ "$open" = 1 ] && cmd_open "$lane" "$cwd"
  return 0
}

cmd_peek() { tmux capture-pane -p -t "$(sess "$1")" -S "-${2:-40}"; }

cmd_open() {
  local s; s="$(sess "$1")" cwd="${2:-$REPO}"
  local wt; wt="$(command -v wt.exe || ls /mnt/c/Users/*/AppData/Local/Microsoft/WindowsApps/wt.exe 2>/dev/null | head -1 || true)"
  if [ -z "$wt" ]; then echo "no wt.exe — attach by hand: tmux attach -t $s"; return 0; fi
  nohup "$wt" -w 0 new-tab --title "$s" wsl.exe -d "${WSL_DISTRO_NAME:-Ubuntu}" --cd "$cwd" -- tmux attach -t "$s" >/dev/null 2>&1 &
  echo "opened Windows Terminal tab attached to $s"
}

cmd_list() {
  local camp="${1:-}"
  echo "== claude sessions on this host (claude agents --json) =="
  roster | python3 -c '
import json, sys
for a in json.load(sys.stdin):
    print("%-28s %-12s %-8s %s" % (a.get("name", "?"), a.get("kind", ""), a.get("status", ""), a.get("waitingFor", "")))'
  echo "== tmux $PREFIX* =="
  tmux ls -F '#{session_name} pane=#{pane_current_command} attached=#{session_attached} created=#{t:session_created}' 2>/dev/null | grep "^$PREFIX" || echo "(none)"
  if [ -n "$camp" ]; then
    echo "== ACTIVE == $(cat "$camp/heartbeat/ACTIVE" 2>/dev/null || echo '(no file)')"
    echo "== STALL flags =="; ls "$camp"/heartbeat/STALL-* 2>/dev/null || echo "(none)"
  fi
}

cmd_kill() {
  local camp="$1" lane="$2" s p n lanepid; s="$(sess "$lane")"
  # Read the session's own pid from the roster BEFORE ending the pane — after tmux dies the row
  # is gone, and that pid IS §15.100's survivor (an RC-attached claude outlives its pane). This
  # is also the only retirement that works for a lane launched with --cwd instead of a worktree.
  lanepid="$(roster_pid "$s")"
  tmux kill-session -t "$s" 2>/dev/null && echo "ended tmux $s" || echo "no tmux session $s"
  if [ -n "$lanepid" ] && [ -d "/proc/$lanepid" ]; then
    retire_pid "$lanepid" "lane $lane session, from the roster" || true
  fi
  active_drop "$camp" "$lane"
  rm -f "$camp/heartbeat/.armed-$lane" "$camp/heartbeat/STALL-$lane"
  local wt="${LANES_WORKTREE_ROOT:-$HOME}/forge-$lane"
  if [ -d "$wt" ]; then
    # Ending the pane is not retiring the lane: §15.100 found an RC-attached claude alive with
    # cwd `/home/parso/forge-sessions (deleted)` after the worktree was removed under it. Two
    # passes, both by PID resolved through /proc — never `pkill -f`, which matches this shell
    # (§15.150). The worktree is removed only once nothing is standing in it.
    n=0
    for p in $(pgrep -x claude 2>/dev/null || true); do
      case "$(proc_cwd "$p")" in "$wt"|"$wt"/*) retire_pid "$p" "lane $lane claude" && n=$((n + 1)) || true ;; esac
    done
    for p in $(pids_under "$wt"); do
      [ -d "/proc/$p" ] || continue
      retire_pid "$p" "orphan in $wt ($(tr -d '\0' < "/proc/$p/comm" 2>/dev/null || echo '?'))" && n=$((n + 1)) || true
    done
    echo "retired $n process(es) whose cwd was $wt"
    if [ -z "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
      git -C "$REPO" worktree remove "$wt" && echo "removed clean worktree $wt (its branch is untouched)"
    else
      echo "KEPT worktree $wt: $(git -C "$wt" status --porcelain | wc -l) uncommitted path(s) — commit or discard by hand, then git -C $REPO worktree remove $wt"
    fi
  fi
  git -C "$REPO" worktree prune
  echo "ACTIVE = $(cat "$camp/heartbeat/ACTIVE" 2>/dev/null || echo NONE)"
}

cmd_reap() {
  local camp="$1" s lane active
  active=" $(active_lanes "$camp") "
  for s in $(tmux ls -F '#{session_name}' 2>/dev/null | grep "^$PREFIX" || true); do
    lane="${s#"$PREFIX"}"
    if [ "$(pane_cmd "$s")" != claude ]; then
      echo "reap $s: its claude has exited (pane runs '$(pane_cmd "$s")')"; cmd_kill "$camp" "$lane"
    elif [[ "$active" != *" $lane "* ]]; then
      echo "live but not in ACTIVE: $s — a finished lane? lanes.sh kill $camp $lane. T1's or the operator's own session? leave it"
    fi
  done
  git -C "$REPO" worktree prune
  echo "ACTIVE = $(cat "$camp/heartbeat/ACTIVE" 2>/dev/null || echo NONE)"
}

# once <seen-var> <key> <line>: print <line> the first time <key> is seen; `unsee` forgets it
once() { local -n _seen="$1"; case " $_seen " in *" $2 "*) ;; *) echo "$3"; _seen="$_seen $2" ;; esac; }
unsee() { local -n _seen="$1"; _seen="$(printf '%s' "$_seen" | sed "s/\b$2\b//")"; }

cmd_events() {
  local camp="$1" hb="$1/heartbeat" lane s row st cmd age f b
  # shellcheck disable=SC2034  # written through the namerefs in once/unsee
  local seen_stall="" seen_gone="" seen_exit="" seen_block="" seen_idle=""
  while true; do
    for f in "$hb"/STALL-*; do
      [ -f "$f" ] || continue; b="$(basename "$f")"
      once seen_stall "$b" "STALL: $(head -1 "$f") — run the 3-signal check (heartbeat · live subprocess · port) before any reclaim"
    done
    for lane in $(active_lanes "$camp"); do
      s="$(sess "$lane")"
      if ! tmux has-session -t "$s" 2>/dev/null; then
        once seen_gone "$lane" "LANE_GONE: $s tmux session gone but still in ACTIVE — re-derive its exit rows from git/gh, then lanes.sh kill $camp $lane"; continue
      fi
      cmd="$(pane_cmd "$s")"
      if [ "$cmd" != claude ]; then
        once seen_exit "$lane" "LANE_EXITED: $s claude has exited (pane runs '$cmd') — re-derive its exit rows, then lanes.sh kill $camp $lane"; continue
      fi
      row="$(roster_row "$s")"; st="${row%% *}"
      # `status == waiting` is the signal Claude Code actually emits; the row's second field is
      # waitingFor, which says WHICH dialog ("permission prompt" · "input needed"). The old
      # `*blocked*` match could never fire — no value anywhere contains that string (bead 2.31).
      if row_is_waiting "$row"; then
        once seen_block "$lane" "LANE_BLOCKED: $s is waiting on a dialog [$row] — only a terminal can answer it; tmux attach -t $s"
      else
        unsee seen_block "$lane"
      fi
      age=999999; [ -f "$hb/$lane.log" ] && age=$(( $(date +%s) - $(stat -c %Y "$hb/$lane.log") ))
      if [ "$st" = idle ] && [ "$age" -gt 600 ]; then
        once seen_idle "$lane" "LANE_IDLE: $s finished its turn, heartbeat $((age / 60)) min old — parked on a detached job or on you? SendMessage(to: \"$s\") to wake it"
      else
        unsee seen_idle "$lane"
      fi
    done
    sleep 30
  done
}

case "${1:-}" in
  render) shift; cmd_render "$@" ;;
  launch) shift; cmd_launch "$@" ;;
  list)   shift; cmd_list "$@" ;;
  peek)   shift; cmd_peek "$@" ;;
  open)   shift; cmd_open "$@" ;;
  kill)   shift; cmd_kill "$@" ;;
  reap)   shift; cmd_reap "$@" ;;
  events) shift; cmd_events "$@" ;;
  *) sed -n '2,42p' "$0"; exit 1 ;;
esac
