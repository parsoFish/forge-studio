/**
 * beats-drive.test.ts — the story runner's BROWSER CHOREOGRAPHY.
 *
 * Split out of `beats.test.ts` on 2026-09-05 when that file crossed the
 * 800-line cap. The seam is the one the module already had: `beats.test.ts`
 * pins the PURE verdict (`beatVerdict`, `resolveBeatRoute`, `stuckVerdict`)
 * against observations handed to it, and this file pins `driveBeat` against a
 * fake Studio — the press, the fill and the wait that produce those
 * observations. Not one case changed in the move.
 *
 * These are ACCEPTANCE tests, pinned before the implementation
 * (`_1.0/gate-manifests/M1-B.txt`). Each one names the wrong implementation it
 * kills, because a test that would look identical had the implementation been
 * wrong is characterization, not acceptance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveBeat } from './beats-drive.mjs';

// ── M1-H: the post-press wait, and the state it is leaving (bead `forge-8vfn.2.28`)
//
// THE INCIDENT. S5 reached 1 of 12 beats and S7 3 of 15, both dying at the
// first press, both reporting the same route as source AND target:
//
//   could not click through to "/agents/new" from "/agents/new": locator.click:
//     - element was detached from the DOM, retrying
//
// The press had worked. `driveBeat` raced `waitForURL(target)` against "a link
// to the target is visible", and `new-agent` — like `new-skill`, `new-hook`,
// `new-kb` and `create-project-cta` — IS that link, sitting on the page being
// navigated AWAY from. `Promise.any` resolved on it instantly, `page.url()`
// still read the SOURCE route because Next commits a client-side navigation
// after the transition, and the runner clicked the same link a second time into
// a detaching DOM. Recorded in `_1.0/stories/S5.md` and `S7.md`.
//
// THE CLASS, and why these cases are worth their weight: **a signal that cannot
// tell "not yet" from "already done"** — the same family as `data-page-ready`
// reporting settled-before-its-fetch (M1-G) and settled-not-succeeded (M1-B,
// above). A WAIT THE STATE IT IS LEAVING CAN SATISFY IS NOT A WAIT.
import { el, READY_MAIN, fakeStudio, pressNewAgent, agentsPages } from './test-fixtures/fake-studio.ts';

test('a beat whose PRESSED CONTROL IS the link to its target goes green, and is pressed exactly once', async () => {
  // THE DEFECT. Kills the `Promise.any([waitForURL, linkToTargetVisible])`
  // shipped wait: on this beat the link IS the control just pressed, so it is
  // already visible on `/agents`, the race resolves before the navigation
  // commits, and the runner clicks it again into a detaching DOM. Reproduced
  // three times live — S5 beat 2, S7 beats 2 and 6.
  const page = fakeStudio({ start: '/agents', commitMs: 200, pages: agentsPages });
  const v = await driveBeat(page, pressNewAgent, 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.deepEqual(page.clicks, ['[data-action="new-agent"]']);
});

test('the post-press wait is not satisfied by the page being LEFT, however slowly the route commits', async () => {
  // The invariant, stated on its own: lengthening the commit must not change
  // the verdict. Any wait a pre-existing element can win is a wait whose
  // outcome is decided by a race, and this one is deliberately unwinnable
  // within 800ms — the shipped implementation fails here by construction.
  const page = fakeStudio({ start: '/agents', commitMs: 800, pages: agentsPages });
  const v = await driveBeat(page, pressNewAgent, 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.deepEqual(page.clicks, ['[data-action="new-agent"]']);
});

test('a press that mints a route NOTHING linked to still arrives — the proof story beat 5 shape', async () => {
  // The capability the cut fallback was written for, held from the other side:
  // `onboard-project` is a BUTTON, no link to `/projects/story-proof` exists
  // anywhere before it, and the route must still be reached by waiting.
  const page = fakeStudio({
    start: '/projects/new',
    commitMs: 250,
    pages: {
      '/projects/new': {
        elements: [
          READY_MAIN('projects'),
          el('button', { 'data-action': 'onboard-project' }, '/projects/story-proof'),
        ],
        data: { page: 'projects', 'project-id': 'new', 'page-ready': 'true' },
      },
      '/projects/story-proof': {
        elements: [READY_MAIN('projects')],
        data: { page: 'projects', 'project-id': 'story-proof', 'page-ready': 'true' },
      },
    },
  });
  const beat = {
    act: 'Press "Onboard project →"',
    do: [{ press: 'onboard-project' }],
    expect: {
      route: '/projects/story-proof',
      data: { page: 'projects', 'project-id': 'story-proof', 'page-ready': 'true' },
    },
    say: 'Registering the project lands the operator on its page.',
  };
  const v = await driveBeat(page, beat, 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.deepEqual(page.clicks, ['[data-action="onboard-project"]']);
});

test('a beat with NO do block still reaches its route by clicking the link — the smoke story path', async () => {
  // The sweep: every story authored before this lane navigates by link alone,
  // and the wait this lane changed must not touch that path at all.
  const page = fakeStudio({ start: '/agents', commitMs: 50, pages: agentsPages });
  const v = await driveBeat(page, { ...pressNewAgent, do: undefined }, 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.deepEqual(page.clicks, ['a[href="/agents/new"]']);
});

test('a route nothing links to and no press reaches is still RED, naming where it was stuck', async () => {
  // Fail-CLOSED. Kills a fix that reports green whenever it stopped waiting:
  // an unreachable route must never pass as a beat.
  const page = fakeStudio({ start: '/agents', commitMs: 50, pages: agentsPages });
  const beat = {
    act: 'Reach a route nothing points at',
    expect: { route: '/nowhere', data: { page: 'nowhere' } },
    say: 'It cannot be reached.',
  };
  const v = await driveBeat(page, beat, 1, 'http://localhost:4124');
  assert.equal(v.status, 'red');
  assert.match(v.failures.join(' | '), /no real-nav path to "\/nowhere" from "\/agents"/);
});

// ---------------------------------------------------------------------------
// Ruling 52 (operator, wave-2 open) — `fill` learns radios and checkboxes.
//
// THE DEFECT, measured three times: `performSteps` calls `locator.fill` on
// whatever the handle resolves to, and playwright refuses a radio or a
// checkbox outright — `Input of type "radio" cannot be filled`. So the beat
// dies before the product is ever asked a question, and the red is the
// HARNESS's, not the product's. S9 beat 5 hit it on the model-tier radios
// (`_1.0/stories/S9.md`), S7 beat 7 on the network-egress checkbox.
//
// The two live DOM shapes, read off the product and reproduced verbatim below:
//
//   radio     <label data-field="kickoff-model-tier-option">
//               <input type="radio" name="modelTier" value="opus"> opus
//             </label>                          × one per allowed tier
//             (apps/studio/components/studio/session/KickoffModelTierPicker.tsx:57)
//
//   checkbox  <input type="checkbox" data-field="hook-permissions-network">
//             (apps/studio/app/hooks/new/page.tsx:130)
//
// The radio shape carries TWO consequences the naive fix misses: the handle is
// on the LABEL (so `check()` on it throws "Not a checkbox or radio button"),
// and it matches N times (so `.first()` picks a tier at random — a green beat
// that set the wrong model is worse than the red one it replaced). `with` must
// therefore SELECT among the matches, never index into them.
//
// Kills, taken together: (1) fill-on-a-radio throwing; (2) a fix that checks
// `.first()` regardless of `with`; (3) a fix that treats `with: ''` on a
// checkbox as "type nothing" instead of "leave it unticked"; (4) a fix that
// silently picks something when `with` names no option; (5) a fix that changes
// what `fill` does to a text input or a `<select>`.

/** The model-tier picker as `KickoffModelTierPicker.tsx` renders it, both tiers. */
const tierRadio = (tier: string, checked = false) =>
  el('label', { 'data-field': 'kickoff-model-tier-option' }, null, [
    el('input', { type: 'radio', name: 'modelTier', value: tier, ...(checked ? { checked: 'true' } : {}) }),
  ], tier);

