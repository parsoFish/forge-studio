/**
 * W7-A3 (artifact-plan-03/04/10/21/27/28/33, sessions-kinds-08/12,
 * artifact-plan-22/23) — pinned contract for `architect-plan-view.ts`: the
 * pure phase/linkage/claim derivations behind the architect PLAN surface on
 * /artifact and the session page's committed banner.
 *
 * Kills:
 *  - a plan gate armed by the URL (?mode=gate) instead of the session phase;
 *  - "the autonomous loop is building it now" asserted while `forge serve`
 *    is not running, or while the initiative merely sits in _queue/pending;
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
} from '../../lib/architect-plan-view.ts';
import type { ArchitectSessionSummary, ServeStatus } from '../../lib/bridge-client.ts';
import type { Run } from '../../lib/studio-client.ts';

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
  // forge-8vfn.8.1.14 — critiquing/revising (ruling 380's critic + its
  // bounced-back revision round) collapse into 'working' exactly like
  // interviewing/exploring/drafting.
  for (const p of ['interviewing', 'exploring', 'drafting', 'critiquing', 'revising'] as const) expect(deriveArchitectPlanPhase(session(p))).toBe('working');
  for (const p of ['awaiting-answers', 'awaiting-verdict', 'finalizing', 'committed', 'rejected'] as const) {
    expect(deriveArchitectPlanPhase(session(p))).toBe(p);
  }
});

test('the gate is armed ONLY at awaiting-verdict — never from a URL, never for a missing session', () => {
  expect(architectGateArmed(session('awaiting-verdict'))).toBe(true);
  for (const p of ['interviewing', 'awaiting-answers', 'exploring', 'drafting', 'critiquing', 'revising', 'finalizing', 'committed', 'rejected'] as const) {
    expect(architectGateArmed(session(p))).toBe(false);
  }
  expect(architectGateArmed(null)).toBe(false);
});

test('per-phase status copy is honest (a rejected plan says rejected; committed says promoted, not "building")', () => {
  expect(architectPlanStatusCopy(session('awaiting-answers'))).toBe('The architect is waiting for your answers.');
  expect(architectPlanStatusCopy(session('interviewing'))).toBe('The architect is thinking… (round 2)');
  expect(architectPlanStatusCopy(session('exploring'))).toBe('The architect is exploring edge cases…');
  expect(architectPlanStatusCopy(session('drafting'))).toBe('The architect is drafting the plan…');
  // forge-8vfn.8.1.14 — the two phases that used to be invisible, reading
  // "drafting" the whole time (m7-d-proof-S1 evidence).
  expect(architectPlanStatusCopy(session('critiquing'))).toBe('The architect is checking the plan for gaps…');
  expect(architectPlanStatusCopy(session('revising'))).toBe('The architect is revising the plan…');
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
  // W8-B3 (sessions-kinds-08): the monitor link is derived against the LIVE
  // flows roster, so this row must be told the flow really exists.
  const [row] = deriveInitiativeLinkage(['INIT-2026-08-18-add-version-flag'], runs, ['forge-architect', 'forge-develop']);
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

const RUNNING: ServeStatus = { state: 'running', pid: 1, restarts: 0, nextRestartAt: null };
const DOWN: ServeStatus = { state: 'down', pid: null, restarts: 0, nextRestartAt: null };
const RESTARTING: ServeStatus = { state: 'restarting', pid: null, restarts: 1, nextRestartAt: '2026-01-01T00:00:01.000Z' };
const UNSUPERVISED: ServeStatus = { state: 'unsupervised', pid: null, restarts: 0, nextRestartAt: null };

test('"building it now" ONLY when a run is active AND forge serve is running (sessions-kinds-08/12)', () => {
  const v = describePostCommit([link('building')], RUNNING);
  expect(v.tone).toBe('building');
  expect(v.headline).toBe(`The autonomous loop is building ${ID} now.`);
  expect(v.serveNotReady).toBe(false);
});

test('active run but serve not running → claimed-not-running, honest, serve not ready', () => {
  const v = describePostCommit([link('building')], DOWN);
  expect(v.tone).toBe('claimed-not-running');
  expect(v.headline).toBe(`${ID} is claimed but forge serve is not currently running — it will resume once Studio brings it back.`);
  expect(v.serveNotReady).toBe(true);
  expect(v.headline).not.toMatch(/building it now/);
});

test('queued: serve running → will pick it up; not running (restarting/down) → not ready', () => {
  expect(describePostCommit([link('queued')], RUNNING)).toEqual({
    tone: 'queued-running', headline: `${ID} is queued — forge serve will pick it up.`, serveNotReady: false,
  });
  expect(describePostCommit([link('queued')], RESTARTING)).toEqual({
    tone: 'queued-not-running', headline: `${ID} is queued — forge serve is not currently running; it will resume once Studio brings it back.`, serveNotReady: true,
  });
  expect(describePostCommit([link('queued')], DOWN)).toEqual({
    tone: 'queued-not-running', headline: `${ID} is queued — forge serve is not currently running; it will resume once Studio brings it back.`, serveNotReady: true,
  });
});

// a null (unreadable) or `unsupervised` serve status is NOT "not running" —
// the headline must not assert a state that was never confirmed, so it gets
// its own, distinct "unknown" tone.
test('queued/claimed with an UNCONFIRMED serve status (null or unsupervised) → "could not confirm" headlines', () => {
  for (const status of [null, UNSUPERVISED]) {
    const queued = describePostCommit([link('queued')], status);
    expect(queued).toEqual({
      tone: 'queued-unknown',
      headline: `${ID} is queued — could not confirm forge serve is running.`,
      serveNotReady: true,
    });
    const claimed = describePostCommit([link('building')], status);
    expect(claimed).toEqual({
      tone: 'claimed-unknown',
      headline: `${ID} is claimed — could not confirm forge serve is running.`,
      serveNotReady: true,
    });
    for (const v of [queued, claimed]) expect(v.headline).not.toMatch(/not currently running|building it now/);
  }
});

test('gated wins over everything; failed / done / unknown are their own honest tones', () => {
  expect(describePostCommit([link('gated'), link('building')], RUNNING).tone).toBe('gated');
  expect(describePostCommit([link('gated')], RUNNING).headline).toBe(`${ID} is waiting on your verdict.`);
  expect(describePostCommit([link('failed')], RUNNING)).toEqual({ tone: 'failed', headline: `${ID} failed — see the run for the failure note.`, serveNotReady: false });
  expect(describePostCommit([link('complete')], DOWN)).toEqual({ tone: 'done', headline: `${ID} finished.`, serveNotReady: false });
  expect(describePostCommit([], RUNNING)).toEqual({ tone: 'unknown', headline: 'Approved — no queue entry found for this session yet.', serveNotReady: false });
  expect(describePostCommit([link('unknown')], null).tone).toBe('unknown');
});

test('multiple initiatives → the headline names every matching id', () => {
  const rows = [{ ...link('queued'), initiativeId: 'INIT-2026-01-01-a' }, { ...link('queued'), initiativeId: 'INIT-2026-01-01-b' }];
  expect(describePostCommit(rows, DOWN).headline).toBe('INIT-2026-01-01-a, INIT-2026-01-01-b is queued — forge serve is not currently running; it will resume once Studio brings it back.');
});


// ---------------------------------------------------------------------------
// W8-B3 (sessions-kinds-08) — the monitor link is derived against the LIVE
// flows roster, never minted from the run's flowId unconditionally.
//
// Live evidence: `GET /api/runs` returns 22 of 63 runs carrying the `"unknown"`
// sentinel the runs payload uses for pre-S8 manifests, and
// `ArchitectCommittedView` picks the first non-null monitorHref as its
// "Watch it build →" target. On 8 of 12 committed architect sessions the
// biggest, greenest control on the panel therefore navigated to
// `/flows/unknown` — a retired-flow not-found page.
// ---------------------------------------------------------------------------

test('sessions-kinds-08: a run whose flowId is not in the live roster gets NO monitor link — its own run page still resolves', () => {
  const runs = [run({ id: 'INIT-legacy', initiativeId: 'INIT-legacy', flowId: 'unknown', status: 'complete' })];
  const [row] = deriveInitiativeLinkage(['INIT-legacy'], runs, ['forge-develop', 'forge-architect']);
  expect(row.monitorHref).toBeNull();
  // Not a blanket suppression: the run page derives from the runs list and
  // works without a flow definition (W7-FIX-A3), so it must survive.
  expect(row.runHref).toBe('/flows/unknown/run/INIT-legacy');
  expect(row.flowId).toBe('unknown');
});

test('sessions-kinds-08: the class, not the one sentinel — a retired-but-not-"unknown" flow id is equally dead and equally suppressed', () => {
  const runs = [run({ id: 'INIT-old', initiativeId: 'INIT-old', flowId: 'release-refine', status: 'complete' })];
  expect(deriveInitiativeLinkage(['INIT-old'], runs, ['forge-develop'])[0].monitorHref).toBeNull();
});

test('sessions-kinds-08: a run on a REAL flow keeps its monitor link — the guard must not have been widened into "never link"', () => {
  const runs = [run({ id: 'INIT-live', initiativeId: 'INIT-live', flowId: 'forge-develop', status: 'active' })];
  expect(deriveInitiativeLinkage(['INIT-live'], runs, ['forge-develop'])[0].monitorHref).toBe('/flows/forge-develop');
});

test('sessions-kinds-08: an UNRESOLVED roster suppresses the link rather than guessing — one fewer link beats a dead end', () => {
  const runs = [run({ id: 'INIT-live', initiativeId: 'INIT-live', flowId: 'forge-develop', status: 'active' })];
  expect(deriveInitiativeLinkage(['INIT-live'], runs, undefined)[0].monitorHref).toBeNull();
  expect(deriveInitiativeLinkage(['INIT-live'], runs, [])[0].monitorHref).toBeNull();
});
