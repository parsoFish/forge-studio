/**
 * host-head.mjs — the HOST tree's own HEAD, recorded at story start and judged
 * at its end. Row 188 (bead forge-8vfn.8.5.25), T1 ruling 1973dz.
 *
 * MEASURED. During a costed S1 run from `~/forge-m7-e-s10`, the story's
 * onboarding agent committed 72ed93fa2 ("docs(brain): fill story-s1 Brain 3
 * profile", the profile.md inside the story ground's Brain 3 sub-wiki) onto
 * the branch the forge checkout running the stories had checked out — and the
 * fence printed `fence: clean`. It could not have said anything else: `fenceBreaches`
 * (`sweep.mjs`) diffs `git status --porcelain` before and after, and a
 * COMMITTED write leaves the porcelain exactly as clean as it found it. The
 * escape was not in the tree's dirt; it was in the tree's HISTORY, on a branch
 * the lane was about to push.
 *
 * SO THE FENCE ALSO READS HEAD. `recordHostHead` runs beside the fence's own
 * porcelain baseline; `judgeHostHead` runs after `applyFence` has judged the
 * porcelain, and reds the run — a named finding in the fence's own `[stories]
 * fence: …` wording — whenever HEAD is not where the story found it.
 *
 * AND THE CLEAR UNDOES WHAT THE RUN COMMITTED, under four conditions, every
 * one of which must hold or NOTHING is touched (the finding still reds):
 *
 *   1. the reset target is ONLY ever the HEAD this run itself recorded, on the
 *      tree this run itself is running in (`root`);
 *   2. the checked-out REF is the one recorded — a run that ends on another
 *      branch, or detached, never resets a ref it did not start on;
 *   3. every new commit DESCENDS from the recorded HEAD (`git merge-base
 *      --is-ancestor`) — a rewritten or rebased branch is not this run's to
 *      put back;
 *   4. the commits' own diff is written as evidence FIRST (`git format-patch
 *      --stdout`, into the run's red-evidence dir, `red-evidence.mjs`) — a
 *      reset that loses the only copy of what happened is not a clear.
 *
 * Then `git reset --soft <recorded>` moves the branch back and leaves the
 * commits' changes STAGED. A soft reset alone would hand the next reader a
 * dirty index, so the clear follows through path by path: a path that is the
 * story's OWN artefact (`fixturePathsFor` — the same list the leading and
 * trailing sweeps remove — plus the ground's Brain 3 sub-wiki, ruling 308's
 * designed write) is restored to the recorded HEAD in index and worktree
 * alike (`git restore --source=<recorded> --staged --worktree`), so the tree
 * ends as it started. Anything NOT the story's own STAYS, staged, for the
 * operator to read — never removed by a fence that cannot know whose it is —
 * and is named.
 *
 * RUNS AFTER THE PORCELAIN FENCE, deliberately: run before it, the foreign
 * paths a soft reset leaves staged would read as this run's porcelain breaches
 * and `applyFence` would restore them away — the exact "stays" this clear
 * promises them.
 *
 * UNREADABLE IS NAMED, NEVER CLEAN (§15.504): a HEAD that could not be read at
 * start or at end is its own red, not a silent pass.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { fixturePathsFor } from './sweep.mjs';

const PATCH_NAME = 'HOST-HEAD-MOVED.patch';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function errText(e) {
  return e?.stderr?.toString().trim() || e?.message || String(e);
}

/** The checked-out ref, or `(detached)`. `symbolic-ref -q` exits 1 on a detached HEAD, which is an answer, not an error. */
function readRef(root) {
  try {
    return git(root, ['symbolic-ref', '-q', 'HEAD']).trim();
  } catch (e) {
    if (e?.status === 1) return '(detached)';
    throw e;
  }
}

/**
 * HEAD and its ref, now.
 * @returns {{sha: string, ref: string, error: null} | {sha: null, ref: null, error: string}}
 */
export function recordHostHead(root) {
  try {
    return { sha: git(root, ['rev-parse', 'HEAD']).trim(), ref: readRef(root), error: null };
  } catch (e) {
    return { sha: null, ref: null, error: errText(e) };
  }
}

/** The story's own paths, repo-relative — a directory entry ends in `/`. */
function ownPrefixes(root, storyId, groundProject) {
  const own = fixturePathsFor(storyId, root).map((p) => `${relative(root, p)}/`);
  if (typeof groundProject === 'string' && /^[a-zA-Z0-9._-]+$/.test(groundProject)) own.push(`brain/projects/${groundProject}/`);
  return own;
}

const short = (sha) => sha.slice(0, 12);

/**
 * @param {{root: string, recorded: ReturnType<typeof recordHostHead>, storyId: string, groundProject?: string|null, evidenceDir: string}} args
 * @returns {{red: boolean, moved: boolean, reset: boolean, cleared: string[], foreign: string[], evidence: string|null, summary: string|null, lines: string[]}}
 */
