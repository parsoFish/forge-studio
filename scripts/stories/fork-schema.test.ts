/**
 * fork-schema.test.ts — forge-8vfn.2.22 (PR-B item 1), the validation half.
 *
 * `tests/stories/S2.story.mjs:143` declares `fork: { over: 'create-app-type',
 * cases: STARTERS }` on its beat 3, and its own comment says `validateStory`
 * "keeps only the fields it knows" and silently drops it, so the runner
 * performs one case. This pins the schema: `fork` is `{ over: <string>,
 * cases: <non-empty array of distinct strings> }`; a malformed shape is
 * refused by name, and the field SURVIVES the rebuild rather than being
 * dropped like it is today.
 *
 * FILL FORK vs DOOR FORK (T1 ruling 1350). `over` naming a `fill` step in the
 * beat's own `do` — S2 beat 3's `create-app-type` — makes this a FILL fork:
 * `beats-fork.mjs` runs every case, each on its own ground. `over` naming
 * anything else — S7 beat 3's `authoring-door`, which no `fill` step fills —
 * makes it a DOOR fork: declared and inert, carried through unexpanded. The
 * classification is NOT checked here: it is a property of `beats-fork.mjs`'s
 * EXPANSION, read from the already-validated `do`, not a schema rule that
 * could refuse a legitimate door fork at load. The two tests below used to
 * refuse exactly the door-fork shape; a door fork run ONCE cannot silently run
 * N identical cases, which was the hazard the old refusal existed to catch.
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

test('fork.over naming NO fill step in this beat\'s own do VALIDATES — a DOOR fork', () => {
  // S7 beat 3's real shape: `over: 'authoring-door'` names no `fill` step in
  // its `do` at all. Ruling (2) — declared and inert, not refused: a door
  // fork is never expanded per case, so it cannot run N cases identically.
  const doorFork = { ...forkBeat, fork: { over: 'create-name', cases: ['a', 'b'] } };
  const s = validateStory({ ...ok, beats: [ok.beats[0], doorFork] });
  assert.deepEqual(s.beats[1].fork, { over: 'create-name', cases: ['a', 'b'] });
});

test('fork.over naming a field only a PRESS step (not a fill) uses VALIDATES — still a DOOR fork', () => {
  const doorFork = {
    ...forkBeat,
    do: [{ press: 'create-app-type' }],
    fork: { over: 'create-app-type', cases: ['a', 'b'] },
  };
  const s = validateStory({ ...ok, beats: [ok.beats[0], doorFork] });
  assert.deepEqual(s.beats[1].fork, { over: 'create-app-type', cases: ['a', 'b'] });
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

test('a fork with empty, duplicate, or non-string cases is refused even when it is a DOOR fork', () => {
  // The malformed-shape refusals are unconditional — they do not depend on
  // whether `over` happens to name a fill step.
  const doorShape = { ...forkBeat, fork: { over: 'authoring-door', cases: [] } };
  assert.throws(() => validateStory({ ...ok, beats: [ok.beats[0], doorShape] }), /beats\[1\]\.fork\.cases/);
  const dupShape = { ...forkBeat, fork: { over: 'authoring-door', cases: ['manual-form', 'manual-form'] } };
  assert.throws(() => validateStory({ ...ok, beats: [ok.beats[0], dupShape] }), /beats\[1\]\.fork\.cases/);
  const nonStringShape = { ...forkBeat, fork: { over: 'authoring-door', cases: ['manual-form', 1] } };
  assert.throws(() => validateStory({ ...ok, beats: [ok.beats[0], nonStringShape] }), /beats\[1\]\.fork\.cases/);
});
