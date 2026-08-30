/**
 * artifact-mode — the /artifact page's gate-vs-view resolution (W7-A3:
 * artifact-plan-03/05/09/21/27).
 *
 * `?mode=gate` is a REQUEST, not a fact. The gate renders only when the
 * run/session is actually awaiting that gate: a completed run can never present
 * a live "THIS RUN IS BLOCKED ON YOU" bar, and an architect plan is armed by
 * the session phase alone (never by the URL, never for a missing session).
 */
import type { Run } from './studio-client';

export type ArtifactType = 'plan' | 'workitems' | 'pr' | 'demo' | 'verdict' | 'reflection';

/** The pre-existing inference rule (was `resolveMode(null, …)` inline in
 *  app/artifact/page.tsx): artifactsReady drives plan/workitems/pr/demo/
 *  reflection; the verdict gate is armed by the QUEUE STATE alone.
 *
 *  W7-B7 (artifact-plan-11/-14): now that `artifactsReady['verdict']` is real
 *  (derived from the cycle's own artifacts/verdict.json), the old
 *  `!verdictReady && (gated || active)` rule broke ROUND 2 — a send-back
 *  writes verdict.json, so when the fix loop re-parks the run at
 *  ready-for-review the gate would read "already decided" and never arm
 *  again. A run whose queue state is `gated` (ready-for-review) awaits an
 *  operator verdict BY DEFINITION — prior-round verdicts notwithstanding —
 *  and a run in any other state does not (`active` no longer arms it either:
 *  agents are still working; nothing awaits the operator yet). */
export function inferArtifactMode(type: ArtifactType, run: Run | null): 'gate' | 'view' {
  if (!run) return 'view';
  if (type === 'verdict') {
    return run.status === 'gated' ? 'gate' : 'view';
  }
  const readyKey = type === 'workitems' ? 'work-items' : type;
  const ready = run.artifactsReady[readyKey as keyof Run['artifactsReady']];
  return ready === 'gate' ? 'gate' : 'view';
}

export function resolveArtifactMode(
  modeParam: string | null,
  type: ArtifactType,
  run: Run | null,
  opts: { architect: boolean; architectArmed: boolean },
): 'gate' | 'view' {
  // artifact-plan-43: an explicit `?mode=view` must win EVEN for an armed
  // architect plan — this used to be checked only AFTER the architect
  // short-circuit below, so the arming decision ignored the URL in both
  // directions (a `mode=view` link followed while the session was armed, or
  // that became armed via the live session poll while the tab sat open,
  // silently promoted to the full Approve/Send-back/Reject gate). `mode=gate`
  // is still never HONOURED for an unarmed session — the gate is armed by the
  // session phase alone, never forced open by the URL.
  if (opts.architect) {
    if (modeParam === 'view') return 'view';
    return opts.architectArmed ? 'gate' : 'view';
  }
  if (modeParam === 'view') return 'view';
  const inferred = inferArtifactMode(type, run);
  if (modeParam === 'gate') return inferred === 'gate' ? 'gate' : 'view';
  return inferred;
}

/**
 * W7-FIX-A3 — the artifact page's not-found rule. W7-A4 (crosscut-08 /
 * artifact-plan-08) rendered the shared NotFound whenever `/api/runs/<id>`
 * was unknown, which also fired for a run whose queue manifest is gone but
 * whose `_logs/<id>/` artifacts still exist (an orphan log dir — real roots
 * carry them; the journey's automated-reflection fixture is that shape).
 * Not-found is asserted ONLY when the run is unknown AND nothing exists on
 * disk for the id: `?run=nope` stays NotFound; an orphan log dir renders its
 * artifact (the page says the run has no queue record).
 *
 * ROUND-2 (finding 2): both inputs are PER-RUN facts. `runOnDisk` is the
 * bridge's own existence answer — the guarded existence of `_logs/<id>`,
 * carried on `GET /api/runs/<id>`'s 404 body — NOT "did this `?type=`'s
 * artifact resolve". The type-derived version made one id render two
 * contradictory pages: `fetchArtifactDoc('workitems', …)` returns `empty`
 * without touching disk whenever the run is null (it reads `run.workItems`),
 * so an orphan log dir rendered its plan and NotFound'd its work-items tab,
 * both linked from the same ArtifactTrail.
 */
export function isRunNotFound(input: { runFound: boolean; runOnDisk: boolean }): boolean {
  if (input.runFound) return false;
  return !input.runOnDisk;
}

/**
 * W8-A2 (artifact-plan-38 / artifact-plan-35) — WHY an artifact's empty state
 * is empty, decided ONCE and shared by the heading + body copy
 * (app/artifact/page.tsx's `EmptyState`). Never promise a future phase for a
 * run that cannot reach one:
 *
 *   - `'orphan'`         — no queue record for this run at all (the queue
 *     manifest is gone); nothing tracks phase progression for this id any
 *     more, so "will emit it when this run reaches that stage" is false
 *     regardless of what's actually on disk for THIS type.
 *   - `'terminal-failed'` — the run failed; it will not retry, so whichever
 *     phase would have produced this artifact never will now.
 *   - `'terminal-status'` — the run is otherwise terminal (complete) and
 *     simply never produced this artifact; nothing more will happen to it.
 *   - `'pending'`         — the run is still planned/active/gated — the
 *     existing "will emit it when this run reaches that stage" promise is
 *     still true.
 *
 * `isOrphan` takes priority: an orphan run has no `Run` object at all, so
 * `status` is always `null` for it — the two are never in conflict, but
 * `isOrphan` is checked first for clarity at the call site.
 */
export type ArtifactEmptyReason = 'orphan' | 'terminal-failed' | 'terminal-status' | 'pending';

export function deriveArtifactEmptyReason(status: Run['status'] | null, isOrphan: boolean): ArtifactEmptyReason {
  if (isOrphan) return 'orphan';
  if (status === 'failed') return 'terminal-failed';
  if (status === 'complete') return 'terminal-status';
  return 'pending';
}
