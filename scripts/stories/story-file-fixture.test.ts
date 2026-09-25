/**
 * `ground.fixture` validation — split out of `story-file.test.ts` (M7-D) when
 * the three cases below took that file past the 800-line cap. The cut follows the
 * SUBJECT: everything here is about the fixture-ground field, and nothing in the
 * parent file is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStory } from './story-file.mjs';

/**
 * M7-D — `ground.fixture` names a forge-owned FIXTURE ground provisioned from
 * `tests/stories/grounds/<fixture>/seed/`, rather than a real project under
 * `projects/`. §3.1's namespace rule carries over unchanged: the fixture can
 * only ever be provisioned into a project this story already owns —
 * `storyFixtureNames(storyId)` from `sweep.mjs` — so a story cannot be typo'd
 * into provisioning onto (and later sweeping) a real ground.
 *
 * `expectedChanges` and `seedIgnoredBorn` are both validated AND rebuilt into a
 * fixed field list in the returned `ground` (bead `forge-8vfn.7.6.82`'s own
 * lesson: a field validated and not named in the rebuild is dropped silently).
 * `fixture` needs the same two-part treatment: validated here, and carried
 * into the frozen object the runner actually reads.
 */
test('M7-D: a ground with a valid fixture validates, and the fixture rides in the frozen ground', () => {
  const v = validateStory({
    id: 'S8',
    ground: { project: 'story-s8', fixture: 'node-library', realSpawn: false, budget_usd: 0 },
    docs: { kind: 'how-to' as const, title: 't' },
    beats: [{ act: 'a', say: 's', expect: { route: '/', data: { x: '1' } } }],
  });
  assert.deepEqual(v.ground, { project: 'story-s8', realSpawn: false, budget_usd: 0, fixture: 'node-library' });
});

test('M7-D: an unsafe ground.fixture name is rejected, naming the field', () => {
  assert.throws(
    () => validateStory({
      id: 'S8',
      ground: { project: 'story-s8', fixture: 'Bad Name', realSpawn: false, budget_usd: 0 },
      docs: { kind: 'how-to' as const, title: 't' },
      beats: [{ act: 'a', say: 's', expect: { route: '/', data: { x: '1' } } }],
    }),
    /ground\.fixture/,
  );
});

test('M7-D: a fixture ground whose project is outside the story\'s own sweep namespace is rejected, naming the namespace', () => {
  // `storyFixtureNames('S8')` is `story-S8` / `story-s8` — `mdtoc` is a REAL
  // project and must never be a valid target for a fixture provision.
  assert.throws(
    () => validateStory({
      id: 'S8',
      ground: { project: 'mdtoc', fixture: 'node-library', realSpawn: false, budget_usd: 0 },
      docs: { kind: 'how-to' as const, title: 't' },
      beats: [{ act: 'a', say: 's', expect: { route: '/', data: { x: '1' } } }],
    }),
    /ground\.fixture/,
  );
  assert.throws(
    () => validateStory({
      id: 'S8',
      ground: { project: 'mdtoc', fixture: 'node-library', realSpawn: false, budget_usd: 0 },
      docs: { kind: 'how-to' as const, title: 't' },
      beats: [{ act: 'a', say: 's', expect: { route: '/', data: { x: '1' } } }],
    }),
    /story-s8/,
    'the refusal must name the namespace the project should have been in',
  );
});
