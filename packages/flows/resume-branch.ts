/**
 * forge-mfv5.1.47 (P0, D-06) — which initiative branch a RESUME runs on.
 *
 * Measured: a resume whose local branch had been deleted reached
 * `git worktree add -b forge/<id>` and recreated the branch from main
 * ("branch: Created from HEAD"), so the run started on none of its own work.
 * A resume now settles its branch BEFORE any worktree step, from git alone:
 *
 *   - local present, origin absent (never pushed)   → the local branch, as is
 *   - local present, equal to origin/<branch>        → the local branch, as is
 *   - local MISSING, origin/<branch> present         → recreated from origin (the pushed work)
 *   - local MISSING, origin absent                   → refused by name
 *   - local AHEAD of origin (unpushed commits)       → refused, listing the shas
 *   - origin AHEAD of local (commits local lacks)    → refused, listing the shas
 *   - an origin that cannot be read, local MISSING   → refused (UNKNOWN, never "absent")
 *   - an origin that cannot be read, local present   → the local branch as is, NAMED
 *     `originUnknown` (nothing here writes; the entry rebase's own fetch then
 *     refuses by name, D-06)
 *
 * Never from main, never a reset, never a force-push. The decision is a pure
 * function of the observed shas; `ensureResumeBranch` observes and acts.
 */

import { execFileSync } from 'node:child_process';

export type ResumeBranchObservation = {
  /** The local branch tip, null when there is no local branch. */
  local: string | null;
  /** origin/<branch>'s tip; null when origin has no such branch or there is no origin remote. */
  origin: string | null;
  /** Commits on local not on origin (newest first). */
  localOnly: string[];
  /** Commits on origin not on local (newest first). */
  originOnly: string[];
};

export type ResumeBranchDecision =
  | { action: 'use-local'; sha: string }
  | { action: 'recreate-from-origin'; sha: string }
  | { action: 'refuse'; reason: string };

const shas = (list: string[]): string => list.map((s) => s.slice(0, 12)).join(', ');

export function decideResumeBranch(branch: string, o: ResumeBranchObservation): ResumeBranchDecision {
  if (o.local === null) {
    if (o.origin === null) {
      return { action: 'refuse', reason: `no local ${branch} and no origin/${branch} — nothing to resume from; a resume never recreates the branch from main` };
    }
    return { action: 'recreate-from-origin', sha: o.origin };
  }
  if (o.origin === null) return { action: 'use-local', sha: o.local };
  if (o.localOnly.length > 0) {
    return {
      action: 'refuse',
      reason: `local ${branch} is ahead of origin/${branch} by ${o.localOnly.length} unpushed commit(s): ${shas(o.localOnly)}${o.originOnly.length > 0 ? `; origin has ${o.originOnly.length} the local lacks: ${shas(o.originOnly)}` : ''} — refusing rather than resetting; push or reconcile them by hand, then resume`,
    };
  }
  if (o.originOnly.length > 0) {
    return {
      action: 'refuse',
      reason: `origin/${branch} has ${o.originOnly.length} commit(s) the local ${branch} lacks: ${shas(o.originOnly)} — refusing rather than overwriting them; fast-forward the local branch by hand, then resume`,
    };
  }
  return { action: 'use-local', sha: o.local };
}

export type EnsureResumeBranchResult =
  | { ok: true; action: 'use-local' | 'recreate-from-origin'; sha: string; originUnknown?: string }
  | { ok: false; reason: string; observation: ResumeBranchObservation | null };

/** Observe the branch on both sides (fetching origin's), then apply `decideResumeBranch`. */
export function ensureResumeBranch(opts: { projectRepoPath: string; branch: string }): EnsureResumeBranchResult {
  const { projectRepoPath, branch } = opts;
  const git = (args: string[]): string => execFileSync('git', ['-C', projectRepoPath, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const tip = (ref: string): string | null => {
    try { return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); } catch { return null; }
  };
  const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? '';

  const local = tip(`refs/heads/${branch}`);
  let hasOrigin = true;
  try { git(['remote', 'get-url', 'origin']); } catch { hasOrigin = false; }

  let origin: string | null = null;
  if (hasOrigin) {
    let listed: string;
    try {
      listed = git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
    } catch (err) {
      const unknown = `could not read origin/${branch} (ls-remote failed: ${errText(err)})`;
      if (local === null) return { ok: false, reason: `${unknown} — refusing rather than assuming absent`, observation: null };
      return { ok: true, action: 'use-local', sha: local, originUnknown: unknown };
    }
    if (listed) {
      try {
        git(['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
      } catch (err) {
        return { ok: false, reason: `could not fetch origin/${branch}: ${errText(err)} — refusing rather than resuming on a stale view`, observation: null };
      }
      origin = tip(`refs/remotes/origin/${branch}`);
      if (origin === null) return { ok: false, reason: `origin/${branch} was listed but did not resolve after the fetch`, observation: null };
    }
  }

  const between = (from: string, to: string): string[] => {
    const out = git(['rev-list', `${from}..${to}`]);
    return out ? out.split('\n') : [];
  };
  let observation: ResumeBranchObservation;
  try {
    observation = {
      local,
      origin,
      localOnly: local !== null && origin !== null ? between(origin, local) : [],
      originOnly: local !== null && origin !== null ? between(local, origin) : [],
    };
  } catch (err) {
    return { ok: false, reason: `could not compare local ${branch} with origin/${branch}: ${errText(err)}`, observation: null };
  }

  const decision = decideResumeBranch(branch, observation);
  if (decision.action === 'refuse') return { ok: false, reason: decision.reason, observation };
  if (decision.action === 'recreate-from-origin') {
    try {
      git(['branch', branch, decision.sha]);
    } catch (err) {
      return { ok: false, reason: `could not recreate ${branch} from origin/${branch} (${decision.sha.slice(0, 12)}): ${errText(err)}`, observation };
    }
  }
  return { ok: true, action: decision.action, sha: decision.sha };
}
