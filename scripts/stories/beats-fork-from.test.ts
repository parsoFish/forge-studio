/**
 * beats-fork-from.test.ts — forge-8vfn.8.5.14, the fix for a MEASURED defect.
 *
 * S2 (`tests/stories/S2.story.mjs`) forks beat 3 over three starters, with
 * beats 1-2 as ENTRY beats (open the Projects pillar, press "new project" ->
 * `/projects/new`) that reach the fork's own page. `expandForkedBeats`'s
 * whole-remainder expansion (T1 ruling 1350) emitted `[fork beat, …later
 * beats]` once per case starting AT the fork beat and never re-emitted the
 * entry beats for any case after the first — so a real run's case 2
 * ("cli") began on case 1's ("api") leftover page, the plan gate
 * `/artifact?run=…`, where `[data-field="create-name"]` does not exist, and
 * every later beat of that case cascaded red.
 *
 * THE FIX. A fill fork declares `fork.from: <beat number>` naming where its
 * own entry beats begin. For every case AFTER THE FIRST, `expandForkedBeats`
 * re-emits beats `from..forkBeat-1` — unchanged, ground-substituted exactly
 * like the remainder beats are, labelled `${n}[${case}]` under their OWN
 * original numbers — immediately before that case's own fork-beat-and-
 * remainder. The FIRST case never re-emits them: the plain walk already ran
 * beats `1..forkBeat-1` once, before this loop ever reached the fork.
 *
 * `story-file.mjs`'s `validateFork` enforces the declaration: `from` must be
 * an integer `1..<this beat's own number>`; a FILL fork on a beat numbered
 * above 1 with NO `from` is refused at load (the S2 hazard, caught at
 * authoring rather than by a funded run); `from` on a DOOR fork is refused
 * (one case, once — nothing to replay); a fill fork on beat 1 needs no
 * `from` (nothing precedes it).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandForkedBeats } from './beats-fork.mjs';
import { validateStory } from './story-file.mjs';
import S2 from '../../tests/stories/S2.story.mjs';
import S7 from '../../tests/stories/S7.story.mjs';

// ─────────────────────────────────────────────────── expandForkedBeats + from

/** Beat 1 — an entry beat with nothing to say about the project yet. */
const entry1 = Object.freeze({
  act: 'Open Studio on the Projects pillar',
  do: Object.freeze([]),
  expect: Object.freeze({ route: '/projects', data: Object.freeze({ page: 'projects-index' }) }),
  say: 's',
});

/**
 * Beat 2 — the OTHER entry beat. Carries a `fill` whose `with` is an EXACT,
 * case-insensitive match for the ground project, purely to prove the claim
 * the brief makes: a re-emitted entry beat is ground-substituted exactly
 * like a remainder beat is. Nothing in S2 itself happens to fill the project
 * name this early; this is a synthetic probe of the mechanism, not a claim
 * about S2's own beat 2.
 */
const entry2 = Object.freeze({
  act: 'Press "new project"',
  do: Object.freeze([
    Object.freeze({ fill: 'remembered-project', with: 'story-PROOF' }),
    Object.freeze({ press: 'create-project-cta' }),
  ]),
  expect: Object.freeze({ route: '/projects/new', data: Object.freeze({ page: 'projects', section: 'project-create' }) }),
  say: 's',
});

/** Beat 3 — the fill fork, `from: 1` naming where the entry beats begin. */
const forkBeat = Object.freeze({
  act: 'Name it, pick a starter, and press "Create project"',
  do: Object.freeze([
    Object.freeze({ fill: 'create-name', with: 'story-PROOF' }),
    Object.freeze({ fill: 'create-app-type', with: 'cli' }),
    Object.freeze({ press: 'create-project' }),
  ]),
  expect: Object.freeze({ route: '/projects/story-proof', data: Object.freeze({ 'project-id': 'story-proof' }) }),
  say: 's',
  fork: Object.freeze({ over: 'create-app-type', cases: Object.freeze(['a', 'b', 'c']), from: 1 }),
});

/** Beat 4 — a remainder beat that references the project, forcing wholeRemainder. */
const tailBeat = Object.freeze({
  act: 'Check readiness',
  do: Object.freeze([]),
  expect: Object.freeze({
    route: '/projects/story-proof',
    data: Object.freeze({ 'project-id': 'story-proof', 'flow-ready': 'true' }),
  }),
  say: 's',
});

test('expandForkedBeats: a fill fork with `from` re-emits the entry beats before every case AFTER THE FIRST', () => {
  const out = expandForkedBeats([entry1, entry2, forkBeat, tailBeat], 'story-proof');
  assert.deepEqual(
    out.map((e) => e.label),
    [
      '1', '2',
      '3[a]', '4[a]',
      '1[b]', '2[b]', '3[b]', '4[b]',
      '1[c]', '2[c]', '3[c]', '4[c]',
    ],
    'case "a" (the first) never re-emits beats 1-2; cases "b" and "c" each do, before their own fork beat and remainder',
  );
  assert.deepEqual(out.map((e) => e.number), [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]);
});

