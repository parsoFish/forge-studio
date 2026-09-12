/**
 * S1 BEAT 11's OWN REPEAT, through the real validator, reaching the real bound
 * — `forge-8vfn.7.6.77`'s repeat half, T1 ruling 930, §15.500.
 *
 * WHY THIS FILE EXISTS AT ALL. The first half of 7.6.77 shipped `perTransition`
 * on `waitForConsequence` — proved correct, thirteen doors, and it did not fix
 * beat 11, because beat 11 does not spend its bound there. Its interview rounds
 * AND its 327-392 s drafting turn run inside
 *
 *   { repeat: [{ fillAll: 'question-freetext', with: ANSWER },
 *              { press: 'submit-answers' }],
 *     until: { 'session-phase': 'awaiting-verdict' } }
 *
 * bounded by the beat's wall clock through `runRepeatStep({ left, timeoutMs })`,
 * whose exhaustion line `beats-repeat.mjs:201` is VERBATIM what funded runs 8
 * and 10 printed. A bound proved correct in isolation, attached to the wrong
 * wait: 640's shape, in this same pair of files.
 *
 * EVERY DOOR IN THE FIRST HALF WAS GREEN THROUGHOUT. They hand-built their
 * beats, so not one of them could notice that the real beat's time is spent
 * somewhere else. So this door takes S1's ACTUAL beat 11 — read from
 * `tests/stories/S1.story.mjs`, run through `validateStory` — and finds the
 * repeat step by searching for it rather than by index, so a restructure of S1
 * reds here instead of silently testing the wrong step.
 *
 * TWO HONEST LIMITS, stated rather than hidden:
 *
 * 1. THE `wait` IS SUPPLIED. S1 declares `{ for: 'agent', upTo: 600_000 }` and
 *    the amend that adds `perTransition`/`progressKey` has not landed — it is
 *    sequenced after this. The `do` block, the `until`, the handles and the
 *    ANSWER text are all S1's own; only the wait is this door's, and it is the
 *    exact wait the amend will declare.
 * 2. IT DRIVES `runRepeatStep`, NOT `driveBeat`. Reaching the repeat through
 *    `driveBeat` needs a browser fixture large enough to press, fill and
 *    navigate, and a door that spends most of itself on a fake is a door about
 *    the fake. The seam this exists to prove is "the real story's repeat meets
 *    the real progress bound", and that seam is entirely inside this call.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validateStory } from './story-file.mjs';
import { runRepeatStep } from './beats-repeat.mjs';
import S1 from '../../tests/stories/S1.story.mjs';

/** The wait the S1 amend will declare. `session-phase` changes on every
 *  interview round and freezes for exactly one drafting turn, so the bound has
 *  to exceed ONE turn (392 s is the longest COMPLETED one measured) rather than
 *  a whole variable-length run. Scaled down here so the door runs in ms. */
const AMEND_WAIT = { for: 'agent', upTo: 4_000, perTransition: 400, progressKey: 'session-phase' };

/** S1's real beat 11, validated, with only its wait supplied. */
function realBeat11() {
  const story = S1 as unknown as { beats: Record<string, unknown>[] };
  const last = story.beats[story.beats.length - 1]!;
  assert.match(String(last['act']), /Approve/,
    'fixture check: S1\'s last beat must still be the approve beat, or this door is testing something else');
  const validated = validateStory({ ...story, beats: [{ ...last, wait: AMEND_WAIT }] }) as {
    beats: { do: Record<string, unknown>[]; wait: Record<string, unknown> }[];
  };
  const beat = validated.beats[0]!;
  const repeats = beat.do.filter((s) => s['repeat'] !== undefined);
  assert.equal(repeats.length, 1,
    'fixture check: exactly one repeat in beat 11 — found by searching, not by index, so a restructure of ' +
    'S1 reds here rather than silently exercising a different step');
  return { beat, step: repeats[0]! };
}

/** Enough page for the repeat: the act is present, and nothing else is asked. */
const gatePresent = { locator: () => ({ count: async () => 1 }), url: () => 'http://localhost:4124/sessions/architect/x' };

