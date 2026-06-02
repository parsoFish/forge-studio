/**
 * `forge requeue <init>` — operator-side recovery for stuck cycles.
 *
 * Re-runs the manual file dance the operator used to do by hand after a
 * cycle ended in `failed` or `ready-for-review-but-no-PR`:
 *
 *   1. Locate the manifest in any queue dir.
 *   2. Move it back to `_queue/pending/`.
 *   3. Reset `retry_count` (optional via --reset-retries) + record the
 *      prior failure mode in `previous_failure_modes` for forensic trail.
 *   4. Delete stranded verdict files (`<init>.verdict-prompt.md` /
 *      `<init>.verdict-response.md`) in any queue dir.
 *   5. Remove the worktree if present (`git worktree remove --force` plus
 *      `rm -rf` fallback) so the next claim gets a fresh canvas.
 *
 * Each step is idempotent; running on an already-cleaned manifest is safe.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getPaths } from '../orchestrator/queue.ts';
import { resolveInitiativeId } from '../orchestrator/initiative-id.ts';
import { parseManifest, serializeManifest } from '../orchestrator/manifest.ts';

export type RequeueOptions = {
  /** Forge root (parent of _queue/). Defaults to cwd. */
  forgeRoot?: string;
  /** Reset retry_count to 0 (default false: keep prior count + append to previous_failure_modes). */
  resetRetries?: boolean;
  /**
   * ADR 019: resume the next cycle from the unifier sub-phase instead of a
   * full re-run. Sets `resume_from: unifier` on the manifest AND preserves the
   * worktree (the per-WI commits live there) — so step 5's worktree removal is
   * skipped. Use after a unifier-only gate failure to salvage the WI work.
   */
  resumeFromUnifier?: boolean;
};

export type RequeueResult = {
  initiativeId: string;
  fromQueueDir: string;
  toQueueDir: string;
  worktreeRemoved: boolean;
  /** True if the stale initiative branch was deleted (non-resume only) so the
   *  re-run branches fresh from current main. */
  branchDeleted: boolean;
  verdictsRemoved: string[];
  retryCountBefore: number;
  retryCountAfter: number;
  previousFailureModesAfter: string[];
};

/**
 * Synchronous (the operator wants a clear pass/fail). Throws if the
 * initiative can't be resolved or the manifest isn't where it should be.
 */
