/**
 * beats-kb-select-nav.test.ts — row 143 (bead `forge-8vfn.8.1.36`, ruling
 * 1737): S10's "find what the cycle learned" beat asserted `kb-id: 'gitpulse'`
 * with no `do` and no `wait` at all, so it was judged purely by wherever the
 * runner's real-nav fallback happened to land.
 *
 * WHY IT WAS RED. `StudioNav.tsx` renders the Knowledge pillar with
 * `data-nav="knowledge"`, never `data-action` — `handleFor` (`beats.mjs`)
 * only ever builds `[data-action="…"]`, so no `press` step can reach it, and
 * the ONLY door to `/knowledge` is the runner's real-nav fallback
 * (`beats-drive.mjs`'s `[data-nav][href]` branch). That fallback carries no
 * `?id=`, and `app/knowledge/page.tsx`'s bare-route branch then falls back to
 * the operator's last-viewed KB, or the roster's first entry — `cycles` on a
 * fresh browser, per `lib/kb-last-viewed.ts`'s `initialKbId` (already pinned
 * by `apps/studio/tests/regression/kb-last-viewed.test.ts`). Never THIS
 * cycle's ground. A real run reds: `data-kb-id: expected "gitpulse", got
 * "cycles"`.
 *
 * THE FIX splits the one beat into two, the same NAVIGATION-ONLY shape
 * `S10.act2.mjs` already uses for the identical reason (T1 ruling 533): a
 * beat with no `do` that only asserts `route` + `page`/`page-ready`, followed
 * by a beat that acts on the page the first one already reached.
 * `performSteps` runs BEFORE the route wait and before real-nav
 * (`beats-drive.mjs`), so a `do` naming `kb-select` on the FIRST beat would
 * run on `/artifact` — the page the previous beat (`Reflect on the cycle`)
 * left the story standing on — where no such control exists at all.
 *
 * This asserts the REAL S10 story, through the REAL parser, rather than a
 * hand-built fixture: the two beats named below, in order, with the shapes
 * the fix requires.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateStory } from './story-file.mjs';

test('row 143: a NAVIGATION-ONLY beat reaches /knowledge before anything acts on it', async () => {
  const story = (await import('../../tests/stories/S10.story.mjs')).default;
  const beats = validateStory(story).beats;

  const navIndex = beats.findIndex((b: any) => b.act === 'Open the knowledge graph');
  assert.notEqual(navIndex, -1, 'the split-out navigation beat must exist');

  const navBeat = beats[navIndex];
  assert.deepEqual(
    navBeat.do,
    [],
    'NAVIGATION-ONLY (533): no `do` — the Knowledge pillar carries `data-nav`, ' +
      'never `data-action`, so only the real-nav fallback can reach it',
  );
  assert.equal(navBeat.expect.route, '/knowledge');
  assert.deepEqual(
    navBeat.expect.data,
    { page: 'knowledge', 'page-ready': 'true' },
    'the 504 class: route plus page/page-ready, nothing else — asserting `kb-id` ' +
      'here would judge a value the NEXT beat has not chosen yet',
  );
});

test('row 143: the very next beat selects the ground KB through #kb-select, never the default', async () => {
  const story = (await import('../../tests/stories/S10.story.mjs')).default;
  const beats = validateStory(story).beats;

  const navIndex = beats.findIndex((b: any) => b.act === 'Open the knowledge graph');
  const selectIndex = beats.findIndex(
    (b: any) => b.act === 'Find what the cycle learned on the knowledge graph',
  );
  assert.notEqual(selectIndex, -1, 'the selecting beat must exist');
  assert.equal(selectIndex, navIndex + 1, 'it must immediately follow the navigation beat');

  const selectBeat = beats[selectIndex];
  assert.deepEqual(
    selectBeat.do,
    [{ fill: 'kb-select', with: 'gitpulse' }],
    '`fill` on the `data-field="kb-select"` SELECT resolves to `selectOption` ' +
      '(`beats-steps.mjs`\'s `setControl`) — the documented control, not the pillar\'s own default',
  );
  assert.equal(selectBeat.expect.route, '/knowledge');
  assert.equal(
    selectBeat.expect.data['kb-id'],
    'gitpulse',
    'the ground project (`S10.constants.mjs`\'s `GROUND.project`), never whatever the pillar defaulted to',
  );
});