describe('7.6.77 repeat half — S1 beat 11\'s own repeat meets the progress bound', () => {
  test('the architect stops emitting: the repeat ends on PROGRESS, naming its wait', async () => {
    // The failing runs' condition: rounds get answered, the phase never reaches
    // `awaiting-verdict`, and the key stops changing. Before this half, the only
    // possible outcome here was the wall-clock line at `beats-repeat.mjs:201`.
    const { beat, step } = realBeat11();
    const startedAt = Date.now();

    const r = await runRepeatStep({
      page: gatePresent as never,
      step: step as never,
      left: () => Math.max(0, 4_000 - (Date.now() - startedAt)),
      matches: async () => false,              // `until` is never met — the drafting turn that overran
      timeoutMs: 4_000,
      run: async () => ({ waitedForHandle: false, error: null }),
      progress: beat.wait as never,
      readProgressNow: async () => ({ value: 'drafting', source: 'root', carriers: 1 }),
    });
    const took = Date.now() - startedAt;

    assert.notEqual(r.error, null, 'a frozen progress key must end the repeat');
    assert.match(r.error!, /^stalled-no-transition \(repeat\):/,
      `the repeat's OWN progress expiry, naming its wait: ${r.error}`);
    assert.doesNotMatch(r.error!, /declared bound \(4000 ms\) ran out/,
      'never the wall-clock line — that is the failure this bead exists to replace');
    assert.ok(took < 2_000, `it must stop at the progress bound, not at the 4 s ceiling — took ${took} ms`);
  });

  test('an architect still working is NOT stopped, and still meets its until', async () => {
    // THE CONTROL, and the one that would catch a bound that reds a healthy run.
    // The phase changes on every read — an architect answering rounds — and the
    // repeat must run to its `until` untouched.
    const { beat, step } = realBeat11();
    let reads = 0;
    let phase = 'interviewing';

    const r = await runRepeatStep({
      page: gatePresent as never,
      step: step as never,
      left: () => 4_000,
      matches: async () => reads > 6,          // the architect reaches awaiting-verdict eventually
      timeoutMs: 4_000,
      run: async () => ({ waitedForHandle: false, error: null }),
      progress: beat.wait as never,
      readProgressNow: async () => {
        reads += 1;
        phase = `round-${reads}`;              // every poll is a transition
        return { value: phase, source: 'root', carriers: 1 };
      },
    });

    assert.equal(r.error, null, `a repeat making progress must finish on its own \`until\`: ${r.error}`);
  });

  test('`until` beats the progress bound: a met condition is never a stall', async () => {
    // Ordering, asserted rather than assumed. The `until` check runs first, so a
    // repeat whose condition is already satisfied returns green however long the
    // key has sat still — which matters because the drafting turn ENDS by
    // changing the phase, and the last poll before that sees a frozen key.
    const { beat, step } = realBeat11();
    const r = await runRepeatStep({
      page: gatePresent as never,
      step: step as never,
      left: () => 4_000,
      matches: async () => true,               // already at awaiting-verdict
      timeoutMs: 4_000,
      run: async () => ({ waitedForHandle: false, error: null }),
      progress: beat.wait as never,
      readProgressNow: async () => ({ value: 'frozen', source: 'root', carriers: 1 }),
    });
    assert.equal(r.error, null, 'a satisfied repeat is not stalled, however still the key is');
  });

  test('a beat with no progress bound keeps the wall-clock line it has always had', async () => {
    // The negative control: the eight other stories declare no `perTransition`
    // and must be untouched, including the failure text their verdicts carry.
    const { step } = realBeat11();
    const startedAt = Date.now();
    const r = await runRepeatStep({
      page: gatePresent as never,
      step: step as never,
      left: () => Math.max(0, 600 - (Date.now() - startedAt)),
      matches: async () => false,
      timeoutMs: 600,
      run: async () => ({ waitedForHandle: false, error: null }),
    });
    assert.match(r.error!, /declared bound \(600 ms\) ran out/,
      `unchanged for every story that declares no progress bound: ${r.error}`);
  });
});
