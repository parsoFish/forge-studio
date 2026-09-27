/**
 * beats-cost-route.test.ts — row 148 (bead `forge-8vfn.8.1.38`, ruling 1771):
 * S10's "Check what the run cost" beat asserted `route: '/monitor'` paired
 * with `run-cost-usd`, and reds live: "data-run-cost-usd ... absent from the
 * page".
 *
 * WHY IT WAS RED. `data-run-cost-usd` is emitted only by `MonitorSummary`
 * (`apps/studio/components/studio/MonitorSummary.tsx:53,104`, `.toFixed(4)`,
 * present whenever `run.costUsd !== null`), mounted only at the per-flow
 * monitor (`apps/studio/app/flows/[id]/page.tsx:566,569`,
 * `data-page="flow-monitor"`). The global `/monitor` route carries
 * `data-ledger-cost-usd` instead, by design and at a different precision
 * (`docs/reference/studio-dom-contract.md` ~1275-1284;
 * `apps/studio/tests/integration/history-ledger-render.test.ts:228-233`).
 *
 * THE FIX moves the beat onto the develop flow's own monitor,
 * `/flows/forge-develop`, `page: 'flow-monitor'`. `StudioNav.tsx`'s own
 * comment says the Flows pillar never deep-links a specific flow ("a
 * specific flow's own monitor ... is reached via a card on that index, not a
 * nav deep-link"), so a NAVIGATION-ONLY beat (ruling 533's shape, the same
 * split row 143 made in `beats-kb-select-nav.test.ts`) reaches the flows
 * index first, and the cost beat's own real-nav reaches the flow from there
 * via the FlowCard's link (`LibraryCard.tsx`'s `FlowCard`).
 *
 * This asserts the REAL S10 story, through the REAL parser, rather than a
 * hand-built fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateStory } from './story-file.mjs';

test('row 148: no S10 beat pairs run-cost-usd with the global /monitor route', async () => {
  const story = (await import('../../tests/stories/S10.story.mjs')).default;
  const beats = validateStory(story).beats;

  const costBeats = beats.filter((b: any) => Object.hasOwn(b.expect.data, 'run-cost-usd'));
  assert.notEqual(costBeats.length, 0, 'a beat asserting run-cost-usd must exist');
  for (const beat of costBeats) {
    assert.notEqual(
      beat.expect.route,
      '/monitor',
      '`data-run-cost-usd` is emitted only by MonitorSummary, mounted only at the per-flow ' +
        'monitor — never at the global /monitor, which carries data-ledger-cost-usd instead',
    );
  }
});

test('row 148: the run-cost beat reads it off the develop flow\'s own monitor', async () => {
  const story = (await import('../../tests/stories/S10.story.mjs')).default;
  const beats = validateStory(story).beats;

  const costIndex = beats.findIndex((b: any) => b.act === 'Check what the run cost');
  assert.notEqual(costIndex, -1, 'the cost beat must exist');

  const costBeat = beats[costIndex];
  assert.equal(costBeat.expect.route, '/flows/forge-develop');
  assert.deepEqual(
    costBeat.expect.data,
    { page: 'flow-monitor', 'page-ready': 'true', 'run-cost-usd': '<runCostUsd>' },
    'the per-flow monitor carries data-page="flow-monitor" (apps/studio/app/flows/[id]/page.tsx:566)',
  );
});

test('row 148: a NAVIGATION-ONLY beat reaches /flows before the cost beat', async () => {
  const story = (await import('../../tests/stories/S10.story.mjs')).default;
  const beats = validateStory(story).beats;

  const costIndex = beats.findIndex((b: any) => b.act === 'Check what the run cost');
  assert.notEqual(costIndex, -1, 'the cost beat must exist');
  const navIndex = costIndex - 1;
  assert.ok(navIndex >= 0, 'a navigation beat must precede the cost beat');

  const navBeat = beats[navIndex];
  assert.deepEqual(
    navBeat.do,
    [],
    'NAVIGATION-ONLY (533): no `do` — the flows index is reached via the Flows pillar and a ' +
      'specific flow only via a card on that index, never a nav deep-link',
  );
  assert.equal(navBeat.expect.route, '/flows');
  assert.deepEqual(navBeat.expect.data, { page: 'flows-index', 'page-ready': 'true' });
});
