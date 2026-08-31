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
 * Resume modes (ADR 019) PRESERVE the worktree + branch instead of wiping
 * them, so the resumed cycle runs against the salvaged per-WI work:
 *   - `--resume-from=demo` re-enters at the post-develop `demo` node (the
 *     successor develop flow's `resumable` re-entry point, R4-10-F6).
 *
 * N7 (plan 2.9): when no explicit resume flag is given, the requeue INFERS
 * the resume position from the prior failure classification + the preserved
 * worktree/branch state (`inferRequeueResume`): an environment-classified
 * failure (rate-limit death, gate timeout — G3/N9) whose branch still
 * carries committed WI work resumes from that state instead of wiping it —
 * all WIs complete ⇒ `resume_from: demo`; some incomplete ⇒ preserve the
 * worktree with no marker (the scheduler's preserved-work-items reuse path
 * re-runs the dev-loop in place). Everything else re-runs fresh from main.
 *
 * Each step is idempotent; running on an already-cleaned manifest is safe.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getPaths } from './queue.ts';
import { resolveInitiativeId } from './initiative-id.ts';
import { parseManifest, serializeManifest } from './manifest.ts';
import { inferRequeueResume, type RequeueResumeDecision } from './requeue-resume.ts';
import { assertManifestPathFields } from './manifest-path-guard.ts';

