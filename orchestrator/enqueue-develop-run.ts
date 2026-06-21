/**
 * S7 / DEC-3 — the "start development" trigger.
 *
 * The architect flow (forge-architect) decomposes an initiative into work items;
 * the operator then presses "start development" on the roadmap. This module is
 * the real, claimable enqueue behind that button (it replaces the dead
 * `defaultEnqueueFlowRun` marker the flow-runner shipped as an M3 placeholder):
 * it repoints the initiative's manifest at the `forge-develop` flow and drops it
 * into `_queue/pending/` so the scheduler claims it and runs dev → unifier →
 * review.
 *
 * DEC-2 lineage: the develop run threads the SAME `cycle_id` the architect flow
 * minted (or mints one if absent), so cost / roadmap / metrics — and the WI
 * hexes pm already emitted — roll up under ONE `_logs/<cycleId>` dir. No sibling
 * cycle is born.
 *
 * S8 seam: the architect→develop worktree hand-off (a develop run resuming the
 * worktree pm wrote its work items into) lands with the forge-cycle monolith
 * retirement (S8). This module owns only the queue-state transition.
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

export const DEVELOP_FLOW_ID = 'forge-develop';

/** Matches the manifest id convention (INIT-YYYY-MM-DD-slug); also a path-traversal guard. */
const INIT_ID_RE = /^INIT-\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type EnqueueDevelopStatus = 'enqueued' | 'not-found' | 'already-developing';

export type EnqueueDevelopResult = {
  status: EnqueueDevelopStatus;
  initiativeId: string;
  /** Present on `enqueued` — the threaded cycle id (architect-minted or fresh). */
  cycleId?: string;
  /** Present on `enqueued` — always `forge-develop`. */
  flowId?: string;
  detail?: string;
};

/**
 * Locate an initiative's manifest across the queue and, when it is in a
 * develop-able state, repoint it at the forge-develop flow + make it claimable.
 *
 * - `pending` / `done` / `failed` → repoint + move to `pending` (`enqueued`).
 * - `in-flight` / `ready-for-review` → a cycle is already running or parked for
 *   review; do NOT enqueue a sibling (`already-developing`).
 * - absent / malformed id → `not-found`.
 *
 * Never throws — a malformed id resolves to `not-found` (defence in depth; the
 * bridge validates too).
 */
export function enqueueDevelopRun(
  initiativeId: string,
  opts: { queueRoot?: string } = {},
): EnqueueDevelopResult {
  if (!INIT_ID_RE.test(initiativeId)) {
    return { status: 'not-found', initiativeId, detail: 'initiativeId is not a valid INIT-YYYY-MM-DD-slug' };
  }

  const paths = getPaths(opts.queueRoot ?? '_queue');
  const file = `${initiativeId}.md`;

  // An in-flight cycle is actively running — never disturb it.
  if (existsSync(join(paths.inFlight, file))) {
    return { status: 'already-developing', initiativeId, detail: 'a cycle is already in-flight' };
  }
  // A develop cycle parked in ready-for-review is awaiting the review gate (or the
  // ADR-026 drain owns it) — don't enqueue a sibling. But a NON-develop manifest
  // in ready-for-review is the forge-architect hand-off state (architect+pm just
  // finalised there with no review node): that IS develop-able, so fall through.
  const reviewParkedPath = join(paths.readyForReview, file);
  if (existsSync(reviewParkedPath) && manifestFlowId(reviewParkedPath) === DEVELOP_FLOW_ID) {
    return { status: 'already-developing', initiativeId, detail: 'a develop cycle is awaiting review' };
  }

  // Claim it from whichever develop-able state it sits in (pending, the architect
  // hand-off in ready-for-review, or a finished/failed run being re-developed).
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

  // Repoint at forge-develop + reset to a fresh, claimable build. resume_from is
  // cleared so the scheduler runs the full dev→unifier→review spine, not a drain.
  const repointed: InitiativeManifest = {
    ...manifest,
    flow_id: DEVELOP_FLOW_ID,
    phase: 'pending',
  };
  delete repointed.resume_from;
  delete repointed.claimed_at;
  delete repointed.claimed_by;

  const pendingPath = join(paths.pending, file);
  mkdirSync(paths.pending, { recursive: true });
  writeFileSync(pendingPath, serializeManifest(repointed));
  // Remove the source manifest if it was claimed from a different state dir.
  if (sourcePath !== pendingPath) {
    try { rmSync(sourcePath, { force: true }); } catch { /* best-effort — the pending copy is authoritative */ }
  }

  // DEC-2: thread the existing cycle_id, or mint one now. Idempotent — never
  // re-stamps an architect-minted id.
  mintAndPersistManifestCycleId(pendingPath, initiativeId);
  const cycleId = readManifestCycleId(pendingPath) ?? undefined;

  return { status: 'enqueued', initiativeId, cycleId, flowId: DEVELOP_FLOW_ID };
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
