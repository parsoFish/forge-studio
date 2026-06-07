/**
 * ADR 026 — drain a ready-for-review cycle's pending unifier work-items in place.
 *
 * A review send-back no longer requeues (which minted a sibling cycle); it
 * appends typed UWIs to the unifier's queue in the LIVE worktree
 * (`cli/ui-bridge.ts` → `appendReviewUnifierItems`). This module is the consumer:
 * a scheduler sweep (sibling of `finalize-merged`) that, for each
 * `ready-for-review/` manifest with PENDING UWIs and an UNMERGED PR, re-claims
 * the manifest threading the SAME `cycle_id` (mechanism B, the
 * `finalize-merged.ts:107-119` pattern) and re-runs the FULL post-unifier spine
 * via `runCycle({ resumeFrom: 'unifier' })` — delivery gate → CI gate →
 * openPrInline (updates the PR) → closure. One cycleId ⇒ one `_logs` dir ⇒ the
 * cost/status lineage + WI-hex list never blank, and no sibling cycle is born.
 *
 * Mutual exclusion: the atomic in-flight rename is the claim (drain and
 * `finalize-merged` can't both grab the same manifest); the drain also skips a
 * MERGED PR (finalize's domain) and a queue with any `failed` UWI (operator
 * territory — never auto-retry). The verdict-append lock is taken for the read
 * checks so a concurrent append doesn't race the pending read.
 */
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';

import { parseManifest } from './manifest.ts';
import { getPaths, moveTo, writeHeartbeat } from './queue.ts';
import { confirmPrMerged } from './pr.ts';
import { runCycle } from './cycle.ts';
import { latestCycleId } from './finalize-merged.ts';
import {
  pendingUnifierItems,
  hasFailedUnifierItem,
  readUnifierItems,
  UNIFIER_MAX_TOTAL_ITEMS,
} from './unifier-items.ts';
import type { CycleInput } from './cycle-context.ts';

/** Keep the claimed manifest's heartbeat fresh during a (possibly long) drain so
 *  a crashed daemon leaves a STALE heartbeat the recovery sweep can reclaim. */
const DRAIN_HEARTBEAT_MS = 30_000;

export type DrainStatus =
  | 'drained'
  | 'no-pending'
  | 'pr-merged'
  | 'no-worktree'
  | 'needs-operator'
  | 'cap-exceeded'
  | 'locked'
  | 'claimed-elsewhere'
  | 'error';
export type DrainResult = { initiativeId: string; status: DrainStatus; detail?: string };

export type DrainDeps = {
  /** Queue root. Defaults to the cwd-based queue (matches the scheduler). */
  queueRoot?: string;
  /** `<forge>/_logs`. Defaults to `<cwd>/_logs` (the cycle_id fallback). */
  logsRoot?: string;
  /** Merge probe. Defaults to `confirmPrMerged` (gh pr view state == MERGED). */
  confirmMerge?: (worktreePath: string) => boolean | Promise<boolean>;
  /**
   * Run the post-unifier spine for one re-claimed cycle. Returns the cycle's
   * terminal status. Injectable for tests; defaults to the real `runCycle`
   * with `resumeFrom: 'unifier'` threading the persisted `cycle_id`.
   */
  runDrainCycle?: (input: CycleInput) => Promise<{ status: string }>;
  notify?: (msg: string) => void;
};

async function defaultRunDrainCycle(input: CycleInput): Promise<{ status: string }> {
  const result = await runCycle(input);
  return { status: result.status };
}

