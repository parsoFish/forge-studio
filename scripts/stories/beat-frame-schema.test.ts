/**
 * beat-frame-schema.test.ts — D-42 (amended under D-46, R44), the validation half.
 *
 * A story frame captures the viewport. A beat that needs the whole page declares
 * `frame: 'fullPage'`. The field is optional, accepts only that one string,
 * fails closed by name on anything else, and survives `validateStory`'s rebuild
 * (the 7.6.82 rule: validated and not carried through is validated-and-discarded).
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

test('a beat with no frame declaration validates, and carries no frame field', () => {
  const s = validateStory(ok);
  assert.equal(Object.hasOwn(s.beats[0], 'frame'), false);
});

test("frame: 'fullPage' SURVIVES validateStory's rebuild", () => {
  const s = validateStory({ ...ok, beats: [{ ...ok.beats[0], frame: 'fullPage' }] });
  assert.equal(s.beats[0].frame, 'fullPage');
});

test('any other frame value is refused, naming the field', () => {
  for (const bad of ['viewport', 'FullPage', '', true, false, 1, null, {}, ['fullPage']]) {
    assert.throws(
      () => validateStory({ ...ok, beats: [{ ...ok.beats[0], frame: bad }] }),
      /beats\[0\]\.frame/,
      `frame ${JSON.stringify(bad)} must be rejected`,
    );
  }
});
