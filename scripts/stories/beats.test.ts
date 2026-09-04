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

// ── M5-B s2: keys the page splits across two SIBLING elements (ruling 163,
// bead forge-8vfn.9, measured by `_1.0/evidence/m5-b-probe9/`).
//
// `/projects/<id>` renders `data-preflight-status` on ContractReadiness's own
// div and `data-checklist-row`/`data-checklist-status` on ProjectContractPanel
// `<li>`s. They are siblings: no single element carries both. Reading S1 beat
// 3's exact key set reported `data-preflight-status` "absent from the page"
// while a probe reading that key ALONE, on the same page moments later, found
// it — so the absence was the runner's, and the bead blaming the product for
// declaring `page-ready` too early is refuted.
//
// The relaxation is bounded by SOURCE COUNT, not by convenience: a key exactly
// one element on the page carries names no competing entity, so reading it
// from its own element cannot pick the wrong one. A key two elements carry is
// exactly the gitweave/mdtoc ambiguity above and stays under the together-rule.

/** The live DOM of `/projects/gitweave` right after onboarding (probe9, 2026-09-05). */
const liveProjectPage = {
  route: '/projects/gitweave',
  data: { page: 'projects', 'project-id': 'gitweave', 'page-ready': 'true' },
  nested: [
    { section: 'contract-readiness', 'preflight-status': 'hard-fail' },
    { section: 'contract-checklist', 'checklist-row-count': '5' },
    { 'checklist-row': 'contract', 'checklist-status': 'absent' },
    { 'checklist-row': 'instructions', 'checklist-status': 'present' },
    { 'checklist-row': 'secrets', 'checklist-status': 'absent' },
  ],
};

/** S1 beat 3's expectation set, verbatim from the pinned story. */
const siblingBeat = {
  act: 'Fill in the form and press "Onboard project →"',
  expect: {
    route: '/projects/gitweave',
    data: {
      page: 'projects',
      'project-id': 'gitweave',
      'page-ready': 'true',
      'preflight-status': 'hard-fail',
      'checklist-row': 'contract',
      'checklist-status': 'absent',
    },
  },
  say: 'Forge measures GitWeave against the contract and reports a hard fail.',
};

test('a key only ONE element on the page carries is read from it, even when another element answers the rest', () => {
  // Kills "one best record decides every missing key". The best-covering
  // record is a checklist `<li>`, which cannot carry `preflight-status` at
  // all; before this, the beat failed naming a key the page plainly rendered.
  const v = beatVerdict(siblingBeat, liveProjectPage);
  assert.equal(v.status, 'green', v.failures.join(' | '));
});

