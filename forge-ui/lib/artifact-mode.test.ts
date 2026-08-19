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

// ---------------------------------------------------------------------------
// W7-FIX-A3 — the artifact page's not-found rule. W7-A4 (crosscut-08 /
// artifact-plan-08) made an unknown run render the shared NotFound instead
// of a fabricated "not yet produced" story. That rule fired for a run whose
// queue manifest is gone but whose `_logs/<id>/` artifacts still exist (the
// journey's automated-reflection fixture; 8 real 2026-05-30/31 betterado
// cycles in the live root) — the flows-run-reflect-automated beat regressed
// to NotFound. Not-found is asserted ONLY when the run is unknown AND nothing
// exists on disk for the id; `?run=nope` (no run, no artifact) stays NotFound.
// ---------------------------------------------------------------------------
import { isRunNotFound } from './artifact-mode.ts';

test('isRunNotFound: unknown run + nothing on disk → not found (crosscut-08 keeps its NotFound)', () => {
  expect(isRunNotFound({ runFound: false, runOnDisk: false })).toBe(true);
});

test('isRunNotFound: unknown run but SOMETHING exists on disk for the id → NOT not-found (orphan log dir renders its artifact)', () => {
  expect(isRunNotFound({ runFound: false, runOnDisk: true })).toBe(false);
});

test('isRunNotFound: a known run is never not-found, whatever is on disk', () => {
  expect(isRunNotFound({ runFound: true, runOnDisk: false })).toBe(false);
});

// W7-FIX-A3 (round-2 finding 2): the decision is a PER-RUN existence fact
// (`GET /api/runs/<id>`'s 404 `onDisk` — the guarded existence of
// `_logs/<id>`), never "did THIS artifact type resolve". The old inputs made
// the answer type-dependent: `fetchArtifactDoc('workitems', …)` returns
// `{type:'empty'}` without touching disk whenever `run` is null (it reads
// `run.workItems`), so the SAME orphan log dir rendered its plan and 404'd its
// work-items tab — two contradictory pages for one id, both linked from the
// same ArtifactTrail.
test('the orphan log dir renders EVERY type the same: workitems (always doc-empty for a null run) is not NotFound while plan renders', () => {
  const orphan = { runFound: false, runOnDisk: true };
  // plan resolved a doc, workitems could not — the verdict is identical.
  expect(isRunNotFound(orphan)).toBe(false);
  const decisions = (['plan', 'workitems', 'pr', 'demo', 'verdict', 'reflection'] as const).map(() => isRunNotFound(orphan));
  expect(new Set(decisions).size).toBe(1);
  expect(decisions.every((d) => d === false)).toBe(true);
});

test('?run=nope stays NotFound for every type (an unknown id with nothing on disk is a real negative)', () => {
  expect(isRunNotFound({ runFound: false, runOnDisk: false })).toBe(true);
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (round-2 finding 1) — the GATE is keyed on the INITIATIVE id.
// `POST /api/runs/<id>/gates/<gateId>` (both `plan` and `verdict`) validates
// its id against INIT_ID_RE (cli/bridge-studio-runs.ts:162 / :788), so a gate
// posted with a CYCLE id 400s. A3-03 re-keyed the run page's "artifacts →"
// link onto the run's own id (the cycle id once claimed), which put a cycle id
// in `?run=` — and GateBar was still passing that raw URL handle straight to
// `postGate`, so the demo gate's Approve/Send-back reached from that link
// could not be submitted at all. ReviewVerdictForm (the verdict gate's own
// form, same page) already resolves `run?.initiativeId ?? runId`; the gate bar
// must use the SAME handle. Source pin: there is no jsdom/@testing-library in
// this repo and `app/artifact/page.tsx` is a `useSearchParams` client page
// that `renderToStaticMarkup` cannot mount (the documented gap in
// ./flow-run-detail-render.test.ts), so the prop wiring is pinned on the
// page source — the same precedent as ./knowledge-page-tabs.test.ts.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARTIFACT_PAGE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'artifact', 'page.tsx');

/** The `<GateBar …/>` JSX element as written in the page source. */
function gateBarElement(): string {
  const src = readFileSync(ARTIFACT_PAGE_PATH, 'utf8');
  const start = src.indexOf('<GateBar');
  expect(start, '<GateBar> must be rendered by the artifact page').toBeGreaterThan(-1);
  const end = src.indexOf('/>', start);
  expect(end, '<GateBar> must be a self-closing element').toBeGreaterThan(start);
  return src.slice(start, end);
}

test('GateBar is keyed on the run\'s initiative id (never the raw ?run= handle, which is a cycle id since A3-03)', () => {
  const el = gateBarElement();
  expect(el).toMatch(/runId=\{gateInitiativeId\}/);
  expect(el, 'the raw URL handle must not reach postGate — it 400s at INIT_ID_RE').not.toMatch(/runId=\{runId\}/);
});

test('gateInitiativeId resolves exactly as ReviewVerdictForm does (run?.initiativeId ?? runId)', () => {
  const src = readFileSync(ARTIFACT_PAGE_PATH, 'utf8');
  expect(src).toMatch(/const gateInitiativeId = run\?\.initiativeId \?\? runId;/);
  // The verdict form's own prop is the pinned precedent this must match.
  expect(src).toMatch(/initiativeId=\{run\?\.initiativeId \?\? runId\}/);
});
