/**
 * The per-transition bound, from the story file to the waiter — bead
 * `forge-8vfn.7.6.77`, T1 ruling 881, C's conditions 1-3.
 *
 * WHAT IS BROKEN. S1 beat 11 ("Open the session, read the plan and press
 * Approve") fails about half the time at its declared 600 000 ms bound, and the
 * four funded runs say why: the work is a VARIABLE NUMBER of VARIABLE-LENGTH
 * turns. Interview rounds cost 28-126 s each; the single drafting turn costs
 * 327-392 s on the runs that completed one. Round count does not predict the
 * outcome — runs 8 and 9 both answered two rounds and only 9 passed — so there
 * is no wall-clock figure that is both safe and meaningful. Raise it enough to
 * survive three rounds plus a slow draft and it no longer catches a stall.
 *
 * THE FIX IS TO BOUND PROGRESS. `perTransition` resets every time `progressKey`
 * CHANGES, so expiry means "no transition", which is the thing the beat is
 * actually watching for. `upTo` is untouched and remains the ceiling.
 *
 * EVERY DOOR HERE TAKES ITS WAIT FROM `validateStory`, never from an object
 * built in this file. That is 7.6.82's whole lesson: `beats-anchor.test.ts`
 * proved `resolveAnchorMs` exactly right while `anchor` was being dropped by
 * the validator, because every one of its cases hand-built the wait it passed
 * in. A door that constructs its own input proves the function; only a door
 * that takes its input from the real producer proves the seam.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validateStory, PROGRESS_KEY_SHAPE } from './story-file.mjs';
import { waitForConsequence, SAFE_KEY } from './beats-page.mjs';
import { driveBeat } from './beats-drive.mjs';

const ROUTE = '/sessions/architect/2026-09-12T00-00-00-abc';

/** The beat S1 beat 11 is: it stands on a session and watches an agent work. */
function beatWith(wait: Record<string, unknown>) {
  const story = validateStory({
    id: 'per-transition',
    ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
    docs: { kind: 'how-to' as const, title: 'per-transition' },
    beats: [
      {
        act: 'read the plan the architect is writing',
        wait,
        expect: { route: ROUTE, data: { page: 'session', 'session-phase': 'awaiting-verdict' } },
        say: 'the beat waits for the architect to finish',
      },
    ],
  }) as { beats: { wait: Record<string, unknown> }[] };
  return story.beats[0]!;
}

/**
 * Enough of playwright's page for the consequence wait, with ONE key under the
 * test's control over time.
 *
 * `respectWanted` is the whole point of the collection door below: the real
 * `readObserved` reads only the keys it was ASKED for, so a page double that
 * hands back every attribute regardless cannot express a key that was never
 * collected — which is exactly the defect `6.11.45` cost a funded run.
 */
function sessionPage(spec: {
  progressKey?: string;
  valueAt?: (elapsedMs: number) => string | undefined;
  respectWanted?: boolean;
  /** WHERE the key renders. `root` is the page root; `descendant` puts it on
   *  `carriers` child elements and NEVER on the root, which is the shape C's P1
   *  was measured on and the shape no door here used before. */
  progressOn?: 'root' | 'descendant';
  carriers?: number;
  route?: string;
}) {
  const startedAt = Date.now();
  const locator = (): any => ({
    first: () => locator(), count: async () => 1, nth: () => locator(),
    evaluateAll: async (fn: any, a: any) => fn([], a), waitFor: async () => {},
    click: async () => {}, fill: async () => {},
  });
  return {
    url: () => `http://localhost:4124${spec.route ?? ROUTE}`,
    locator,
    goto: async () => {},
    waitForSelector: async () => {},
    evaluate: async (_fn: unknown, arg?: { wanted?: string[] }) => {
      const all: Record<string, string> = { page: 'session', 'page-ready': 'true', 'session-phase': 'drafting' };
      const nested: Record<string, string>[] = [];
      if (spec.progressKey !== undefined && spec.valueAt !== undefined) {
        const v = spec.valueAt(Date.now() - startedAt);
        if (v !== undefined) {
          if ((spec.progressOn ?? 'root') === 'root') all[spec.progressKey] = v;
          else for (let i = 0; i < (spec.carriers ?? 1); i += 1) nested.push({ [spec.progressKey]: v });
        }
      }
      const wanted = arg?.wanted ?? null;
      const keep = (o: Record<string, string>) => wanted === null || spec.respectWanted === false
        ? o
        : Object.fromEntries(Object.entries(o).filter(([k]) => wanted.includes(k)));
      return {
        data: keep(all), nested: nested.map(keep),
        lifecycle: null, lifecycleError: null, sessionPhase: 'drafting',
      };
    },
  };
}

