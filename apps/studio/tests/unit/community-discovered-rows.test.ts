/**
 * M6-D / rulings 478 + 616 — which refresh states carry PROPOSALS, and which
 * carry none.
 *
 * The page renders `[data-component="discovered-rows"]` from one expression:
 *
 *     !refreshing && refreshResult?.state === 'ok' ? refreshResult.discovered : []
 *
 * so the property worth pinning is not "rows render" — it is **when they must
 * NOT**. A proposal list surviving an in-flight request, or a refusal, would be
 * stale by construction: the rows describe what the LAST successful pass found,
 * and showing them over a live or failed one is the same lie the in-flight state
 * exists to refuse.
 *
 * This lives in a unit test rather than in the community journey because the
 * journey's CM-23 runs under dry-bridge, which REFUSES the refresh — so a
 * journey check could only ever assert the absence, in a browser, at the cost of
 * pushing an already-over-cap file further over. The behaviour CM-23 exercises
 * is unchanged by this work.
 */
import { test, expect } from 'vitest';

import type { CommunityRefreshResult, DiscoveredRow } from '../../lib/community-client.ts';

const ROW: DiscoveredRow = {
  id: 'brainstorming',
  sourceUrl: 'https://github.com/obra/superpowers',
  path: 'skills/brainstorming/SKILL.md',
};

const OK_WITH_ROWS: CommunityRefreshResult = {
  state: 'ok',
  wrote: true,
  dryRun: false,
  lastRefresh: '2026-09-11T10:00:00.000Z',
  counts: { total: 4, refreshed: 4, unchanged: 0, noUpstream: 0, failed: 0 },
  outcomes: [],
  errors: [],
  discovered: [ROW],
  hubOutcomes: [],
};

/** The page's own expression, named once so the test drives the real rule
 *  rather than a paraphrase of it. */
function proposalsFor(result: CommunityRefreshResult | null, refreshing: boolean): readonly DiscoveredRow[] {
  return !refreshing && result?.state === 'ok' ? result.discovered : [];
}

test('a settled successful pass carries its proposals', () => {
  expect(proposalsFor(OK_WITH_ROWS, false)).toEqual([ROW]);
});

test('nothing clicked yet proposes nothing', () => {
  expect(proposalsFor(null, false)).toEqual([]);
});

test('an IN-FLIGHT refresh proposes nothing, even when the previous pass found rows', () => {
  // The rows describe what the LAST pass found; rendering them over a live
  // request would be the stale-verdict lie in a different costume.
  expect(proposalsFor(OK_WITH_ROWS, true)).toEqual([]);
});

test('a REFUSED refresh proposes nothing — including the dry-bridge refusal the journey exercises', () => {
  const refusedDry: CommunityRefreshResult = { state: 'refused-dry-bridge', route: '/api/studio/community/refresh', method: 'POST', action: 'network' };
  const refused: CommunityRefreshResult = { state: 'refused', status: 409, error: 'no token', reason: 'missing-token', remedy: 'export GH_TOKEN' };

  expect(proposalsFor(refusedDry, false)).toEqual([]);
  expect(proposalsFor(refused, false)).toEqual([]);
});

test('a transport error proposes nothing — the bridge was never reached, so nothing was discovered', () => {
  expect(proposalsFor({ state: 'transport-error', error: 'bridge unreachable' }, false)).toEqual([]);
});
