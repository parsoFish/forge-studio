/**
 * fork-schema.test.ts — forge-8vfn.2.22 (PR-B item 1), the validation half.
 *
 * `tests/stories/S2.story.mjs:143` declares `fork: { over: 'create-app-type',
 * cases: STARTERS }` on its beat 3, and its own comment says `validateStory`
 * "keeps only the fields it knows" and silently drops it, so the runner
 * performs one case. This pins the schema: `fork` is `{ over: <a fill field
 * this beat's own `do` actually fills>, cases: <non-empty array of distinct
 * strings> }`; anything else is refused by name, and the field SURVIVES the
 * rebuild rather than being dropped like it is today.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStory } from './story-file.mjs';

const ok = {
  id: 'smoke',
  ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
  docs: { kind: 'how-to', title: 'Find a project from Home' },
  beats: [
    {
      act: 'Open Studio on Home',
      expect: { route: '/', data: { 'page-ready': 'true' } },
      say: 'Studio opens on Home.',
    },
  ],
};

const forkBeat = {
  act: 'Pick a starter',
  do: [{ fill: 'create-app-type', with: 'cli' }],
  expect: { route: '/projects/new', data: { 'page-ready': 'true' } },
  say: 's',
  fork: { over: 'create-app-type', cases: ['api', 'cli', 'webapp'] },
};

test('a well-formed fork validates and SURVIVES the rebuild', () => {
  const s = validateStory({ ...ok, beats: [ok.beats[0], forkBeat] });
  assert.deepEqual(s.beats[1].fork, { over: 'create-app-type', cases: ['api', 'cli', 'webapp'] });
  assert.ok(Object.isFrozen(s.beats[1].fork));
  assert.ok(Object.isFrozen(s.beats[1].fork.cases));
});

test('a beat with no fork validates, and carries no fork field', () => {
  const s = validateStory(ok);
  assert.equal(Object.hasOwn(s.beats[0], 'fork'), false);
});

test('fork.over must name a fill field THIS BEAT\'S OWN do actually fills', () => {
  // A fork over a field nothing fills would run every case identically and
  // silently — refused rather than discovered as N identical green cases.
  const bad = { ...forkBeat, fork: { over: 'create-name', cases: ['a', 'b'] } };
  assert.throws(
    () => validateStory({ ...ok, beats: [ok.beats[0], bad] }),
    /beats\[1\]\.fork\.over/,
  );
});

test('fork.over naming a field only a PRESS step (not a fill) uses is refused', () => {
  const bad = {
    ...forkBeat,
    do: [{ press: 'create-app-type' }],
    fork: { over: 'create-app-type', cases: ['a', 'b'] },
  };
  assert.throws(
    () => validateStory({ ...ok, beats: [ok.beats[0], bad] }),
    /beats\[1\]\.fork\.over/,
  );
});

test('fork.cases must be a non-empty array of strings', () => {
  for (const bad of [[], 'cli', null, [1, 2], ['cli', null]]) {
    assert.throws(
      () => validateStory({ ...ok, beats: [ok.beats[0], { ...forkBeat, fork: { over: 'create-app-type', cases: bad } }] }),
      /beats\[1\]\.fork\.cases/,
      `cases ${JSON.stringify(bad)} must be rejected`,
    );
  }
});

test('fork.cases must be DISTINCT — a duplicate would run the same case twice under two labels', () => {
  assert.throws(
    () => validateStory({
      ...ok,
      beats: [ok.beats[0], { ...forkBeat, fork: { over: 'create-app-type', cases: ['cli', 'cli'] } }],
    }),
    /beats\[1\]\.fork\.cases/,
  );
});

test('a fork missing `over` or `cases`, or not an object, is refused', () => {
  for (const bad of [{}, { over: 'create-app-type' }, { cases: ['a'] }, 'cli', null, []]) {
    assert.throws(
      () => validateStory({ ...ok, beats: [ok.beats[0], { ...forkBeat, fork: bad }] }),
      /beats\[1\]\.fork/,
      `fork ${JSON.stringify(bad)} must be rejected`,
    );
  }
});
