/**
 * W7-A3 (artifact-plan-03/04/10/21/27/28/33, sessions-kinds-08/12,
 * artifact-plan-22/23) — pinned contract for `architect-plan-view.ts`: the
 * pure phase/linkage/claim derivations behind the architect PLAN surface on
 * /artifact and the session page's committed banner.
 *
 * Kills:
 *  - a plan gate armed by the URL (?mode=gate) instead of the session phase;
 *  - "the autonomous loop is building it now" asserted while the scheduler is
 *    stopped, or while the initiative merely sits in _queue/pending;
 *  - a committed banner that names no initiative / links to the flow
 *    DEFINITION instead of the run;
 *  - a missing session rendered as an armed gate instead of not-found.
 */
import { test, expect } from 'vitest';

import {
  deriveArchitectPlanPhase,
  architectGateArmed,
  architectPlanStatusCopy,
  architectSessionHref,
  architectPlanArtifactHref,
  isArchitectRunId,
  architectSessionIdFromRunId,
  deriveInitiativeLinkage,
  describePostCommit,
} from './architect-plan-view.ts';
import type { ArchitectSessionSummary } from './bridge-client.ts';
import type { Run } from './studio-client.ts';

function session(phase: ArchitectSessionSummary['phase'], extra: Partial<ArchitectSessionSummary> = {}): ArchitectSessionSummary {
  return {
    sessionId: '2026-08-18T13-27-13-8ee491f5',
    project: 'demo-project',
    projectRepoPath: '/x/demo-project',
    phase,
    round: 2,
    idea: 'add a --version flag',
    questions: null,
    planUrl: '/api/architect/file/demo-project/2026-08-18T13-27-13-8ee491f5/PLAN.html',
    completenessCritic: null,
    initiativeIds: ['INIT-2026-08-18-add-version-flag'],
    ...extra,
  };
}

function run(over: Partial<Run>): Run {
  return {
    id: 'RUN', flowId: 'forge-develop', initiativeId: 'INIT-2026-08-18-add-version-flag', initiative: 'x',
    status: 'planned', origin: 'architect', costUsd: 0, phases: {}, phaseMeta: {}, artifactsReady: {}, flowLineage: [],
    ...over,
  };
}

test('phase derivation: null → not-found; working phases collapse; the rest pass through', () => {
  expect(deriveArchitectPlanPhase(null)).toBe('not-found');
  for (const p of ['interviewing', 'exploring', 'drafting'] as const) expect(deriveArchitectPlanPhase(session(p))).toBe('working');
  for (const p of ['awaiting-answers', 'awaiting-verdict', 'finalizing', 'committed', 'rejected'] as const) {
    expect(deriveArchitectPlanPhase(session(p))).toBe(p);
  }
});

test('the gate is armed ONLY at awaiting-verdict — never from a URL, never for a missing session', () => {
  expect(architectGateArmed(session('awaiting-verdict'))).toBe(true);
  for (const p of ['interviewing', 'awaiting-answers', 'exploring', 'drafting', 'finalizing', 'committed', 'rejected'] as const) {
    expect(architectGateArmed(session(p))).toBe(false);
  }
  expect(architectGateArmed(null)).toBe(false);
});

test('per-phase status copy is honest (a rejected plan says rejected; committed says promoted, not "building")', () => {
  expect(architectPlanStatusCopy(session('awaiting-answers'))).toBe('The architect is waiting for your answers.');
  expect(architectPlanStatusCopy(session('interviewing'))).toBe('The architect is thinking… (round 2)');
  expect(architectPlanStatusCopy(session('exploring'))).toBe('The architect is exploring edge cases…');
  expect(architectPlanStatusCopy(session('drafting'))).toBe('The architect is drafting the plan…');
  expect(architectPlanStatusCopy(session('awaiting-verdict'))).toBe('Plan ready — review & approve.');
  expect(architectPlanStatusCopy(session('finalizing'))).toBe('Approved — the architect is finalizing and queueing the manifests…');
  expect(architectPlanStatusCopy(session('committed'))).toBe('Approved — manifests promoted to the queue.');
  expect(architectPlanStatusCopy(session('rejected'))).toBe('This plan was rejected — it stays readable below.');
  expect(architectPlanStatusCopy(session('committed'))).not.toMatch(/building it now/);
});