const kickoffPages = {
  '/sessions/authoring/new': {
    elements: [
      READY_MAIN('session-kickoff'),
      el('textarea', { 'data-field': 'kickoff-prompt' }),
      el('select', { 'data-field': 'kickoff-project' }),
      tierRadio('sonnet', true),
      tierRadio('opus'),
      el('input', { type: 'checkbox', 'data-field': 'hook-permissions-network', checked: 'true' }),
    ],
    data: { page: 'session-kickoff', 'page-ready': 'true' },
  },
};

const kickoffBeat = (steps: unknown[]) => ({
  act: 'Set the model this session will run on',
  do: steps,
  expect: { route: '/sessions/authoring/new', data: { page: 'session-kickoff', 'page-ready': 'true' } },
  say: 'The operator picks the tier.',
});

test('fill on a RADIO checks the option whose value is `with`, not the first one on the page', async () => {
  // THE DEFECT (S9 beat 5) and its subtler twin: `.first()` is `sonnet` here,
  // so a fix that checks the first match would go green having set the wrong
  // model — the story would report a knob as working while proving nothing.
  const page = fakeStudio({ start: '/sessions/authoring/new', commitMs: 0, pages: kickoffPages });
  const v = await driveBeat(page, kickoffBeat([{ fill: 'kickoff-model-tier-option', with: 'opus' }]), 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.deepEqual(page.checked, [{ handle: '[data-field="kickoff-model-tier-option"]', value: 'opus', state: true }]);
});

test('fill on a radio whose `with` names NO option is RED, naming the value and every option there was', async () => {
  // Fail-CLOSED, with the closed-vocabulary error contract SPEC §5 requires:
  // name the offending value AND the allowed set. Kills a fix that falls back
  // to the first match, and one that reports a bare playwright timeout.
  const page = fakeStudio({ start: '/sessions/authoring/new', commitMs: 0, pages: kickoffPages });
  const v = await driveBeat(page, kickoffBeat([{ fill: 'kickoff-model-tier-option', with: 'haiku' }]), 1, 'http://localhost:4124');
  assert.equal(v.status, 'red');
  const text = v.failures.join(' | ');
  assert.match(text, /"haiku"/);
  assert.match(text, /sonnet/);
  assert.match(text, /opus/);
  assert.deepEqual(page.checked, []);
});

test('fill on a CHECKBOX with "" UNTICKS it — S7 beat 7\'s "leave it unticked"', async () => {
  // Kills a fix that maps `with: ''` onto `fill('')` (playwright refuses) and
  // one that maps any string onto check() (which would ARM network egress in
  // the very beat that exists to prove it stays off).
  const page = fakeStudio({ start: '/sessions/authoring/new', commitMs: 0, pages: kickoffPages });
  const v = await driveBeat(page, kickoffBeat([{ fill: 'hook-permissions-network', with: '' }]), 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.deepEqual(page.checked, [{ handle: '[data-field="hook-permissions-network"]', value: '', state: false }]);
});

test('fill on a checkbox with "true" TICKS it', async () => {
  const page = fakeStudio({ start: '/sessions/authoring/new', commitMs: 0, pages: kickoffPages });
  const v = await driveBeat(page, kickoffBeat([{ fill: 'hook-permissions-network', with: 'true' }]), 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', v.failures.join(' | '));
  // `value` is the input's own `value` attribute — this checkbox carries none,
  // so it reads '' in BOTH directions. The state is the assertion.
  assert.deepEqual(page.checked, [{ handle: '[data-field="hook-permissions-network"]', value: '', state: true }]);
});

test('fill on a checkbox with a value in NEITHER half of the vocabulary is RED, naming the allowed set', async () => {
  // A checkbox has two states and `with` is a free string; an unknown value
  // must be refused, not guessed. Same contract as the radio above.
  const page = fakeStudio({ start: '/sessions/authoring/new', commitMs: 0, pages: kickoffPages });
  const v = await driveBeat(page, kickoffBeat([{ fill: 'hook-permissions-network', with: 'maybe' }]), 1, 'http://localhost:4124');
  assert.equal(v.status, 'red');
  const text = v.failures.join(' | ');
  assert.match(text, /"maybe"/);
  assert.match(text, /true/);
  assert.match(text, /false/);
  assert.deepEqual(page.checked, []);
});

test('THE NEGATIVE CONTROL: fill on a text control and on a <select> is byte-for-byte what it was', async () => {
  // The whole point of a one-concern harness PR. If this moves, the change
  // reached past the two input types ruling 52 scopes it to.
  const page = fakeStudio({ start: '/sessions/authoring/new', commitMs: 0, pages: kickoffPages });
  const v = await driveBeat(
    page,
    kickoffBeat([
      { fill: 'kickoff-prompt', with: 'build me a thing' },
      { fill: 'kickoff-project', with: 'mdtoc' },
    ]),
    1,
    'http://localhost:4124',
  );
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.deepEqual(page.filled, [{ handle: '[data-field="kickoff-prompt"]', value: 'build me a thing' }]);
  assert.deepEqual(page.selected, [{ handle: '[data-field="kickoff-project"]', value: 'mdtoc' }]);
  assert.deepEqual(page.checked, []);
});

// ── 6.11.45: A REPEAT'S `until` IS READ FROM THE PAGE, NOT ONLY THE BEAT'S KEYS
//
// THE INCIDENT, measured on S1 run 9 (funded, $3.7414). The architect finished:
// `architect turn end (phase=awaiting-verdict)` at 23:46:57.740, with `PLAN.md`
// and `PLAN.html` written. #516 captured the page at beat 11's red **2 m 24 s
// later** and it carried, on one element each, `data-session-phase=
// "awaiting-verdict"`, `data-architect-phase="awaiting-verdict"`,
// `data-page-ready="true"` and `data-action="open-plan"`. The beat's `until` is
// `{'session-phase': 'awaiting-verdict'}`. **The page was showing the loop's own
// stop condition, met, and the loop reported it unmet for the whole bound.**
//
// THE CAUSE. `readObserved` collected `[...Object.keys(beat.expect.data),
// ...ERROR_SENTINELS]` and nothing else. `until` is the repeat's OWN condition
// (T1 ruling 320) and its keys were never added to that read, so `matchesData`
// asked `Object.hasOwn(seen, 'session-phase')` for a key nobody collected and
// answered `false` HOWEVER THE PAGE READ.
//
// WHY THE ASYMMETRY IS THE PROOF, and not just a story that fits: S1 beat 11's
// `expect.data` is `section`/`architect-phase`/`gate-armed`/`plan-mode` — no
// `session-phase` — so its `until` could never be satisfied on any product. S2
// beat 12's `expect.data` DOES declare `session-phase`, so its `until` is
// readable and its red is a different matter entirely.
//
// AND WHY NO TEST CAUGHT IT: `fakeStudio.evaluate` returned every declared key
// whatever the read asked for, so an uncollected key still arrived. That is
// fixed above, and these two cases stand on the honest fake.

/** The beat S1 beat 11 is, reduced to the shape that carries the defect. */
const answerUntilVerdict = (expectData: Record<string, string>) => ({
  act: 'Open the session, read the plan and press Approve',
  do: [
    {
      repeat: [{ fillAll: 'question-freetext', with: 'an answer' }, { press: 'submit-answers' }],
      until: { 'session-phase': 'awaiting-verdict' },
    },
  ],
  wait: { for: 'agent', upTo: 1500 },
  expect: { route: '/sessions/architect/x', data: expectData },
});

/** A drafted session: the interview is over, so no answer control is on the page. */
const draftedSession = () => ({
  start: '/sessions/architect/x',
  commitMs: 0,
  pages: {
    '/sessions/architect/x': {
      elements: [READY_MAIN('session'), el('a', { 'data-action': 'open-plan' })],
      data: {
        page: 'session',
        'page-ready': 'true',
        'session-kind': 'architect',
        'session-phase': 'awaiting-verdict',
        'architect-phase': 'awaiting-verdict',
      },
    },
  },
});

test('6.11.45 (RED): a repeat stops on an `until` key the beat does not declare — the page is asked for it', async () => {
  // S1 beat 11's own key set: no `session-phase` among them. On the unfixed
  // read this loop cannot see `awaiting-verdict` however plainly the page says
  // it, and spends the whole declared bound before reporting `until` unmet —
  // which is exactly what a funded run measured, 2 m 24 s after the plan was
  // on disk.
  const page = fakeStudio(draftedSession());
  const beat = answerUntilVerdict({ 'architect-phase': 'awaiting-verdict', page: 'session' });
  const started = Date.now();
  const v = await driveBeat(page, beat, 1, 'http://localhost:4124');
  const elapsed = Date.now() - started;

  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.ok(elapsed < 1000, `the loop must stop when its own condition is met, not at the bound — took ${elapsed} ms of 1500`);
  assert.deepEqual(page.clicks, [], 'nothing was submitted: the interview was already over');
});

test('6.11.45: a beat that DOES declare the `until` key stays green — the positive control', async () => {
  // S2 beat 12's key set. It worked before this change and must work after:
  // the read collects the UNION, so a key declared twice is collected once and
  // nothing that used to be read stops being read.
  const page = fakeStudio(draftedSession());
  const beat = answerUntilVerdict({
    page: 'session',
    'page-ready': 'true',
    'session-kind': 'architect',
    'session-phase': 'awaiting-verdict',
  });
  const v = await driveBeat(page, beat, 1, 'http://localhost:4124');

  assert.equal(v.status, 'green', v.failures.join(' | '));
});

// ── ruling 438: a beat that MINTS a value always waits, even with no `do` ─────
//
// MEASURED, S2 beat 10 in M5: the beat has no `do` block that navigates and no
// declared `wait`, so `driveBeat`'s condition — `steps.length > 0 ||
// bound.label !== null` — was false and the page was read ONCE. A binding
// attribute that is always PRESENT reads `""` on that single read, before the
// mint returns, and the beat reds with `got ""`. Bead `forge-8vfn.6.11.5`
// answered it in the PRODUCT, by making the attribute ABSENT until it has a
// value — fixing in `apps/studio` a defect that lives in the runner, and
// leaving every future always-present binding attribute to fail the same way.
//
// A mint is asynchronous by definition. `answers()` already treats `""` as
// not-yet (`beats-page.mjs:29`), so the wait is bounded and terminating: it
// ends when the value arrives, or at the beat's own bound with the key named.
// This is the wiring that was missing, not a new rule.
//
// A: ruling 437's always-present `data-architect-session-id` is sequenced
// behind this change, and its funded S2 proof run behind that.

/** A page whose binding attribute is empty for `emptyReads` reads, then minted. */
function mintingStudio(emptyReads: number, id = 'sid-9') {
  let reads = 0;
  return fakeStudio({
    start: '/architect/new',
    commitMs: 0,
    pages: {
      '/architect/new': {
        elements: [el('main', { page: 'architect-new' })],
        get data() {
          reads += 1;
          return {
            page: 'architect-new',
            'architect-session-id': reads > emptyReads ? id : '',
          };
        },
      },
    },
  });
}

const mintBeat = {
  act: 'press start and watch the id appear',
  expect: {
    route: '/architect/new',
    data: { page: 'architect-new', 'architect-session-id': '<architectSessionId>' },
  },
  say: 'the id is minted asynchronously',
};

test('438 (i): a binding attribute that is "" for two reads then minted goes GREEN', async () => {
  const page = mintingStudio(2);
  const v = await driveBeat(page, mintBeat, 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', `failures: ${JSON.stringify(v.failures)}`);
  assert.equal(v.bindings?.architectSessionId, 'sid-9', 'and the minted value is bound for a later beat\'s route');
});

test('438 (ii) POSITIVE CONTROL: a value that never arrives reds, NAMING the key and the bound', async () => {
  const page = mintingStudio(Number.MAX_SAFE_INTEGER);
  const v = await driveBeat(page, mintBeat, 1, 'http://localhost:4124', {}, 400);
  assert.equal(v.status, 'red');
  const said = (v.failures ?? []).join(' | ');
  assert.match(said, /architect-session-id/, `the key must be named: ${said}`);
  assert.match(said, /minted nothing within/, `and the bound must be named: ${said}`);
});

test('438 (iii) POSITIVE CONTROL: a placeholder-free do-less beat still reads ONCE', async () => {
  // The change must not turn every observing beat into a poll — a beat with
  // nothing to wait for waits for nothing, exactly as before.
  let reads = 0;
  const page = fakeStudio({
    start: '/agents',
    commitMs: 0,
    pages: {
      '/agents': {
        elements: [el('main', { page: 'agents-index' })],
        get data() { reads += 1; return { page: 'agents-index', 'page-ready': 'true' }; },
      },
    },
  });
  const v = await driveBeat(
    page,
    { act: 'look', expect: { route: '/agents', data: { page: 'agents-index', 'page-ready': 'true' } }, say: 'x' },
    1, 'http://localhost:4124',
  );
  assert.equal(v.status, 'green');
  assert.ok(reads <= 2, `a beat with no placeholder and no do must not poll — it read ${reads} times`);
});

// ── 7.5.3: the runner read query-BLIND and selected query-STRICT ─────────────
//
// MEASURED (T1 ruling 451, D's evidence). `readObserved` compares
// `new URL(page.url()).pathname`, so a beat declaring `/sessions/demo/x`
// ACCEPTS arriving at `/sessions/demo/x?project=gitpulse`. Selection did the
// opposite: an exact `[href="/sessions/demo/x"]`, which that anchor does not
// match. The runner therefore refused to find a link to a URL it would have
// been happy to arrive at, and said "no link points at it" with the anchor on
// the page.
//
// It is not hypothetical: three LIVE sites mount `SessionMinted` with a
// `project` — `DemoStageHandoff.tsx:60`, `DemoTimeline.tsx:215`,
// `ContractResolutionPanel.tsx:295` — so the whole demo path carries
// `?project=`, and A's S9 run 2 died on it.
//
// Site-by-site query dropping was refused: a link that legitimately needs a
// parameter must stay reachable, and a beat should declare the route an
// operator would say out loud rather than the product's parameter plumbing.

const QUERIED_PAGES = {
  '/projects/gitpulse': {
    elements: [
      READY_MAIN('projects'),
      // The shape the three live sites emit.
      el('a', { href: '/sessions/demo/sid-1?project=gitpulse' }, '/sessions/demo/sid-1'),
    ],
    data: { page: 'projects', 'page-ready': 'true' },
  },
  '/sessions/demo/sid-1': {
    elements: [READY_MAIN('session')],
    data: { page: 'session', 'page-ready': 'true' },
  },
};

test('7.5.3 (RED): a link whose href carries a QUERY is found by the beat\'s bare route', async () => {
  const page = fakeStudio({ start: '/projects/gitpulse', commitMs: 50, pages: QUERIED_PAGES });
  const v = await driveBeat(
    page,
    {
      act: 'open the demo session the hand-off points at',
      expect: { route: '/sessions/demo/sid-1', data: { page: 'session', 'page-ready': 'true' } },
      say: 'the anchor carries ?project=, the beat does not',
    },
    1,
    'http://localhost:4124',
  );
  assert.equal(v.status, 'green', `failures: ${JSON.stringify(v.failures)}`);
});

test('7.5.3 POSITIVE CONTROL: two links differing ONLY in query are NAMED, never picked', async () => {
  // Two destinations, one pathname. Choosing by DOM order is how a beat
  // silently starts asserting the wrong page — the same shape as
  // `resolveExpectations`' best-match tie-break. The runner refuses and says so.
  const page = fakeStudio({
    start: '/projects/gitpulse',
    commitMs: 50,
    pages: {
      ...QUERIED_PAGES,
      '/projects/gitpulse': {
        elements: [
          READY_MAIN('projects'),
          el('a', { href: '/sessions/demo/sid-1?project=gitpulse' }, '/sessions/demo/sid-1'),
          el('a', { href: '/sessions/demo/sid-1?project=gitweave' }, '/sessions/demo/sid-1'),
        ],
        data: { page: 'projects', 'page-ready': 'true' },
      },
    },
  });
  const v = await driveBeat(
    page,
    {
      act: 'open the demo session',
      expect: { route: '/sessions/demo/sid-1', data: { page: 'session' } },
      say: 'two hand-offs, one pathname',
    },
    1,
    'http://localhost:4124',
  );
  assert.equal(v.status, 'red');
  const said = (v.failures ?? []).join(' | ');
  assert.match(said, /ambiguous real-nav path/, said);
  assert.match(said, /project=gitpulse/, `it names the candidates: ${said}`);
  assert.match(said, /project=gitweave/, `both of them: ${said}`);
});

test('7.5.3 POSITIVE CONTROL: a route NOTHING links to is still unreachable', async () => {
  // Query-blindness widens what counts as a link, and must not turn "no link"
  // into "some link". The refusal is the guard real-nav-only exists for.
  const page = fakeStudio({ start: '/projects/gitpulse', commitMs: 50, pages: QUERIED_PAGES });
  const v = await driveBeat(
    page,
    { act: 'go somewhere nothing points at', expect: { route: '/monitor', data: { page: 'monitor' } }, say: 'x' },
    1,
    'http://localhost:4124',
  );
  assert.equal(v.status, 'red');
  assert.match((v.failures ?? []).join(' | '), /no real-nav path to "\/monitor"/);
});

test('7.5 (ruling 514): a beat whose route CARRIES a query picks that link out of two sharing the pathname', async () => {
  // The inverse of the case above, and D's S6 beat 7 is the live instance:
  // the Knowledge page offers `/knowledge` AND `/knowledge?id=story-s6`, and
  // the beat MEANS the second. Query-blind selection (7.5.3) can only see two
  // links sharing a pathname and refuse, which is right when the beat says
  // `/knowledge` and wrong when it says which one it wants.
  //
  // The rule this pins: a route that DECLARES a query is matched on pathname
  // AND query exactly; a route that declares none keeps matching pathname
  // only, so the product staying free to add `?project=…` costs nothing.
  const pages = {
    '/projects/gitpulse': {
      elements: [
        READY_MAIN('projects'),
        el('a', { href: '/knowledge' }, '/knowledge'),
        el('a', { href: '/knowledge?id=story-s6' }, '/knowledge?id=story-s6'),
      ],
      data: { page: 'projects', 'page-ready': 'true' },
    },
    '/knowledge': { elements: [READY_MAIN('knowledge')], data: { page: 'knowledge', 'page-ready': 'true', 'kb-id': 'cycles' } },
    '/knowledge?id=story-s6': {
      elements: [READY_MAIN('knowledge')],
      data: { page: 'knowledge', 'page-ready': 'true', 'kb-id': 'story-s6' },
    },
  };

  const wanted = await driveBeat(
    fakeStudio({ start: '/projects/gitpulse', commitMs: 50, pages }),
    {
      act: 'open the story-s6 knowledge base',
      expect: { route: '/knowledge?id=story-s6', data: { page: 'knowledge', 'kb-id': 'story-s6' } },
      say: 'the beat names the destination it means',
    },
    1,
    'http://localhost:4124',
  );
  assert.equal(wanted.status, 'green', `failures: ${JSON.stringify(wanted.failures)}`);

  // POSITIVE CONTROL, same page: with no query declared the ambiguity stands.
  // Without this, "picks the queried one" could be satisfied by quietly
  // preferring a link with a query, which is the tie-break 7.5.3 forbids.
  const unwanted = await driveBeat(
    fakeStudio({ start: '/projects/gitpulse', commitMs: 50, pages }),
    {
      act: 'open knowledge',
      expect: { route: '/knowledge', data: { page: 'knowledge' } },
      say: 'the beat does not say which',
    },
    1,
    'http://localhost:4124',
  );
  assert.equal(unwanted.status, 'red');
  assert.match((unwanted.failures ?? []).join(' | '), /ambiguous real-nav path/);
});

test('586: two links to one page differing ONLY in fragment are ONE candidate, not an ambiguity', async () => {
  // RED BEFORE THE FIX, and bought by G1/S10 run 5's beat 6:
  //
  //   ambiguous real-nav path to "/projects/gitpulse" … 2 links share that
  //   pathname and differ only in their query —
  //   /projects/gitpulse , /projects/gitpulse#roadmap
  //
  // They differ in FRAGMENT, and the message named the defect out loud. The
  // candidates are chosen by `routeMatches`, which has been fragment-blind
  // since ruling 546 — a fragment-only href is not a different place — and were
  // then deduped by `new Set` over the RAW HREF STRINGS, which is blind to
  // nothing. The predicate said "one destination", the Set said "two strings",
  // and the guard fired on the Set. Beats 6–22 were lost to it.
  const page = fakeStudio({
    start: '/artifact',
    commitMs: 50,
    pages: {
      '/artifact': {
        elements: [
          READY_MAIN('artifact'),
          // `el`'s THIRD argument is `navigatesTo`, not the link text — both
          // land on the same page, which is the whole claim under test.
          el('a', { href: '/projects/gitpulse' }, '/projects/gitpulse'),
          el('a', { href: '/projects/gitpulse#roadmap' }, '/projects/gitpulse'),
        ],
        data: { page: 'artifact', 'page-ready': 'true' },
      },
      '/projects/gitpulse': {
        elements: [READY_MAIN('projects')],
        data: { page: 'projects', 'page-ready': 'true' },
      },
    },
  });
  const v = await driveBeat(
    page,
    {
      act: 'Go back to the project the plan belongs to',
      expect: { route: '/projects/gitpulse', data: { page: 'projects' } },
      say: 'one page, two ways to say so',
    },
    1,
    'http://localhost:4124',
  );
  assert.equal(v.status, 'green', `failures: ${JSON.stringify(v.failures)}`);
});

test('586 POSITIVE CONTROL: collapsing fragments does not swallow a QUERY difference', async () => {
  // The sharp control. "Ignore the fragment" must not become "ignore what is
  // next to the fragment": these two carry fragments AND differ in query, which
  // makes them two destinations (ruling 514). The refusal must survive, or the
  // fix has traded a false refusal for a silent wrong-page assertion — the
  // tie-break 527 forbids.
  const page = fakeStudio({
    start: '/projects/gitpulse',
    commitMs: 50,
    pages: {
      '/projects/gitpulse': {
        elements: [
          READY_MAIN('projects'),
          el('a', { href: '/knowledge?id=a#top' }, '/knowledge'),
          el('a', { href: '/knowledge?id=b#top' }, '/knowledge'),
        ],
        data: { page: 'projects', 'page-ready': 'true' },
      },
      '/knowledge': { elements: [READY_MAIN('knowledge')], data: { page: 'knowledge', 'page-ready': 'true' } },
    },
  });
  const v = await driveBeat(
    page,
    { act: 'open knowledge', expect: { route: '/knowledge', data: { page: 'knowledge' } }, say: 'which one?' },
    1,
    'http://localhost:4124',
  );
  assert.equal(v.status, 'red');
  const said = (v.failures ?? []).join(' | ');
  assert.match(said, /ambiguous real-nav path/, said);
  assert.match(said, /id=a/, `it names both candidates: ${said}`);
  assert.match(said, /id=b/, said);
  assert.match(said, /QUERY/, `and now the message is true as written: ${said}`);
});