export function judgeHostHead({ root, recorded, storyId, groundProject = null, evidenceDir }) {
  const judged = { red: false, moved: false, reset: false, cleared: [], foreign: [], evidence: null, summary: null, lines: [] };
  const red = (summary, ...lines) => ({ ...judged, red: true, summary, lines: [...judged.lines, ...lines] });
  if (recorded.error !== null) {
    return red('HEAD could not be read at story start',
      `[stories] fence: HEAD UNKNOWN — could not read this tree's HEAD at story start (${recorded.error}); a commit ` +
      'the run made would be invisible, so this is not clean');
  }
  const now = recordHostHead(root);
  if (now.error !== null) {
    return red('HEAD could not be read at story end',
      `[stories] fence: HEAD UNKNOWN — could not read this tree's HEAD at story end (${now.error}); recorded ` +
      `${short(recorded.sha)} on ${recorded.ref} at start — not clean`);
  }
  if (now.sha === recorded.sha && now.ref === recorded.ref) {
    return { ...judged, lines: [`[stories] fence: HEAD unchanged — ${short(now.sha)} on ${now.ref}, as the story found it`] };
  }
  judged.moved = true;
  const span = `${short(recorded.sha)}..${short(now.sha)}`;
  if (now.ref !== recorded.ref) {
    return red(`the checked-out ref changed from ${recorded.ref} to ${now.ref}`,
      `[stories] fence: HEAD MOVED ${span} — the checked-out ref changed from ${recorded.ref} to ${now.ref} during this ` +
      'run; NOT reset (the clear only ever moves the ref this run recorded) — investigate before trusting this run');
  }
  try {
    git(root, ['merge-base', '--is-ancestor', recorded.sha, now.sha]);
  } catch (e) {
    const why = e?.status === 1 ? `${short(recorded.sha)} is not an ancestor of ${short(now.sha)}` : errText(e);
    return red(`HEAD moved ${span} on ${now.ref} and does not descend from the recorded HEAD`,
      `[stories] fence: HEAD MOVED ${span} on ${now.ref} — ${why}; the branch was rewritten, not committed onto, so ` +
      'NOTHING was reset — investigate before trusting this run');
  }
  let commits;
  let paths;
  try {
    commits = git(root, ['log', '--format=%h %s', `${recorded.sha}..${now.sha}`]).trim().split('\n').filter((l) => l !== '');
    paths = git(root, ['diff', '--name-only', '-z', recorded.sha, now.sha]).split('\0').filter((p) => p !== '');
    mkdirSync(evidenceDir, { recursive: true });
    judged.evidence = join(evidenceDir, PATCH_NAME);
    writeFileSync(judged.evidence, git(root, ['format-patch', '--stdout', `${recorded.sha}..${now.sha}`]));
  } catch (e) {
    return red(`HEAD moved ${span} on ${now.ref} and its diff could not be kept`,
      `[stories] fence: HEAD MOVED ${span} on ${now.ref} — could not keep the commits' diff as evidence ` +
      `(${errText(e)}); NOTHING was reset, so the only copy is the branch itself — investigate before trusting this run`);
  }
  const moved = `[stories] fence: HEAD MOVED ${span} on ${now.ref} — ${commits.length} commit(s) landed on the tree ` +
    `running this story (${commits.join('; ')}); their diff is kept in ${judged.evidence}`;
  try {
    git(root, ['reset', '--soft', recorded.sha]);
  } catch (e) {
    return red(`HEAD moved ${span} on ${now.ref} and the soft reset failed`, moved,
      `[stories] fence: COULD NOT reset ${now.ref} to ${short(recorded.sha)}: ${errText(e)} — the commits are still on the branch`);
  }
  judged.reset = true;
  const prefixes = ownPrefixes(root, storyId, groundProject);
  const own = paths.filter((p) => prefixes.some((pre) => p.startsWith(pre)));
  judged.foreign = paths.filter((p) => !own.includes(p));
  const lines = [moved, `[stories] fence: HEAD RESET ${now.ref} to ${short(recorded.sha)} (git reset --soft) — the branch is where the story found it`];
  if (own.length > 0) {
    try {
      git(root, ['restore', `--source=${recorded.sha}`, '--staged', '--worktree', '--', ...own]);
      judged.cleared = own;
      for (const p of own) lines.push(`[stories] fence: CLEARED ${p} — the story's own artefact, committed during the run; restored to ${short(recorded.sha)}`);
    } catch (e) {
      lines.push(`[stories] fence: COULD NOT clear the story's own committed path(s) ${own.join(', ')}: ${errText(e)} — left staged`);
    }
  }
  for (const p of judged.foreign) {
    lines.push(`[stories] fence: STAGED ${p} — committed during the run and NOT the story's own; left staged in this tree ` +
      'for the operator (never removed by a fence that cannot know whose it is) — investigate before trusting this run');
  }
  return {
    ...judged,
    red: true,
    summary: `HEAD moved ${span} on ${now.ref} (${commits.length} commit(s); reset to the recorded HEAD, ` +
      `${judged.cleared.length} own path(s) cleared, ${judged.foreign.length} foreign path(s) left staged)`,
    lines,
  };
}
