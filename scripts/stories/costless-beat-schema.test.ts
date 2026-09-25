/**
 * costless-beat-schema.test.ts — findings row 61, the validation half.
 *
 * A beat may declare `costless: true` — an assertion that it dispatches
 * nothing at all, enforced at run time by `costlessBeatVerdict`
 * (`spend.mjs`, `costless-beat-verdict.test.ts`). This file pins the SCHEMA
 * half alone: the field is boolean-only, refused otherwise by name (the same
 * fail-closed shape every other beat field in `story-file.mjs` follows), and
 * it survives `validateStory`'s rebuild rather than being dropped like `fork`
 * was before item 1 of this same brief.
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

test('a beat with no costless declaration validates, and carries no costless field', () => {
  const s = validateStory(ok);
  assert.equal(Object.hasOwn(s.beats[0], 'costless'), false);
});

test('costless: true SURVIVES validateStory\'s rebuild', () => {
  const s = validateStory({ ...ok, beats: [{ ...ok.beats[0], costless: true }] });
  assert.equal(s.beats[0].costless, true);
});

test('costless: false also survives — it is a real assertion, not a default', () => {
  const s = validateStory({ ...ok, beats: [{ ...ok.beats[0], costless: false }] });
  assert.equal(s.beats[0].costless, false);
});

test('a non-boolean costless is refused, naming the field', () => {
  // Kills truthiness coercion: `costless: 'true'` is a truthy string, and a
  // validator that coerces would let a typo silently assert the beat is
  // costless when the author meant something else entirely (or nothing).
  for (const bad of ['true', 1, 0, null, {}, []]) {
    assert.throws(
      () => validateStory({ ...ok, beats: [{ ...ok.beats[0], costless: bad }] }),
      /beats\[0\]\.costless/,
      `costless ${JSON.stringify(bad)} must be rejected`,
    );
  }
});
