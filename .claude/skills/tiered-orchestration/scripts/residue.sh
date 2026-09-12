#!/usr/bin/env bash
# residue.sh — print §15.427's residue list IN FULL for one worktree, every item
# by path with its count, from ONE date stamp.
#
#   residue.sh <worktree>
#
# WHY IT EXISTS. Two lanes' launchers each hand-rolled this list and each omitted
# a different item: M6-C printed porcelain and not the six queue counts (861);
# M6-A printed the queue and not `_logs/_agent-*` (873); M6-D printed the queue
# and not porcelain, and labelled a count `_agent-dirs` while counting only
# `_agent-*` and not `_authoring-*` (875). Three lanes, three omissions, and each
# lane had instrumented the item its OWN last incident was about. That is not a
# memory problem to be solved by remembering harder — it is `heartbeat.sh`'s
# shape: when the rule is "remember to also print X", make X structurally
# inseparable from the rest.
#
# ONE DATE. Every line carries the same stamp, taken once, so a reader can never
# be shown two items measured at different moments and read them as one census.
#
# EVERY PATH IS AN ARGUMENT (§15.148): a tool that resolves its own root answers
# a different question in each checkout.
#
# INERT (§15.494): this script has no launch path and takes no lock — grep it for
# `npm run`, `flock`, `--approve-spend`; there are none. It is safe to pipe, safe
# to truncate, safe to run at any time. It makes exactly ONE write, named below.
#
# EXIT: 0 only when every GATING item is zero or absent. Otherwise 1, naming the
# FIRST non-zero item — a verdict that says "not clean" without saying which is
# the summary-without-items this file exists to replace.
set -u

R="${1:?usage: residue.sh <worktree>}"
[ -d "$R" ] || { echo "residue.sh: no such worktree: $R" >&2; exit 2; }
[ $# -le 1 ] || { echo "residue.sh: unexpected argument '$2' — this tool takes one worktree and nothing else" >&2; exit 2; }

TS=$(date -u +%FT%TZ)          # ONE date, used by every line below.
say() { echo "$TS RESIDUE $*"; }

FIRST=""                        # the first gating item found non-zero
gate() {                        # gate <label> <count>
  say "$1=$2"
  [ "$2" = "0" ] && return 0
  [ -n "$FIRST" ] || FIRST="$1=$2"
}

# --- porcelain, SPLIT. 861: `.gitignore:42` hides `_queue/ready-for-review/*`,
# so "porcelain 0" stood as the clean-tree line for thirteen hours with a real
# initiative sitting in the queue. Tracked and untracked are different claims and
# are never collapsed here.
P_TRACKED=$(cd "$R" && git status --porcelain 2>/dev/null | grep -cv '^??' || true)
P_UNTRACKED=$(cd "$R" && git status --porcelain 2>/dev/null | grep -c '^??' || true)
gate "porcelain.tracked" "$P_TRACKED"
gate "porcelain.untracked" "$P_UNTRACKED"

# --- the six queue states, by path. `.gitkeep` is structure, not work.
for q in pending in-flight ready-for-review done merged failed; do
  n=$(ls -1 "$R/_queue/$q" 2>/dev/null | grep -vx '.gitkeep' | grep -c . || true)
  gate "_queue/$q" "$n"
done

# --- worktrees the scheduler resolves as a sibling of the queue root
# (`enqueue-flow-run.ts:353`), which is why a leftover tree is a false-green risk
# and not untidiness.
gate "_worktrees" "$(ls -1 "$R/_worktrees" 2>/dev/null | grep -c . || true)"

# --- session dirs, EACH FAMILY NAMED SEPARATELY. A single `_agent-dirs` label
# over one glob is the 875 defect: the label claimed more than the count covered.
gate "_logs/_agent-*"     "$(ls -1d "$R"/_logs/_agent-*     2>/dev/null | grep -c . || true)"
gate "_logs/_authoring-*" "$(ls -1d "$R"/_logs/_authoring-* 2>/dev/null | grep -c . || true)"
# 864: a `<ts>_INIT-*` cycle dir carries no `turn.pid` and no marker, so the
# reaper's collector skips it and a ceiling fed from that collector cannot see
# what it spent. Counted here precisely because the spend path cannot.
gate "_logs/<ts>_INIT-*"  "$(ls -1d "$R"/_logs/*_INIT-*     2>/dev/null | grep -c . || true)"
# 872: the bridge opens its own run dir at BOOT. It is not a dispatched turn and
# never gates — reported so a reader is not left wondering where it went.
say "_logs/_bridge-*=$(ls -1d "$R"/_logs/_bridge-* 2>/dev/null | grep -c . || true) (informational — the bridge's own boot dir, never a spawn, never gating)"

# --- the daemon pid file. THREE states, not two: absent, dead (removed here),
# LIVE (gates). This is the script's ONE write, and it is deliberate: a pid file
# for a process that no longer exists is residue by definition, and every
# launcher that hand-rolled this list already removed it.
PID_FILE="$R/_logs/daemon/forge.pid"
if [ ! -f "$PID_FILE" ]; then
  say "_logs/daemon/forge.pid=absent"
else
  dp=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$dp" ] && [ -d "/proc/$dp" ]; then
    say "_logs/daemon/forge.pid=LIVE:$dp"
    [ -n "$FIRST" ] || FIRST="_logs/daemon/forge.pid=LIVE:$dp"
  else
    say "_logs/daemon/forge.pid=dead-and-removed:${dp:-empty} (mtime $(stat -c %y "$PID_FILE" 2>/dev/null))"
    rm -f "$PID_FILE"
  fi
fi

# --- 746: a campaign dir inside the worktree. Present is residue, not config.
if [ -e "$R/_1.0" ]; then
  say "_1.0/=present"
  [ -n "$FIRST" ] || FIRST="_1.0/=present"
else
  say "_1.0/=absent"
fi

if [ -z "$FIRST" ]; then
  say "VERDICT clean — every gating item above is zero or absent"
  exit 0
fi
say "VERDICT NOT CLEAN — first non-zero gating item: $FIRST"
exit 1