export type RequeueOptions = {
  /** Forge root (parent of _queue/). Defaults to cwd. */
  forgeRoot?: string;
  /**
   * R4-17 round-4 (pin 7): the projects root the CALLER already resolved.
   * Passed verbatim to `assertManifestPathFields` so a long-lived caller (the
   * bridge, holding `ctx.projectsRoot` from server start) is validated against
   * the root it is actually using rather than one this guard re-reads from
   * `forge.config.json` at call time. Omitted by the CLI path, which resolves
   * fresh per invocation and has no snapshot to diverge from.
   */
  projectsRoot?: string;
  /** Reset retry_count to 0 (default false: keep prior count + append to previous_failure_modes). */
  resetRetries?: boolean;
  /**
   * ADR 019 (successor develop flow, R4-10-F6): resume the next cycle at the
   * post-develop `demo` node instead of a full re-run. Sets `resume_from: demo`
   * on the manifest AND preserves the worktree (the per-WI commits live there) —
   * so step 5's worktree removal is skipped. Use after a post-develop-band
   * failure with all WIs complete, to salvage the WI work.
   */
  resumeFromDemo?: boolean;
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
  /**
   * N7: how the resume position was decided — the operator's explicit
   * `--resume-from=demo`, or the inference over the prior failure
   * classification + preserved worktree/branch state. Surfaced so the
   * bridge/CLI can show WHY the worktree was preserved or wiped.
   */
  resumeDecision: RequeueResumeDecision;
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

  // 1. Locate manifest in any queue dir. `merged` is included defensively
  //    (R4-11-F1): it's a transient pass-through promoted to `done/` in the
  //    same sweep as closure's confirmed-merge move, but a crash between that
  //    move and the promotion would otherwise strand the manifest somewhere
  //    requeue can't find it.
  const candidates: Array<{ dir: string; label: string }> = [
    { dir: queuePaths.pending, label: 'pending' },
    { dir: queuePaths.inFlight, label: 'in-flight' },
    { dir: queuePaths.readyForReview, label: 'ready-for-review' },
    { dir: queuePaths.merged, label: 'merged' },
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

  const worktreePath = (manifest.worktree_path as string | undefined) ?? join(forgeRoot, '_worktrees', initiativeId);
  const projectRepoPath = (manifest.project_repo_path as string | undefined) ?? '';

  // SEC-02 (forge-d1f): defence in depth AT the destructive call site itself.
  // writeManifest's ingest-time guard (orchestrator/manifest.ts) is the primary
  // choke point, but runRequeue re-serialises this manifest via
  // serializeManifest WITHOUT re-validating anything — a manifest that reached
  // disk through some OTHER path (a future ingest route that forgets to call
  // writeManifest, or direct corruption) would otherwise sail straight through
  // to the rmSync(recursive) below. Placement BEFORE inferRequeueResume matters:
  // that call threads cycleId/worktreePath/projectRepoPath straight into
  // orchestrator/requeue-resume.ts, which does
  // join(forgeRoot,'_logs',cycleId,'events.jsonl') reads and
  // `git -C projectRepoPath` — this one assertion covers every requeue-resume
  // read too, not just the rmSync path below. Throws (fails closed) rather
  // than proceeding to delete anything.
  assertManifestPathFields(
    {
      initiative_id: initiativeId,
      project: manifest.project,
      worktree_path: worktreePath,
      project_repo_path: projectRepoPath || undefined,
      cycle_id: manifest.cycle_id,
    },
    { forgeRoot, projectsRoot: opts.projectsRoot },
  );

  // ADR 019 + N7: decide the resume position. An explicit
  // `--resume-from=demo` is the operator's override; otherwise infer from
  // the prior failure classification + the preserved worktree/branch state
  // (environment failure with salvageable committed work resumes; everything
  // else re-runs fresh from main — the pre-N7 behaviour).
  const resumeDecision: RequeueResumeDecision = opts.resumeFromDemo
    ? { resume: true, resume_from: 'demo', reason: 'operator-requested --resume-from=demo' }
    : inferRequeueResume({
        forgeRoot,
        cycleId: manifest.cycle_id,
        initiativeId,
        worktreePath,
        projectRepoPath,
      });

  // A resume preserves the worktree + branch (the salvaged per-WI work the
  // resumed cycle runs against). Only a full (non-resume) requeue wipes them
  // for a fresh-from-main re-run.
  const preserveWorktree = resumeDecision.resume;

  const updated = {
    ...manifest,
    retry_count: retryCountAfter,
    previous_failure_modes: previousFailureModesAfter,
    // ADR 019: stamp the resume marker so the scheduler runs the cycle from the
    // preserved worktree — `demo` re-enters at the post-develop `demo` node
    // (successor develop flow, R4-10-F6). A fresh (non-resume) requeue CLEARS any
    // resume marker (e.g. one a send-back stamped, ADR 040) so the re-run is a true
    // full cycle. N7's in-place dev-loop resume deliberately stamps NOTHING: the
    // scheduler's preserved-work-items reuse path detects it from the worktree itself.
    resume_from:
      resumeDecision.resume && resumeDecision.resume_from === 'demo'
        ? ('demo' as const)
        : undefined,
  };

  // 3. Atomic move to pending/ via tmp+rename.
  const toPath = join(queuePaths.pending, filename);
  const tmpPath = toPath + '.tmp';
  writeFileSync(tmpPath, serializeManifest(updated));
  renameSync(tmpPath, toPath);
  rmSync(fromPath, { force: true });

  // 4. Remove stranded verdict files. ADR 026 retired the `<id>.pr-feedback.md`
  //    send-back thread (review feedback is now appended UWIs in the worktree),
  //    so always clear any legacy feedback file too — it is no longer read.
  const verdictsRemoved: string[] = [];
  const staleSuffixes = ['.verdict-prompt.md', '.verdict-response.md', '.pr-feedback.md'];
  for (const c of candidates) {
    for (const suffix of staleSuffixes) {
      const path = join(c.dir, `${initiativeId}${suffix}`);
      if (existsSync(path)) {
        try { rmSync(path, { force: true }); verdictsRemoved.push(path); } catch { /* */ }
      }
    }
  }

  // 5. Remove the worktree AND delete the initiative branch — UNLESS resuming
  //    (unifier OR developer), where the preserved worktree + branch ARE the
  //    salvaged WI work the resume runs against (ADR 019). Deleting the branch on a
  //    normal re-run is load-bearing: otherwise the next `git worktree add`
  //    reuses the STALE branch (based on whatever main was at the original run)
  //    instead of branching fresh from CURRENT main — and if main has since
  //    advanced (another cycle merged, or an operator commit), the resumed
  //    branch diverges and the unifier's branches_in_sync gate hard-fails
  //    (`main != merge-base`). Fresh-from-main on every non-resume re-run.
  //    (2026-06-02: this exact divergence sank the ci-green re-run.)
  let worktreeRemoved = false;
  let branchDeleted = false;
  if (!preserveWorktree) {
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
    resumeDecision,
  };
}
