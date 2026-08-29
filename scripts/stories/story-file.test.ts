/**
 * story-file.test.ts — the story file contract.
 *
 * A story file is EXTERNAL INPUT to the runner: it is authored interactively
 * with the operator (park point H6) in a separate session, by someone who is
 * not looking at this validator. So it is validated at the boundary and fails
 * fast, with the offending field named — an operator who mistypes `docs.kind`
 * must be told which field, not handed a stack trace from three modules away.
 *
 * Pinned before implementation (`_1.0/gate-manifests/M1-B.txt`).
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

test('a well-formed story validates and comes back frozen', () => {
  const s = validateStory(ok);
  assert.equal(s.id, 'smoke');
  assert.equal(s.beats.length, 1);
  assert.ok(Object.isFrozen(s), 'a validated story is frozen so no later stage can edit the gate');
});

test('validateStory returns a copy and never mutates its input', () => {
  const input = structuredClone(ok);
  validateStory(input);
  assert.deepEqual(input, ok);
});

test('an unknown docs.kind is rejected, naming the field', () => {
  // Kills a validator that accepts any string: `kind` selects the output
  // directory (docs/tutorials vs docs/how-to), so an unknown value would
  // silently write the usage doc nowhere anyone reads.
  assert.throws(
    () => validateStory({ ...ok, docs: { kind: 'reference', title: 't' } }),
    /docs\.kind/,
  );
});

test('a beat with no data expectation is rejected, naming the beat index', () => {
  // Kills the vacuous beat: `expect.data` empty means the beat asserts
  // nothing about the page and can never be red. A story of such beats is
  // green by construction — a gate that reports green having not looked.
  assert.throws(
    () => validateStory({ ...ok, beats: [{ act: 'a', expect: { route: '/', data: {} }, say: 's' }] }),
    /beats\[0\]\.expect\.data/,
  );
});

test('a missing ground.budget_usd is rejected — the spend gate cannot default it', () => {
  // Kills `budget_usd ?? 0`. A story that forgot to declare its budget must
  // not be silently treated as costless; that is how an unapproved real spawn
  // reaches the SDK.
  assert.throws(
    () => validateStory({ ...ok, ground: { project: 'mdtoc', realSpawn: false } }),
    /ground\.budget_usd/,
  );
});

test('a negative budget is rejected', () => {
  assert.throws(
    () => validateStory({ ...ok, ground: { project: 'mdtoc', realSpawn: true, budget_usd: -1 } }),
    /ground\.budget_usd/,
  );
});

test('a non-boolean ground.realSpawn is rejected rather than coerced', () => {
  // Kills truthiness coercion: `realSpawn: 'false'` is a truthy string, and a
  // validator that coerces would turn a costless story into a spending one.
  assert.throws(
    () => validateStory({ ...ok, ground: { project: 'mdtoc', realSpawn: 'false', budget_usd: 0 } }),
    /ground\.realSpawn/,
  );
});

test('a route that is not path-absolute is rejected', () => {
  assert.throws(
    () => validateStory({
      ...ok,
      beats: [{ act: 'a', expect: { route: 'projects', data: { x: '1' } }, say: 's' }],
    }),
    /beats\[0\]\.expect\.route/,
  );
});

test('an empty beats array is rejected', () => {
  assert.throws(() => validateStory({ ...ok, beats: [] }), /beats/);
});

test('a beat missing its narration is rejected — the doc fragment needs it', () => {
  // `say` is not decoration: it is the prose of the generated usage doc. A
  // beat without it produces a documentation step with no explanation.
  assert.throws(
    () => validateStory({
      ...ok,
      beats: [{ act: 'a', expect: { route: '/', data: { x: '1' } } }],
    }),
    /beats\[0\]\.say/,
  );
});
