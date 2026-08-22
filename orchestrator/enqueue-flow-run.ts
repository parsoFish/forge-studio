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
import { join, resolve } from 'node:path';

import {
  parseManifest,
  serializeManifest,
  mintAndPersistManifestCycleId,
  readManifestCycleId,
  type InitiativeManifest,
} from './manifest.ts';
import { getPaths } from './queue.ts';
import { WORK_ITEM_FILE_PATTERN } from './work-item.ts';
// W7-FIX-A3 (round-2 finding 6): ONE predicate for the manifest id
// convention. This module, `POST /api/flows/:id/run`'s own pre-check and
// `enqueue-plan-run.ts` each carried a hand-copied regex for the same rule
// (already drifting: `\d{4}` here vs `[0-9]{4}` in cli/bridge-studio-runs.ts),
// so a future tightening in one would leave the others accepting ids the
// enqueue refuses — the exact fail-open the done/ guard must not have.
import { isCanonicalInitiativeId } from './initiative-id.ts';

export const DEVELOP_FLOW_ID = 'forge-develop';

/** Matches studio flow-id slugs; a path-traversal guard on the flow ref. */
const FLOW_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type EnqueueFlowRunStatus =
  | 'enqueued'
  | 'not-found'
  | 'already-running'
  | 'already-done'
  | 'not-planned'
  /**
   * W8-A3 (`flows-37` / `forge-chm`, S1): the manifest is queued under a
   * DIFFERENT flow and the caller did not confirm the repoint. Refused before
   * anything is written — the queued manifest is left byte-identical.
   */
  | 'repoint-requires-confirm'
  | 'error';

