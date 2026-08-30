/**
 * W7-B7 pins — the /artifact page's request planner. Kills the blind
 * optional-artifact GET fan: verdict.json 404s on every type, plan.json /
 * PLAN.md probes for files nothing produces, per-WI + pr-description /
 * reflection fetches on runs whose own model says the artifact is absent
 * (the walkthrough baseline's /artifact rows). The run model's
 * `artifactsReady` is the disk truth — status decides before any body is
 * fetched.
 *
 * W8-A2 (WI-5) additions:
 *   - artifact-plan-41: `onDisk` is now a REQUIRED 4th argument, threaded
 *     from `RunLookup.onDisk` — a genuinely UNKNOWN id (nothing on disk
 *     either) probes NOTHING, since the existence question is already
 *     answered before this page's NotFound paints. An orphan (on disk, no
 *     queue record) keeps the pre-existing "probe the type's own primary"
 *     behaviour. These are two different `run === null` situations that
 *     must not share a branch — see the "orphan vs unknown id" tests below,
 *     which kill a fix that resurrects a shared branch under a new name.
 *   - artifact-plan-40: `probeDemoMarkdown` is no longer gated on
 *     `ready('demo')` — it is deliberately best-effort (see the field's own
 *     doc in artifact-request-plan.ts).
 *
 * RUN: cd forge-ui && npx vitest run lib/artifact-request-plan.test.ts
 */
import { test, expect } from 'vitest';

import { planArtifactRequests } from './artifact-request-plan.ts';
import type { Run } from './studio-client.ts';

function run(over: Partial<Run>): Run {
  return {
    id: '2026-07-11T17-26-34_INIT-2026-07-11-x', flowId: 'forge-develop', initiativeId: 'INIT-2026-07-11-x',
    initiative: 'x', status: 'complete', origin: 'architect', costUsd: 0,
    phases: {}, phaseMeta: {}, artifactsReady: {}, flowLineage: [], ...over,
  };
}

test('a run with NO ready artifacts fetches NOTHING for any type EXCEPT the deliberately best-effort DEMO.md probe (the 404 fan is gone)', () => {
  const bare = run({ status: 'planned' });
  for (const type of ['plan', 'workitems', 'pr', 'demo', 'verdict', 'reflection'] as const) {
    const plan = planArtifactRequests(type, bare, 'view', true);
    expect(plan).toEqual({
      probePlanHtml: false,
      probeDemoJson: false,
      probePrDescription: false,
      probeVerdictJson: false,
      probeReflectionJson: false,
      // artifact-plan-40: best-effort, not gated on demo.json readiness —
      // true only for type==='demo' in view mode, regardless of `ready`.
      probeDemoMarkdown: type === 'demo',
      workItemIds: [],
    });
  }
});

test('declared-ready artifacts are fetched — plan/demo/pr/verdict/reflection each keyed on its own flag', () => {
  const full = run({
    artifactsReady: { plan: 'view', demo: 'view', pr: 'view', verdict: 'view', reflection: 'view', 'work-items': 'view' },
    workItems: [
      { id: 'WI-1', status: 'complete', costUsd: 0.5 },
      { id: 'WI-2', status: 'complete', costUsd: 0.4 },
    ],
  });
  expect(planArtifactRequests('plan', full, 'view', true).probePlanHtml).toBe(true);
  expect(planArtifactRequests('demo', full, 'view', true)).toMatchObject({ probeDemoJson: true, probeDemoMarkdown: true });
  expect(planArtifactRequests('pr', full, 'view', true)).toMatchObject({ probePrDescription: true, probeDemoJson: true });
  expect(planArtifactRequests('verdict', full, 'view', true).probeVerdictJson).toBe(true);
  expect(planArtifactRequests('reflection', full, 'view', true).probeReflectionJson).toBe(true);
  expect(planArtifactRequests('workitems', full, 'view', true).workItemIds).toEqual(['WI-1', 'WI-2']);
});

