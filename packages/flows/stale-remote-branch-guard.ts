/**
 * Stale `forge/<INIT>` remote-branch guard (bead forge-8vfn.8.1.8).
 *
 * scheduler-run-one.ts always dispatches onto `forge/<INIT>` — no attempt
 * suffix. If a PRIOR, abandoned attempt already pushed it with no PR ever
 * opened, the ref lingers forever and the NEXT fresh attempt spends a work
 * item before its own push fails non-fast-forward.
 *
 * Two halves, both keyed on `probeRemoteBranch` so they can never disagree
 * about "stale": `shouldRefuseFreshAttempt` runs BEFORE any spend, ONLY on a
 * genuinely fresh attempt (worktree strategy 'add' — a resume/send-back/
 * hand-off owns its branch and never reaches this module);
 * `cleanupPushedBranchOnFailure` deletes a branch THIS attempt's own push
 * landed, iff it was absent before this attempt and the cycle still failed —
 * never a branch merely found, never one backing an open PR.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { githubOwnerRepoForWorktree, ghForWorktree } from './gh-pinned.ts';

// Probe: does `branch` exist on origin, and is there an open PR for it?

export type StaleRemoteBranchProbe = {
  /** SHA of `refs/heads/<branch>` on origin, or `null` — including "no
   *  reachable origin" (best-effort; never throws, never reads as "refuse"). */
  remoteSha: string | null;
  /** True iff an OPEN PR exists for `branch`. Always `false` when the remote
   *  isn't GitHub, or when `remoteSha` is `null`. */
  openPrExists: boolean;
};

/** Injectable so a caller need not shell out `git` (production default does). */
export type RemoteBranchShaLookup = (projectRepoPath: string, branch: string) => string | null;
/** Injectable so tests need no `gh` — see this module's docstring. */
export type OpenPrLookup = (projectRepoPath: string, branch: string) => boolean;

const defaultRemoteBranchShaLookup: RemoteBranchShaLookup = (projectRepoPath, branch) => {
  try {
    const out = execFileSync(
      'git',
      ['-C', projectRepoPath, 'ls-remote', '--heads', 'origin', `refs/heads/${branch}`],
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim();
    if (!out) return null; // origin reachable, branch genuinely absent
    return out.split(/\s+/, 1)[0] || null;
  } catch {
    return null; // no origin, unreachable, or any other git failure
  }
};

/** Reuses the `gh-pinned.ts` seam every other outward `gh` call in this
 *  package goes through. `null` owner (non-GitHub remote) means "no PR
 *  concept", not "cannot verify, so block". */
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

export type StaleRemoteBranchDeps = {
  remoteBranchSha?: RemoteBranchShaLookup;
  openPr?: OpenPrLookup;
};

export function probeRemoteBranch(
  projectRepoPath: string,
  branch: string,
  deps: StaleRemoteBranchDeps = {},
): StaleRemoteBranchProbe {
  const remoteSha = (deps.remoteBranchSha ?? defaultRemoteBranchShaLookup)(projectRepoPath, branch);
  const openPrExists = remoteSha === null ? false : (deps.openPr ?? defaultOpenPrLookup)(projectRepoPath, branch);
  return { remoteSha, openPrExists };
}

/**
 * Half a: refuse a FRESH attempt iff the branch already lives on origin with
 * no open PR backing it. The caller must only call this when the worktree
 * strategy is 'add' — a resume/reuse never reaches this function.
 */
export function shouldRefuseFreshAttempt(probe: StaleRemoteBranchProbe): boolean {
  return probe.remoteSha !== null && !probe.openPrExists;
}

// Event log — direct JSONL append (mirrors scheduler-run-one.ts's own
// `emitClaimRefusedEvent`: the cycle logger isn't open yet at either call site).
function appendGuardEvent(
  forgeRoot: string,
  initiativeId: string,
  eventType: 'error' | 'log',
  message: string,
  metadata: Record<string, unknown>,
): void {
  try {
    const logDir = resolve(forgeRoot, '_logs', initiativeId);
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const entry = {
      event_id: `stale-remote-branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      cycle_id: initiativeId,
      initiative_id: initiativeId,
      started_at: new Date().toISOString(),
      phase: 'orchestrator',
      skill: 'scheduler',
      event_type: eventType,
      input_refs: [] as string[],
      output_refs: [] as string[],
      message,
      metadata,
    };
    appendFileSync(join(logDir, 'events.jsonl'), JSON.stringify(entry) + '\n');
  } catch {
    /* best-effort — never throw from a hygiene/refusal path */
  }
}

/** Named event for the refusal (half a): names the branch and its sha. */
export function emitStaleRemoteBranchRefused(
  forgeRoot: string,
  initiativeId: string,
  branch: string,
  sha: string,
): void {
  appendGuardEvent(forgeRoot, initiativeId, 'error', 'stale-remote-branch.refused', { branch, sha });
}

// Cleanup (half b): delete a branch THIS ATTEMPT pushed, on failure.

export type CleanupPushedBranchOptions = {
  projectRepoPath: string;
  branch: string;
  initiativeId: string;
  forgeRoot: string;
  /** Optional console tee, matching runOne's own `[serve] ...` progress lines. */
  onCleaned?: (detail: string) => void;
  deps?: StaleRemoteBranchDeps;
};

/**
 * Best-effort: delete `branch` from origin iff it now exists there AND no PR
 * is open for it. The caller must only invoke this when it has already
 * proven — via a `probeRemoteBranch` call taken BEFORE this attempt did
 * anything — that the branch was ABSENT before this attempt started; this
 * function alone cannot tell that apart from a resume/send-back's own branch.
 * Never throws, and never changes the cycle's already-decided outcome.
 */
export function cleanupPushedBranchOnFailure(opts: CleanupPushedBranchOptions): void {
  try {
    const probe = probeRemoteBranch(opts.projectRepoPath, opts.branch, opts.deps);
    if (probe.remoteSha === null) return; // this attempt never actually landed a push
    if (probe.openPrExists) return; // never delete a branch backing an open PR
    execFileSync('git', ['-C', opts.projectRepoPath, 'push', 'origin', '--delete', opts.branch], {
      stdio: 'pipe',
    });
    appendGuardEvent(opts.forgeRoot, opts.initiativeId, 'log', 'stale-remote-branch.cleaned-up', {
      branch: opts.branch,
      sha: probe.remoteSha,
    });
    opts.onCleaned?.(`deleted remote branch ${opts.branch} (pushed by this failed attempt, no open PR)`);
  } catch {
    /* best-effort — cleanup must never change the failure outcome */
  }
}
