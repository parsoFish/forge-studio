/**
 * Stale `forge/<INIT>` remote-branch probe (bead forge-8vfn.8.1.8).
 *
 * scheduler-run-one.ts always dispatches onto `forge/<INIT>` — no attempt
 * suffix, so a prior abandoned attempt's push (no PR ever opened) would
 * otherwise linger on origin and block every future fresh attempt. Pure
 * probe + decision only — the caller owns the refusal, the delete, and all
 * event logging.
 */

import { execFileSync } from 'node:child_process';
import { githubOwnerRepoForWorktree, ghForWorktree } from './gh-pinned.ts';

export type StaleRemoteBranchProbe = {
  /** SHA of `refs/heads/<branch>` on origin, or `null` (including "no
   *  reachable origin" — best-effort, never throws, never reads as "refuse"). */
  remoteSha: string | null;
  /** True iff an OPEN PR exists for `branch`. Always `false` for a non-GitHub
   *  remote, or when `remoteSha` is `null`. */
  openPrExists: boolean;
};

/** Both injectable so tests need neither `git` nor `gh`; production defaults below. */
export type RemoteBranchShaLookup = (projectRepoPath: string, branch: string) => string | null;
export type OpenPrLookup = (projectRepoPath: string, branch: string) => boolean;

const defaultRemoteBranchShaLookup: RemoteBranchShaLookup = (projectRepoPath, branch) => {
  try {
    const out = execFileSync(
      'git',
      ['-C', projectRepoPath, 'ls-remote', '--heads', 'origin', `refs/heads/${branch}`],
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim();
    return out ? out.split(/\s+/, 1)[0] || null : null;
  } catch {
    return null; // no origin, unreachable, or any other git failure
  }
};

/** Reuses the `gh-pinned.ts` seam every outward `gh` call in this package
 *  goes through. `null` owner (non-GitHub remote) means "no PR concept". */
const defaultOpenPrLookup: OpenPrLookup = (projectRepoPath, branch) => {
  try {
    const gh = githubOwnerRepoForWorktree(projectRepoPath);
    if (!gh) return false;
    const out = ghForWorktree(projectRepoPath)(
      ['pr', 'view', branch, '--json', 'state', '-q', '.state'],
      projectRepoPath,
    ).trim();
    return out.toUpperCase() === 'OPEN';
  } catch {
    return false; // no PR for this branch, or `gh` unavailable
  }
};

export function probeRemoteBranch(
  projectRepoPath: string,
  branch: string,
  deps: { remoteBranchSha?: RemoteBranchShaLookup; openPr?: OpenPrLookup } = {},
): StaleRemoteBranchProbe {
  const remoteSha = (deps.remoteBranchSha ?? defaultRemoteBranchShaLookup)(projectRepoPath, branch);
  const openPrExists = remoteSha === null ? false : (deps.openPr ?? defaultOpenPrLookup)(projectRepoPath, branch);
  return { remoteSha, openPrExists };
}

/**
 * Refuse a FRESH attempt iff the branch already lives on origin with no open
 * PR backing it (the open-PR exemption). Caller must only call this for a
 * fresh ('add') worktree strategy — a resume/reuse never reaches it.
 */
export function shouldRefuseFreshAttempt(probe: StaleRemoteBranchProbe): boolean {
  return probe.remoteSha !== null && !probe.openPrExists;
}
