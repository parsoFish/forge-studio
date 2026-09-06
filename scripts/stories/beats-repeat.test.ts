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

// ===========================================================================
// Bead `forge-8vfn.6.11.38` (P1, ruling 349) — the loop must not overshoot the
// thing it is waiting for.
//
// Read from the S1 run 8 archive, not hypothesised: the session was at
// `phase: "awaiting-verdict", round: 4` while the loop was still filling round
// 4's field, and beat 11 died after 357 s on `could not fill question-freetext
// … element was detached from the DOM`. Two causes: `until` was evaluated once
// per ROUND (a round is several actions long, and the product can leave the
// interview between them), and a DETACHED control was reported as the failure
// rather than as the page moving — which is the very event `until` exists to
// notice. `until` is a DOM read, so the product can have moved while the page
// is still re-rendering, and the single post-error re-check ran too early.
// ===========================================================================

/**
 * The interview above, plus the two things the archive shows: the fill can find
 * its element detaching, and the PAGE's rendered phase can lag the session's
 * own. `visibleAfter` is how many matcher reads pass before the rendered phase
 * catches up — the gap the single post-error re-check fell into.
 */
function movingInterviewPage({ detachFills = 0, visibleAfter = 0 }) {
  const state = { phase: 'awaiting-answers', visible: 'awaiting-answers', filled: [], submits: 0, reads: 0, detached: 0 };
  const present = (handle) =>
    handle.includes('question-freetext') || handle.includes('submit-answers')
      ? state.phase === 'awaiting-answers'
      : true;
  const fill = async (v) => {
    if (state.detached < detachFills) {
      state.detached += 1;
      // The product leaves the interview; the DOM has not caught up yet.
      state.phase = 'awaiting-verdict';
      throw new Error('element was detached from the DOM');
    }
    state.filled.push(v);
  };
  return {
    state,
    locator(handle) {
      return {
        count: async () => (present(handle) ? 1 : 0),
        nth: () => ({ fill }),
        waitFor: async () => { if (!present(handle)) throw new Error('not present'); },
        first: () => ({
          waitFor: async () => { if (!present(handle)) throw new Error('not present'); },
          click: async () => {
            if (!present(handle)) throw new Error('no element carries that handle');
            if (handle.includes('submit-answers')) { state.submits += 1; state.phase = 'awaiting-verdict'; }
          },
          fill,
        }),
      };
    },
    waitForSelector: async () => {},
  };
}

/** Reads the RENDERED phase, which catches up to the session's only after `visibleAfter` reads. */
const laggingMatcher = (page, visibleAfter) => async (spec) => {
  page.state.reads += 1;
  if (page.state.reads > visibleAfter) page.state.visible = page.state.phase;
  return Object.entries(spec).every(([k, v]) => (k === 'session-phase' ? page.state.visible === v : false));
};

test('6.11.38: a control that DETACHES mid-round is the page moving, not this beat failing', async () => {
  // The fill detaches because the architect drafted underneath it. The rendered
  // phase lags by one read, so the single post-error re-check says "not yet" —
  // exactly what put 357 s and a red verdict on S1 run 8's beat 11.
  const page = movingInterviewPage({ detachFills: 1, visibleAfter: 2 });
  const r = await performStepsForTest(page, [{ repeat: ROUND, until: UNTIL }], 20000, laggingMatcher(page, 2));

  assert.equal(r.error, null, `a detached control must send the loop back to its \`until\`, got: ${r.error}`);
  assert.equal(page.state.phase, 'awaiting-verdict', 'and the product really had moved on');
});

test('6.11.38: `until` is re-read BEFORE EVERY action in a round — the press is never even ATTEMPTED once the interview has ended', async () => {
  // The fill SUCCEEDS and is what moves the product on (no error anywhere), so
  // nothing forces the loop to look: only a re-read before the next action can
  // stop it. The observable is whether the click was ATTEMPTED — asserting on
  // `submits` alone would pass either way, because the press throws on the
  // missing control before it increments anything. That is the difference
  // between testing the fix and testing around it.
  const page = movingInterviewPage({ detachFills: 0, visibleAfter: 0 });
  page.state.attempts = 0;
  const present = (handle) =>
    handle.includes('question-freetext') || handle.includes('submit-answers')
      ? page.state.phase === 'awaiting-answers'
      : true;
  page.locator = (handle) => ({
    count: async () => (present(handle) ? 1 : 0),
    nth: () => ({ fill: async () => { page.state.phase = 'awaiting-verdict'; } }),
    waitFor: async () => { if (!present(handle)) throw new Error('not present'); },
    first: () => ({
      waitFor: async () => { if (!present(handle)) throw new Error('not present'); },
      fill: async () => { page.state.phase = 'awaiting-verdict'; },
      click: async () => {
        if (handle.includes('submit-answers')) page.state.attempts += 1;
        if (!present(handle)) throw new Error('no element carries that handle');
      },
    }),
  });

  const r = await performStepsForTest(page, [{ repeat: ROUND, until: UNTIL }], 20000, laggingMatcher(page, 0));

  assert.equal(r.error, null);
  assert.equal(
    page.state.attempts,
    0,
    'the press was attempted against a session that had already drafted — `submit-answers` exists only at `awaiting-answers`, so this is the loop acting after the product moved',
  );
});

test('6.11.38 POSITIVE CONTROL: detachment is softened, but a control that never resolves still reds at the bound', async () => {
  // A page that detaches EVERY fill and never leaves the interview in the
  // page's own view. Softening detachment must not make a stuck loop green —
  // that would turn every genuinely wedged interview into a pass.
  const page = movingInterviewPage({ detachFills: Number.MAX_SAFE_INTEGER, visibleAfter: 0 });
  page.state.phase = 'awaiting-answers';
  const stuck = async () => false;
  const r = await performStepsForTest(page, [{ repeat: ROUND, until: UNTIL }], 1200, stuck);

  assert.notEqual(r.error, null, 'a loop that never met its condition must NOT report success');
  assert.match(r.error, /declared bound/);
  assert.match(r.error, /session-phase/, 'and the failure must name the `until` that was never met');
});

test('6.11.38: a NON-detached inner failure still reds, naming its round — detachment is the only softened case', async () => {
  const page = movingInterviewPage({ detachFills: 0, visibleAfter: 0 });
  // The press is disabled rather than gone: a real failure, not the page moving.
  page.locator = (handle) => ({
    count: async () => 1,
    nth: () => ({ fill: async () => {} }),
    waitFor: async () => {},
    first: () => ({
      waitFor: async () => {},
      fill: async () => {},
      click: async () => { throw new Error('the control is disabled'); },
    }),
  });
  const r = await performStepsForTest(page, [{ repeat: ROUND, until: UNTIL }], 5000, async () => false);

  assert.notEqual(r.error, null);
  assert.match(r.error, /repeat, round 1:/);
  assert.match(r.error, /disabled/);
});
