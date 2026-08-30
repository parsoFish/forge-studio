/**
 * W7-B7 pins (artifact-plan-17) — the PR artifact page's view model. Kills:
 * a PR page with no link to the actual pull request (the run records the URL
 * in its own reviewer.pr-opened event; it must reach the renderer), an
 * invented PR number, and a fabricated state on runs whose PR state is
 * unknowable. RUN: cd forge-ui && npx vitest run lib/artifact-pr-view.test.ts
 */
import { test, expect } from 'vitest';

import { prDocWithRunLink, prNumberFromUrl, prStateFromRun } from './artifact-pr-view.ts';
import type { Run } from './studio-client.ts';

function run(over: Partial<Run>): Run {
  return {
    id: 'c', flowId: 'forge-develop', initiativeId: 'INIT-2026-01-01-x', initiative: 'x', status: 'complete',
    origin: 'architect', costUsd: 0, phases: {}, phaseMeta: {}, artifactsReady: {}, flowLineage: [], ...over,
  };
}

const URL = 'https://github.com/parsoFish/gitpulse/pull/12';

test('prNumberFromUrl: extracts the /pull/<n> tail; never invents', () => {
  expect(prNumberFromUrl(URL)).toBe(12);
  expect(prNumberFromUrl('https://github.com/x/y/pull/7/files')).toBe(7);
  expect(prNumberFromUrl('https://github.com/x/y')).toBeUndefined();
  expect(prNumberFromUrl(undefined)).toBeUndefined();
});

test('prStateFromRun: merged for complete, open for gated/active, UNKNOWN (omitted) for failed/planned/null', () => {
  expect(prStateFromRun(run({ status: 'complete' }))).toBe('merged');
  expect(prStateFromRun(run({ status: 'gated' }))).toBe('open');
  expect(prStateFromRun(run({ status: 'active' }))).toBe('open');
  expect(prStateFromRun(run({ status: 'failed' }))).toBeUndefined();
  expect(prStateFromRun(run({ status: 'planned' }))).toBeUndefined();
  expect(prStateFromRun(null)).toBeUndefined();
});

test('prDocWithRunLink: the run prUrl reaches the doc (url + derived number + state) even with a text-only description', () => {
  const merged = prDocWithRunLink({ title: 'forge: INIT-x', body: 'text' }, run({ prUrl: URL, status: 'complete' }));
  expect(merged).toMatchObject({ title: 'forge: INIT-x', url: URL, number: 12, state: 'merged' });
});

test('prDocWithRunLink: a recorded PR with NO description still yields a linkable doc', () => {
  const merged = prDocWithRunLink(null, run({ prUrl: URL, status: 'gated' }));
  expect(merged).toMatchObject({ url: URL, number: 12, state: 'open' });
});

test('prDocWithRunLink: failed run — link renders, state stays honestly absent', () => {
  const merged = prDocWithRunLink(null, run({ prUrl: URL, status: 'failed' }));
  expect(merged?.url).toBe(URL);
  expect(merged?.state).toBeUndefined();
});

test('prDocWithRunLink: nothing recorded, nothing parsed ⇒ null (the page renders its empty state)', () => {
  expect(prDocWithRunLink(null, run({}))).toBeNull();
  expect(prDocWithRunLink(null, null)).toBeNull();
});