test('hrefs: session deep link carries the project; artifact href carries the mode; run-id helpers strip the prefix', () => {
  expect(architectSessionHref({ sessionId: 'a b', project: 'p/q' })).toBe('/sessions/architect/a%20b?project=p%2Fq');
  expect(architectPlanArtifactHref('s1', 'gate')).toBe('/artifact?run=_architect-s1&type=plan&mode=gate');
  expect(architectPlanArtifactHref('s1', 'view')).toBe('/artifact?run=_architect-s1&type=plan&mode=view');
  expect(isArchitectRunId('_architect-s1')).toBe(true);
  expect(isArchitectRunId('2026-07-11T17-26-34_INIT-x')).toBe(false);
  expect(architectSessionIdFromRunId('_architect-s1')).toBe('s1');
  expect(architectSessionIdFromRunId('cycle')).toBe('');
});

test('linkage: one row per initiative id, matched on run.initiativeId, run/monitor hrefs from the run\'s OWN flowId + id', () => {
  const runs = [run({ id: 'INIT-2026-08-18-add-version-flag', flowId: 'forge-architect', status: 'planned' })];
  const [row] = deriveInitiativeLinkage(['INIT-2026-08-18-add-version-flag'], runs);
  expect(row).toEqual({
    initiativeId: 'INIT-2026-08-18-add-version-flag',
    runId: 'INIT-2026-08-18-add-version-flag',
    flowId: 'forge-architect',
    runStatus: 'planned',
    queueState: 'queued',
    runHref: '/flows/forge-architect/run/INIT-2026-08-18-add-version-flag',
    monitorHref: '/flows/forge-architect',
  });
});

test('linkage: queue state maps from run status; no run → unknown with null hrefs (never a fabricated link)', () => {
  const cases: Array<[Run['status'], string]> = [['planned', 'queued'], ['active', 'building'], ['gated', 'gated'], ['complete', 'complete'], ['failed', 'failed']];
  for (const [status, expected] of cases) {
    expect(deriveInitiativeLinkage(['INIT-2026-08-18-add-version-flag'], [run({ status })])[0].queueState).toBe(expected);
  }
  const [missing] = deriveInitiativeLinkage(['INIT-2026-01-01-nope'], [run({})]);
  expect(missing.queueState).toBe('unknown');
  expect(missing.runHref).toBeNull();
  expect(missing.monitorHref).toBeNull();
  expect(missing.runId).toBeNull();
});

test('linkage: the run href is keyed on the INITIATIVE id (stable across the scheduler\'s claim), never the cycle id', () => {
  const claimed = run({ id: '2026-08-18T13-35-37_INIT-2026-08-18-add-version-flag', flowId: 'forge-develop', status: 'active' });
  const [row] = deriveInitiativeLinkage(['INIT-2026-08-18-add-version-flag'], [claimed]);
  expect(row.runId).toBe('2026-08-18T13-35-37_INIT-2026-08-18-add-version-flag');
  expect(row.runHref).toBe('/flows/forge-develop/run/INIT-2026-08-18-add-version-flag');
  expect(row.queueState).toBe('building');
});

test('linkage keeps input order and does not cross-attribute a neighbour\'s run', () => {
  const runs = [run({ id: 'B-run', initiativeId: 'INIT-2026-01-01-b', status: 'active' })];
  const rows = deriveInitiativeLinkage(['INIT-2026-01-01-a', 'INIT-2026-01-01-b'], runs);
  expect(rows.map((r) => r.initiativeId)).toEqual(['INIT-2026-01-01-a', 'INIT-2026-01-01-b']);
  expect(rows[0].queueState).toBe('unknown');
  expect(rows[1].queueState).toBe('building');
});

// ---- describePostCommit ---------------------------------------------------

