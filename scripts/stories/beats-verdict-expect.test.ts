/**
 * beats-verdict-expect.test.ts — the verdict carries the RAW declared
 * expectations alongside what was observed.
 *
 * forge-8vfn.2.27 (labelling half). The generated how-to doc's "what you
 * should see" list renders `verdict.data`, which today is ONLY what the page
 * showed (`{ ...observed.data, ...seen }` — see `beats.mjs`). A value the
 * story declared as a placeholder (`'<name>'`) is environment-derived — it
 * will differ on every run — and a doc reader (or an agent diffing two
 * generated docs) needs to be told that BEFORE it can tell that apart from
 * drift. Telling them requires knowing which key was DECLARED as a
 * placeholder, which `verdict.data` alone cannot answer: it only carries the
 * bound value, not the `<name>` it was bound as.
 *
 * New file: `beats.test.ts` is not itself forbidden, but the brief's "new
 * tests go in new test files" applies to every item, so this stays separate
 * from the existing pinned acceptance suite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beatVerdict } from './beats.mjs';

const beat = {
  act: 'Create a project',
  say: 'A new project is onboarded.',
  expect: { route: '/projects/new', data: { page: 'projects', 'onboard-session-id': '<sessionId>' } },
};

test('the verdict carries the raw expect.data it was judged against, not only the observed values', () => {
  const v = beatVerdict(beat, { route: '/projects/new', data: { page: 'projects', 'onboard-session-id': 'onb-7f3c1a' } });
  assert.equal(v.expect.page, 'projects');
  assert.equal(v.expect['onboard-session-id'], '<sessionId>', 'the RAW placeholder text, not the bound value');
});

test('a plain (non-placeholder) declared value is carried through unchanged', () => {
  const plainBeat = { act: 'a', say: 's', expect: { route: '/x', data: { page: 'home' } } };
  const v = beatVerdict(plainBeat, { route: '/x', data: { page: 'home' } });
  assert.equal(v.expect.page, 'home');
});