/** The shape S1 beat 11 will declare, scaled down so the doors run in ms. */
const WAIT = { for: 'agent', upTo: 4_000, perTransition: 400, progressKey: 'architect-turns' };

describe('7.6.77 — the bound is on PROGRESS, not on the wall clock', () => {
  test('a key that keeps changing is never stopped by the per-transition bound', async () => {
    // THE CASE THE BEAT IS BOUGHT FOR: an architect that answers three
    // interview rounds and then drafts for longer than any single bound would
    // allow. Here every 100 ms is a transition, and the beat runs to its own
    // ceiling — the progress bound never fires, because progress never stopped.
    const beat = beatWith(WAIT);
    const page = sessionPage({ progressKey: 'architect-turns', valueAt: (ms) => String(Math.floor(ms / 100)) });

    const began = Date.now();
    const stall = await waitForConsequence(
      page as never, beat as never, 1_500, null, null, null, null, null, beat.wait,
    );

    assert.equal(stall, null, 'a wait that is making progress ends at its ceiling, not at the progress bound');
    assert.ok(Date.now() - began >= 1_400, `and it really did wait: ${Date.now() - began} ms`);
  });

  test('the budget RESETS on every transition — it is not a shorter wall clock', async () => {
    // THE DOOR THE MUTATION PASS DEMANDED. Deleting `lastChangeAt = Date.now()`
    // left every other door in this file green: a changing key takes the
    // change branch and never reaches the expiry test, so the only visible
    // difference is WHERE the budget is measured from once progress stops.
    // Without the reset, `perTransition` is measured from the wait's START —
    // which is precisely what C's condition 1 refuses, "a budget that can never
    // reset, a shorter wall-clock bound wearing a progress bound's name" — and
    // on beat 11 it would kill the drafting turn the moment the interview
    // rounds' own time had been spent.
    //
    // Three transitions at 300 ms apart, then silence, against a 400 ms bound.
    // Reset: expiry ~1 300 ms. No reset: expiry ~400 ms. A 3x separation, so
    // the assertion is about the mechanism and not about timing slack.
    const beat = beatWith(WAIT);
    const page = sessionPage({
      progressKey: 'architect-turns',
      valueAt: (ms) => String(Math.min(3, Math.floor(ms / 300))),
    });

    const began = Date.now();
    const stall = await waitForConsequence(
      page as never, beat as never, 4_000, null, null, null, null, null, beat.wait,
    );
    const took = Date.now() - began;

    assert.notEqual(stall, null, 'it freezes at "3" and the bound must eventually fire');
    assert.ok(took >= 1_200,
      `each transition must push the deadline out: expiry at ${took} ms means the budget was measured from the ` +
      "wait's start, so `perTransition` is just a shorter `upTo` and the bead's whole fix is absent");
  });

  test('the transition COUNT is reported honestly — one door per axis', async () => {
    // SPLIT OUT OF THE DOOR ABOVE, and the reason is a measurement. That door
    // asserted the count as well as the timing, and it red twice while six
    // other `tsx` suites were running: at 100 ms polls against 300 ms steps a
    // contended poll can skip a value entirely, so the count it observed was
    // 2 where 3 was declared. The TIMING assertion is safe under load in one
    // direction only — a late poll pushes expiry later, never earlier — but the
    // COUNT is not, and a door carrying two nondeterministic axes reds for
    // whichever one slipped. 7.6.50's family, in a door I wrote tonight.
    //
    // So this fixture advances on every READ rather than on the clock: three
    // changes, then frozen, whatever the poll timing does.
    let reads = 0;
    const beat = beatWith(WAIT);
    const page = sessionPage({ progressKey: 'architect-turns', valueAt: () => String(Math.min(3, reads++)) });

    const stall = await waitForConsequence(
      page as never, beat as never, 4_000, null, null, null, null, null, beat.wait,
    );

    assert.notEqual(stall, null);
    assert.match(stall!.why, /changed 3 time\(s\)/,
      `the first sighting is not a transition and every later change is exactly one: ${stall!.why}`);
    assert.match(stall!.why, /read "3" for the last/, 'and the frozen value is quoted');
  });

  test('a key that appears and then FREEZES stops the beat at the per-transition bound', async () => {
    // Two transitions, then silence. The beat must stop shortly after 400 ms,
    // nowhere near its 4 000 ms ceiling.
    const beat = beatWith(WAIT);
    const page = sessionPage({
      progressKey: 'architect-turns',
      valueAt: (ms) => (ms < 250 ? String(Math.floor(ms / 100)) : '2'),
    });

    const began = Date.now();
    const stall = await waitForConsequence(
      page as never, beat as never, 4_000, null, null, null, null, null, beat.wait,
    );
    const took = Date.now() - began;

    assert.notEqual(stall, null, 'a frozen progress key must end the beat');
    assert.match(stall!.why, /^stalled-no-transition:/, `it names WHICH expiry: ${stall!.why}`);
    assert.match(stall!.why, /architect-turns/, 'and which key');
    assert.match(stall!.why, /"2"/, 'and the value it froze at, quoted so an empty string is visible');
    assert.ok(took < 2_000, `it stops at the progress bound, not at the 4 s ceiling — took ${took} ms`);
  });

  test('a key that NEVER APPEARS reports a different finding, and says it is not about the agent', async () => {
    // C's condition 3, and the reason the two messages must never be one. A key
    // that never appears CANNOT stop changing, so the bound firing here says
    // nothing whatever about the agent — it says the beat named a key this page
    // does not render. Reporting it as a stall sends a reader to look at an
    // agent that may be working perfectly.
    const beat = beatWith(WAIT);
    const page = sessionPage({ progressKey: 'architect-turns', valueAt: () => undefined });

    const stall = await waitForConsequence(
      page as never, beat as never, 4_000, null, null, null, null, null, beat.wait,
    );

    assert.notEqual(stall, null, 'the bound must still fire: a progress bound that silently does nothing when ' +
      'its key is missing is protection that reads as present and is not');
    assert.match(stall!.why, /^no-progress-key:/, `a DIFFERENT prefix from the stall: ${stall!.why}`);
    assert.doesNotMatch(stall!.why, /stalled-no-transition/, 'the two findings must never be confusable');
    assert.match(stall!.why, /never present on the page/, 'it says what was actually observed');
    assert.match(stall!.why, /NOT a measurement\s+of the agent|NOT a measurement of the agent/,
      `and it refuses to be read as a stall: ${stall!.why}`);
  });

  test('the progress key is COLLECTED even when the beat never mentions it', async () => {
    // `forge-8vfn.6.11.45`, one layer down. `readObserved` reads the keys it is
    // ASKED for and nothing else, so a `progressKey` outside `expect.data` is
    // never read at all — and an unread key is ABSENT every time, HOWEVER THE
    // PAGE READS. Without the `alsoWanted` plumbing this page — which renders
    // the key and changes it every 100 ms — reports `no-progress-key`, a
    // story-authoring accusation against a perfectly healthy run.
    //
    // `architect-turns` is in neither `expect.data` nor the error sentinels,
    // and the page double honours `wanted`, so this is the real condition.
    const beat = beatWith(WAIT);
    assert.equal(Object.hasOwn((beat as never as { expect: { data: object } }).expect.data, 'architect-turns'), false,
      'fixture check: the key must NOT be one the beat declares, or this door proves nothing');
    const page = sessionPage({ progressKey: 'architect-turns', valueAt: (ms) => String(Math.floor(ms / 100)) });

    const stall = await waitForConsequence(
      page as never, beat as never, 1_200, null, null, null, null, null, beat.wait,
    );

    assert.equal(stall, null, 'the key changes every 100 ms: the only way this reds is by never being read');
  });

  test('a beat that declares NO per-transition bound is entirely unchanged', async () => {
    // The negative control. Nothing about the existing waiting model may shift
    // for the nine stories that declare no progress bound.
    const beat = beatWith({ for: 'agent', upTo: 4_000 });
    const page = sessionPage({ progressKey: 'architect-turns', valueAt: () => undefined });

    const began = Date.now();
    const stall = await waitForConsequence(page as never, beat as never, 900, null, null, null, null, null, null);

    assert.equal(stall, null, 'no progress bound declared, so nothing new can stop this beat');
    assert.ok(Date.now() - began >= 800, 'it sits out its bound exactly as it did before');
  });

  test('a key rendered on a DESCENDANT is tracked — not reported as never present', async () => {
    // C's P1, reproduced against this branch before the fix and measured: a key
    // changing every 100 ms on a child element red-ed `no-progress-key`.
    //
    // WHY IT HAPPENED. `alsoWanted` got the key into `readObserved`, and
    // `SAFE_KEY` put it into the descendant selector, so `observed.nested`
    // really did carry it every poll. The READ threw it away:
    // `resolveExpectations` is scoped to `expected` at every tier — `missing`
    // comes from `Object.keys(expected)`, `solo` fills only `missing`, and the
    // early return hands back the ROOT alone — so a key the beat does not
    // itself expect is never looked for among the descendants.
    //
    // It is the same species as the `foo:bar` finding one layer along:
    // absent-because-never-asked-about, reported as absent-because-not-
    // rendered. And it defeats condition 3 exactly — the two expiries stay two
    // and the WRONG one fires, sending the reader to the story file while a
    // funded beat 11 dies at 480 s.
    const beat = beatWith(WAIT);
    const page = sessionPage({
      progressKey: 'architect-turns', progressOn: 'descendant',
      valueAt: (ms) => String(Math.floor(ms / 100)),
    });

    const stall = await waitForConsequence(
      page as never, beat as never, 1_200, null, null, null, null, null, beat.wait,
    );

    assert.equal(stall, null,
      'the key is on a child element and changes every 100 ms: the only way this reds is by reading only the root');
  });

  test('a key that is SEEN and then STOPS RENDERING is its own finding, not a stall', async () => {
    // C's P2. `got === undefined` after a sighting used to fall into the same
    // branch as a frozen value, so the expiry said "The key renders, so this is
    // the agent" about a key that had stopped rendering. A page that unmounts
    // the element is not an agent that stopped emitting, and the sentence told
    // the reader it was — two causes, one answer, which is the species this
    // whole bead exists to stop.
    const beat = beatWith(WAIT);
    const page = sessionPage({
      progressKey: 'architect-turns',
      valueAt: (ms) => (ms < 300 ? String(Math.floor(ms / 100)) : undefined),
    });

    const stall = await waitForConsequence(
      page as never, beat as never, 4_000, null, null, null, null, null, beat.wait,
    );

    assert.notEqual(stall, null);
    assert.match(stall!.why, /^progress-key-vanished:/, `its own prefix: ${stall!.why}`);
    assert.doesNotMatch(stall!.why, /stalled-no-transition/, 'never the stall message');
    assert.doesNotMatch(stall!.why, /The key renders and is still rendering/,
      'and never the claim that the key is still rendering');
    assert.match(stall!.why, /look at the markup/, 'it sends the reader to the right place');
  });

  test('a key carried by SEVERAL elements refuses to guess which one it means', async () => {
    // The third gradation. Picking a carrier would be a measurement of
    // whichever element sorted first — a true reading of the wrong thing, which
    // is the proxy species — so the bound expires and says it could not read
    // the key, rather than reporting a stall it never measured.
    const beat = beatWith(WAIT);
    const page = sessionPage({
      progressKey: 'architect-turns', progressOn: 'descendant', carriers: 3,
      valueAt: (ms) => String(Math.floor(ms / 100)),
    });

    const stall = await waitForConsequence(
      page as never, beat as never, 4_000, null, null, null, null, null, beat.wait,
    );

    assert.notEqual(stall, null, 'a key it cannot read must still end the beat — silence here is the fallback species');
    assert.match(stall!.why, /^ambiguous-progress-key:/, `its own prefix: ${stall!.why}`);
    assert.match(stall!.why, /3 elements/, 'and it says how many carry it');
    assert.match(stall!.why, /NOTHING about the agent/, 'and refuses to be read as a stall');
  });

  test('the channel door\'s stop is the RUNNER\'s too — C\'s one-line finding', async () => {
    // `no-channel` is our measurement of an absent dispatch directory; the
    // product said nothing. The verdict has been announcing it as something
    // "the product had already said so about this session" — a false sentence
    // inside a red. C's call: fix it here rather than bead it, because a bead
    // means the next reader is told something untrue in the meantime.
    const beat = beatWith({ for: 'agent', upTo: 400_000, perTransition: 399_000, progressKey: 'architect-turns' });
    const page = sessionPage({ route: '/projects/gitweave' });

    // Off-session (no `/sessions/` route) and a bound well past twice the
    // ceiling, which is what `doorWorthRunning` requires before the door runs.
    const stall = await waitForConsequence(
      page as never, beat as never, 400_000, null, null, null,
      () => ({ reason: 'no-channel', detail: 'no dispatch directory was born after the press.' }),
      null, beat.wait,
    );

    assert.notEqual(stall, null);
    assert.match(stall!.why, /no-channel/);
    assert.equal((stall as { stoppedBy?: string }).stoppedBy, 'runner',
      'the door is the runner measuring silence, and the verdict must not attribute it to the product');
  });

  test('a progressKey the SELECTOR could not use is refused at the boundary, not half-honoured', async () => {
    // FROM THIS BEAD'S HAND SECURITY REVIEW (§15.333). `readObserved` reads the
    // page ROOT's attributes by name — `getAttribute` takes any string — but
    // builds its DESCENDANT selector only from keys matching `SAFE_KEY`. So a
    // key outside that shape is read on the root and invisible on every child,
    // and this bound would report "the key never appeared" about a key a
    // descendant is rendering: absent-because-uncollected and
    // absent-because-unrendered arriving as one answer.
    //
    // The two patterns are bound to each other HERE rather than by a comment,
    // so they cannot drift (the `STALL_CEILING_MS` arrangement, ruling 580).
    assert.equal(PROGRESS_KEY_SHAPE.source, SAFE_KEY.source,
      'the validator must refuse exactly what the selector cannot use — one pattern, two modules, no drift');

    for (const bad of ['foo:bar', 'foo bar', '1-first', 'foo]', 'foo,bar']) {
      assert.throws(() => beatWith({ ...WAIT, progressKey: bad }), /wait\.progressKey/,
        `\`${bad}\` reaches the root read and never the descendant selector, so it must be refused by name`);
    }
    // And the shape a real story uses is untouched.
    assert.equal((beatWith({ ...WAIT, progressKey: 'architect-turns' }).wait as { progressKey: string }).progressKey,
      'architect-turns');
  });

  test('the verdict does NOT attribute a runner finding to the product', async () => {
    // END TO END, through `driveBeat`, because the clause is appended there.
    //
    // `named()` reads "the product had already said so about this session" —
    // true for `stopReasonFor`, which asks the PRODUCT for its own crashed /
    // terminal / stalled verdict, and false for this bound, which is the
    // runner's own measurement of silence. Appending it here would send a
    // reader hunting for a product verdict that was never made.
    const wait = { for: 'agent', upTo: 4_000, perTransition: 300, progressKey: 'architect-turns' };
    const story = validateStory({
      id: 'per-transition-verdict',
      ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
      docs: { kind: 'how-to' as const, title: 'per-transition verdict' },
      beats: [{
        act: 'read the plan the architect is writing',
        wait,
        expect: { route: ROUTE, data: { page: 'session', 'session-phase': 'awaiting-verdict' } },
        say: 'the beat waits for the architect to finish',
      }],
    }) as { beats: unknown[] };
    const page = sessionPage({ progressKey: 'architect-turns', valueAt: () => 'frozen' });

    const verdict = await driveBeat(
      page as never, story.beats[0] as never, 1, 'http://localhost:4124', {}, 4_000,
    ) as { status: string; failures: string[] };

    assert.equal(verdict.status, 'red', 'the phase never reaches awaiting-verdict, so the beat is red');
    const joined = verdict.failures.join('\n');
    assert.match(joined, /stalled-no-transition/, `the verdict carries the finding: ${joined}`);
    assert.doesNotMatch(joined, /the product had already said so/,
      `the product said nothing about this — the runner measured it:\n${joined}`);
    assert.match(joined, /rather than sitting out its declared bound/,
      'and it still says the beat stopped early rather than timing out');
  });
});
