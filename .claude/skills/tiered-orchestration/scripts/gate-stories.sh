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
# THREE PRECONDITIONS A BARE `eval` of that text would not carry:
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
#
#  3. THE TREE COMES BACK AS IT WAS FOUND (item 76 follow-up). The story
#     runner regenerates `demos/stories/**` (story.json + frames) and the doc
#     fragments under `docs/tutorials/`/`docs/how-to/` — real product output,
#     not noise, but THIS gate is a read of the tree as it stood when
#     invoked, and leaving that output dirty makes gate.sh's OWN LATER pins
#     check read it as this PR's undeclared change ("UNDECLARED:
#     M6-C:demos/stories/proof/story.json …", GATE_SH_EXIT=3 — measured on a
#     real gate run). So this step snapshots those trees before running —
#     REFUSING, never silently proceeding, if any of them is already dirty,
#     since there would then be no way to tell pre-existing work from this
#     run's own write — and restores them afterwards regardless of the run's
#     own exit code: `git restore --source=HEAD --worktree` for every tracked
#     path it touched, `rm -rf` for every untracked path it created. The
#     scope is the same three trees `scripts/stories/gallery.mjs`'s own
#     `GENERATED_TREES` names — a literal copy here rather than an import of
#     it, because routing a bash step through a node subprocess over a
#     three-item list pins this file under a SIBLING lane's manifest for no
#     behavioural gain, and that exact seam (parsing a spawned process's
#     stdout line by line) is what cost this fix's first attempt its final
#     entry (below).
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

# FORGE_STORIES_GENERATED_TREES is the test seam — same idiom as
# FORGE_CHROMIUM_EXECUTABLE. Set (even to "") to use that exact
# space-separated scope instead of the real default below.
#
# MEASURED: the first attempt at this piped a node subprocess's newline-
# joined stdout through `while IFS= read -r t; do …`, and the LAST entry —
# `docs/how-to`, with no trailing newline after it — went missing from the
# scope entirely on a real gate run, because `read`'s own loop condition
# fails on a final line with no newline to terminate it, and bash never
# enters the body for that line. A literal bash array has no such seam.
TREES=()
if [ -n "${FORGE_STORIES_GENERATED_TREES+x}" ]; then
  for t in $FORGE_STORIES_GENERATED_TREES; do [ -n "$t" ] && TREES+=("$t"); done
else
  TREES=(demos/stories apps/docs/src/content/docs/guides/how-to apps/docs/public/media/stories)
fi

if [ "${#TREES[@]}" -gt 0 ]; then
  if ! PRE="$(git status --porcelain -- "${TREES[@]}" 2>&1)"; then
    echo "[stories-guard] could not read \`git status\` for ${TREES[*]} — refusing rather than guessing whether this run's own output would be safe to restore: $PRE"
    exit 75
  fi
  if [ -n "$PRE" ]; then
    echo "[stories-guard] ${TREES[*]} already has uncommitted changes before this step ran — refusing rather than restoring over real work (commit, stash, or restore it first):"
    printf '%s\n' "$PRE" | sed 's/^/[stories-guard]   /'
    exit 75
  fi
fi

if [ -n "${FORGE_RUN_LOCK:-}" ]; then
  "$HERE/with-locks.sh" "$(dirname "$FORGE_RUN_LOCK")" run -- bash -c "$CMD"
else
  bash -c "$CMD"
fi
RC=$?

# RESTORE — regardless of RC: even a story that fails mid-run can have
# already written a beat's story.json before the beat that failed.
RESTORE_RC=0
if [ "${#TREES[@]}" -gt 0 ]; then
  # Plain (non `-z`) porcelain: bash command substitution mangles embedded
  # NULs (measured: `-z`'s own separator silently truncated the capture), and
  # every path this step ever writes is a plain kebab-case filename under
  # demos/stories or the docs site's how-to/media trees — never a space or a newline.
  POST="$(git status --porcelain -- "${TREES[@]}" 2>/dev/null)"
  if [ -n "$POST" ]; then
    echo "[stories] restoring ${TREES[*]} to the tree this step found (a gate must leave the tree as it found it):"
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      status="${line:0:2}"; path="${line:3}"
      echo "  $status $path"
      case "$status" in
        '??') rm -rf -- "$path" ;;
        *) git restore --source=HEAD --worktree -- "$path" ;;
      esac
    done <<< "$POST"
    STILL="$(git status --porcelain -- "${TREES[@]}" 2>/dev/null)"
    if [ -n "$STILL" ]; then
      echo "[stories-guard] could not fully restore ${TREES[*]} — still dirty after this step:"
      printf '%s\n' "$STILL" | sed 's/^/[stories-guard]   /'
      RESTORE_RC=1
    fi
  fi
fi

# A green run that cannot be cleaned up is not a green gate step — turn it
# into the same named REFUSED shape rather than reporting PASS over a dirty
# tree. A run that already failed on its own terms keeps its own exit code;
# the restore was still attempted and reported above either way.
if [ "$RC" -eq 0 ] && [ "$RESTORE_RC" -ne 0 ]; then
  exit 75
fi
exit "$RC"