test('expandForkedBeats: a re-emitted entry beat is GROUND-SUBSTITUTED exactly like a remainder beat is', () => {
  const out = expandForkedBeats([entry1, entry2, forkBeat, tailBeat], 'story-proof');
  const entry2ForB = out.find((e) => e.label === '2[b]');
  assert.equal(
    entry2ForB.beat.do[0].with,
    'story-proof-b',
    'a fill step naming the base project, case-insensitively, moves to the per-case ground on replay',
  );
  const entry2ForC = out.find((e) => e.label === '2[c]');
  assert.equal(entry2ForC.beat.do[0].with, 'story-proof-c');
});

test('expandForkedBeats: the FIRST case\'s own beats are the plain, unreplayed ones (no "[a]" on beats 1-2)', () => {
  const out = expandForkedBeats([entry1, entry2, forkBeat, tailBeat], 'story-proof');
  assert.deepEqual(out[0].beat, entry1);
  assert.equal(out[1].beat.do[0].with, 'story-PROOF', 'beat 2 ran ONCE, plainly, untouched by any case substitution');
});

test('expandForkedBeats: with no `from`, nothing is replayed (beat-1 fork, or an ungrounded call)', () => {
  const beatOneFork = Object.freeze({ ...forkBeat, fork: Object.freeze({ over: 'create-app-type', cases: Object.freeze(['a', 'b']) }) });
  const out = expandForkedBeats([beatOneFork, tailBeat], 'story-proof');
  assert.deepEqual(out.map((e) => e.label), ['1[a]', '2[a]', '1[b]', '2[b]']);
});

// ──────────────────────────────────────────────────────────────── validation

const okStory = {
  id: 'smoke',
  ground: { project: 'story-proof', realSpawn: false, budget_usd: 0 },
  docs: { kind: 'how-to', title: 'Probe' },
  beats: [entry1, entry2],
};

/** A 3-beat story: two plain entry beats, then a fill fork at beat 3. */
function withForkAtBeat3(fork) {
  return {
    ...okStory,
    beats: [entry1, entry2, { ...forkBeat, fork }],
  };
}

test('validateStory: a fill fork on beat 3 with NO `from` is refused, naming the beat', () => {
  assert.throws(
    () => validateStory(withForkAtBeat3({ over: 'create-app-type', cases: ['a', 'b', 'c'] })),
    /beats\[2\]\.fork.*beat 3 is a fill fork and declares no 'from'.*re-run the beats/s,
  );
});

test('validateStory: `from` must be an integer within 1..<this beat\'s own number>', () => {
  for (const bad of [0, 4, 1.5, '1', -1]) {
    assert.throws(
      () => validateStory(withForkAtBeat3({ over: 'create-app-type', cases: ['a', 'b', 'c'], from: bad })),
      /beats\[2\]\.fork\.from/,
      `from: ${JSON.stringify(bad)} must be refused`,
    );
  }
});

test('validateStory: `from` on a DOOR fork is refused — one case, once, nothing to replay', () => {
  assert.throws(
    () => validateStory(withForkAtBeat3({ over: 'authoring-door', cases: ['a', 'b'], from: 1 })),
    /beats\[2\]\.fork\.from.*door fork.*nothing to replay/s,
  );
});

test('validateStory: a fill fork on BEAT 1 needs no `from`', () => {
  const story = {
    ...okStory,
    beats: [{ ...forkBeat, fork: { over: 'create-app-type', cases: ['a', 'b'] } }, tailBeat],
  };
  const s = validateStory(story);
  assert.equal(Object.hasOwn(s.beats[0].fork, 'from'), false);
});

test('validateStory: a fill fork on beat 1 declaring `from: 1` validates (it is already the minimum)', () => {
  const story = {
    ...okStory,
    beats: [{ ...forkBeat, fork: { over: 'create-app-type', cases: ['a', 'b'], from: 1 } }, tailBeat],
  };
  const s = validateStory(story);
  assert.equal(s.beats[0].fork.from, 1);
});

test('validateStory: a well-formed `from` validates and SURVIVES the rebuild', () => {
  const s = validateStory(withForkAtBeat3({ over: 'create-app-type', cases: ['a', 'b', 'c'], from: 1 }));
  assert.deepEqual(s.beats[2].fork, { over: 'create-app-type', cases: ['a', 'b', 'c'], from: 1 });
  assert.ok(Object.isFrozen(s.beats[2].fork));
});

test('validateStory: the real S2 story (fork `from: 1` on beat 3) validates', () => {
  const s = validateStory(S2);
  assert.equal(s.beats[2].fork.from, 1);
  assert.equal(s.beats[2].fork.over, 'create-app-type');
});

test('validateStory: the real S7 story (door fork on beat 3, no `from`) validates unchanged', () => {
  const s = validateStory(S7);
  assert.equal(Object.hasOwn(s.beats[2].fork, 'from'), false);
  assert.equal(s.beats[2].fork.over, 'authoring-door');
});
