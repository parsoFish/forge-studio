/**
 * beats.test.ts — the story runner's per-beat verdict.
 *
 * These are ACCEPTANCE tests, pinned before the implementation
 * (`_1.0/gate-manifests/M1-B.txt`). Each one names the wrong implementation it
 * kills, because a test that would look identical had the implementation been
 * wrong is characterization, not acceptance.
 *
 * The defect class every case here exists to make impossible: a beat that
 * cannot find the state it asserted reporting green anyway. That is the
 * `declared-data-fails-open` family — a value parsed and surfaced but enforced
 * nowhere — and it is the single most-repeated finding of the wave-4 and
 * wave-8 campaigns. A story is a gate; a gate that reports green having not
 * looked is worse than no gate at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beatVerdict, driveBeat, resolveBeatRoute, stuckVerdict } from './beats.mjs';

const beat = {
  act: 'Click through to the Projects pillar',
  expect: { route: '/projects', data: { 'page-ready': 'true', 'project-count': '3' } },
  say: 'The Projects pillar lists every project forge manages.',
};

test('a beat whose route and every data-* expectation hold is green', () => {
  const v = beatVerdict(beat, { route: '/projects', data: { 'page-ready': 'true', 'project-count': '3' } });
  assert.equal(v.status, 'green');
  assert.deepEqual(v.failures, []);
});

test('a beat whose data-* expectation FAILS returns a red verdict naming the attribute and both values', () => {
  // Kills: a verdict that compares nothing, or reports the mismatch without
  // saying which attribute or what it expected — an operator reading the run
  // must not have to re-run it to find out what broke.
  const v = beatVerdict(beat, { route: '/projects', data: { 'page-ready': 'true', 'project-count': '0' } });
  assert.equal(v.status, 'red');
  assert.equal(v.failures.length, 1);
  assert.match(v.failures[0], /project-count/);
  assert.match(v.failures[0], /expected "3"/);
  assert.match(v.failures[0], /got "0"/);
});

test('a MISSING data-* attribute is red and says absent — never treated as a pass', () => {
  // Kills the fail-open implementation: `if (observed[k] && observed[k] !== want)`,
  // which lets an attribute the UI never rendered slip through as green. This is
  // the exact shape of M0's merge-gate `catch -> return { ok: true }` and of
  // M1-D's brain lint reporting 0 errors having skipped Brain 3 entirely.
  const v = beatVerdict(beat, { route: '/projects', data: { 'page-ready': 'true' } });
  assert.equal(v.status, 'red');
  assert.equal(v.failures.length, 1);
  assert.match(v.failures[0], /project-count/);
  assert.match(v.failures[0], /absent/);
});

test('an empty observation is red on every expectation, not silently green', () => {
  // Kills: a verdict that iterates the OBSERVED keys instead of the EXPECTED
  // ones. That implementation passes all of the above and still reports green
  // for a page that rendered nothing at all.
  const v = beatVerdict(beat, { route: '/projects', data: {} });
  assert.equal(v.status, 'red');
  assert.equal(v.failures.length, 2);
});

test('landing on the wrong route is red even when every data-* matches', () => {
  // Kills a verdict that checks only attributes: real nav can land somewhere
  // unintended while the asserted attributes happen to exist on that page too.
  const v = beatVerdict(beat, { route: '/', data: { 'page-ready': 'true', 'project-count': '3' } });
  assert.equal(v.status, 'red');
  assert.match(v.failures.join(' '), /route/);
  assert.match(v.failures.join(' '), /\/projects/);
});

test('every failed expectation is reported, not just the first', () => {
  // Kills a short-circuiting verdict. An operator must see the whole truth of
  // one run, not discover the next broken expectation one re-run at a time.
  const v = beatVerdict(beat, { route: '/', data: {} });
  assert.equal(v.failures.length, 3);
});

test('the verdict carries the narration and act forward for the doc fragment', () => {
  // The triple output (verdict, clip, doc) comes from ONE script; the doc
  // fragment reads these fields off the verdict, so they must survive it.
  const v = beatVerdict(beat, { route: '/projects', data: { 'page-ready': 'true', 'project-count': '3' } });
  assert.equal(v.act, beat.act);
  assert.equal(v.say, beat.say);
});

test('the verdict is frozen and does not mutate the beat it judged', () => {
  const input = structuredClone(beat);
  const v = beatVerdict(input, { route: '/x', data: {} });
  assert.ok(Object.isFrozen(v));
  assert.deepEqual(input, beat);
});

// ---------------------------------------------------------------------------
// Settled != succeeded. Found by adversarial review, 2026-08-29.
// ---------------------------------------------------------------------------

test('a page that SETTLED INTO AN ERROR is red, even though every declared expectation holds', () => {
  // THE DEFECT THIS KILLS, and it is the campaign's headline class. The
  // product's own convention (`components/PageLoadError.tsx`, and
  // `ProjectsIndex.tsx:115`: `error ? 'error' : ready ? 'ok' : 'loading'`) is
  // that a route whose fetch THREW still renders its own data-page and
  // `data-page-ready="true"` — it HAS settled, into an honest failure — and
  // says so via `data-fetch-status="error"`.
  //
  // So a beat asserting only {page, page-ready} — which is exactly what the
  // shipped smoke story asserted — goes GREEN against a visibly broken page.
  // The runner must judge the error sentinels whether or not the story
  // author remembered them; relying on nine story authors to each remember
  // is how this class survives.
  const v = beatVerdict(beat, {
    route: '/projects',
    data: { 'page-ready': 'true', 'project-count': '3', 'fetch-status': 'error' },
  });
  assert.equal(v.status, 'red');
  assert.match(v.failures.join(' '), /fetch-status/);
});

test('data-load-error="true" is red on the same grounds', () => {
  const v = beatVerdict(beat, {
    route: '/projects',
    data: { 'page-ready': 'true', 'project-count': '3', 'load-error': 'true' },
  });
  assert.equal(v.status, 'red');
  assert.match(v.failures.join(' '), /load-error/);
});

test('a story that DELIBERATELY asserts the error state is honoured, not overridden', () => {
  // The escape hatch: a story about the error surface itself must be able to
  // assert it. The invariant only fires on an error the story did not ask for.
  const errorBeat = {
    act: 'See the honest failure when the roster read fails',
    expect: { route: '/projects', data: { 'fetch-status': 'error' } },
    say: 'The page says it could not load, instead of pretending to be empty.',
  };
  const v = beatVerdict(errorBeat, { route: '/projects', data: { 'fetch-status': 'error' } });
  assert.equal(v.status, 'green');
});

test('fetch-status "ok" and "loading" are not treated as errors', () => {
  const ok = beatVerdict(beat, {
    route: '/projects',
    data: { 'page-ready': 'true', 'project-count': '3', 'fetch-status': 'ok' },
  });
  assert.equal(ok.status, 'green');
});

// ── M1-F: nested `data-*` and prior-beat route segments (bead forge-8vfn.2.17)
//
// `docs/forge-ui-dom-and-harness.md` states that nested `data-*` IS the
// contract — the project card is
// `a[data-card-type="project"][data-card-id][data-health]`, not an attribute of
// `main[data-page]`. The shipped reader queried `main[data-page]` only, so the
// runner's read scope was narrower than the contract it judged, and S1 beat 1
// reported "absent from the page" about state the page plainly rendered.
//
// The split is deliberate: the READER stays value-blind (it collects by key),
// and every value judgement lives here, in the pure function.

const cardBeat = {
  act: 'Open Studio on the Projects pillar',
  expect: {
    route: '/projects',
    data: { page: 'projects-index', 'card-id': 'gitweave', health: 'attention' },
  },
  say: 'GitWeave is discovered from disk but needs attention.',
};

// The live DOM of `/projects`, booted from this lane's worktree on 2026-08-30.
const liveProjectsIndex = {
  route: '/projects',
  data: { page: 'projects-index' },
  nested: [
    { 'card-id': 'gitweave', health: 'attention' },
    { 'card-id': 'mdtoc', health: 'healthy' },
  ],
};

test('a data-* expectation the page renders on a NESTED element is satisfied', () => {
  // Kills the shipped reader's scope: `card-id` and `health` live on the card,
  // never on `main`, and reporting them absent is a false red about the harness
  // dressed as a product gap.
  const v = beatVerdict(cardBeat, liveProjectsIndex);
  assert.equal(v.status, 'green', v.failures.join(' | '));
});

test('nested expectations must be satisfied by ONE element, not assembled from two', () => {
  // Kills per-key existential matching. With gitweave healthy and mdtoc needing
  // attention, "the gitweave card needs attention" is FALSE, but a reader that
  // answers each key independently reports it true — the fail-open shape this
  // module exists to prevent, one layer down from the root.
  const v = beatVerdict(cardBeat, {
    route: '/projects',
    data: { page: 'projects-index' },
    nested: [
      { 'card-id': 'gitweave', health: 'healthy' },
      { 'card-id': 'mdtoc', health: 'attention' },
    ],
  });
  assert.equal(v.status, 'red');
});

test('a nested expectation nothing on the page carries is still red, and says absent', () => {
  const v = beatVerdict(cardBeat, { route: '/projects', data: { page: 'projects-index' }, nested: [] });
  assert.equal(v.status, 'red');
  assert.ok(v.failures.some((f) => /card-id.*absent from the page/.test(f)), v.failures.join(' | '));
});

test('main\'s own attribute still wins over a nested element carrying the same key', () => {
  // The page root is the page's own statement about itself. A nested element
  // must never be able to overrule it — that would let a stale card satisfy a
  // page-level assertion.
  const v = beatVerdict(
    { ...cardBeat, expect: { route: '/projects', data: { page: 'projects-index' } } },
    { route: '/projects', data: { page: 'projects-index' }, nested: [{ page: 'not-found' }] },
  );
  assert.equal(v.status, 'green', v.failures.join(' | '));
});

test('an observation with no nested records at all behaves exactly as before', () => {
  // Every story authored before this lane, and every beat asserting only
  // page-root state, must be judged identically.
  const v = beatVerdict(beat, { route: '/projects', data: { 'page-ready': 'true', 'project-count': '3' } });
  assert.equal(v.status, 'green', v.failures.join(' | '));
});

// ── Binding a route segment a prior beat produced.
//
// The pinned S1 already writes the convention: beat 4 declares
// `'onboard-session-id': '<sessionId>'` and beats 5-6 route
// `/sessions/onboarding/<sessionId>`. The shipped shape is that one.

const bindBeat = {
  act: 'Press "Run onboarding agent"',
  expect: { route: '/projects/gitweave', data: { 'onboard-session-id': '<sessionId>' } },
  say: 'An Agent fills the contract in.',
};

test('a <name> expectation is satisfied by any value and binds it for later beats', () => {
  const v = beatVerdict(bindBeat, {
    route: '/projects/gitweave',
    data: {},
    nested: [{ 'onboard-session-id': 'onb-7f3c1a' }],
  });
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.equal(v.bindings.sessionId, 'onb-7f3c1a');
});

test('a <name> expectation the page answers with an EMPTY value is red, not bound', () => {
  // Kills "any value at all": an id attribute rendered as "" is a product that
  // minted nothing, and binding it would put an empty segment in a later route.
  const v = beatVerdict(bindBeat, { route: '/projects/gitweave', data: { 'onboard-session-id': '' }, nested: [] });
  assert.equal(v.status, 'red');
  assert.deepEqual(v.bindings, {});
});

test('a <name> expectation the page does not render at all is red and says absent', () => {
  const v = beatVerdict(bindBeat, { route: '/projects/gitweave', data: {}, nested: [] });
  assert.equal(v.status, 'red');
  assert.ok(v.failures.some((f) => /onboard-session-id.*absent/.test(f)), v.failures.join(' | '));
});

test('resolveBeatRoute substitutes a segment an earlier beat bound', () => {
  const beat5 = { ...bindBeat, expect: { route: '/sessions/onboarding/<sessionId>', data: { page: 'session' } } };
  const r = resolveBeatRoute(beat5, { sessionId: 'onb-7f3c1a' });
  assert.equal(r.route, '/sessions/onboarding/onb-7f3c1a');
  assert.equal(r.unbound, null);
});

test('resolveBeatRoute refuses a placeholder no earlier beat bound, naming it', () => {
  // Kills a silent literal: navigating to the text "/sessions/demo/<demoSessionId>"
  // would 404 and the beat would blame the product for a story-authoring gap.
  const beat7 = { ...bindBeat, expect: { route: '/sessions/demo/<demoSessionId>', data: { page: 'session' } } };
  const r = resolveBeatRoute(beat7, { sessionId: 'onb-7f3c1a' });
  assert.equal(r.unbound, 'demoSessionId');
});

test('resolveBeatRoute leaves a route with no placeholder untouched', () => {
  const r = resolveBeatRoute(beat, {});
  assert.equal(r.route, '/projects');
  assert.equal(r.unbound, null);
});

test('a beat that never reached its page exports NO bindings', () => {
  // A beat can be red for three reasons that all leave the browser on the
  // PREVIOUS page: a `do` step that could not act, no real-nav path, and a
  // control that was not actionable. All three read that previous page to
  // report it honestly — and must not export a `<name>` binding harvested
  // there, or a later beat navigates to a segment the wrong page supplied and
  // can go GREEN on it. That is the fail-open this module exists to prevent,
  // reached through the new verb.
  const v = stuckVerdict(bindBeat, { route: '/projects/new', data: { 'onboard-session-id': 'stale-id' }, nested: [] }, 'could not press it');
  assert.equal(v.status, 'red');
  assert.deepEqual(v.failures, ['could not press it']);
  assert.deepEqual(v.bindings, {});
});

test('stuckVerdict still reports the page it was stuck on, for the operator reading the run', () => {
  const v = stuckVerdict(bindBeat, { route: '/projects/new', data: { page: 'projects' }, nested: [] }, 'no real-nav path');
  assert.equal(v.data.page, 'projects');
});

test('the verdict carries the NESTED values it judged, so the generated doc documents them', () => {
  // The how-to fragment renders `verdict.data` as its "what you should see"
  // list. Reading only the page root there means a beat can assert
  // `data-card-id="gitweave"` and the generated documentation never mentions
  // it — the tests, demos and docs drifting apart inside the one script §3
  // built to stop exactly that.
  const v = beatVerdict(cardBeat, liveProjectsIndex);
  assert.equal(v.data['card-id'], 'gitweave');
  assert.equal(v.data.health, 'attention');
  assert.equal(v.data.page, 'projects-index');
});

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
//
// These drive `driveBeat` against a fake Studio whose navigation commits a
// moment AFTER the click that starts it, which is the whole of the defect. The
// pure verdict above cannot see it: the bug lives in the browser choreography.

/** One element: a tag, its attributes, and the route clicking it navigates to. */
const el = (tag: string, attrs: Record<string, string>, navigatesTo: string | null = null) => ({
  tag,
  attrs,
  navigatesTo,
});

