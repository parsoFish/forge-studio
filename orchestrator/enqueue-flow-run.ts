/**
 * R2-04-F1 (ADR-041) — the generic per-flow claimable enqueue.
 *
 * Generalizes the "start development" trigger (enqueue-develop-run.ts, now a
 * delegate) so ANY target flow can be enqueued from a trigger: locate the
 * initiative's manifest across the queue, guard the states a run must never
 * disturb, repoint the manifest at the target flow, and drop it into
 * `_queue/pending/` so the scheduler claims it. This is the dispatch half of
 * the produce→stage→drain→dispatch trigger pipeline — and the enqueue path
 * operator-authored flows use for `on: flow-complete` chaining.
 *
 * DEC-2 lineage: the run threads the SAME `cycle_id` the source flow minted
 * (or mints one if absent), so cost / roadmap / metrics roll up under ONE
 * `_logs/<cycleId>` dir. No sibling cycle is born.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseManifest,
  serializeManifest,
  mintAndPersistManifestCycleId,
  readManifestCycleId,
  type InitiativeManifest,
} from './manifest.ts';
import { getPaths } from './queue.ts';

export const DEVELOP_FLOW_ID = 'forge-develop';

/** Matches the manifest id convention (INIT-YYYY-MM-DD-slug); also a path-traversal guard. */
const INIT_ID_RE = /^INIT-\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Matches studio flow-id slugs; a path-traversal guard on the flow ref. */
const FLOW_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type EnqueueFlowRunStatus =
  | 'enqueued'
  | 'not-found'
  | 'already-running'
  | 'not-planned'
  | 'error';

export type EnqueueFlowRunResult = {
  status: EnqueueFlowRunStatus;
  initiativeId: string;
  /** Present on `enqueued` — the threaded cycle id (source-minted or fresh). */
  cycleId?: string;
  /** Present on `enqueued` — the target flow. */
  flowId?: string;
  detail?: string;
};

/**
 * Locate an initiative's manifest across the queue and, when it is in a
 * runnable state, repoint it at `flowId` + make it claimable.
 *
 * - `pending` / `done` / `failed` → repoint + move to `pending` (`enqueued`).
 * - `in-flight` / `merged` → a cycle is running or finalizing; never disturb
 *   (`already-running`).
 * - `ready-for-review` with the SAME flow_id as the target → that flow is
 *   parked awaiting its gate (or the fix-loop drain owns it) — don't enqueue a
 *   sibling (`already-running`). A DIFFERENT flow's manifest there is a
 *   hand-off state (e.g. forge-architect finalised with no review node) and IS
 *   runnable — fall through.
 * - forge-develop only: no decomposition evidence → `not-planned`
 *   (known-gaps §9 / ADR-040 rider — see enqueue-develop-run.ts).
 * - absent / malformed ids → `not-found`.
 * - a filesystem failure while writing → `error` (message in `detail`).
 *
 * Never throws — defence in depth; callers (the trigger drain, the bridge)
 * report per-item.
 */
