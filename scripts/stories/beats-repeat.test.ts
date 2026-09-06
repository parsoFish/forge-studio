/**
 * `{ repeat: [...] }` — a `do` step that acts UNTIL the beat's own expectation
 * answers, bounded by the wait the beat already declares (§3.1; T1 rulings 312
 * and 317, operator-confirmed in the M5-B session-8 window).
 *
 * WHY IT EXISTS. The architect interviews before it plans, and the number of
 * ROUNDS is the agent's judgement, exactly as the number of questions per round
 * already is (`fillAll`'s reason). `packages/sessions/bridge-studio-architect.ts`
 * writes `{ phase: 'interviewing', round: round + 1 }` and spawns another turn
 * on every submission; nothing counts rounds, and the product has no ceiling
 * (bead `forge-8vfn.6.10.28`). S4 run 4 measured `round: 2` with one round of
 * answers recorded, and red at `awaiting-answers` after the full 600 000 ms.
 *
 * WHY NOT A FIXED NUMBER OF SUBMIT STEPS. It breaks in BOTH directions, which
 * is the fact that decided the shape:
 *   · too few  — the session never reaches `awaiting-verdict`;
 *   · too many — `submit-answers` exists ONLY at `awaiting-answers`
 *                (`studio/session-kinds.yaml:88` is the only row declaring
 *                `awaits: questions`), so once the architect drafts, the control
 *                is gone and the next press reds on a missing handle.
 * A count is only ever right by luck, and each wrong guess costs a funded run.
 *
 * THE BOUND IS NOT NEW. `repeat` invents no ceiling: it spends what is left of
 * the beat's declared `wait: { for: 'agent', upTo }`, so "one declared bound is
 * one spend" (`6.11.22`) still holds, and a beat whose draft never comes reds at
 * that bound saying how many rounds it answered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { performStepsForTest } from './beats.mjs';

/**
 * A fake page that models the real interview: `question-freetext` exists only
 * while the session awaits answers, and each submission either opens another
 * round or drafts. Deliberately NOT a stub that always succeeds — the shape
 * under test is "the product decides when to stop", so the fake has to decide.
 */
function interviewPage({ roundsBeforeDraft }) {
  const state = { round: 1, phase: 'awaiting-answers', filled: [], submits: 0 };
  const present = (handle) =>
    handle.includes('question-freetext') || handle.includes('submit-answers')
      ? state.phase === 'awaiting-answers'
      : true;
  return {
    state,
    locator(handle) {
      return {
        count: async () => (present(handle) ? 1 : 0),
        nth: () => ({ fill: async (v) => { state.filled.push(v); } }),
        // `waitForHandleOrStall` waits on the located handle before the act.
        waitFor: async () => { if (!present(handle)) throw new Error('not present'); },
        first: () => ({
          waitFor: async () => { if (!present(handle)) throw new Error('not present'); },
          click: async () => {
            if (!present(handle)) throw new Error('no element carries that handle');
            if (handle.includes('submit-answers')) {
              state.submits += 1;
              state.phase = state.submits >= roundsBeforeDraft ? 'awaiting-verdict' : 'awaiting-answers';
              state.round += 1;
            }
          },
          fill: async (v) => { state.filled.push(v); },
        }),
      };
    },
    waitForSelector: async () => {},
  };
}

const UNTIL = { 'session-phase': 'awaiting-verdict' };

const ROUND = [
  { fillAll: 'question-freetext', with: 'the answer' },
  { press: 'submit-answers' },
];

/**
 * The runner injects a MATCHER over a data spec — `until`'s own keys — not the
 * beat's whole expectation. T1 ruling 320: borrowing `expect.data` is
 * unreachable whenever the repeat is not the last step, which is the defect
 * that cost S1 run 6 and S2 run 4.
 */
const matcher = (page) => async (spec) =>
  Object.entries(spec).every(([k, v]) => (k === 'session-phase' ? page.state.phase === v : false));

test('312: one round is enough — repeat stops as soon as the expectation answers', async () => {
  const page = interviewPage({ roundsBeforeDraft: 1 });
  const r = await performStepsForTest(page, [{ repeat: ROUND, until: UNTIL }], 20000, matcher(page));

  assert.equal(r.error, null);
  assert.equal(page.state.submits, 1, 'it does not submit again after the draft');
  assert.equal(page.state.phase, 'awaiting-verdict');
});