const READY_MAIN = (page: string) => el('main', { 'data-page': page, 'data-page-ready': 'true' });

/** Does one element answer one selector clause? Handles the four shapes `driveBeat` builds. */
function matchesClause(node: ReturnType<typeof el>, clause: string): boolean {
  const tag = /^[a-z]+/.exec(clause)?.[0] ?? null;
  if (tag !== null && node.tag !== tag) return false;
  for (const [, key, want] of clause.matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]/g)) {
    const got = node.attrs[key];
    if (got === undefined) return false;
    if (want !== undefined && got !== want) return false;
  }
  return true;
}

/** Poll until `pred` holds, or reject the way playwright does when it never does. */
function until(pred: () => boolean, timeout: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (pred()) return resolve();
      if (Date.now() - started >= timeout) return reject(new Error(`Timeout exceeded waiting for ${what}`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

/**
 * Enough of playwright's page for `driveBeat`, with ONE deliberate fidelity:
 * a click that navigates leaves `page.url()` reading the OLD route until the
 * commit lands `commitMs` later, and any control on the page being left throws
 * "element was detached from the DOM" while that is in flight. That is the
 * measured behaviour of Next's App Router and the whole of `forge-8vfn.2.28`.
 */
function fakeStudio(spec: {
  start: string;
  commitMs: number;
  pages: Record<string, { elements: ReturnType<typeof el>[]; data?: Record<string, string>; nested?: Record<string, string>[] }>;
}) {
  let route = spec.start;
  let committingTo: string | null = null;
  const clicks: string[] = [];
  const here = () => spec.pages[route] ?? { elements: [] };
  const find = (sel: string) =>
    here().elements.find((n) => sel.split(',').some((c) => matchesClause(n, c.trim()))) ?? null;

  const locator = (sel: string): any => ({
    first: () => locator(sel),
    count: async () => (find(sel) === null ? 0 : 1),
    async click() {
      const node = find(sel);
      if (node === null) throw new Error(`locator.click: Timeout 5000ms exceeded waiting for ${sel}`);
      if (committingTo !== null) throw new Error('locator.click: element was detached from the DOM, retrying');
      clicks.push(sel);
      if (node.navigatesTo !== null) {
        const to = node.navigatesTo;
        committingTo = to;
        setTimeout(() => {
          route = to;
          committingTo = null;
        }, spec.commitMs);
      }
    },
    waitFor: ({ timeout }: { timeout: number }) => until(() => find(sel) !== null, timeout, sel),
    evaluate: async () => find(sel)?.tag.toUpperCase() ?? 'INPUT',
    async fill() {
      if (find(sel) === null) throw new Error(`locator.fill: Timeout 5000ms exceeded waiting for ${sel}`);
    },
    selectOption: async () => {},
  });

  return {
    clicks,
    url: () => `http://localhost:4124${route}`,
    goto: async (u: string) => {
      route = new URL(u).pathname;
    },
    locator,
    waitForURL: (pred: (u: string) => boolean, o: { timeout: number }) =>
      until(() => pred(`http://localhost:4124${route}`), o.timeout, 'the URL'),
    waitForSelector: (sel: string, o: { timeout: number }) => until(() => find(sel) !== null, o.timeout, sel),
    evaluate: async () => ({ data: here().data ?? {}, nested: here().nested ?? [] }),
  };
}

/** S5 beat 2, verbatim from the pinned story. */
const pressNewAgent = {
  act: 'Press "+ New agent"',
  do: [{ press: 'new-agent' }],
  expect: {
    route: '/agents/new',
    data: { page: 'agents', 'agent-id': '', 'page-ready': 'true', section: 'starter-picker' },
  },
  say: 'A new agent starts from a starter.',
};

/** `/agents` and `/agents/new` as the product renders them, read off the live DOM in S5. */
const agentsPages = {
  '/agents': {
    elements: [READY_MAIN('agents-index'), el('a', { href: '/agents/new', 'data-action': 'new-agent' }, '/agents/new')],
    data: { page: 'agents-index', 'page-ready': 'true' },
  },
  '/agents/new': {
    elements: [READY_MAIN('agents')],
    data: { page: 'agents', 'agent-id': '', 'page-ready': 'true' },
    nested: [{ section: 'starter-picker' }],
  },
};

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
