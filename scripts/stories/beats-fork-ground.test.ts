/**
 * beats-fork-ground.test.ts — T1 ruling 1350, ruling (1): fill forks run every
 * case, each on its own ground.
 *
 * A FILL fork's `over` names a `fill` step in its own beat's `do` (S2 beat 3:
 * `create-app-type`). Today `expandForkedBeats` runs every case against the
 * SAME `ground.project` (`beats-fork.mjs`'s own header used to say so, and
 * S2's own comments recorded the collision as an accepted gap). This closes
 * it: case `c` of a fill fork over `ground.project = 'story-<id>'` runs
 * against `story-<id>-<c>` — substituted EXACTLY where the story's project id
 * appears (a whole route segment, a whole `expect.data` value, a whole `fill`
 * step's `with`), never as a substring of longer text. That is "by
 * construction" rather than a text replace: a route's OTHER segments, or a
 * `do` step's unrelated prose (`--exclude-author <pattern>`, `fork-schema`'s
 * own worked example of the class), are never touched because they are never
 * an EXACT, case-insensitive match for the project id.
 *
 * THE WHOLE-REMAINDER DECISION, read from S2 itself. Beats 4-8 of S2 assert
 * `project-id: 'story-s2'` and route `/projects/story-s2` — literal, on the
 * ALREADY-VALIDATED story, so they cannot be "made per-case" by leaving them
 * alone: if only beat 3 forked, the three cases would each mint a DIFFERENT
 * per-case ground and then all three would run beats 4-13 exactly once,
 * standing on whichever case ran last. So a fill fork whose remainder
 * references the ground project expands the WHOLE remainder — beat 3 through
 * the story's last beat — once per case; a fill fork whose remainder never
 * mentions the project (tested here with a synthetic story, since neither S2
 * nor S7 is that shape) forks only its own beat, exactly as before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStory } from './story-file.mjs';
import {
  expandForkedBeats,
  substituteForkCase,
  substituteGroundProject,
  isFillFork,
  describeDoorFork,
} from './beats-fork.mjs';
import S2 from '../../tests/stories/S2.story.mjs';
import S7 from '../../tests/stories/S7.story.mjs';

// ─────────────────────────────────────────────────────────── substituteGroundProject

const beat = Object.freeze({
  act: 'Check the project is ready',
  do: Object.freeze([
    Object.freeze({ fill: 'create-name', with: 'story-S2' }),
    Object.freeze({ fill: 'idea', with: 'Ship a --project story-s2 style flag, unrelated to the ground' }),
  ]),
  expect: Object.freeze({
    route: '/projects/story-s2',
    data: Object.freeze({ page: 'projects', 'project-id': 'story-s2', 'flow-ready': 'true' }),
  }),
  say: 's',
});

test('substituteGroundProject replaces a route segment that IS the project, exactly', () => {
  const out = substituteGroundProject(beat, 'story-s2', 'story-s2-api');
  assert.equal(out.expect.route, '/projects/story-s2-api');
});

test('substituteGroundProject replaces an expect.data value that IS the project, exactly', () => {
  const out = substituteGroundProject(beat, 'story-s2', 'story-s2-api');
  assert.equal(out.expect.data['project-id'], 'story-s2-api');
  assert.equal(out.expect.data['flow-ready'], 'true', 'an unrelated value is untouched');
});

test('substituteGroundProject matches a fill\'s `with` CASE-INSENSITIVELY — the pre-slug typed name', () => {
  // The operator types 'story-S2' and forge lower-cases it to 'story-s2'
  // (S2's own header comment). So the fill that MINTS the ground must also
  // move to the per-case id, or every case collides on the SAME slug.
  const out = substituteGroundProject(beat, 'story-s2', 'story-s2-api');
  assert.equal(out.do[0].with, 'story-s2-api');
});

test('substituteGroundProject NEVER touches a partial match inside longer text', () => {
  // The exact hazard `story-file.mjs`'s own placeholder-scan comment names:
  // `--exclude-author <pattern>` is CLI syntax, not a placeholder, and this is
  // that same class — 'story-s2' sits inside a sentence, not as a whole value.
  const out = substituteGroundProject(beat, 'story-s2', 'story-s2-api');
  assert.equal(out.do[1].with, 'Ship a --project story-s2 style flag, unrelated to the ground');
});

test('substituteGroundProject never mutates its input', () => {
  const before = JSON.stringify(beat);
  substituteGroundProject(beat, 'story-s2', 'story-s2-api');
  assert.equal(JSON.stringify(beat), before);
});

test('substituteGroundProject is a no-op when the beat names no occurrence of the project', () => {
  const untouched = Object.freeze({
    act: 'Open Monitor',
    do: Object.freeze([]),
    expect: Object.freeze({ route: '/monitor', data: Object.freeze({ page: 'monitor' }) }),
    say: 's',
  });
  const out = substituteGroundProject(untouched, 'story-s2', 'story-s2-api');
  assert.deepEqual(out.expect, untouched.expect);
});

// ────────────────────────────────────────────────────────────────── isFillFork

test('isFillFork is true when over names a fill step in the beat\'s own do', () => {
  const fillForkBeat = { ...beat, fork: { over: 'create-name', cases: ['a', 'b'] } };
  assert.equal(isFillFork(fillForkBeat), true);
});

test('isFillFork is false when over names no fill step — a door fork', () => {
  const doorForkBeat = { ...beat, fork: { over: 'authoring-door', cases: ['a', 'b'] } };
  assert.equal(isFillFork(doorForkBeat), false);
});

test('isFillFork is false when the beat carries no fork at all', () => {
  assert.equal(isFillFork(beat), false);
});

// ──────────────────────────────────────────────── expandForkedBeats + groundProject

const fillForkBeat = Object.freeze({
  act: 'Name it and create the project',
  do: Object.freeze([
    Object.freeze({ fill: 'create-name', with: 'story-PROOF' }),
    Object.freeze({ fill: 'create-app-type', with: 'cli' }),
    Object.freeze({ press: 'create-project' }),
  ]),
  expect: Object.freeze({
    route: '/projects/story-proof',
    data: Object.freeze({ page: 'projects', 'project-id': 'story-proof' }),
  }),
  say: 's',
  fork: Object.freeze({ over: 'create-app-type', cases: Object.freeze(['api', 'cli']) }),
});

test('CLEAN: a fill fork whose remainder never mentions the project forks only ITS OWN beat', () => {
  const laterUnrelated = Object.freeze({
    act: 'Check Monitor',
    do: Object.freeze([]),
    expect: Object.freeze({ route: '/monitor', data: Object.freeze({ page: 'monitor' }) }),
    say: 's',
  });
  const out = expandForkedBeats([fillForkBeat, laterUnrelated], 'story-proof');
  // TWO cases of the fork beat, plus ONE pass of the unrelated later beat —
  // never doubled or tripled just because a fork happened earlier.
  assert.deepEqual(out.map((e) => e.label), ['1[api]', '1[cli]', '2']);
  assert.equal(out[0].beat.expect.route, '/projects/story-proof-api');
  assert.equal(out[1].beat.expect.route, '/projects/story-proof-cli');
  assert.equal(out[2].beat, laterUnrelated, 'untouched — passed through unchanged, exactly like an unforked beat');
});

test('WHOLE REMAINDER: a fill fork whose remainder DOES assert on the project expands every later beat too', () => {
  const laterAssertsProject = Object.freeze({
    act: 'Check readiness',
    do: Object.freeze([]),
    expect: Object.freeze({ route: '/projects/story-proof', data: Object.freeze({ 'project-id': 'story-proof', 'flow-ready': 'true' }) }),
    say: 's',
  });
  const out = expandForkedBeats([fillForkBeat, laterAssertsProject], 'story-proof');
  assert.deepEqual(out.map((e) => [e.number, e.label]), [
    [1, '1[api]'], [2, '2[api]'],
    [1, '1[cli]'], [2, '2[cli]'],
  ], 'the WHOLE remainder — beat 1 through beat 2 — runs once per case, each fully substituted');
  assert.equal(out[0].beat.expect.route, '/projects/story-proof-api');
  assert.equal(out[1].beat.expect.data['project-id'], 'story-proof-api', 'the LATER beat is substituted too');
  assert.equal(out[2].beat.expect.route, '/projects/story-proof-cli');
  assert.equal(out[3].beat.expect.data['project-id'], 'story-proof-cli');
});

test('a story with no fork is unaffected by passing groundProject', () => {
  const plain = Object.freeze({
    act: 'Open Home', do: Object.freeze([]),
    expect: Object.freeze({ route: '/', data: Object.freeze({ page: 'home' }) }), say: 's',
  });
  const out = expandForkedBeats([plain], 'story-proof');
  assert.equal(out[0].beat, plain);
});

test('expandForkedBeats with no groundProject given behaves exactly as the ungrounded call (backward compatible)', () => {
  const withGround = expandForkedBeats([fillForkBeat]);
  assert.deepEqual(withGround.map((e) => e.label), ['1[api]', '1[cli]']);
  // No substitution at all when groundProject is not supplied — same shape
  // `substituteForkCase` alone would have produced.
  assert.equal(withGround[0].beat.expect.route, '/projects/story-proof', 'unsubstituted: no groundProject means no ground rewrite');
  assert.deepEqual(withGround[0].beat, substituteForkCase(fillForkBeat, 'api'));
});

// ────────────────────────────────────────────────────────────────── describeDoorFork

test('describeDoorFork names the field and every case, and says ONCE that it is declared not driven', () => {
  const line = describeDoorFork({ over: 'authoring-door', cases: ['creation-agent', 'manual-form'] });
  assert.match(line, /authoring-door/);
  assert.match(line, /creation-agent/);
  assert.match(line, /manual-form/);
  assert.match(line, /declared/i);
  assert.match(line, /not driven|once/i);
});

// ───────────────────────────────────────────────────────── real S2 / S7 end to end

test('S2: the pinned fill fork (beat 3) expands its WHOLE remainder once per starter, on its own ground', () => {
  const story = validateStory(S2);
  const out = expandForkedBeats(story.beats, story.ground.project);
  // 13 beats; the fork sits at beat 3 (index 2) and its remainder is beats
  // 3-13 (11 beats), run 3 times — one per STARTER — plus beats 1-2 run once.
  assert.equal(story.beats.length, 13);
  assert.equal(out.length, 2 + 11 * 3, `expected 2 + 11*3 = 35 expanded entries, got ${out.length}`);
  const labels = out.map((e) => e.label);
  assert.deepEqual(labels.slice(0, 2), ['1', '2']);
  assert.deepEqual(
    labels.slice(2, 13),
    ['3[api]', '4[api]', '5[api]', '6[api]', '7[api]', '8[api]', '9[api]', '10[api]', '11[api]', '12[api]', '13[api]'],
  );
  assert.deepEqual(
    labels.slice(13, 24).map((l) => l.split('[')[0]),
    ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'],
    'the SECOND case (cli) repeats the same original beat numbers',
  );
  assert.ok(labels.slice(13, 24).every((l) => l.endsWith('[cli]')));
  assert.ok(labels.slice(24, 35).every((l) => l.endsWith('[webapp]')));
  // Every case's own ground is per-case, and every later beat's literal
  // reference to it moved too.
  const apiEntries = out.slice(2, 13);
  assert.equal(apiEntries[0].beat.expect.route, '/projects/story-s2-api');
  assert.equal(apiEntries[1].beat.expect.data['project-id'], 'story-s2-api', 'beat 4 (readiness) follows the fork\'s own case');
  const cliEntries = out.slice(13, 24);
  assert.equal(cliEntries[0].beat.expect.route, '/projects/story-s2-cli');
  assert.equal(cliEntries[1].beat.expect.data['project-id'], 'story-s2-cli');
});

test('S7: the pinned door fork (beat 3) loads and drives exactly like an unforked story — one entry per beat', () => {
  // The beat COUNT is read from the story, never hardcoded: S7 grows beats
  // independently of this fork work, and the property pinned here is the
  // RATIO — a door fork contributes exactly one entry, whatever the story's
  // own length is — not a specific number a future amendment would stale again.
  const story = validateStory(S7);
  const out = expandForkedBeats(story.beats, story.ground.project);
  assert.equal(out.length, story.beats.length, 'a door fork contributes ONE entry — S7\'s beat count is unchanged by forking at all');
  assert.deepEqual(out.map((e) => e.label), story.beats.map((_, i) => String(i + 1)));
  const forkEntry = out[2];
  assert.deepEqual(forkEntry.doorFork, { over: 'authoring-door', cases: ['creation-agent', 'manual-form'] });
  assert.equal(forkEntry.beat, story.beats[2], 'the door-forked beat passes through UNCHANGED');
});