const ID = 'INIT-2026-08-18-add-version-flag';
const link = (queueState: ReturnType<typeof deriveInitiativeLinkage>[number]['queueState']) =>
  ({ initiativeId: ID, runId: 'r', flowId: 'forge-develop', runStatus: null, queueState, runHref: '/flows/forge-develop/run/r', monitorHref: '/flows/forge-develop' });

test('"building it now" ONLY when a run is active AND the scheduler is running (sessions-kinds-08/12)', () => {
  const v = describePostCommit([link('building')], { running: true });
  expect(v.tone).toBe('building');
  expect(v.headline).toBe(`The autonomous loop is building ${ID} now.`);
  expect(v.needsSchedulerStart).toBe(false);
});

test('active run but scheduler stopped → claimed-stopped, honest, needs a start', () => {
  const v = describePostCommit([link('building')], { running: false });
  expect(v.tone).toBe('claimed-stopped');
  expect(v.headline).toBe(`${ID} is claimed but the scheduler is stopped — it will not progress until you start it.`);
  expect(v.needsSchedulerStart).toBe(true);
  expect(v.headline).not.toMatch(/building it now/);
});

test('queued: running scheduler → will pick it up; paused → resume it; stopped/unknown → start it (needsSchedulerStart)', () => {
  expect(describePostCommit([link('queued')], { running: true, paused: false })).toEqual({
    tone: 'queued-running', headline: `${ID} is queued — the scheduler will pick it up.`, needsSchedulerStart: false,
  });
  expect(describePostCommit([link('queued')], { running: true, paused: true })).toEqual({
    tone: 'queued-running', headline: `${ID} is queued — the scheduler is paused; resume it to start.`, needsSchedulerStart: false,
  });
  expect(describePostCommit([link('queued')], { running: false })).toEqual({
    tone: 'queued-stopped', headline: `${ID} is queued — the scheduler is stopped. Start it to build.`, needsSchedulerStart: true,
  });
});

// W7-FIX-A3 (A3-04): a null (unreadable) scheduler status is NOT "stopped" —
// the headline must not assert a state that was never read (the strip
// beneath renders "unknown" with no Start button, so "start it" would
// contradict its own controls). Distinct tones, still mounts the strip.
test('queued/claimed with an UNKNOWN scheduler (null) → "could not confirm" headlines, never "stopped"', () => {
  const queued = describePostCommit([link('queued')], null);
  expect(queued).toEqual({
    tone: 'queued-unknown',
    headline: `${ID} is queued — could not confirm the scheduler is running; check its status below.`,
    needsSchedulerStart: true,
  });
  const claimed = describePostCommit([link('building')], null);
  expect(claimed).toEqual({
    tone: 'claimed-unknown',
    headline: `${ID} is claimed — could not confirm the scheduler is running; check its status below.`,
    needsSchedulerStart: true,
  });
  for (const v of [queued, claimed]) expect(v.headline).not.toMatch(/stopped|building it now/);
});

test('gated wins over everything; failed / done / unknown are their own honest tones', () => {
  expect(describePostCommit([link('gated'), link('building')], { running: true }).tone).toBe('gated');
  expect(describePostCommit([link('gated')], { running: true }).headline).toBe(`${ID} is waiting on your verdict.`);
  expect(describePostCommit([link('failed')], { running: true })).toEqual({ tone: 'failed', headline: `${ID} failed — see the run for the failure note.`, needsSchedulerStart: false });
  expect(describePostCommit([link('complete')], { running: false })).toEqual({ tone: 'done', headline: `${ID} finished.`, needsSchedulerStart: false });
  expect(describePostCommit([], { running: true })).toEqual({ tone: 'unknown', headline: 'Approved — no queue entry found for this session yet.', needsSchedulerStart: false });
  expect(describePostCommit([link('unknown')], null).tone).toBe('unknown');
});

test('multiple initiatives → the headline names every matching id', () => {
  const rows = [{ ...link('queued'), initiativeId: 'INIT-2026-01-01-a' }, { ...link('queued'), initiativeId: 'INIT-2026-01-01-b' }];
  expect(describePostCommit(rows, { running: false }).headline).toBe('INIT-2026-01-01-a, INIT-2026-01-01-b is queued — the scheduler is stopped. Start it to build.');
});
