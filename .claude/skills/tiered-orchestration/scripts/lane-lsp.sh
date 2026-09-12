#!/usr/bin/env bash
# lane-lsp.sh — list or stop THIS lane session's own language servers.
#
#   lane-lsp.sh status            what this session is holding
#   lane-lsp.sh stop              kill those, by PID, and report
#   lane-lsp.sh status --from N   anchor on pid N instead of discovering the
#                                 session (tests only; see the door)
#
# forge-8vfn.7.6.58, operator instruction via rulings 809/812. A lane's LSP was
# the single largest process on the box — 728 MB of `tsserver`, larger than any
# `claude` session — while memory was the binding constraint and a sibling's
# gate waiters were being killed outright by pressure rather than timing out.
#
# THIS TOOL IS INERT UNTIL ITS INVOCATION IS ALLOW-LISTED in `lane-settings.json`,
# which is T1's file and the operator's decision. A lane does not widen its own
# permissions (§15.462) — least of all for a capability its permission classifier
# has already denied it once. Nothing here works around that; it is the thing
# that gets allow-listed, not a route past the list.
#
# ONLY OUR OWN DESCENDANTS, AND BY PID (ruling 665). Never a pattern kill:
# `pkill -f` matches the very shell that typed the pattern, which cost this lane
# an exit 144 and D the same thing an hour apart (§15.440). So the walk is:
# find the `claude` session this script is running under, collect ITS descendant
# tree, and keep only the language-server processes in it. A sibling lane's
# `tsserver` is 500 MB of somebody else's memory and is none of our business.
#
# `comm` GATES, `cmdline` DISCRIMINATES, and the order matters. A wrapper shell
# whose command text merely mentions `tsserver` — this file being edited, a job
# log being catted, this very script being invoked — carries the word in its
# cmdline and is `comm=bash`. The wrapper is not the server; its `node` children
# are. So `comm` must be `node` first, and only then does the cmdline decide.
set -u

MODE="${1:-status}"
ANCHOR=""
[ "${2:-}" = "--from" ] && ANCHOR="${3:-}"

case "$MODE" in status|stop) ;; *)
  echo "usage: lane-lsp.sh status|stop [--from <pid>]" >&2; exit 2 ;;
esac

ppid_of() { awk '/^PPid:/{print $2}' "/proc/$1/status" 2>/dev/null; }
comm_of() { cat "/proc/$1/comm" 2>/dev/null; }
rss_of()  { awk '/^VmRSS:/{print int($2/1024)}' "/proc/$1/status" 2>/dev/null; }
args_of() { tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null; }

# The session we belong to: walk up until `comm` is `claude`. Anchoring on the
# SESSION rather than on this shell is what keeps a sibling lane's servers out —
# every lane has its own `claude`, and each owns only what hangs beneath it.
discover_session() {
  local p="$$" hops=0
  while [ -n "$p" ] && [ "$p" != 1 ] && [ "$hops" -lt 40 ]; do
    [ "$(comm_of "$p")" = claude ] && { echo "$p"; return 0; }
    p=$(ppid_of "$p"); hops=$((hops + 1))
  done
  return 1
}

if [ -z "$ANCHOR" ]; then
  ANCHOR=$(discover_session) || {
    echo "lane-lsp.sh: REFUSING — no 'claude' session found in this process's parent chain." >&2
    echo "  This tool only ever touches ITS OWN session's descendants; with no session to anchor" >&2
    echo "  on there is nothing it may safely act upon, and a pattern match over the whole box is" >&2
    echo "  exactly what ruling 665 forbids." >&2
    exit 3
  }
fi
[ -d "/proc/$ANCHOR" ] || { echo "lane-lsp.sh: REFUSING — anchor pid $ANCHOR is not running." >&2; exit 3; }

# Is `p` a descendant of the anchor? Walked per process rather than by building a
# child map: the tree is shallow and /proc entries vanish mid-walk (D measured
# four disappearing between a listing and a read), so a miss must be harmless.
descends_from() {
  local p="$1" hops=0
  while [ -n "$p" ] && [ "$p" != 1 ] && [ "$hops" -lt 40 ]; do
    [ "$p" = "$ANCHOR" ] && return 0
    p=$(ppid_of "$p"); hops=$((hops + 1))
  done
  return 1
}

found=0 total=0 pids=""
for p in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
  [ "$p" = "$ANCHOR" ] && continue
  [ "$(comm_of "$p")" = node ] || continue          # gate: the server is node; a shell is not
  a=$(args_of "$p")
  case "$a" in
    *typescript/lib/tsserver.js*|*bin/typescript-language-server*|*bin/pyright*|*gopls*) ;;
    *) continue ;;
  esac
  descends_from "$p" || continue                    # ours, not a sibling lane's
  r=$(rss_of "$p"); r=${r:-0}
  printf '  LSP pid=%-8s rss=%-6s %s\n' "$p" "${r}MB" "$(echo "$a" | cut -c1-72)"
  pids="$pids $p"; total=$((total + r)); found=$((found + 1))
done

printf '  session=%s  servers=%s  totalRSS=%sMB\n' "$ANCHOR" "$found" "$total"
[ "$found" -eq 0 ] && { echo "  nothing to stop (a clean report, not a silent one)"; exit 0; }
[ "$MODE" = status ] && exit 0

for p in $pids; do
  kill "$p" 2>/dev/null && echo "  stopped pid=$p" || echo "  could not signal pid=$p (already gone?)"
done
sleep 1
# A ZOMBIE IS NOT RUNNING, and `[ -d /proc/$p ]` cannot tell the difference —
# `/proc/<pid>` survives until the parent reaps. The door caught this: a killed
# server whose parent had not yet waited was reported STILL RUNNING and the tool
# exited 1 on a clean stop. `kill -0` has the same blind spot. The state field is
# what distinguishes them: `Z` is dead-and-unreaped, and for this tool's purpose
# — memory reclaimed — a zombie has already released everything that mattered.
still_running() {
  local st
  st=$(awk '{print $3}' "/proc/$1/stat" 2>/dev/null) || return 1
  [ -n "$st" ] && [ "$st" != Z ]
}
left=0
for p in $pids; do still_running "$p" && { echo "  STILL RUNNING pid=$p"; left=$((left + 1)); }; done
printf '  stopped %s of %s; freed ~%sMB\n' "$((found - left))" "$found" "$total"
# The servers respawn on demand, so this is a reclaim and never a fix — M7 row 42
# records the durable form: disable the LSP plugin in the lane launch profile.
[ "$left" -eq 0 ] || exit 1