export type EnqueueFlowRunResult = {
  status: EnqueueFlowRunStatus;
  initiativeId: string;
  /** Present on `enqueued` — the threaded cycle id (source-minted or fresh). */
  cycleId?: string;
  /** Present on `enqueued` — the target flow. */
  flowId?: string;
  /**
   * Present on `repoint-requires-confirm` — the flow the initiative is queued
   * under TODAY, so the caller can name it instead of asking the operator to
   * confirm something the UI never disclosed (the whole of `flows-37`).
   */
  currentFlowId?: string;
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
 * - a source manifest whose `flow_id` differs from the target, without
 *   `confirmRepoint` → `repoint-requires-confirm` (W8-A3 / `flows-37`).
 *   Nothing is written; the queued manifest is untouched.
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
  opts: {
    queueRoot?: string;
    allowFinishedSource?: boolean;
    /** The operator answered the repoint question for THIS request. */
    confirmRepoint?: boolean;
    /**
     * Source flows this caller has standing authority to repoint FROM, because
     * the transition is the designed lifecycle and its surface states it.
     * Narrow on purpose: a blanket `confirmRepoint: true` default on a delegate
     * re-opens `flows-37` through that delegate's own route (adversarial review
     * round 1, S1-1 — `POST /api/develop/start` batches N initiative ids on one
     * click and the roadmap carries no flow id to disclose).
     */
    allowRepointFrom?: readonly string[];
  } = {},
): EnqueueFlowRunResult {
  if (!isCanonicalInitiativeId(initiativeId)) {
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

  // W7-FIX-A3 (round-2 finding 6): a SHIPPED manifest is not an operator run
  // source. `done/` stays a legitimate source for the trigger drain's
  // flow-complete chaining (`allowFinishedSource: true` — that's how a
  // finished develop run chains onto reflect), but every operator-initiated
  // enqueue (`POST /api/flows/:id/run`, `POST /api/develop/start`) must refuse
  // it rather than yank the merged manifest back out and re-run it. Keyed on
  // the resolved SOURCE, so a live `pending/` copy still wins over a stale
  // `done/` one.
  if (!opts.allowFinishedSource && sourcePath === join(paths.done, file)) {
    return {
      status: 'already-done',
      initiativeId,
      detail: `${initiativeId} is already shipped (queue: done) — a merged initiative is not re-run from the kickoff; plan a new initiative instead.`,
    };
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
  // operator-authored) have no decomposition precondition. The evidence sources
  // MUST match the roadmap UI's "planned" check (bridge-studio.ts
  // `readWorkItemsForInitiative`) — else the UI shows "start development" while
  // this boundary rejects it (an inconsistency the roadmap journey catches).
  if (flowId === DEVELOP_FLOW_ID && !hasDecompositionEvidence(manifest, opts.queueRoot ?? '_queue')) {
    return {
      status: 'not-planned',
      initiativeId,
      detail: 'no decomposition evidence (manifest specs, WI snapshot, or preserved work-items) — plan the initiative first',
    };
  }

  // W8-A3 (`flows-37` / `forge-chm`, S1 — data corruption). Repointing an
  // initiative that is queued under ANOTHER flow takes it away from that flow.
  // Every planned initiative on disk carries the flow that produced it
  // (`flow_id: forge-architect`), so the generic Start-Run picker's one click
  // silently stole real queued work. The rule lives HERE and not on a route:
  // the operator-facing `POST /api/flows/:id/run` and `POST /api/develop/start`
  // are two doors onto this one primitive, and W7-FIX-A3 (round-2 finding 6)
  // already learned what a route-local pre-check leaves open. The THIRD door,
  // `POST /api/initiatives/:id/plan`, is a structural clone that never reaches
  // this module — `enqueue-plan-run.ts` carries the same rule in its own terms
  // (review round 1, S2-2).
  //
  // A blanket refusal is NOT available: it would refuse every candidate the
  // picker can legitimately offer. The contract is an EXPLICIT confirmation
  // that DEFAULTS CLOSED. Two callers hold standing authority instead:
  //   · the trigger drain's flow-complete chaining, which repoints on every hop
  //     by design (`confirmRepoint: true`);
  //   · the architect→develop hand-off, and ONLY from `forge-architect`
  //     (`allowRepointFrom`). A blanket default on that delegate is what review
  //     round 1 found re-opening flows-37: `POST /api/develop/start` takes a
  //     BATCH of ids from a roadmap that carries no flow id to disclose, so an
  //     initiative queued under an authored flow was taken by one click on a
  //     button that never named it.
  //
  // Ordered AFTER the develop `not-planned` precondition (review round 1, S3-7):
  // asking the operator to confirm a move that the very next check refuses is a
  // question with no right answer. Cheap precondition first, authorisation second.
  const currentFlowId = manifest.flow_id;
  const preAuthorised = (opts.allowRepointFrom ?? []).includes(currentFlowId ?? '');
  if (!opts.confirmRepoint && !preAuthorised && currentFlowId && currentFlowId !== flowId) {
    return {
      status: 'repoint-requires-confirm',
      initiativeId,
      currentFlowId,
      detail:
        `${initiativeId} is currently queued under "${currentFlowId}" — running it on "${flowId}" ` +
        `moves it off that flow. Confirm the repoint to proceed.`,
    };
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

/**
 * True if the dir holds at least one `WI-*.md` spec (skips `_graph.md` etc).
 * `WORK_ITEM_FILE_PATTERN` is the exported SSOT (orchestrator/work-item.ts) —
 * this used to carry its own narrower `/^WI-\d+\.md$/`, which read a
 * split-only decomposition (`WI-4a.md`, `WI-4b.md`) as an EMPTY directory.
 */
function hasWorkItemFiles(dir: string): boolean {
  try {
    return readdirSync(dir).some((f) => WORK_ITEM_FILE_PATTERN.test(f));
  } catch {
    return false;
  }
}

/**
 * Decomposition evidence for the develop `not-planned` gate — the SAME sources
 * the roadmap UI reads to decide an initiative is "planned"
 * (`readWorkItemsForInitiative`): the manifest's `specs` back-ref (R4-05), the
 * `_logs/<cycleId>/work-items-snapshot/` (post-PM, reliable for done cycles),
 * and the preserved worktree WI dir (`.forge/work-items/` in the manifest's
 * worktree or the forge-managed `_worktrees/<initId>/`). `_logs` and
 * `_worktrees` are resolved as siblings of the queue root.
 */
function hasDecompositionEvidence(manifest: InitiativeManifest, queueRoot: string): boolean {
  if ((manifest.specs?.length ?? 0) > 0) return true;

  const queueParent = resolve(queueRoot, '..');
  const logsRoot = resolve(queueParent, '_logs');
  const cycleId = manifest.cycle_id;
  if (cycleId && hasWorkItemFiles(join(logsRoot, cycleId, 'work-items-snapshot'))) return true;

  if (
    manifest.worktree_path &&
    existsSync(manifest.worktree_path) &&
    hasWorkItemFiles(join(manifest.worktree_path, '.forge', 'work-items'))
  ) {
    return true;
  }
  if (hasWorkItemFiles(join(queueParent, '_worktrees', manifest.initiative_id, '.forge', 'work-items'))) {
    return true;
  }
  return false;
}

/** Best-effort read of a manifest's flow_id; null on any parse failure. */
function manifestFlowId(manifestPath: string): string | null {
  try {
    return parseManifest(readFileSync(manifestPath, 'utf8')).flow_id ?? null;
  } catch {
    return null;
  }
}