test('the view-mode verdict STAMP fetch also rides the declared flag — absent verdict, no fetch on any type', () => {
  const noVerdict = run({ artifactsReady: { plan: 'view', demo: 'view' } });
  expect(planArtifactRequests('plan', noVerdict, 'view', true).probeVerdictJson).toBe(false);
  expect(planArtifactRequests('demo', noVerdict, 'view', true).probeVerdictJson).toBe(false);
  const withVerdict = run({ artifactsReady: { plan: 'view', verdict: 'view' } });
  expect(planArtifactRequests('plan', withVerdict, 'view', true).probeVerdictJson).toBe(true);
});

test('gate mode authors a verdict — the prior doc is not fetched; the demo evidence is (when declared)', () => {
  const gated = run({ status: 'gated', artifactsReady: { demo: 'gate', pr: 'gate', verdict: 'view' } });
  const plan = planArtifactRequests('verdict', gated, 'gate', true);
  expect(plan.probeVerdictJson).toBe(false);
  expect(plan.probeDemoJson).toBe(true);
});

test('gate mode with NO demo declared fetches no demo.json (the no-demo fallback form renders instead)', () => {
  const gated = run({ status: 'gated', artifactsReady: {} });
  expect(planArtifactRequests('verdict', gated, 'gate', true).probeDemoJson).toBe(false);
});

test('per-WI fetches never fire when work-items is not declared, even if the run lists workItems', () => {
  const r = run({ workItems: [{ id: 'WI-1', status: 'pending', costUsd: 0 }] });
  expect(planArtifactRequests('workitems', r, 'view', true).workItemIds).toEqual([]);
});

// ---------------------------------------------------------------------------
// artifact-plan-41 (W8-A2): orphan (on disk, no queue record) vs a
// genuinely UNKNOWN id (nothing on disk either) — `run === null` covers
// BOTH, and they must resolve to DIFFERENT plans. A fix that collapses them
// back onto one branch (e.g. always probing, or always returning NONE) is
// killed by one of the two tests below.
// ---------------------------------------------------------------------------

test('ORPHAN (run===null, onDisk=true): the type\'s own primary is probed directly — the legacy behaviour, confined', () => {
  expect(planArtifactRequests('plan', null, 'view', true).probePlanHtml).toBe(true);
  expect(planArtifactRequests('demo', null, 'view', true)).toMatchObject({ probeDemoJson: true, probeDemoMarkdown: true });
  expect(planArtifactRequests('pr', null, 'view', true)).toMatchObject({ probePrDescription: true, probeDemoJson: true });
  expect(planArtifactRequests('verdict', null, 'view', true).probeVerdictJson).toBe(true);
  expect(planArtifactRequests('reflection', null, 'view', true).probeReflectionJson).toBe(true);
  // artifact-plan-35: still [] — no bridge route lists the snapshot dir for a
  // bare cycleId (see the module docstring); the page softens the copy
  // instead (deriveArtifactEmptyReason('orphan', …)).
  expect(planArtifactRequests('workitems', null, 'view', true).workItemIds).toEqual([]);
});

test('UNKNOWN id (run===null, onDisk=false): NOTHING is probed for ANY type — the existence question is already answered', () => {
  const NONE_PLAN = {
    probePlanHtml: false,
    probeDemoJson: false,
    probePrDescription: false,
    probeVerdictJson: false,
    probeReflectionJson: false,
    probeDemoMarkdown: false,
    workItemIds: [],
  };
  for (const type of ['plan', 'workitems', 'pr', 'demo', 'verdict', 'reflection'] as const) {
    for (const mode of ['view', 'gate'] as const) {
      expect(planArtifactRequests(type, null, mode, false)).toEqual(NONE_PLAN);
    }
  }
});

test('orphan vs unknown id are DISTINGUISHABLE for the SAME type/mode — onDisk is the only input that differs', () => {
  const orphanPlan = planArtifactRequests('plan', null, 'view', true);
  const unknownPlan = planArtifactRequests('plan', null, 'view', false);
  expect(orphanPlan.probePlanHtml).toBe(true);
  expect(unknownPlan.probePlanHtml).toBe(false);
  expect(orphanPlan).not.toEqual(unknownPlan);
});
