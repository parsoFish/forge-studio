/**
 * Stale `forge/<INIT>` remote-branch probe (bead forge-8vfn.8.1.8).
 *
 * scheduler-run-one.ts always dispatches onto `forge/<INIT>` — no attempt
 * suffix, so a prior abandoned attempt's push (no PR ever opened) would
 * otherwise linger on origin and block every future fresh attempt. Pure
 * probe + decision only — the caller owns the refusal, the delete, and all
 * event logging.
 *
 * TRI-STATE, fail-closed (row 93 reopen, M7-COMMON §6.15): a guard's catch
 * never returns a safe-looking default. Earlier, ANY git/gh failure read as
 * "absent" / "no open PR" — indistinguishable from a confirmed fact, risking
 * both a skipped refusal AND a later delete of a branch this attempt never
 * pushed. Every lookup below answers PRESENT / ABSENT / UNKNOWN(reason); the
 * caller treats UNKNOWN as its own refusal, never as ABSENT.
 */

import { execFileSync } from 'node:child_process';
import { githubOwnerRepoForWorktree, ghForWorktree } from './gh-pinned.ts';

/** ABSENT only on an empty `git ls-remote --heads`; any exec failure is UNKNOWN. */
export type BranchLookupResult =
  | { status: 'present'; sha: string }
  | { status: 'absent' }
  | { status: 'unknown'; reason: string };

/** NONE only on a genuine, locally-determined non-GitHub remote or a real
 *  "no open PR" answer; a `gh` failure is UNKNOWN, never NONE. */
export type OpenPrLookupResult =
  | { status: 'open' }
  | { status: 'none' }
  | { status: 'unknown'; reason: string };

/** `unknown.lookup` names which lookup could not complete — the caller
 *  refuses rather than assumes. */
export type StaleRemoteBranchProbe =
  | { status: 'absent' }
  | { status: 'present'; sha: string; openPr: 'open' | 'none' }
  | { status: 'unknown'; lookup: 'remoteBranchSha' | 'openPr'; reason: string };

/** Both injectable so tests need neither `git` nor `gh`; production defaults below. */
export type RemoteBranchShaLookup = (projectRepoPath: string, branch: string) => BranchLookupResult;
export type OpenPrLookup = (projectRepoPath: string, branch: string) => OpenPrLookupResult;

const defaultRemoteBranchShaLookup: RemoteBranchShaLookup = (projectRepoPath, branch) => {
  let out: string;
  try {
    out = execFileSync(
      'git',
      ['-C', projectRepoPath, 'ls-remote', '--heads', 'origin', `refs/heads/${branch}`],
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim();
  } catch (err) {
    return { status: 'unknown', reason: err instanceof Error ? err.message : String(err) };
  }
  const sha = out ? out.split(/\s+/, 1)[0] : undefined;
  return sha ? { status: 'present', sha } : { status: 'absent' };
};

/** gh's own wording for "there is simply no PR" (bead forge-8vfn.8.1.12) —
 *  verbatim, case-insensitive: `gh pr view <branch>` exits 1 with stderr
 *  `no pull requests found for branch "<branch>"`. That is a DETERMINATE
 *  NONE, not an exec failure — every other failure (auth, network, rate
 *  limit, unknown) still falls through to UNKNOWN below. */
const NO_PR_FOUND_RE = /no pull requests found/i;

/** Reuses the `gh-pinned.ts` seam every outward `gh` call goes through.
 *  `githubOwnerRepoForWorktree` is a LOCAL, no-network read — the branch
 *  lookup above already proved origin reachable, so `null` here is a
 *  genuine "not a GitHub remote", never "we couldn't tell". Only the
 *  actual `gh` call below can fail as UNKNOWN — except gh's own "no pull
 *  requests found" shape, which is a real answer wearing a nonzero exit code. */
const defaultOpenPrLookup: OpenPrLookup = (projectRepoPath, branch) => {
  const gh = githubOwnerRepoForWorktree(projectRepoPath);
  if (!gh) return { status: 'none' };
  try {
    const out = ghForWorktree(projectRepoPath)(
      ['pr', 'view', branch, '--json', 'state', '-q', '.state'],
      projectRepoPath,
    ).trim();
    return { status: out.toUpperCase() === 'OPEN' ? 'open' : 'none' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (NO_PR_FOUND_RE.test(reason)) return { status: 'none' };
    return { status: 'unknown', reason };
  }
};

export function probeRemoteBranch(
  projectRepoPath: string,
  branch: string,
  deps: { remoteBranchSha?: RemoteBranchShaLookup; openPr?: OpenPrLookup } = {},
): StaleRemoteBranchProbe {
  const branchLookup = (deps.remoteBranchSha ?? defaultRemoteBranchShaLookup)(projectRepoPath, branch);
  if (branchLookup.status === 'unknown') {
    return { status: 'unknown', lookup: 'remoteBranchSha', reason: branchLookup.reason };
  }
  if (branchLookup.status === 'absent') return { status: 'absent' };
  const prLookup = (deps.openPr ?? defaultOpenPrLookup)(projectRepoPath, branch);
  if (prLookup.status === 'unknown') {
    return { status: 'unknown', lookup: 'openPr', reason: prLookup.reason };
  }
  return { status: 'present', sha: branchLookup.sha, openPr: prLookup.status };
}

/**
 * Refuse a FRESH ('add') attempt iff the branch already lives on origin with
 * no open PR (the open-PR exemption); a resume/reuse never reaches this.
 * `unknown` never refuses here — the caller checks that first and refuses via
 * the separate, retryable `stale-remote-branch.probe-failed` path.
 */
export function shouldRefuseFreshAttempt(
  probe: StaleRemoteBranchProbe,
): probe is { status: 'present'; sha: string; openPr: 'none' } {
  return probe.status === 'present' && probe.openPr === 'none';
}