test('312: four rounds is also enough — the count is the product\'s, not the story\'s', async () => {
  const page = interviewPage({ roundsBeforeDraft: 4 });
  const r = await performStepsForTest(page, [{ repeat: ROUND, until: UNTIL }], 20000, matcher(page));

  assert.equal(r.error, null);
  assert.equal(page.state.submits, 4);
  assert.equal(page.state.filled.length, 4, 'every round was actually answered');
});

test('312: a draft that never comes reds at the declared bound, naming the rounds answered', async () => {
  // The S4 run 4 shape: the architect keeps interviewing because the work it was
  // asked for already exists. The beat must say that, not time out anonymously.
  const page = interviewPage({ roundsBeforeDraft: Number.POSITIVE_INFINITY });
  const r = await performStepsForTest(page, [{ repeat: ROUND, until: UNTIL }], 1200, matcher(page));

  assert.ok(r.error, 'it must red');
  assert.match(r.error, /repeat/, 'the failure names the step that ran out');
  assert.match(r.error, /round/i, 'and how many rounds it answered');
  assert.ok(page.state.submits > 0, 'it did answer while it could');
});

test('312: repeat never runs when the expectation is already satisfied', async () => {
  // A beat that stands on a session which has ALREADY drafted must not press a
  // control that is gone. This is the half a fixed count cannot express.
  const page = interviewPage({ roundsBeforeDraft: 1 });
  page.state.phase = 'awaiting-verdict';

  const r = await performStepsForTest(page, [{ repeat: ROUND, until: UNTIL }], 20000, matcher(page));

  assert.equal(r.error, null);
  assert.equal(page.state.submits, 0, 'nothing was pressed');
  assert.equal(page.state.filled.length, 0);
});

test('320: without an `until`, repeat refuses rather than looping forever', async () => {
  // A repeat with nothing to reach is an authoring error and is named as one —
  // never a silent loop bounded only by the wait.
  const page = interviewPage({ roundsBeforeDraft: 2 });
  const r = await performStepsForTest(page, [{ repeat: ROUND }], 5000, matcher(page));

  assert.ok(r.error, 'it must refuse');
  assert.match(r.error, /until/i, 'and name what is missing');
});

test('320: `until` is the repeat\'s OWN condition, NOT the beat\'s expectation', async () => {
  // THE DEFECT THIS RULING CLOSES, as a test. S1 beat 11's do is
  // [view-architect-session, repeat, open-plan, approve-plan] and its
  // expect.data is architect-phase "committed" — a state produced by a step
  // that runs AFTER the repeat. Borrowing that expectation made the loop
  // unstoppable: it kept submitting to a session that had already drafted,
  // pressing a control that disables itself, until the bound expired.
  // Here the beat-level expectation is UNREACHABLE and the repeat must still
  // stop, because `until` describes the INTERVIEW's end and nothing else.
  const page = interviewPage({ roundsBeforeDraft: 2 });
  const beatExpectationNeverTrue = async (spec) =>
    Object.entries(spec).every(([k, v]) => (k === 'session-phase' ? page.state.phase === v : false));

  const r = await performStepsForTest(
    page,
    [{ repeat: ROUND, until: { 'session-phase': 'awaiting-verdict' } }],
    20000,
    beatExpectationNeverTrue,
  );

  assert.equal(r.error, null, 'the repeat stops on its own condition');
  assert.equal(page.state.submits, 2);
  assert.equal(page.state.phase, 'awaiting-verdict');
});

test('312: a stop-condition read that throws is "not yet", never a run-ending crash', async () => {
  // `readObserved` runs `page.evaluate`, which throws when the page navigates
  // under it. A repeat polls the condition between acts that submit and
  // re-render, so it WILL meet that race, and an unguarded throw aborts the
  // whole run — dropping every later story's doc and gallery row. The read is
  // guarded at the call site in `driveBeat`; this pins the contract the loop
  // relies on: a thrown condition must not escape, and must not be read as
  // "satisfied" either, which would end the loop on a page nobody could see.
  const page = interviewPage({ roundsBeforeDraft: 2 });
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new Error('Execution context was destroyed');
    return page.state.phase === 'awaiting-verdict';
  };
  const guarded = async () => { try { return await flaky(); } catch { return false; } };

  const r = await performStepsForTest(page, [{ repeat: ROUND, until: UNTIL }], 20000, guarded);

  assert.equal(r.error, null, 'the throw must not end the run');
  assert.equal(page.state.phase, 'awaiting-verdict', 'and the loop still finishes its work');
});
