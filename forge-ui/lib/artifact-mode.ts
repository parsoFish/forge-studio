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
