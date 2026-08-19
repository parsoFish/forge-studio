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
 *  reflection; verdict is the gate while a gated/active run has no verdict. */
export function inferArtifactMode(type: ArtifactType, run: Run | null): 'gate' | 'view' {
  if (!run) return 'view';
  if (type === 'verdict') {
    const verdictReady = run.artifactsReady['verdict'];
    if (!verdictReady && (run.status === 'gated' || run.status === 'active')) return 'gate';
    return 'view';
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
  if (opts.architect) return opts.architectArmed ? 'gate' : 'view';
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
 */
export function isRunNotFound(input: { runFound: boolean; artifactPresent: boolean; reflectionPresent: boolean }): boolean {
  if (input.runFound) return false;
  return !input.artifactPresent && !input.reflectionPresent;
}
