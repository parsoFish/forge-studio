/**
 * Scheduler background sweeps (bead forge-8vfn.15 size split — see design.md).
 * Every function is BEST-EFFORT: none may throw out of a `setInterval` tick.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPaths, recover, type QueuePaths } from './queue.ts';
import * as worktree from './worktree.ts';
import { finalizeMergedReadyForReview } from './finalize-merged.ts';
import { drainPendingFixWorkItems } from './drain-fix-loop.ts';
import type { PhaseWiring } from './phase-wiring.ts';
import { drainFlowRunRequests } from './flow-run-requests.ts';
import { syncCronTriggers } from './cron-triggers.ts';
import { parseManifest as parseFullManifest } from './manifest.ts';
import { notify, type NotifyConfig } from './notify.ts';

/**
 * F-W5-7 sweep: finalize ready-for-review cycles whose PR the operator has
 * merged — closure aligns local↔remote + deletes the branch + moves to done/,
 * and the reflector fires (reflection becomes available in the UI). Best-effort.
 */
export async function runFinalizeSweep(wiring: PhaseWiring): Promise<void> {
  try {
    for (const r of await finalizeMergedReadyForReview({ runReflector: wiring.runReflector })) {
      if (r.status === 'finalized') {
        console.log(`[serve] finalized ${r.initiativeId} — operator merged the PR → done + reflection`);
      } else if (r.status === 'error') {
        console.error(`[serve] finalize ${r.initiativeId} failed: ${r.detail}`);
      }
    }
  } catch {
    /* sweep is best-effort — never throw out of setInterval */
  }
}

/**
 * ADR 040 fix-loop drain sweep: re-enter any ready-for-review cycle that has
 * pending fix work-items (a review send-back compiled them onto the
 * initiative's own queue) in the SAME cycle — reusing the persisted cycle_id,
 * the worktree, and the open PR; the develop agent is the single fix executor.
 * Runs AFTER the finalize sweep so a freshly-merged PR is finalized first (the
 * drain skips merged PRs — a merge always wins). Best-effort — never throws
 * out of the timer.
 */
export async function runDrainSweep(wiring: PhaseWiring): Promise<void> {
  try {
    for (const r of await drainPendingFixWorkItems({ notify: (m) => console.log(`[serve] ${m}`), phaseWiring: wiring })) {
      if (r.status === 'drained') {
        console.log(`[serve] fix loop ${r.initiativeId} — fix work items run in the same cycle (${r.detail})`);
      } else if (r.status === 'error') {
        console.error(`[serve] fix-loop drain ${r.initiativeId} failed: ${r.detail}`);
      }
    }
  } catch {
    /* sweep is best-effort — never throw out of setInterval */
  }
}

/**
 * Stage C flow-trigger sweep: dispatch any flow-run requests staged by an
 * `on: complete` trigger (repoint the source initiative at the target flow +
 * make it claimable). Best-effort — never throws out of the timer. No seed flow
 * declares an `on: complete` trigger today, so this is usually a no-op.
 */
export function runFlowTriggerSweep(): void {
  try {
    const forgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    for (const r of drainFlowRunRequests({ forgeRoot, notify: (m) => console.log(`[serve] ${m}`) })) {
      if (r.status === 'dispatched') {
        console.log(`[serve] flow-trigger dispatched ${r.target?.kind}:${r.target?.ref}${r.sourceInitiativeId ? ` on ${r.sourceInitiativeId}` : ' (originated)'}`);
      } else if (r.status === 'error') {
        console.error(`[serve] flow-trigger ${r.target?.kind}:${r.target?.ref} failed: ${r.detail}`);
      }
    }
  } catch {
    /* sweep is best-effort — never throw out of the timer */
  }
}

/**
 * R2-04 (ADR-041): sync the scheduler's armed cron triggers against every
 * flow's declared `on: cron` set (stop what's no longer declared, arm what's
 * newly declared). Best-effort, mirroring the other sweeps — a broken flow or
 * an invalid schedule is reported inside `syncCronTriggers` via `notify` and
 * must never throw out of the startup path or the recover-timer tick. A fire
 * only ever stages a claimable flow-run request (never dispatches, never
 * spawns); `onFire` is the in-process nudge that re-runs the flow-trigger
 * drain sweep promptly instead of waiting for the next poll.
 */
export function runCronSync(): void {
  try {
    const forgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    syncCronTriggers({
      forgeRoot,
      notify: (m) => console.log(`[serve] ${m}`),
      onFire: () => runFlowTriggerSweep(),
    });
  } catch {
    /* sweep is best-effort — never throw out of setInterval or startup */
  }
}

export async function runRecoverySweep(
  cfg: { queueRoot: string; staleHeartbeatMs: number; notify: NotifyConfig },
): Promise<void> {
  try {
    const recoveries = recover({
      paths: getPaths(cfg.queueRoot),
      staleHeartbeatMs: cfg.staleHeartbeatMs,
      worktreeExists: worktree.exists,
    });
    for (const r of recoveries) {
      cleanupRecoveredWorktrees(r.recovered, getPaths(cfg.queueRoot));
      await notify(
        {
          type: 'recovered',
          title: `Recovered ${r.recovered.length} initiative(s)`,
          body: `Reason: ${r.reason}. Items: ${r.recovered.join(', ')}`,
        },
        cfg.notify,
      );
    }
  } catch {
    /* sweep is best-effort — never throw out of setInterval */
  }
}

/**
 * Best-effort cleanup of orphaned worktrees + scratch branches for a set of
 * filenames recovered to `pending/`. Reads each recovered manifest to extract
 * `worktree_path` (annotated at claim time) and `project_repo_path`, then
 * spawns `worktree.cleanup()` against the corresponding handle. Idempotent —
 * a worktree that no longer exists is fine. Shared by `runRecoverySweep`
 * above and scheduler.ts's own startup recovery sweep (which is NOT
 * try/catch-wrapped like the interval version — a startup failure should be
 * loud).
 */
export function cleanupRecoveredWorktrees(filenames: string[], paths: QueuePaths): void {
  for (const filename of filenames) {
    const recoveredPath = join(paths.pending, filename);
    if (!existsSync(recoveredPath)) continue;
    try {
      const m = parseManifestFile(recoveredPath);
      if (!m || !m.worktree_path) continue;
      worktree.cleanup({
        path: m.worktree_path,
        branch: `forge/${m.initiative_id}`,
        projectRepoPath: m.project_repo_path,
      });
    } catch {
      /* malformed manifest or git error — non-fatal */
    }
  }
}

/**
 * Manifest read for cleanup hot-path. Returns null if the frontmatter is
 * malformed or required fields are missing.
 */
function parseManifestFile(
  manifestPath: string,
): { initiative_id: string; project_repo_path: string; worktree_path?: string } | null {
  try {
    const m = parseFullManifest(readFileSync(manifestPath, 'utf8'));
    if (!m.initiative_id || !m.project_repo_path) return null;
    return {
      initiative_id: m.initiative_id,
      project_repo_path: m.project_repo_path,
      worktree_path: m.worktree_path,
    };
  } catch {
    return null;
  }
}
