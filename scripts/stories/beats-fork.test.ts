/**
 * beats-fork.test.ts — forge-8vfn.2.22 (PR-B item 1), the runner half.
 *
 * `expandForkedBeats` flattens `story.beats` into the sequence the runner
 * actually drives: one entry per case for a beat that forked, one entry for
 * every other beat. Each entry carries the ORIGINAL 1-indexed beat number
 * (ground-licensing — `ground.expectedChanges[].beat` — is declared against
 * that number, never against a flattened position) and a display LABEL:
 * `"3"` for an ordinary beat, `"3[api]"` for a case, matching the brief's own
 * example (`3` → `3[typescript-api]`).
 *
 * WHAT THIS DOES NOT DO, on purpose — S2's own comments (lines ~59–90) and
 * the state each case leaves. S2's fork creates a project named
 * `ground.project` ("story-s2") EVERY case, so a second case's own
 * `create-project` press would meet the first case's leftover repo — the same
 * 409-already-exists shape S1's onboarding form hits, for a different reason.
 * Per-case ground reset between cases is not something this harness owns
 * anywhere today (`sweepProductFixtures` runs ONCE, at the end of the WHOLE
 * run) and this module does not invent one: it substitutes the case into the
 * beat and hands the result to the SAME driver every other beat gets, running
 * every case against the SAME shared ground. A story whose cases collide on
 * shared state reds honestly, on the product's own conflict — reported as a
 * finding, not silently made to pass by a cleanup step nobody asked this bead
 * to build.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandForkedBeats, substituteForkCase } from './beats-fork.mjs';

const plainBeat = Object.freeze({
  act: 'Open Studio on Home',
  do: Object.freeze([]),
  expect: Object.freeze({ route: '/', data: Object.freeze({ 'page-ready': 'true' }) }),
  say: 'Studio opens on Home.',
});

const forkedBeat = Object.freeze({
  act: 'Pick a starter',
  do: Object.freeze([
    Object.freeze({ fill: 'create-name', with: 'story-S2' }),
    Object.freeze({ fill: 'create-app-type', with: 'cli' }),
    Object.freeze({ press: 'create-project' }),
  ]),
  expect: Object.freeze({ route: '/projects/story-s2', data: Object.freeze({ 'page-ready': 'true' }) }),
  say: 's',
  fork: Object.freeze({ over: 'create-app-type', cases: Object.freeze(['api', 'cli', 'webapp']) }),
});

// ─────────────────────────────────────────────────────────── substituteForkCase

test('substituteForkCase replaces ONLY the named fill step\'s `with`, and drops `fork`', () => {
  const out = substituteForkCase(forkedBeat, 'webapp');
  assert.equal(Object.hasOwn(out, 'fork'), false, 'a substituted beat carries no fork — the runner drives it like any other');
  assert.deepEqual(out.do[0], { fill: 'create-name', with: 'story-S2' }, 'an unrelated fill step is untouched');
  assert.deepEqual(out.do[1], { fill: 'create-app-type', with: 'webapp' }, 'the named fill step now carries the CASE');
  assert.deepEqual(out.do[2], { press: 'create-project' }, 'a non-fill step is untouched');
});

test('substituteForkCase never mutates the beat it was given', () => {
  const before = JSON.stringify(forkedBeat);
  substituteForkCase(forkedBeat, 'api');
  assert.equal(JSON.stringify(forkedBeat), before);
});

test('substituteForkCase preserves every other field — costless, expect, say, act', () => {
  const withCostless = Object.freeze({ ...forkedBeat, costless: true });
  const out = substituteForkCase(withCostless, 'api');
  assert.equal(out.costless, true);
  assert.equal(out.expect.route, '/projects/story-s2');
  assert.equal(out.say, 's');
  assert.equal(out.act, 'Pick a starter');
});

// ────────────────────────────────────────────────────────────── expandForkedBeats

test('a story with no fork expands to one entry per beat, numbered and labelled plainly', () => {
  const out = expandForkedBeats([plainBeat, plainBeat]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((e) => [e.number, e.label]), [[1, '1'], [2, '2']]);
  assert.equal(out[0].beat, plainBeat, 'an unforked beat passes through UNCHANGED, not a copy');
});

test('a forked beat expands to one entry PER CASE, each labelled "<number>[<case>]"', () => {
  const out = expandForkedBeats([plainBeat, forkedBeat]);
  assert.equal(out.length, 4, 'plainBeat (1) + three cases of the forked beat (2)');
  assert.deepEqual(
    out.map((e) => [e.number, e.label]),
    [[1, '1'], [2, '2[api]'], [2, '2[cli]'], [2, '2[webapp]']],
    'the ORIGINAL beat number (2) is shared by every case; the label carries the case',
  );
  assert.deepEqual(out[2].beat.do[1], { fill: 'create-app-type', with: 'cli' }, 'each case entry carries its OWN substituted beat');
});

test('a forked beat mid-story keeps every OTHER beat\'s number and label exactly as before', () => {
  const out = expandForkedBeats([plainBeat, forkedBeat, plainBeat]);
  assert.deepEqual(out.map((e) => e.number), [1, 2, 2, 2, 3]);
  assert.deepEqual(out.map((e) => e.label), ['1', '2[api]', '2[cli]', '2[webapp]', '3']);
});

test('cases are expanded in DECLARED ORDER, not sorted or reordered', () => {
  const reordered = Object.freeze({
    ...forkedBeat,
    fork: Object.freeze({ over: 'create-app-type', cases: Object.freeze(['webapp', 'api', 'cli']) }),
  });
  const out = expandForkedBeats([reordered]);
  assert.deepEqual(out.map((e) => e.label), ['1[webapp]', '1[api]', '1[cli]']);
});

// ────────────────────────────────────────────────────────────────── door forks

// T1 ruling 1350 — S7 beat 3's real shape: `over: 'authoring-door'` names no
// `fill` step in this beat's own `do`. A door fork is DECLARED and INERT: the
// runner performs the beat ONCE, unexpanded, never once per case.
const doorForkedBeat = Object.freeze({
  act: 'Describe the skill to the creation agent',
  do: Object.freeze([
    Object.freeze({ fill: 'authoring-launcher-project', with: 'mdtoc' }),
    Object.freeze({ press: 'start-authoring' }),
  ]),
  expect: Object.freeze({ route: '/skills/new', data: Object.freeze({ 'minted-session-id': '<authoringSessionId>' }) }),
  say: 's',
  fork: Object.freeze({ over: 'authoring-door', cases: Object.freeze(['creation-agent', 'manual-form']) }),
});

test('a DOOR fork expands to exactly ONE entry — declared, not driven per case', () => {
  const out = expandForkedBeats([plainBeat, doorForkedBeat, plainBeat]);
  assert.equal(out.length, 3, 'the door fork contributes ONE entry, not one per case');
  assert.deepEqual(out.map((e) => [e.number, e.label]), [[1, '1'], [2, '2'], [3, '3']]);
});

test('a DOOR fork\'s single entry carries the fork undisturbed, for the runner to report', () => {
  const out = expandForkedBeats([doorForkedBeat]);
  assert.equal(out.length, 1);
  assert.equal(out[0].beat, doorForkedBeat, 'passed through UNCHANGED, exactly like an unforked beat');
  assert.deepEqual(out[0].doorFork, { over: 'authoring-door', cases: ['creation-agent', 'manual-form'] });
});
