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
import { performSteps } from './beats-steps.mjs';
import { driveBeat } from './beats-drive.mjs';
import S1 from '../../tests/stories/S1.story.mjs';

/** The wait the S1 amend will declare. `session-phase` changes on every
 *  interview round and freezes for exactly one drafting turn, so the bound has
 *  to exceed ONE turn (392 s is the longest COMPLETED one measured) rather than
 *  a whole variable-length run. Scaled down here so the door runs in ms. */
const AMEND_WAIT = { for: 'agent', upTo: 4_000, perTransition: 400, progressKey: 'session-phase' };

/** 7.6.98's form: the bound on the STEP, the wait carrying only a backstop. */
const BACKSTOP_WAIT = { for: 'agent', upTo: 4_000 };

/** S1's real beat 11, validated, with only its wait supplied. */
function realBeat11(wait: Record<string, unknown> = AMEND_WAIT, stepExtra: Record<string, unknown> = {}) {
  const story = S1 as unknown as { beats: Record<string, unknown>[] };
  const last = story.beats[story.beats.length - 1]!;
  assert.match(String(last['act']), /Approve/,
    'fixture check: S1\'s last beat must still be the approve beat, or this door is testing something else');
  const rawDo = ((last['do'] as Record<string, unknown>[]) ?? []).map((st) =>
    st !== null && typeof st === 'object' && st['repeat'] !== undefined ? { ...st, ...stepExtra } : st);
  const validated = validateStory({ ...story, beats: [{ ...last, do: rawDo, wait }] }) as {
    beats: { do: Record<string, unknown>[]; wait: Record<string, unknown> }[];
  };
  const beat = validated.beats[0]!;
  const repeats = beat.do.filter((s) => s['repeat'] !== undefined);
  assert.equal(repeats.length, 1,
    'fixture check: exactly one repeat in beat 11 — found by searching, not by index, so a restructure of ' +
    'S1 reds here rather than silently exercising a different step');
  return { beat, step: repeats[0]! };
}

/**
 * Enough page for the repeat AND for `performSteps` to act through it. The
 * thinner version — `{ locator: () => ({ count }) }` — was enough while every
 * door called `runRepeatStep` directly and handed it a stub `run`, and that is
 * exactly why the `performSteps` seam went untested: the fixture could not
 * reach it. A door's fixture quietly decides which seams are reachable.
 */
function livePage() {
  const locator = (): any => ({
    first: () => locator(), nth: () => locator(), count: async () => 1,
    evaluateAll: async (fn: any, a: any) => fn([], a), waitFor: async () => {},
    click: async () => {}, fill: async () => {},
  });
  return {
    locator,
    url: () => 'http://localhost:4124/sessions/architect/x',
    waitForSelector: async () => {},
    evaluate: async () => ({ data: {}, nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null }),
  };
}
const gatePresent = livePage();

/**
 * A page whose `readObserved` answers with `data`, then with `after` once the
 * beat has pressed its way onward. Enough for `driveBeat` end to end, which the
 * thinner `livePage` is not — and that difference is exactly what fenced off
 * the routing seam until the mutation pass asked for it.
 */
function routedPage(data: Record<string, string>, after: Record<string, string> | null = null) {
  let reads = 0;
  const locator = (): any => ({
    first: () => locator(), nth: () => locator(), count: async () => 1,
    evaluateAll: async (fn: any, a: any) => fn([], a), waitFor: async () => {},
    click: async () => {}, fill: async () => {},
  });
  return {
    locator,
    // S1 beat 11's DECLARED route. `driveBeat` waits for the URL to match it
    // before reading the consequence, so the fake must already be there.
    url: () => 'http://localhost:4124/artifact',
    goto: async () => {},
    waitForSelector: async () => {},
    evaluate: async () => {
      reads += 1;
      const d = after !== null && reads > 3 ? after : data;
      return { data: { ...d }, nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null };
    },
  };
}

