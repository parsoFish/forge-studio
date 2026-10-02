#!/usr/bin/env bash
# gate-stories.sh — gate.sh's own step for the costless stories CI runs (M7
# findings row 76, T1 ruling 1973cy item 76).
#
#   gate-stories.sh <joined-shell-command>
#
# `gate.sh` derives the one argument from the `stories` job's own multi-line
# `run: |` block in ci.yml (its `steps()`, never a hard-coded `smoke`/`proof`
# pair) and hands it here verbatim, `&&`-joined — so a future change to which
# stories CI runs there is picked up automatically, the same rule §15.37
# states for every other step this file reads.
#
# TWO PRECONDITIONS A BARE `eval` of that text would not carry:
#
#  1. CHROMIUM ALREADY INSTALLED. CI's own preceding step is `npx
#     playwright-core install --with-deps chromium`, which needs `sudo apt`
#     and is refused on a lane host (ci.yml's sibling build-and-test job
#     comment says why — no `--with-deps` off a shared runner image). So this
#     NEVER installs it — only checks, and REFUSES BY NAME (§15.92) rather
#     than failing three npm scripts deep inside a browser launch.
#
#  2. THE RUN-LOCK, ordered suite-then-run (`with-locks.sh`'s own header).
#     `gate.sh` already holds `.suite-lock` itself, or runs under an ancestor
#     that does (forge-8vfn.7.6.79) — this step must never make a SECOND,
#     independent acquire of that same lock, which is exactly the deadlock
#     `with-locks.sh` already refuses to let a wrapped `gate.sh` cause, one
#     level out. So this takes ONLY the run-lock, via `with-locks.sh
#     <campaign> run --`. The story runner's own `lockOrderVerdict`
#     (scripts/stories/lock-guard.mjs) then finds the run-lock held by this
#     process's own ancestry (the wrapper) and the suite-lock held by ITS
#     ancestry (gate.sh, or gate.sh's own ancestor) — satisfied without this
#     script ever touching `.suite-lock`.
#
#     No `$CAMP` argument: `FORGE_RUN_LOCK` — gate.sh already exports it when
#     a campaign is named — carries the campaign dir as its own dirname, and
#     a second way to spell the same path is forge-e8dn's own lesson. Outside
#     a campaign (both unset) the command runs directly, unserialised — the
#     same contract gate.sh's own suite-lock take already states.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD="${1:?usage: gate-stories.sh <joined-command>}"

# FORGE_CHROMIUM_EXECUTABLE is the test seam — same idiom as this skill's
# FORGE_PROC_LOCKS / FORGE_LOADAVG_FILE elsewhere: a door proving the REFUSAL
# and the pass-through fire correctly without actually downloading a browser.
chromium_path() {
  if [ -n "${FORGE_CHROMIUM_EXECUTABLE:-}" ]; then
    printf '%s' "$FORGE_CHROMIUM_EXECUTABLE"
    return
  fi
  node -e "try{process.stdout.write(require('playwright-core').chromium.executablePath())}catch{}" 2>/dev/null
}

CHROMIUM="$(chromium_path)"
if [ -z "$CHROMIUM" ] || [ ! -x "$CHROMIUM" ]; then
  echo "[stories-guard] chromium is not installed at '${CHROMIUM:-<unresolved>}' — run \`npx playwright-core install chromium\` first (CI's own preceding step); this step never installs it for you (no sudo apt on a lane host)"
  exit 75
fi

if [ -n "${FORGE_RUN_LOCK:-}" ]; then
  exec "$HERE/with-locks.sh" "$(dirname "$FORGE_RUN_LOCK")" run -- bash -c "$CMD"
fi
exec bash -c "$CMD"
