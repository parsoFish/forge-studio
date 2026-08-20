/**
 * W7-B7 pins — the /artifact page's request planner. Kills the blind
 * optional-artifact GET fan: verdict.json 404s on every type, plan.json /
 * PLAN.md probes for files nothing produces, per-WI + pr-description /
 * reflection fetches on runs whose own model says the artifact is absent
 * (the walkthrough baseline's /artifact rows). The run model's
 * `artifactsReady` is the disk truth (deriveArtifacts stats the files) —
 * status decides before any body is fetched.
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

test('a run with NO ready artifacts fetches NOTHING for any type (the 404 fan is gone)', () => {
  const bare = run({ status: 'planned' });
  for (const type of ['plan', 'workitems', 'pr', 'demo', 'verdict', 'reflection'] as const) {
    const plan = planArtifactRequests(type, bare, 'view');
    expect(plan).toEqual({
      probePlanHtml: false,
      probeDemoJson: false,
      probePrDescription: false,
      probeVerdictJson: false,
      probeReflectionJson: false,
      probeDemoMarkdown: false,
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
  expect(planArtifactRequests('plan', full, 'view').probePlanHtml).toBe(true);
  expect(planArtifactRequests('demo', full, 'view')).toMatchObject({ probeDemoJson: true, probeDemoMarkdown: true });
  expect(planArtifactRequests('pr', full, 'view')).toMatchObject({ probePrDescription: true, probeDemoJson: true });
  expect(planArtifactRequests('verdict', full, 'view').probeVerdictJson).toBe(true);
  expect(planArtifactRequests('reflection', full, 'view').probeReflectionJson).toBe(true);
  expect(planArtifactRequests('workitems', full, 'view').workItemIds).toEqual(['WI-1', 'WI-2']);
});

test('the view-mode verdict STAMP fetch also rides the declared flag — absent verdict, no fetch on any type', () => {
  const noVerdict = run({ artifactsReady: { plan: 'view', demo: 'view' } });
  expect(planArtifactRequests('plan', noVerdict, 'view').probeVerdictJson).toBe(false);
  expect(planArtifactRequests('demo', noVerdict, 'view').probeVerdictJson).toBe(false);
  const withVerdict = run({ artifactsReady: { plan: 'view', verdict: 'view' } });
  expect(planArtifactRequests('plan', withVerdict, 'view').probeVerdictJson).toBe(true);
});

test('gate mode authors a verdict — the prior doc is not fetched; the demo evidence is (when declared)', () => {
  const gated = run({ status: 'gated', artifactsReady: { demo: 'gate', pr: 'gate', verdict: 'view' } });
  const plan = planArtifactRequests('verdict', gated, 'gate');
  expect(plan.probeVerdictJson).toBe(false);
  expect(plan.probeDemoJson).toBe(true);
});

test('gate mode with NO demo declared fetches no demo.json (the no-demo fallback form renders instead)', () => {
  const gated = run({ status: 'gated', artifactsReady: {} });
  expect(planArtifactRequests('verdict', gated, 'gate').probeDemoJson).toBe(false);
});

test('per-WI fetches never fire when work-items is not declared, even if the run lists workItems', () => {
  const r = run({ workItems: [{ id: 'WI-1', status: 'pending', costUsd: 0 }] });
  expect(planArtifactRequests('workitems', r, 'view').workItemIds).toEqual([]);
});

test('UNKNOWN run (orphan _logs dir): the type\'s own primary is probed directly — the legacy behaviour, confined', () => {
  expect(planArtifactRequests('plan', null, 'view').probePlanHtml).toBe(true);
  expect(planArtifactRequests('demo', null, 'view')).toMatchObject({ probeDemoJson: true, probeDemoMarkdown: true });
  expect(planArtifactRequests('pr', null, 'view')).toMatchObject({ probePrDescription: true, probeDemoJson: true });
  expect(planArtifactRequests('verdict', null, 'view').probeVerdictJson).toBe(true);
  expect(planArtifactRequests('reflection', null, 'view').probeReflectionJson).toBe(true);
  expect(planArtifactRequests('workitems', null, 'view').workItemIds).toEqual([]);
});
