/**
 * beats-interview-concluded.test.ts — row 160 (bead `forge-8vfn.8.1.48`,
 * ruling 1891): S10 beat 4's repeat waited its whole 1 080 000 ms bound on
 * run 41, whose architect asked NO questions at all and went straight from
 * `interviewing` to `exploring`. `[data-field="question-freetext"]` never
 * rendered, and the beat's `until` — `{ 'session-phase': 'awaiting-verdict' }`
 * — could not tell "0 rounds, already concluded" from "standing on the wrong
 * page": it just kept polling for a control that was never coming.
 *
 * THE FIX (same PR, `SessionArchitectPanel.tsx` / `architect-hex.ts`) adds a
 * POSITIVE signal — `data-interview-state="asking"|"concluded"` — and moves
 * beat 4's `until` onto it. `runRepeatStep` (`beats-repeat.mjs`) is UNCHANGED:
 * it already checks `until` before ever polling for the gate, so naming the
 * right key is the whole fix. This file asserts the REAL S10 story, through
 * the REAL parser, and reproduces run 41's shape against both the retired
 * `until` (to show it would have hung) and the real one (to show it no
 * longer does).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateStory } from './story-file.mjs';
import { performStepsForTest } from './beats-steps.mjs';

async function loadBeat4() {
  const story = (await import('../../tests/stories/S10.story.mjs')).default;
  const beats = validateStory(story).beats;
  const beat4 = beats.find((b: any) => b.act === "Open the session and answer the Architect's questions");
  assert.notEqual(beat4, undefined, 'beat 4 must exist');
  return beat4;
}

/** Reads whichever of the two keys a test cares about off `page.state`. */
const matcher = (page: any) => async (spec: Record<string, string>) =>
  Object.entries(spec).every(([k, v]) => {
    if (k === 'session-phase') return page.state.phase === v;
    if (k === 'interview-state') return page.state.interviewState === v;
    return false;
  });

test(
  "row 160: beat 4's repeat.until is the POSITIVE interview-concluded signal, " +
    'never session-phase',
  async () => {
    const beat4 = await loadBeat4();
    assert.deepEqual((beat4.do[1] as any).until, { 'interview-state': 'concluded' });
  },
);

test('row 160: beat 4 still answers a rendered round, unchanged', async () => {
  const beat4 = await loadBeat4();
  assert.deepEqual((beat4.do[1] as any).repeat, [
    {
      fillAll: 'question-freetext',
      with:
        'The gate command is `npm test`. Exclude wins over include when both are given — ' +
        'say so in the header annotation. Breaking the existing human-readable output is ' +
        'not acceptable; the new flag is additive, like --author was.',
    },
    { press: 'submit-answers' },
  ]);
});

/**
 * Run 41's exact shape: the interview concludes on its first turn, no
 * question ever renders, and the ARCHITECT'S NEXT PHASE never reaches
 * `awaiting-verdict` either (the row 159 draft-validation failure this beat
 * cannot see or fix). `question-freetext`/`submit-answers` never carry any
 * handle at all — `count()` is 0 on every read, exactly `pageWithoutTheAct`
 * in `beats-repeat.test.ts`.
 */
function run41ShapePage() {
  const state = { phase: 'interviewing', interviewState: 'asking' };
  // The interview turn concludes almost immediately — no round is ever
  // rendered. Modelled as a short delay so the repeat's poll branch (not just
  // its very first, pre-poll check) is what observes the transition.
  setTimeout(() => {
    state.phase = 'exploring';
    state.interviewState = 'concluded';
  }, 20);
  return {
    url: () => 'http://localhost:4124/sessions/architect/s1',
    state,
    locator() {
      return {
        count: async () => 0,
        nth: () => ({ fill: async () => {} }),
        waitFor: async () => { throw new Error('not present'); },
        first: () => ({
          evaluateAll: async (fn: any, arg: any) => fn([], arg),
          waitFor: async () => { throw new Error('not present'); },
          click: async () => { throw new Error('no element carries that handle'); },
          fill: async () => {},
        }),
      };
    },
    waitForSelector: async () => {},
  };
}

