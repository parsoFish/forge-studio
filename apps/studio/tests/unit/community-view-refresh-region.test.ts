/**
 * T1 ruling 608(i) — the refresh region states the IN-FLIGHT refresh, not only
 * its outcome.
 *
 * WHAT THIS EXISTS FOR. The result section used to render only once a result
 * existed, so while a refresh ran the DOM was indistinguishable from one where
 * nothing had been clicked. An operator could not tell "working" from "did
 * nothing"; a beat waiting on the outcome could not tell "not yet" from
 * "never". The product knew (`refreshing === true`) and did not say.
 *
 * WHY IT IS NOT COSMETIC. `community-refresh-api.ts` fetches its sources ONE
 * AT A TIME, each bounded at 10 s, and this repository's registry resolves to
 * four fetchable sources — so a HEALTHY refresh can run for tens of seconds
 * against S8 beat 4's 15 s expectation window. Bead `forge-8vfn.7.6.16` (M7)
 * owns the duration; these own the visibility.
 *
 * Lives beside `community-view.test.ts` rather than inside it: that file is at
 * its `check-file-size` ceiling, and an exemption is a ceiling rather than a
 * licence.
 */
import { test, expect } from 'vitest';

import { refreshRegionView } from '../../lib/community-view.ts';
import type { CommunityRefreshResult } from '../../lib/community-client.ts';

const OK_WROTE: CommunityRefreshResult = {
  state: 'ok',
  wrote: true,
  dryRun: false,
  counts: { total: 4, refreshed: 4, unchanged: 0, noUpstream: 0, failed: 0 },
  outcomes: [],
  errors: [],
  discovered: [],
  lastRefresh: '2026-09-11T09:00:00.000Z',
};

test('nothing clicked yet: the region is absent — no empty shell', () => {
  expect(refreshRegionView(null, { refreshing: false })).toBeNull();
});

test('in flight: the region states it, so "working" is distinguishable from "did nothing"', () => {
  const view = refreshRegionView(null, { refreshing: true });

  expect(view?.state).toBe('in-flight');
  expect(view?.headline).toMatch(/refreshing/i);
});

test('the in-flight detail is HONEST about the shape rather than reassuring', () => {
  const view = refreshRegionView(null, { refreshing: true });

  // Two true things an operator watching a long refresh needs: it is serial,
  // so it grows with the registry; and forge is not crawling anything it was
  // not told about (hubs.yaml's D10, which this surface must never contradict).
  expect(view?.detail).toMatch(/one at a time/i);
  expect(view?.detail).toMatch(/nothing is crawled|does not already declare/i);
});

test('resolved: the region carries the outcome exactly as before', () => {
  const view = refreshRegionView(OK_WROTE, { refreshing: false });

  expect(view?.state).toBe('refreshed');
  expect(view?.headline).toMatch(/4 updated/);
});

test('a SECOND refresh shows in-flight, never the previous verdict — a stale success over a live request is the worse lie', () => {
  const view = refreshRegionView(OK_WROTE, { refreshing: true });

  expect(view?.state).toBe('in-flight');
  expect(view?.headline).not.toMatch(/4 updated/);
});

test('the postWriteReloadFailed reconciliation still reaches refreshOutcomeView untouched', () => {
  const view = refreshRegionView(OK_WROTE, { refreshing: false, postWriteReloadFailed: true });

  // The suffix variant is refreshOutcomeView's own; this function must pass
  // the option through rather than re-derive or swallow it.
  expect(view?.state).toBe('refreshed-stale-view');
});
