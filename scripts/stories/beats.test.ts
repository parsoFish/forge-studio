/**
 * beats.test.ts — the story runner's per-beat verdict.
 *
 * These are ACCEPTANCE tests, pinned before the implementation
 * (`_1.0/gate-manifests/M1-B.txt`). Each one names the wrong implementation it
 * kills, because a test that would look identical had the implementation been
 * wrong is characterization, not acceptance.
 *
 * The defect class every case here exists to make impossible: a beat that
 * cannot find the state it asserted reporting green anyway. That is the
 * `declared-data-fails-open` family — a value parsed and surfaced but enforced
 * nowhere — and it is the single most-repeated finding of the wave-4 and
 * wave-8 campaigns. A story is a gate; a gate that reports green having not
 * looked is worse than no gate at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beatVerdict } from './beats.mjs';

const beat = {
  act: 'Click through to the Projects pillar',
  expect: { route: '/projects', data: { 'page-ready': 'true', 'project-count': '3' } },
  say: 'The Projects pillar lists every project forge manages.',
};

test('a beat whose route and every data-* expectation hold is green', () => {
  const v = beatVerdict(beat, { route: '/projects', data: { 'page-ready': 'true', 'project-count': '3' } });
  assert.equal(v.status, 'green');
  assert.deepEqual(v.failures, []);
});

test('a beat whose data-* expectation FAILS returns a red verdict naming the attribute and both values', () => {
  // Kills: a verdict that compares nothing, or reports the mismatch without
  // saying which attribute or what it expected — an operator reading the run
  // must not have to re-run it to find out what broke.
  const v = beatVerdict(beat, { route: '/projects', data: { 'page-ready': 'true', 'project-count': '0' } });
  assert.equal(v.status, 'red');
  assert.equal(v.failures.length, 1);
  assert.match(v.failures[0], /project-count/);
  assert.match(v.failures[0], /expected "3"/);
  assert.match(v.failures[0], /got "0"/);
});

test('a MISSING data-* attribute is red and says absent — never treated as a pass', () => {
  // Kills the fail-open implementation: `if (observed[k] && observed[k] !== want)`,
  // which lets an attribute the UI never rendered slip through as green. This is
  // the exact shape of M0's merge-gate `catch -> return { ok: true }` and of
  // M1-D's brain lint reporting 0 errors having skipped Brain 3 entirely.
  const v = beatVerdict(beat, { route: '/projects', data: { 'page-ready': 'true' } });
  assert.equal(v.status, 'red');
  assert.equal(v.failures.length, 1);
  assert.match(v.failures[0], /project-count/);
  assert.match(v.failures[0], /absent/);
});

test('an empty observation is red on every expectation, not silently green', () => {
  // Kills: a verdict that iterates the OBSERVED keys instead of the EXPECTED
  // ones. That implementation passes all of the above and still reports green
  // for a page that rendered nothing at all.
  const v = beatVerdict(beat, { route: '/projects', data: {} });
  assert.equal(v.status, 'red');
  assert.equal(v.failures.length, 2);
});

test('landing on the wrong route is red even when every data-* matches', () => {
  // Kills a verdict that checks only attributes: real nav can land somewhere
  // unintended while the asserted attributes happen to exist on that page too.
  const v = beatVerdict(beat, { route: '/', data: { 'page-ready': 'true', 'project-count': '3' } });
  assert.equal(v.status, 'red');
  assert.match(v.failures.join(' '), /route/);
  assert.match(v.failures.join(' '), /\/projects/);
});

test('every failed expectation is reported, not just the first', () => {
  // Kills a short-circuiting verdict. An operator must see the whole truth of
  // one run, not discover the next broken expectation one re-run at a time.
  const v = beatVerdict(beat, { route: '/', data: {} });
  assert.equal(v.failures.length, 3);
});

test('the verdict carries the narration and act forward for the doc fragment', () => {
  // The triple output (verdict, clip, doc) comes from ONE script; the doc
  // fragment reads these fields off the verdict, so they must survive it.
  const v = beatVerdict(beat, { route: '/projects', data: { 'page-ready': 'true', 'project-count': '3' } });
  assert.equal(v.act, beat.act);
  assert.equal(v.say, beat.say);
});

test('the verdict is frozen and does not mutate the beat it judged', () => {
  const input = structuredClone(beat);
  const v = beatVerdict(input, { route: '/x', data: {} });
  assert.ok(Object.isFrozen(v));
  assert.deepEqual(input, beat);
});