export function runRequeue(
  initInput: string,
  opts: RequeueOptions = {},
): RequeueResult {
  const forgeRoot = opts.forgeRoot ?? process.cwd();
  const queuePaths = getPaths(join(forgeRoot, '_queue'));

  const resolved = resolveInitiativeId(initInput, { queueRoot: queuePaths.root });
  if (resolved.kind !== 'ok') {
    throw new Error(`forge requeue: no initiative resolves "${initInput}" (${resolved.kind}). Check the queue with \`forge status\`.`);
  }
  const initiativeId = resolved.canonical;
  const filename = `${initiativeId}.md`;

  // 1. Locate manifest in any queue dir.
  const candidates: Array<{ dir: string; label: string }> = [
    { dir: queuePaths.pending, label: 'pending' },
    { dir: queuePaths.inFlight, label: 'in-flight' },
    { dir: queuePaths.readyForReview, label: 'ready-for-review' },
    { dir: queuePaths.done, label: 'done' },
    { dir: queuePaths.failed, label: 'failed' },
  ];
  const fromCandidate = candidates.find((c) => existsSync(join(c.dir, filename)));
  if (!fromCandidate) {
    throw new Error(`forge requeue: no manifest ${filename} found in any _queue/ dir.`);
  }
  const fromPath = join(fromCandidate.dir, filename);
  const fromQueueDir = fromCandidate.label;

  // 2. Read + annotate manifest. previous_failure_modes append; retry_count
  //    bumps or resets per --reset-retries.
  const raw = readFileSync(fromPath, 'utf8');
  const manifest = parseManifest(raw);
  const retryCountBefore = manifest.retry_count ?? 0;
  const previousModes = manifest.previous_failure_modes ?? [];

  // Stamp the current state into the failure-mode history (one entry per
  // requeue so we can see the trail).
  const newMode = `requeued-from-${fromQueueDir}-${new Date().toISOString().slice(0, 10)}`;
  const previousFailureModesAfter = [...previousModes, newMode];
  const retryCountAfter = opts.resetRetries ? 0 : retryCountBefore;

  const updated = {
    ...manifest,
    retry_count: retryCountAfter,
    previous_failure_modes: previousFailureModesAfter,
    // ADR 019: stamp the resume marker so the scheduler runs the cycle from
    // the unifier sub-phase against the preserved worktree.
    ...(opts.resumeFromUnifier ? { resume_from: 'unifier' as const } : {}),
  };

  // 3. Atomic move to pending/ via tmp+rename.
  const toPath = join(queuePaths.pending, filename);
  const tmpPath = toPath + '.tmp';
  writeFileSync(tmpPath, serializeManifest(updated));
  renameSync(tmpPath, toPath);
  rmSync(fromPath, { force: true });

  // 4. Remove stranded verdict files.
  const verdictsRemoved: string[] = [];
  for (const c of candidates) {
    for (const suffix of ['.verdict-prompt.md', '.verdict-response.md']) {
      const path = join(c.dir, `${initiativeId}${suffix}`);
      if (existsSync(path)) {
        try { rmSync(path, { force: true }); verdictsRemoved.push(path); } catch { /* */ }
      }
    }
  }

  // 5. Remove the worktree AND delete the initiative branch — UNLESS resuming
  //    from the unifier, where the preserved worktree + branch ARE the salvaged
  //    WI work the resume runs against (ADR 019). Deleting the branch on a
  //    normal re-run is load-bearing: otherwise the next `git worktree add`
  //    reuses the STALE branch (based on whatever main was at the original run)
  //    instead of branching fresh from CURRENT main — and if main has since
  //    advanced (another cycle merged, or an operator commit), the resumed
  //    branch diverges and the unifier's branches_in_sync gate hard-fails
  //    (`main != merge-base`). Fresh-from-main on every non-resume re-run.
  //    (2026-06-02: this exact divergence sank the ci-green re-run.)
  let worktreeRemoved = false;
  let branchDeleted = false;
  const worktreePath = (manifest.worktree_path as string | undefined) ?? join(forgeRoot, '_worktrees', initiativeId);
  const projectRepoPath = (manifest.project_repo_path as string | undefined) ?? '';
  if (!opts.resumeFromUnifier) {
    if (existsSync(worktreePath) && projectRepoPath && existsSync(projectRepoPath)) {
      try {
        execFileSync('git', ['-C', projectRepoPath, 'worktree', 'remove', '--force', worktreePath], { stdio: 'pipe' });
        worktreeRemoved = true;
      } catch { /* registry entry may be stale; fall through */ }
      try { execFileSync('git', ['-C', projectRepoPath, 'worktree', 'prune'], { stdio: 'pipe' }); } catch { /* */ }
    }
    if (existsSync(worktreePath)) {
      try { rmSync(worktreePath, { recursive: true, force: true }); worktreeRemoved = true; } catch { /* */ }
    }
    // Delete the stale initiative branch (local + remote) so the re-run's
    // worktree add recreates it fresh from current main. Best-effort: the
    // branch may not exist, or there may be no origin remote.
    if (projectRepoPath && existsSync(projectRepoPath)) {
      const branch = `forge/${initiativeId}`;
      try {
        execFileSync('git', ['-C', projectRepoPath, 'branch', '-D', branch], { stdio: 'pipe' });
        branchDeleted = true;
      } catch { /* no local branch — fine */ }
      try {
        execFileSync('git', ['-C', projectRepoPath, 'push', 'origin', '--delete', branch], { stdio: 'pipe' });
      } catch { /* no remote / no remote branch — fine */ }
    }
  }

  return {
    initiativeId,
    fromQueueDir,
    toQueueDir: 'pending',
    worktreeRemoved,
    branchDeleted,
    verdictsRemoved,
    retryCountBefore,
    retryCountAfter,
    previousFailureModesAfter,
  };
}