test('a key several elements carry is still answered by ONE element, not assembled', () => {
  // Kills the over-wide fix: `checklist-row` and `checklist-status` are each
  // carried by three `<li>`s, so "the contract row is present" must be true of
  // ONE row. `contract` is absent and `instructions` is present; assembling
  // the pair across the two would report a row that does not exist.
  const v = beatVerdict(
    { ...siblingBeat, expect: { ...siblingBeat.expect, data: { ...siblingBeat.expect.data, 'checklist-status': 'present' } } },
    liveProjectPage,
  );
  assert.equal(v.status, 'red');
  assert.ok(
    v.failures.some((f) => /checklist-status.*expected "present", got "absent"/.test(f)),
    v.failures.join(' | '),
  );
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

/**
 * One element: a tag, its attributes, the route clicking it navigates to, and
 * — for the label-wrapping-an-input shape the model-tier picker renders — its
 * children and its own text. `children`/`text` exist so the fake can answer
 * `evaluate` with a node whose `querySelector('input')` and `textContent` are
 * real, which is the only way a test of the radio path can drive the SAME
 * evaluate callback production ships rather than a stand-in for it.
 */
const el = (
  tag: string,
  attrs: Record<string, string>,
  navigatesTo: string | null = null,
  children: Array<{ tag: string; attrs: Record<string, string> }> = [],
  text = '',
) => ({ tag, attrs, navigatesTo, children, text });

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
  const filled: Array<{ handle: string; value: string }> = [];
  const selected: Array<{ handle: string; value: string }> = [];
  const checked: Array<{ handle: string; value: string; state: boolean }> = [];
  const here = () => spec.pages[route] ?? { elements: [] };
  const findAll = (sel: string) =>
    here().elements.filter((n) => sel.split(',').some((c) => matchesClause(n, c.trim())));
  const find = (sel: string) => findAll(sel)[0] ?? null;

  /**
   * A DOM-ish stand-in for ONE node, passed to the real `evaluate` callback
   * `performSteps` ships. It answers exactly the four things that callback
   * asks — `tagName`, `querySelector('input')`, the input's `type`/`value`,
   * and `textContent` — so the production callback is executed here, not
   * re-implemented. `evaluate` that ignored its argument (the shape this fake
   * had before ruling 52) can only ever test a stand-in.
   */
  const domish = (node: ReturnType<typeof el>): any => {
    const child = node.children[0] ?? null;
    const self = node.tag.toLowerCase() === 'input' ? node : null;
    const input = self ?? child;
    return {
      tagName: node.tag.toUpperCase(),
      textContent: node.text,
      type: self?.attrs.type ?? '',
      value: self?.attrs.value ?? '',
      querySelector: (q: string) =>
        input !== null && q.includes('input') && input.tag.toLowerCase() === 'input'
          ? { type: input.attrs.type ?? '', value: input.attrs.value ?? '', tagName: 'INPUT' }
          : null,
    };
  };

  /**
   * The INPUT inside a matched node — `label.locator('input')`. playwright's
   * `check()` refuses anything that is not the input itself, and the
   * model-tier picker puts `data-field` on the LABEL, so resolving the child
   * is not a convenience: it is the only shape that can act on that control.
   * Recorded under the PARENT handle, because that is the handle the story
   * named.
   */
  const childInput = (sel: string, index: number): any => {
    const owner = () => findAll(sel)[index] ?? null;
    // DESCENDANTS ONLY — playwright's `locator.locator()` never matches the
    // node itself. The fake used to fall back to the owner, which made a
    // checkbox carrying `data-field` on the INPUT look reachable by descending
    // into it; real chromium timed out after 30 s on exactly that call. A fake
    // more forgiving than the thing it stands for cannot fail the way
    // production does.
    const input = () => {
      const n = owner();
      if (n === null) return null;
      return n.children[0] ?? null;
    };
    const must = (verb: string) => {
      const i = input();
      if (i === null || i.tag.toLowerCase() !== 'input') {
        throw new Error(`locator.${verb}: Error: Not a checkbox or radio button`);
      }
      return i;
    };
    return {
      first: () => childInput(sel, index),
      count: async () => (input() === null ? 0 : 1),
      async check() {
        const i = must('check');
        checked.push({ handle: sel, value: i.attrs.value ?? '', state: true });
      },
      async uncheck() {
        const i = must('uncheck');
        checked.push({ handle: sel, value: i.attrs.value ?? '', state: false });
      },
    };
  };

  const locator = (sel: string, index = 0): any => ({
    first: () => locator(sel, 0),
    nth: (i: number) => locator(sel, i),
    locator: () => childInput(sel, index),
    count: async () => findAll(sel).length,
    async click() {
      const node = findAll(sel)[index] ?? null;
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
    async evaluate(fn: (n: any) => unknown) {
      const node = findAll(sel)[index] ?? null;
      if (node === null) throw new Error(`locator.evaluate: Timeout 5000ms exceeded waiting for ${sel}`);
      return fn(domish(node));
    },
    async fill(value: string) {
      const node = findAll(sel)[index] ?? null;
      if (node === null) throw new Error(`locator.fill: Timeout 5000ms exceeded waiting for ${sel}`);
      // playwright's own refusal, verbatim — the defect ruling 52 removes.
      const t = node.tag.toLowerCase() === 'input' ? (node.attrs.type ?? '') : '';
      if (t === 'radio' || t === 'checkbox') {
        throw new Error(`locator.fill: Error: Input of type "${t}" cannot be filled`);
      }
      filled.push({ handle: sel, value });
    },
    async selectOption(value: string) {
      selected.push({ handle: sel, value });
    },
    async check() {
      const node = findAll(sel)[index] ?? null;
      if (node === null) throw new Error(`locator.check: Timeout 5000ms exceeded waiting for ${sel}`);
      // playwright refuses check() on anything that is not the input itself.
      if (node.tag.toLowerCase() !== 'input') throw new Error('locator.check: Error: Not a checkbox or radio button');
      checked.push({ handle: sel, value: node.attrs.value ?? '', state: true });
    },
    async uncheck() {
      const node = findAll(sel)[index] ?? null;
      if (node === null) throw new Error(`locator.uncheck: Timeout 5000ms exceeded waiting for ${sel}`);
      if (node.tag.toLowerCase() !== 'input') throw new Error('locator.uncheck: Error: Not a checkbox or radio button');
      checked.push({ handle: sel, value: node.attrs.value ?? '', state: false });
    },
  });

  return {
    clicks,
    filled,
    selected,
    checked,
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
