/**
 * forge-mfv5.1.47 (D-06): the branch a RESUME runs on, settled before any worktree step and never from
 * main: local as is (origin absent or equal), a missing one from origin/<branch>, a disagreement refused
 * listing the shas; an unreadable origin refuses only when local is missing (else it is named).
 */
import { execFileSync } from 'node:child_process';

export type ResumeBranchObservation = { local: string | null; origin: string | null; localOnly: string[]; originOnly: string[] };
export type ResumeBranchDecision = { action: 'use-local' | 'recreate-from-origin'; sha: string } | { action: 'refuse'; reason: string };
export type EnsureResumeBranchResult =
  | { ok: true; action: 'use-local' | 'recreate-from-origin'; sha: string; originUnknown?: string }
  | { ok: false; reason: string };

const shas = (list: string[]): string => list.map((s) => s.slice(0, 12)).join(', ');

export function decideResumeBranch(branch: string, o: ResumeBranchObservation): ResumeBranchDecision {
  if (o.local === null) {
    return o.origin === null
      ? { action: 'refuse', reason: `no local ${branch} and no origin/${branch} — nothing to resume from; a resume never recreates the branch from main` }
      : { action: 'recreate-from-origin', sha: o.origin };
  }
  if (o.localOnly.length > 0) {
    const theirs = o.originOnly.length > 0 ? `; origin has ${o.originOnly.length} the local lacks: ${shas(o.originOnly)}` : '';
    return { action: 'refuse', reason: `local ${branch} is ahead of origin/${branch} by ${o.localOnly.length} unpushed commit(s): ${shas(o.localOnly)}${theirs} — refusing rather than resetting; push or reconcile them by hand, then resume` };
  }
  if (o.originOnly.length > 0) {
    return { action: 'refuse', reason: `origin/${branch} has ${o.originOnly.length} commit(s) the local ${branch} lacks: ${shas(o.originOnly)} — refusing rather than overwriting them; fast-forward the local branch by hand, then resume` };
  }
  return { action: 'use-local', sha: o.local };
}

export function ensureResumeBranch(opts: { projectRepoPath: string; branch: string }): EnsureResumeBranchResult {
  const { branch } = opts;
  const git = (args: string[]): string => execFileSync('git', ['-C', opts.projectRepoPath, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const tip = (ref: string): string | null => { try { return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); } catch { return null; } };
  const why = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? '';
  const list = (range: string): string[] => git(['rev-list', range]).split('\n').filter(Boolean);
  const local = tip(`refs/heads/${branch}`);
  let hasOrigin = true;
  try { git(['remote', 'get-url', 'origin']); } catch { hasOrigin = false; } // a never-pushed project: local is the only copy
  let origin: string | null = null;
  if (hasOrigin) {
    let listed: string;
    try { listed = git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]); } catch (err) {
      const unknown = `could not read origin/${branch} (ls-remote failed: ${why(err)})`;
      return local === null ? { ok: false, reason: `${unknown} — refusing rather than assuming absent` } : { ok: true, action: 'use-local', sha: local, originUnknown: unknown };
    }
    if (listed) {
      try { git(['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]); } catch (err) {
        return { ok: false, reason: `could not fetch origin/${branch}: ${why(err)} — refusing rather than resuming on a stale view` };
      }
      origin = tip(`refs/remotes/origin/${branch}`);
      if (origin === null) return { ok: false, reason: `origin/${branch} was listed but did not resolve after the fetch` };
    }
  }
  let decision: ResumeBranchDecision;
  try {
    const both = local !== null && origin !== null;
    decision = decideResumeBranch(branch, { local, origin, localOnly: both ? list(`${origin}..${local}`) : [], originOnly: both ? list(`${local}..${origin}`) : [] });
  } catch (err) {
    return { ok: false, reason: `could not compare local ${branch} with origin/${branch}: ${why(err)}` };
  }
  if (decision.action === 'refuse') return { ok: false, reason: decision.reason };
  if (decision.action === 'recreate-from-origin') {
    try { git(['branch', branch, decision.sha]); } catch (err) {
      return { ok: false, reason: `could not recreate ${branch} from origin/${branch} (${decision.sha.slice(0, 12)}): ${why(err)}` };
    }
  }
  return { ok: true, action: decision.action, sha: decision.sha };
}