export function enqueueFlowRun(
  initiativeId: string,
  flowId: string,
  opts: { queueRoot?: string } = {},
): EnqueueFlowRunResult {
  if (!INIT_ID_RE.test(initiativeId)) {
    return { status: 'not-found', initiativeId, detail: 'initiativeId is not a valid INIT-YYYY-MM-DD-slug' };
  }
  if (!FLOW_ID_RE.test(flowId)) {
    return { status: 'not-found', initiativeId, detail: `"${flowId}" is not a valid flow id slug` };
  }

  const paths = getPaths(opts.queueRoot ?? '_queue');
  const file = `${initiativeId}.md`;

  // An in-flight cycle is actively running — never disturb it.
  if (existsSync(join(paths.inFlight, file))) {
    return { status: 'already-running', initiativeId, detail: 'a cycle is already in-flight' };
  }
  // A cycle of the TARGET flow parked in ready-for-review is awaiting its gate
  // (or the ADR-040 fix-loop drain owns it) — don't enqueue a sibling. A
  // different flow's manifest there is a hand-off state: runnable, fall through.
  const reviewParkedPath = join(paths.readyForReview, file);
  if (existsSync(reviewParkedPath) && manifestFlowId(reviewParkedPath) === flowId) {
    return { status: 'already-running', initiativeId, detail: `a ${flowId} cycle is awaiting its gate` };
  }
  // R4-11-F1: `merged` is a transient pass-through (promoted to `done/` in the
  // same sweep) — never a run *source*; don't race the finalize sweep.
  if (existsSync(join(paths.merged, file))) {
    return { status: 'already-running', initiativeId, detail: 'a merged cycle is finalizing (merged → done)' };
  }

  // Claim it from whichever runnable state it sits in (pending, a hand-off in
  // ready-for-review, or a finished/failed run being re-run). `merged` is
  // deliberately excluded — never a run source (see above).
  const sourcePath = firstExisting(
    [paths.pending, paths.readyForReview, paths.done, paths.failed].map((d) => join(d, file)),
  );
  if (!sourcePath) {
    return { status: 'not-found', initiativeId };
  }

  let manifest: InitiativeManifest;
  try {
    manifest = parseManifest(readFileSync(sourcePath, 'utf8'));
  } catch (err) {
    return { status: 'not-found', initiativeId, detail: err instanceof Error ? err.message : String(err) };
  }

  // known-gaps §9 (defense-in-depth, closed with ADR 040) — DEVELOP-specific:
  // the dev-loop hard-fails on an empty WI dir, so dispatching an undecomposed
  // initiative at forge-develop wastes a cycle. Other flows (architect, reflect,
  // operator-authored) have no decomposition precondition.
  if (flowId === DEVELOP_FLOW_ID) {
    const hasSpecs = (manifest.specs?.length ?? 0) > 0;
    const hasWorktreeWis =
      !!manifest.worktree_path &&
      existsSync(manifest.worktree_path) &&
      hasWorkItemFiles(join(manifest.worktree_path, '.forge', 'work-items'));
    if (!hasSpecs && !hasWorktreeWis) {
      return {
        status: 'not-planned',
        initiativeId,
        detail: 'no decomposition evidence (manifest specs or preserved work-items) — plan the initiative first',
      };
    }
  }

  // Repoint at the target flow + reset to a fresh, claimable build. resume_from
  // is cleared so the scheduler runs the flow's full spine, not a drain re-entry.
  const repointed: InitiativeManifest = {
    ...manifest,
    flow_id: flowId,
    phase: 'pending',
  };
  delete repointed.resume_from;
  delete repointed.claimed_at;
  delete repointed.claimed_by;

  const pendingPath = join(paths.pending, file);
  try {
    mkdirSync(paths.pending, { recursive: true });
    writeFileSync(pendingPath, serializeManifest(repointed));
    // Remove the source manifest if it was claimed from a different state dir.
    if (sourcePath !== pendingPath) {
      try { rmSync(sourcePath, { force: true }); } catch { /* best-effort — the pending copy is authoritative */ }
    }

    // DEC-2: thread the existing cycle_id, or mint one now. Idempotent — never
    // re-stamps a source-minted id.
    mintAndPersistManifestCycleId(pendingPath, initiativeId);
  } catch (err) {
    return { status: 'error', initiativeId, detail: err instanceof Error ? err.message : String(err) };
  }
  const cycleId = readManifestCycleId(pendingPath) ?? undefined;

  return { status: 'enqueued', initiativeId, cycleId, flowId };
}

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** True if the dir holds at least one `WI-*.md` spec (skips `_graph.md` etc). */
function hasWorkItemFiles(dir: string): boolean {
  try {
    return readdirSync(dir).some((f) => /^WI-\d+\.md$/.test(f));
  } catch {
    return false;
  }
}

/** Best-effort read of a manifest's flow_id; null on any parse failure. */
function manifestFlowId(manifestPath: string): string | null {
  try {
    return parseManifest(readFileSync(manifestPath, 'utf8')).flow_id ?? null;
  } catch {
    return null;
  }
}
