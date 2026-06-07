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
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

import { parseManifest } from './manifest.ts';
import { getPaths, moveTo } from './queue.ts';
import { confirmPrMerged } from './pr.ts';
import { runCycle } from './cycle.ts';
import {
  pendingUnifierItems,
  hasFailedUnifierItem,
  readUnifierItems,
  UNIFIER_MAX_TOTAL_ITEMS,
} from './unifier-items.ts';
import type { CycleInput } from './cycle-context.ts';

export type DrainStatus =
  | 'drained'
  | 'no-pending'
  | 'pr-merged'
  | 'no-worktree'
  | 'needs-operator'
  | 'cap-exceeded'
  | 'locked'
  | 'error';
export type DrainResult = { initiativeId: string; status: DrainStatus; detail?: string };

export type DrainDeps = {
  /** Queue root. Defaults to the cwd-based queue (matches the scheduler). */
  queueRoot?: string;
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
      renameSync(manifestPath, inFlightPath);

      // ADR 026 mechanism B: reuse the SAME cycle_id (persisted at first claim)
      // so the drain appends to the original `_logs` dir; resumeFrom 'unifier'
      // skips PM + the per-WI dev-loop and runs only the pending UWIs + the
      // full post-unifier spine.
      const cycleId = m.cycle_id ?? initiativeId;
      const input: CycleInput = {
        initiativeId,
        manifestPath: inFlightPath,
        projectRepoPath,
        worktreePath,
        cycleId,
        resumeFrom: 'unifier',
      };
      const result = await runDrainCycle(input);

      // Closure is the single terminal-move authority (in-flight → ready-for-
      // review / done). If the cycle threw before closure, the manifest is
      // stranded in in-flight — return it to ready-for-review so it's never lost.
      if (existsSync(inFlightPath)) {
        try { moveTo(file, 'ready-for-review', paths); } catch { /* best-effort */ }
      }

      deps.notify?.(`${initiativeId} · drained ${pending.length} unifier work-item(s) → ${result.status}`);
      out.push({ initiativeId, status: 'drained', detail: result.status });
    } catch (err) {
      out.push({ initiativeId, status: 'error', detail: err instanceof Error ? err.message : String(err) });
    } finally {
      if (release) { try { await release(); } catch { /* ignore */ } }
    }
  }
  return out;
}