const ROUND = [
  { fillAll: 'question-freetext', with: 'the answer' },
  { press: 'submit-answers' },
];

test(
  'row 160 (regression): the RETIRED until — session-phase: awaiting-verdict — ' +
    "hangs on run 41's shape",
  async () => {
    const page = run41ShapePage();
    const retiredUntil = { 'session-phase': 'awaiting-verdict' };
    const r = await performStepsForTest(page, [{ repeat: ROUND, until: retiredUntil }], 1200, matcher(page));

    assert.ok(
      r.error,
      'the gate never renders and session-phase never reaches awaiting-verdict, so it must red',
    );
    assert.match(r.error, /never became available/);
  },
);

test(
  "row 160 (fixed): beat 4's REAL until — interview-state: concluded — " +
    'passes at once on the identical shape',
  async () => {
    const beat4 = await loadBeat4();
    const page = run41ShapePage();
    const started = Date.now();
    const r = await performStepsForTest(page, [beat4.do[1]], 5000, matcher(page));
    const elapsed = Date.now() - started;

    assert.equal(r.error, null, `expected the repeat to pass once the interview concludes, got: ${r.error}`);
    assert.ok(elapsed < 2000, `it must stop as soon as the positive signal is met, took ${elapsed} ms`);
  },
);

/**
 * The OTHER branch: questions ARE rendered and answered exactly as before.
 * `askingThenConcludedPage` mirrors `interviewPage` in `beats-repeat.test.ts`
 * — a fixed round count is the product's decision, not the story's — but
 * tracks `interviewState` alongside `phase` the way the real product does.
 */
function askingThenConcludedPage({ roundsBeforeConclude }: { roundsBeforeConclude: number }) {
  const state = { phase: 'awaiting-answers', interviewState: 'asking', filled: [] as string[], submits: 0 };
  const present = (handle: string) =>
    handle.includes('question-freetext') || handle.includes('submit-answers')
      ? state.interviewState === 'asking'
      : true;
  return {
    url: () => 'http://localhost:4124/sessions/architect/s1',
    state,
    locator(handle: string) {
      return {
        count: async () => (present(handle) ? 1 : 0),
        nth: () => ({ fill: async (v: string) => { state.filled.push(v); } }),
        waitFor: async () => { if (!present(handle)) throw new Error('not present'); },
        first: () => ({
          evaluateAll: async (fn: any, arg: any) => fn([], arg),
          waitFor: async () => { if (!present(handle)) throw new Error('not present'); },
          click: async () => {
            if (!present(handle)) throw new Error('no element carries that handle');
            if (!handle.includes('submit-answers')) return;
            state.submits += 1;
            if (state.submits >= roundsBeforeConclude) {
              state.phase = 'exploring';
              state.interviewState = 'concluded';
            } else {
              state.phase = 'awaiting-answers';
              state.interviewState = 'asking';
            }
          },
          fill: async (v: string) => { state.filled.push(v); },
        }),
      };
    },
    waitForSelector: async () => {},
  };
}

test(
  'row 160: questions rendered still answer every round, and the repeat only stops ' +
    'once the architect concludes',
  async () => {
    const beat4 = await loadBeat4();
    const page = askingThenConcludedPage({ roundsBeforeConclude: 3 });
    const r = await performStepsForTest(page, [beat4.do[1]], 20000, matcher(page));

    assert.equal(r.error, null, `expected the interview to finish, got: ${r.error}`);
    assert.equal(page.state.submits, 3, 'the product\'s own round count is honoured, not guessed');
    assert.equal(page.state.filled.length, 3);
    assert.equal(page.state.interviewState, 'concluded');
  },
);
