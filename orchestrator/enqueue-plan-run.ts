/**
 * R4-05 / F4 — the standalone per-initiative "Plan" trigger.
 *
 * Mirrors `orchestrator/enqueue-develop-run.ts` structure-for-structure: this
 * module is the real, claimable enqueue behind the roadmap's per-initiative
 * "Plan" button. It repoints the initiative's manifest at the `forge-architect`
 * flow (the decompose flow — architect node is a design-time no-op marker,
 * `flow-runner.ts` proceeds straight to `execPm` -> `runProjectManager`) and
 * drops it into `_queue/pending/` so the scheduler claims it and decomposes.
 *
 * Both entry paths — this one-at-a-time trigger AND the batch
 * `promoteManifests` path an approved architect PLAN gate writes through —
 * converge on the exact same manifest shape (`flow_id: 'forge-architect'`,
 * `phase: 'pending'`) and therefore the exact same `execPm` -> `runProjectManager`
 * pipeline. See `enqueue-plan-run.test.ts` / `project-manager-shared-pipeline.test.ts`
 * for the equivalence proof. This module owns only the queue-state transition —
 * no new runner, no `runAgent`, no in-request spawn.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseManifest,
  serializeManifest,
  mintAndPersistManifestCycleId,
  readManifestCycleId,
  type InitiativeManifest,
} from './manifest.ts';
import { getPaths, type QueuePaths } from './queue.ts';
import { DEVELOP_FLOW_ID } from './enqueue-develop-run.ts';

/**
 * The decompose flow. Deliberately NOT imported from `architect-runner.ts` —
 * its `ARCHITECT_FLOW_ID` is a module-private const, and importing that module
 * just for a string constant would pull in the whole architect runner (SDK
 * query fn, interview schema, brain access) for a lightweight queue-transition
 * module. Same literal, same precedent as `architect-runner.ts`'s own comments
 * referencing `forge-develop` by name rather than importing `DEVELOP_FLOW_ID`.
 */
export const PLAN_FLOW_ID = 'forge-architect';

/** Matches the manifest id convention (INIT-YYYY-MM-DD-slug); also a path-traversal guard. */
const INIT_ID_RE = /^INIT-\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type EnqueuePlanStatus = 'enqueued' | 'not-found' | 'already-running' | 'error';

export type EnqueuePlanResult = {
  status: EnqueuePlanStatus;
  initiativeId: string;
  /** Present on `enqueued` — the threaded cycle id (existing or freshly minted). */
  cycleId?: string;
  /** Present on `enqueued` — always `forge-architect`. */
  flowId?: string;
  detail?: string;
};

/**
 * Locate an initiative's manifest across the queue and, when it is in a
 * plannable state, repoint it at the forge-architect flow + make it claimable.
 *
 * - `pending` / `done` / `failed` / a non-develop `ready-for-review` (the
 *   architect hand-off state) -> repoint + move to `pending` (`enqueued`).
 * - `in-flight` -> a cycle is already running; do NOT enqueue a sibling
 *   (`already-running`).
 * - a `forge-develop` manifest parked in `ready-for-review` -> that's a
 *   develop cycle awaiting the review gate; don't plan over it
 *   (`already-running`).
 * - absent / malformed id -> `not-found`.
 * - a filesystem failure while writing the repointed manifest -> `error`
 *   (with the underlying message in `detail`).
 *
 * No "already-planned / has-WIs" check by design — this is a pure state
 * transition (a later UI-side PR gates the trigger's visibility to WI-less
 * initiatives). A re-plan of a done/failed initiative re-decomposes, which is
 * intended (parallels re-develop).
 *
 * Never throws — a malformed id resolves to `not-found`, a write failure to
 * `error` (defence in depth; the bridge route validates too).
 */
export function enqueuePlanRun(
  initiativeId: string,
  opts: { queueRoot?: string } = {},
): EnqueuePlanResult {
  if (!INIT_ID_RE.test(initiativeId)) {
    return { status: 'not-found', initiativeId, detail: 'initiativeId is not a valid INIT-YYYY-MM-DD-slug' };
  }

  const paths = getPaths(opts.queueRoot ?? '_queue');
  const file = `${initiativeId}.md`;

  // An in-flight cycle is actively running — never disturb it.
  if (existsSync(join(paths.inFlight, file))) {
    return { status: 'already-running', initiativeId, detail: 'a cycle is already in-flight' };
  }
  // A develop cycle parked in ready-for-review is awaiting the review gate (or
  // the ADR-026 drain owns it) — don't plan over it. A NON-develop manifest in
  // ready-for-review is the forge-architect hand-off state: that's still
  // plannable (falls through), matching enqueueDevelopRun's inverse check.
  const reviewParkedPath = join(paths.readyForReview, file);
  if (existsSync(reviewParkedPath) && manifestFlowId(reviewParkedPath) === DEVELOP_FLOW_ID) {
    return { status: 'already-running', initiativeId, detail: 'a develop cycle is awaiting review' };
  }
  // R4-11-F1: `merged` is a transient pass-through (promoted to `done/` in the
  // same sweep) — a manifest sitting there is between a confirmed merge and its
  // reflection, never a plan *source*; don't race the finalize sweep.
  if (existsSync(join(paths.merged, file))) {
    return { status: 'already-running', initiativeId, detail: 'a merged cycle is finalizing (merged → done)' };
  }

  // Claim it from whichever plannable state it sits in (pending, the architect
  // hand-off in ready-for-review, or a finished/failed run being re-planned).
  // `merged` is deliberately excluded — never a plan source (see above).
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

  // Repoint at forge-architect + reset to a fresh, claimable build. resume_from
  // is cleared since a decompose pass is not a unifier-drain resume.
  const repointed: InitiativeManifest = {
    ...manifest,
    flow_id: PLAN_FLOW_ID,
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

    // Thread the existing cycle_id, or mint one now. Idempotent — never
    // re-stamps an already-minted id.
    mintAndPersistManifestCycleId(pendingPath, initiativeId);
  } catch (err) {
    // Honor the never-throws contract: a filesystem failure comes back as an
    // error-shaped result the caller can report per-item.
    return { status: 'error', initiativeId, detail: err instanceof Error ? err.message : String(err) };
  }
  const cycleId = readManifestCycleId(pendingPath) ?? undefined;

  return { status: 'enqueued', initiativeId, cycleId, flowId: PLAN_FLOW_ID };
}

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Best-effort read of a manifest's flow_id; null on any parse failure. */
function manifestFlowId(manifestPath: string): string | null {
  try {
    return parseManifest(readFileSync(manifestPath, 'utf8')).flow_id ?? null;
  } catch {
    return null;
  }
}

/** Re-exported for callers that need the queue layout (the bridge route). */
export type { QueuePaths };