describe('7.6.77 repeat half — S1 beat 11\'s own repeat meets the progress bound', () => {
  // THE TWO DOORS THE MUTATION PASS DEMANDED, and they are R3's lesson a THIRD
  // time. Every door below drives `runRepeatStep` or `performSteps` and hands
  // the bound in by hand, so two mutations survived: making `driveBeat` ignore
  // the step entirely (M2), and handing the step's bound to the consequence
  // wait as well (M3 — the very defect 7.6.98 is named for). Both are about
  // ROUTING, and routing is `driveBeat`'s job, so only a door that goes through
  // `driveBeat` can see either. A door that constructs its own input proves the
  // function; only one taking its input from the real producer proves the seam.
  test('7.6.98 SEAM: driveBeat routes the STEP\'s bound to the repeat (M2)', async () => {
    const { beat } = realBeat11(BACKSTOP_WAIT, { perTransition: 300, progressKey: 'session-phase' });
    const page = routedPage({ 'session-phase': 'drafting' });   // frozen: never reaches awaiting-verdict

    const v = await driveBeat(page as never, beat as never, 1, 'http://localhost:4124', {}, 4_000) as {
      status: string; failures: string[];
    };
    const joined = v.failures.join('\n');

    assert.equal(v.status, 'red', 'the repeat never meets its until, so the beat is red');
    assert.match(joined, /stalled-no-transition \(repeat\)/,
      `the step's bound must REACH the repeat through driveBeat: ${joined}`);
    assert.doesNotMatch(joined, /declared bound \(4000 ms\) ran out/,
      'and must not fall back to the wall-clock line, which is what an ignored step produces');
  });

  test('7.6.98 SEAM: driveBeat withholds it from the consequence wait (M3)', async () => {
    // The repeat SUCCEEDS immediately, so the beat proceeds to its consequence
    // wait — which here stands on a page carrying no `session-phase` at all,
    // exactly as `/artifact` does. Handing the step's bound along produces
    // `no-progress-key (consequence)`; withholding it produces an honest
    // mismatch instead.
    const { beat } = realBeat11(BACKSTOP_WAIT, { perTransition: 300, progressKey: 'session-phase' });
    const page = routedPage({ 'session-phase': 'awaiting-verdict' }, { 'page': 'artifact' });

    const v = await driveBeat(page as never, beat as never, 1, 'http://localhost:4124', {}, 2_000) as {
      status: string; failures: string[];
    };
    const joined = v.failures.join('\n');

    assert.doesNotMatch(joined, /\(consequence\)/,
      `a bound declared on the repeat must never reach the consequence wait: ${joined}`);
    assert.doesNotMatch(joined, /no-progress-key/,
      'and a page that legitimately lacks the key must not be accused of a story-authoring gap');
  });

  test('7.6.98: the bound declared on the STEP reaches the repeat, and NOT the consequence wait', () => {
    // THE FIX, read off S1 as it now ships. Two things at once: the repeat
    // carries the live bound bound to its own `until` key, and the WAIT carries
    // none — because that wait stands on `/artifact`, which renders
    // `session-phase` zero times and reported `no-progress-key (consequence)`
    // for it.
    const story = S1 as unknown as { beats: Record<string, unknown>[] };
    const last = story.beats[story.beats.length - 1]!;
    const v = validateStory({ ...story, beats: [last] }) as {
      beats: { do: Record<string, unknown>[]; wait: Record<string, unknown> }[];
    };
    const beat = v.beats[0]!;
    const step = beat.do.find((x) => x['repeat'] !== undefined)!;

    assert.equal(step['perTransition'], 480_000, 'the repeat carries the live bound');
    assert.equal(step['progressKey'], 'session-phase', 'and the key its own `until` names');
    assert.equal((step['until'] as Record<string, string>)['session-phase'], 'awaiting-verdict',
      'the binding that makes a key-on-the-wrong-page impossible by construction');
    assert.equal(beat.wait['perTransition'], undefined,
      'the WAIT carries no progress bound — handing one to the consequence wait is the defect 7.6.98 names');
    assert.equal(beat.wait['upTo'], 1_200_000,
      'and `upTo` is the backstop: a runaway stop, not a bound this beat expects to reach');
  });

  test('7.6.98: a step-declared bound actually ENDS the repeat on a stall', async () => {
    // Carried is not spent. Same shape as the 7.6.77 door below, but the bound
    // arrives from the STEP rather than from the wait.
    const { step } = realBeat11(BACKSTOP_WAIT, { perTransition: 400, progressKey: 'session-phase' });
    const startedAt = Date.now();
    const r = await performSteps(
      livePage() as never, [step] as never, 4_000, null, null,
      async () => false, null, null, null,
      step as never,
      async () => ({ value: 'drafting', source: 'root', carriers: 1 }),
    ) as { error: string | null };
    const took = Date.now() - startedAt;

    assert.match(r.error!, /^stalled-no-transition \(repeat\):/, `the step's bound fired: ${r.error}`);
    assert.ok(took < 2_000, `at the progress bound, not the 4 s backstop — took ${took} ms`);
  });

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
    // THE EXIT CONDITION MUST NOT COME FROM THE THING UNDER TEST, and the first
    // version of this door is why the rule is written here. It had
    // `left: () => 4_000` — a CONSTANT, so the loop's own bound never expired —
    // and `matches: async () => reads > 6`, where `reads` was incremented only
    // inside `readProgressNow`. Under the R1 mutation (`tracker` disabled) the
    // reader is never called, `reads` never moves, `until` is never met and the
    // bound never expires: the door HUNG rather than failing. Measured at 405 s
    // and 915 s, 0.0% CPU, which reads exactly like a slow suite.
    //
    // A door that hangs under a mutation is worse than one that passes: a
    // failure announces itself, a hang is indistinguishable from contention on
    // a box four sessions share. So `left` decays on the real clock and the
    // counter that ends the loop is incremented by `run` — the ROUNDS, which is
    // what "the architect is still working" actually means — leaving
    // `readProgressNow` free to be disabled by any mutation without changing
    // whether this terminates.
    const { beat, step } = realBeat11();
    let rounds = 0;
    let reads = 0;
    const startedAt = Date.now();

    const r = await runRepeatStep({
      page: gatePresent as never,
      step: step as never,
      left: () => Math.max(0, 4_000 - (Date.now() - startedAt)),
      matches: async () => rounds >= 3,        // the architect reaches awaiting-verdict after three rounds
      timeoutMs: 4_000,
      run: async () => { rounds += 1; return { waitedForHandle: false, error: null }; },
      progress: beat.wait as never,
      readProgressNow: async () => {
        reads += 1;
        return { value: `round-${reads}`, source: 'root', carriers: 1 };  // every poll is a transition
      },
    });

    assert.equal(r.error, null, `a repeat making progress must finish on its own \`until\`: ${r.error}`);
    assert.ok(reads > 0, 'fixture check: the progress reader was actually consulted, or this proves nothing');
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

  test('the bound REACHES the repeat through performSteps — the seam the mutation pass found open', async () => {
    // R3 SURVIVED THE FIRST MUTATION PASS: setting `progress: null,
    // readProgressNow: null` at the `runRepeatStep` call site inside
    // `performSteps` left all seventeen doors green. Every door above drives
    // `runRepeatStep` DIRECTLY and hands it the bound itself, so nothing
    // anywhere proved that the bound a beat declares actually arrives there.
    //
    // That is this bead's own defect one layer up. 7.6.77 shipped a bound
    // attached to the wrong wait; this would have shipped a bound attached to
    // the right wait and never delivered to it, with a green suite either way.
    // "A door that constructs its own input proves the function; only a door
    // that takes its input from the real producer proves the seam" — and
    // `performSteps` is the producer for this one.
    const { beat, step } = realBeat11();
    const startedAt = Date.now();

    const r = await performSteps(
      livePage() as never,
      [step] as never,
      4_000,                                   // the beat's declared bound
      null, null,
      async () => false,                       // `until` never met
      null, null, null,
      beat.wait as never,                      // progress, as driveBeat passes it
      async () => ({ value: 'drafting', source: 'root', carriers: 1 }),
    ) as { error: string | null };
    const took = Date.now() - startedAt;

    assert.notEqual(r.error, null, 'the repeat must end');
    assert.match(r.error!, /^stalled-no-transition \(repeat\):/,
      `the declared bound must REACH the repeat through performSteps: ${r.error}`);
    assert.ok(took < 2_000, `and stop at the progress bound, not the 4 s ceiling — took ${took} ms`);
  });

  test('a page that cannot be READ is its own finding, never a stall', async () => {
    // R4 SURVIVED TOO: collapsing the `unreadable` branch into the stall message
    // changed nothing, because no door ever produced that source. §15.504 — a
    // read that could not happen is not a reading of ABSENT — and the repeat's
    // reader throws by design when the page navigates under it between rounds.
    // Without its own sentence, a beat whose page never came back would be told
    // the key "renders and is still rendering", which is false and sends the
    // reader to the agent instead of to the page.
    const { beat, step } = realBeat11();
    let reads = 0;
    const startedAt = Date.now();

    const r = await runRepeatStep({
      page: gatePresent as never,
      step: step as never,
      left: () => Math.max(0, 4_000 - (Date.now() - startedAt)),
      matches: async () => false,
      timeoutMs: 4_000,
      run: async () => ({ waitedForHandle: false, error: null }),
      progress: beat.wait as never,
      readProgressNow: async () => {
        reads += 1;
        // Seen once, then the page stops being readable — the real sequence.
        return reads === 1
          ? { value: 'drafting', source: 'root', carriers: 1 }
          : { value: undefined, source: 'unreadable', carriers: 0 };
      },
    });

    assert.notEqual(r.error, null);
    assert.match(r.error!, /^progress-key-unreadable \(repeat\):/, `its own prefix: ${r.error}`);
    assert.doesNotMatch(r.error!, /stalled-no-transition/, 'never the stall message');
    assert.doesNotMatch(r.error!, /renders and is still rendering/, 'and never the claim that the key renders');
    assert.match(r.error!, /the read itself failed/, 'it names WHAT failed');
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
