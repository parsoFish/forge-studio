/**
 * W7-A3 (artifact-plan-03/05/09/21/27) — pinned contract for
 * `artifact-mode.ts`: `?mode=gate` is a REQUEST, not a fact. The gate renders
 * only when the run/session is actually awaiting that gate.
 *
 * Kills:
 *  - a completed run rendering a live "THIS RUN IS BLOCKED ON YOU" bar because
 *    the URL said mode=gate (artifact-plan-05);
 *  - an architect plan gate armed by the URL while the session is committed /
 *    rejected / drafting / missing (artifact-plan-03/21/27).
 */
import { test, expect } from 'vitest';

import { inferArtifactMode, resolveArtifactMode } from './artifact-mode.ts';
import type { Run } from './studio-client.ts';

function run(over: Partial<Run>): Run {
  return {
    id: 'c', flowId: 'forge-develop', initiativeId: 'INIT-2026-01-01-x', initiative: 'x', status: 'active', origin: 'architect',
    costUsd: 0, phases: {}, phaseMeta: {}, artifactsReady: {}, flowLineage: [], ...over,
  };
}

test('inferArtifactMode: artifactsReady gate/view drives plan/demo/pr; verdict gate = no verdict yet on a gated/active run', () => {
  expect(inferArtifactMode('plan', run({ status: 'gated', artifactsReady: { plan: 'gate' } }))).toBe('gate');
  expect(inferArtifactMode('plan', run({ status: 'complete', artifactsReady: { plan: 'view' } }))).toBe('view');
  expect(inferArtifactMode('workitems', run({ artifactsReady: { 'work-items': 'gate' } }))).toBe('gate');
  expect(inferArtifactMode('verdict', run({ status: 'gated' }))).toBe('gate');
  expect(inferArtifactMode('verdict', run({ status: 'complete', artifactsReady: { verdict: 'view' } }))).toBe('view');
  expect(inferArtifactMode('verdict', run({ status: 'complete' }))).toBe('view');
  expect(inferArtifactMode('plan', null)).toBe('view');
});

test('?mode=gate on a run that is NOT gated for that artifact → view (artifact-plan-05)', () => {
  const done = run({ status: 'complete', artifactsReady: { plan: 'view', demo: 'view', verdict: 'view' } });
  const opts = { architect: false, architectArmed: false };
  expect(resolveArtifactMode('gate', 'plan', done, opts)).toBe('view');
  expect(resolveArtifactMode('gate', 'demo', done, opts)).toBe('view');
  expect(resolveArtifactMode('gate', 'verdict', done, opts)).toBe('view');
  expect(resolveArtifactMode('gate', 'plan', null, opts)).toBe('view');
});

test('?mode=gate on a run that IS gated for that artifact → gate; ?mode=view always wins; absent → inferred', () => {
  const gated = run({ status: 'gated', artifactsReady: { demo: 'gate', pr: 'gate' } });
  const opts = { architect: false, architectArmed: false };
  expect(resolveArtifactMode('gate', 'demo', gated, opts)).toBe('gate');
  expect(resolveArtifactMode('gate', 'verdict', gated, opts)).toBe('gate');
  expect(resolveArtifactMode('view', 'demo', gated, opts)).toBe('view');
  expect(resolveArtifactMode(null, 'demo', gated, opts)).toBe('gate');
  expect(resolveArtifactMode('bogus', 'demo', gated, opts)).toBe('gate');
});

test('architect plan: the URL mode is ignored — gate iff the session awaits a verdict', () => {
  expect(resolveArtifactMode('gate', 'plan', null, { architect: true, architectArmed: false })).toBe('view');
  expect(resolveArtifactMode('view', 'plan', null, { architect: true, architectArmed: true })).toBe('gate');
  expect(resolveArtifactMode(null, 'plan', null, { architect: true, architectArmed: true })).toBe('gate');
  expect(resolveArtifactMode(null, 'plan', null, { architect: true, architectArmed: false })).toBe('view');
});