export async function drainPendingUnifierItems(deps: DrainDeps = {}): Promise<DrainResult[]> {
  const paths = getPaths(deps.queueRoot);
  const logsRoot = deps.logsRoot ? resolve(deps.logsRoot) : resolve('_logs');
  const confirmMerge = deps.confirmMerge ?? confirmPrMerged;
  const runDrainCycle = deps.runDrainCycle ?? defaultRunDrainCycle;

  const out: DrainResult[] = [];
  if (!existsSync(paths.readyForReview)) return out;

  for (const file of readdirSync(paths.readyForReview)) {
    if (!file.endsWith('.md')) continue;
    const manifestPath = join(paths.readyForReview, file);
    let initiativeId = file.replace(/\.md$/, '');
    let release: (() => Promise<void>) | null = null;
    try {
      const m = parseManifest(readFileSync(manifestPath, 'utf8'));
      initiativeId = m.initiative_id || initiativeId;
      const worktreePath = m.worktree_path ?? '';
      const projectRepoPath = m.project_repo_path ?? '';
      if (!worktreePath || !existsSync(worktreePath)) {
        out.push({ initiativeId, status: 'no-worktree' });
        continue;
      }

      // A failed UWI is operator territory — never auto-retry (it would loop).
      if (hasFailedUnifierItem(worktreePath)) {
        out.push({ initiativeId, status: 'needs-operator' });
        continue;
      }

      // Lock the manifest for the read checks so a concurrent verdict append
      // doesn't race the pending read; release before the (long) cycle runs.
      try {
        release = await lockfile.lock(manifestPath, { retries: { retries: 5, minTimeout: 50 } });
      } catch {
        out.push({ initiativeId, status: 'locked' });
        continue;
      }

      const pending = pendingUnifierItems(worktreePath);
      if (pending.length === 0) {
        out.push({ initiativeId, status: 'no-pending' });
        continue;
      }

      // Merge-vs-drain: a MERGED PR is finalize-merged's domain, not ours.
      if (await confirmMerge(worktreePath)) {
        out.push({ initiativeId, status: 'pr-merged' });
        continue;
      }

      // Cap (defence in depth — the append enforces it too).
      const total = readUnifierItems(worktreePath).items.length;
      if (total > UNIFIER_MAX_TOTAL_ITEMS) {
        deps.notify?.(`${initiativeId} · unifier review-UWI cap reached (${total}/${UNIFIER_MAX_TOTAL_ITEMS}) — operator must take over`);
        out.push({ initiativeId, status: 'cap-exceeded' });
        continue;
      }

      // Atomic re-claim: ready-for-review → in-flight (the claim). Release the
      // verdict lock first; the rename is the cross-sweep mutual exclusion.
      if (release) { try { await release(); } catch { /* ignore */ } release = null; }
      const inFlightPath = join(paths.inFlight, file);
      try {
        renameSync(manifestPath, inFlightPath);
      } catch (renameErr) {
        // Another sweep (finalize) or handler claimed/removed it first — skip cleanly.
        out.push({ initiativeId, status: 'claimed-elsewhere', detail: renameErr instanceof Error ? renameErr.message : String(renameErr) });
        continue;
      }

      // Heartbeat the claimed manifest so a daemon crash mid-drain leaves a STALE
      // heartbeat the recovery sweep reclaims to pending — and resumes correctly
      // (the send-back stamped resume_from:'unifier' on the manifest). moveTo
      // (closure / the finally below) cleans the heartbeat.
      writeHeartbeat(file, paths);
      const heartbeat = setInterval(() => { try { writeHeartbeat(file, paths); } catch { /* best-effort */ } }, DRAIN_HEARTBEAT_MS);

      // ADR 026 mechanism B: reuse the SAME cycle_id so the drain appends to the
      // original `_logs` dir (prefer the persisted id, then the latest matching
      // dir, then the initiativeId — never silently fork a second dir). resumeFrom
      // 'unifier' skips PM + the per-WI dev-loop and runs only the pending UWIs +
      // the full post-unifier spine.
      const cycleId = m.cycle_id ?? latestCycleId(logsRoot, initiativeId) ?? initiativeId;
      const input: CycleInput = {
        initiativeId,
        manifestPath: inFlightPath,
        projectRepoPath,
        worktreePath,
        cycleId,
        resumeFrom: 'unifier',
      };
      try {
        const result = await runDrainCycle(input);
        deps.notify?.(`${initiativeId} · drained ${pending.length} unifier work-item(s) → ${result.status}`);
        out.push({ initiativeId, status: 'drained', detail: result.status });
      } finally {
        clearInterval(heartbeat);
        // Closure is the single terminal-move authority (in-flight → ready-for-
        // review / done). If the cycle threw/crashed before closure, the manifest
        // is stranded in in-flight — return it to ready-for-review so it's never
        // lost. Runs on BOTH the success-but-not-moved and the throw paths.
        if (existsSync(inFlightPath)) {
          try { moveTo(file, 'ready-for-review', paths); } catch { /* best-effort */ }
        }
      }
    } catch (err) {
      out.push({ initiativeId, status: 'error', detail: err instanceof Error ? err.message : String(err) });
    } finally {
      if (release) { try { await release(); } catch { /* ignore */ } }
    }
  }
  return out;
}
