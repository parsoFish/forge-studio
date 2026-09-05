/**
 * beats-waits.test.ts — the story runner's waiting model (beads
 * `forge-8vfn.2.25` and `forge-8vfn.2.29`), both measured live in lane
 * M1-C-S34: a same-route act got NO wait for its consequence, and
 * `performSteps` never waited BETWEEN a do block's steps — a press-then-fill
 * read the page it had just navigated FROM.
 *
 * Split out of `beats.test.ts` to keep that file under the repo's 800-line
 * cap (`scripts/check-file-size.mjs`, a shrinking ratchet under the current
 * milestone — a baseline entry would raise the debt ceiling, not honour it).
 * This file duplicates the minimum browser-choreography fake it needs rather
 * than importing `beats.test.ts`'s internals: a test file reaching into
 * another test file's fixtures is worse than a few repeated lines.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveBeat } from './beats.mjs';

/**
 * One element: a tag, its attrs, the route a click navigates to, a delayed
 * data-* effect, and WHEN it becomes enabled — `0` from first paint, `n` after
 * n ms, `null` never. The product serialises real work behind a `disabled`
 * button (S1 beat 9's one-clause-at-a-time apply), so a double that cannot be
 * disabled cannot express bead `forge-8vfn.6.11.6` at all.
 */
const el = (
  tag: string,
  attrs: Record<string, string>,
  navigatesTo: string | null = null,
  effect: { afterMs: number; patch: Record<string, string> } | null = null,
  enabledAfterMs: number | null = 0,
) => ({ tag, attrs, navigatesTo, effect, enabledAfterMs });

const READY_MAIN = (page: string) => el('main', { 'data-page': page, 'data-page-ready': 'true' });

/** Does one element answer one selector clause? Handles `tag[attr]` / `tag[attr="value"]`. */
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
 * Enough of playwright's page for `driveBeat`'s wait logic. A click that
 * navigates commits `commitMs` later — Next's App Router choreography, the
 * whole of bead `forge-8vfn.2.29` — and a click carrying an `effect` mints
 * its data-* patch `afterMs` later with NO navigation at all: a same-route
 * press starting real async work, bead `forge-8vfn.2.25`.
 */
function fakeStudio(spec: {
  start: string;
  commitMs: number;
  pages: Record<string, { elements: ReturnType<typeof el>[]; data: Record<string, string> }>;
  /**
   * What `context.setDefaultTimeout(...)` bounds a locator action to when the
   * call passes none — 5000 in `run.mjs`. Scaled down in the disabled-control
   * tests so a press that fails to pass its OWN bound is measurably red in
   * milliseconds instead of only after five real seconds.
   */
  defaultTimeoutMs?: number;
}) {
  let route = spec.start;
  let patched: Record<string, string> = {};
  const selected: Array<{ handle: string; value: string }> = [];
  // Playwright's actionability clock. `enabledAfterMs` is measured from the
  // moment the page exists, which is the closest a double gets to "the product
  // is busy and will free itself".
  const startedAt = Date.now();
  const isDisabled = (n: ReturnType<typeof el>) =>
    n.enabledAfterMs === null || Date.now() - startedAt < n.enabledAfterMs;
  const here = () => spec.pages[route] ?? { elements: [], data: {} };
  const findAll = (sel: string) => here().elements.filter((n) => sel.split(',').some((c) => matchesClause(n, c.trim())));
  const find = (sel: string) => findAll(sel)[0] ?? null;

  const locator = (sel: string): any => ({
    first: () => locator(sel),
    count: async () => findAll(sel).length,
    async click(opts: { timeout?: number } = {}) {
      // Real playwright's click performs actionability checks — visible,
      // ENABLED, stable — and retries until ITS timeout, which is the
      // context default (5s, `run.mjs`) unless the call passes one. Modelling
      // that bound is the whole of bead `forge-8vfn.6.11.6`.
      const timeout = opts.timeout ?? spec.defaultTimeoutMs ?? 5000;
      const ready = () => {
        const n = find(sel);
        return n !== null && !isDisabled(n);
      };
      await until(ready, timeout, sel).catch(() => {
        const n = find(sel);
        throw new Error(
          `locator.click: Timeout ${timeout}ms exceeded.\nCall log:\n` +
            (n === null ? `  - waiting for locator('${sel}')` : '    - element is not enabled'),
        );
      });
      const node = find(sel);
      if (node === null) throw new Error(`locator.click: Timeout ${timeout}ms exceeded waiting for ${sel}`);
      if (node.navigatesTo !== null) {
        const to = node.navigatesTo;
        setTimeout(() => {
          route = to;
        }, spec.commitMs);
      }
      if (node.effect !== null) {
        const { afterMs, patch } = node.effect;
        setTimeout(() => {
          patched = { ...patched, ...patch };
        }, afterMs);
      }
    },
    waitFor: ({ timeout }: { timeout: number }) => until(() => find(sel) !== null, timeout, sel),
    async evaluate(fn: (n: any) => unknown) {
      const node = find(sel);
      if (node === null) throw new Error(`locator.evaluate: Timeout 5000ms exceeded waiting for ${sel}`);
      // Enough of a DOM node for `readShape` in beats.mjs: a SELECT carries
      // no radio/checkbox child, so `querySelector` answering null is exact.
      return fn({
        tagName: node.tag.toUpperCase(),
        textContent: '',
        type: '',
        value: '',
        querySelector: () => null,
        disabled: isDisabled(node),
        title: node.attrs.title ?? '',
        getAttribute: (k: string) => (k === 'disabled' ? (isDisabled(node) ? '' : null) : (node.attrs[k] ?? null)),
      });
    },
    async selectOption(value: string) {
      selected.push({ handle: sel, value });
    },
  });

  return {
    selected,
    url: () => `http://localhost:4124${route}`,
    goto: async (u: string) => {
      route = new URL(u).pathname;
    },
    locator,
    waitForURL: (pred: (u: string) => boolean, o: { timeout: number }) =>
      until(() => pred(`http://localhost:4124${route}`), o.timeout, 'the URL'),
    waitForSelector: (sel: string, o: { timeout: number }) => until(() => find(sel) !== null, o.timeout, sel),
    evaluate: async () => ({ data: { ...here().data, ...patched }, nested: [] }),
  };
}

const runOnboardingBeat = {
  act: 'Press "Run onboarding agent"',
  do: [{ press: 'run-onboarding-agent' }],
  expect: { route: '/projects/gitweave', data: { 'onboard-run-status': 'running', 'onboard-session-id': '<sessionId>' } },
  say: 'An Agent starts a real onboarding run against the project.',
};

/** idle + no id until `effect` (or never, for the genuine-red case) mints the running state. */
const onboardPage = (effect: { afterMs: number; patch: Record<string, string> } | null) => ({
  '/projects/gitweave': {
    elements: [READY_MAIN('project-detail'), el('button', { 'data-action': 'run-onboarding-agent' }, null, effect)],
    data: { page: 'project-detail', 'onboard-run-status': 'idle', 'onboard-session-id': '' },
  },
});

test('a same-route press waits for its CONSEQUENCE before reading — S3 beat 11, live', async () => {
  // THE DEFECT: measured live as got "idle" + empty id while a real agent run was already in progress.
  const patch = { 'onboard-run-status': 'running', 'onboard-session-id': 'onb-cf8d272a' };
  const page = fakeStudio({ start: '/projects/gitweave', commitMs: 0, pages: onboardPage({ afterMs: 300, patch }) });
  const v = await driveBeat(page, runOnboardingBeat, 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.equal(v.bindings.sessionId, 'onb-cf8d272a');
});

test('a same-route consequence that NEVER arrives times out at its bound and stays red', async () => {
  // Fail-CLOSED: no effect ever fires, so `onboard-run-status` can never become "running".
  const page = fakeStudio({ start: '/projects/gitweave', commitMs: 0, pages: onboardPage(null) });
  const started = Date.now();
  const v = await driveBeat(page, runOnboardingBeat, 1, 'http://localhost:4124', {}, 200);
  assert.equal(v.status, 'red');
  assert.ok(Date.now() - started < 2000, 'the wait must respect its bound, not hang');
  assert.match(v.failures.join(' | '), /onboard-run-status: expected "running", got "idle"/);
});

/** `arrival` defaults to S7's real `/templates/new`; the red case passes one missing the field. */
const libraryPages = (arrival: ReturnType<typeof el>[] = [READY_MAIN('template-new'), el('select', { 'data-field': 'template-category' })]) => ({
  '/library': { elements: [READY_MAIN('library'), el('button', { 'data-action': 'new-template' }, '/templates/new')], data: { page: 'library', 'page-ready': 'true' } },
  '/templates/new': { elements: arrival, data: { page: 'template-new', 'page-ready': 'true' } },
});

const templateBeat = {
  act: 'Press "+ New template" and set its category',
  do: [{ press: 'new-template' }, { fill: 'template-category', with: 'flow' }],
  expect: { route: '/templates/new', data: { page: 'template-new', 'page-ready': 'true' } },
  say: 'One operator act: press the create CTA and fill the form it opens.',
};

test('a do block of [press, fill] performs both steps against the right pages — S7\'s template beat', async () => {
  // THE DEFECT: measured live as `could not fill [data-field="template-category"]: Timeout 5000ms
  // exceeded` — the fill ran on /library before /templates/new had mounted.
  const page = fakeStudio({ start: '/library', commitMs: 300, pages: libraryPages() });
  const v = await driveBeat(page, templateBeat, 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.deepEqual(page.selected, [{ handle: '[data-field="template-category"]', value: 'flow' }]);
});

test('a do block whose SECOND step never finds its handle times out at its bound and stays red', async () => {
  // Fail-CLOSED: the arrival page here never renders `template-category` at all.
  const page = fakeStudio({ start: '/library', commitMs: 50, pages: libraryPages([READY_MAIN('template-new')]) });
  const started = Date.now();
  const v = await driveBeat(page, templateBeat, 1, 'http://localhost:4124', {}, 200);
  assert.equal(v.status, 'red');
  assert.ok(Date.now() - started < 2000, 'the wait must respect its bound, not hang');
  assert.match(v.failures.join(' | '), /could not fill \[data-field="template-category"\]/);
});

/* ------------------------------------------------------------------------ *
 * Bead `forge-8vfn.6.11.7` — the post-`do` wait covers EVERY declared key.
 *
 * Measured live on S1 run 2 (H6 authoring sitting, 2026-09-05): beat 7
 * declares `stage-detail-stage` first and `action` second; the press before
 * it satisfies the FIRST key instantly, `waitForConsequence` returned on it,
 * and the page was read while `launch-demo-builder`'s POST was still in
 * flight — `data-action: expected "view-demo-session", got "back-to-project"`.
 * The order of keys in an `expect.data` object silently decided what the
 * runner waited for, and nothing in §3.1 said so (ruling 196, §15.179).
 * ------------------------------------------------------------------------ */

/** S1 beat 7's shape: a first key already true, a second the press mints late. */
const handoffPage = (effect: { afterMs: number; patch: Record<string, string> } | null) => ({
  '/sessions/onboarding/onb-1': {
    elements: [READY_MAIN('session-detail'), el('button', { 'data-action': 'launch-demo-builder' }, null, effect)],
    data: { page: 'session-detail', 'stage-detail-stage': 'demo', action: 'back-to-project' },
  },
});

const handoffBeat = (data: Record<string, string>) => ({
  act: 'Press "Launch the demo builder"',
  do: [{ press: 'launch-demo-builder' }],
  expect: { route: '/sessions/onboarding/onb-1', data },
  say: 'The onboarding session hands off to a demo-builder session.',
});

const MINTED = { afterMs: 300, patch: { action: 'view-demo-session' } };

test('the post-do wait covers EVERY declared key, not just the first — S1 beat 7, live', async () => {
  // THE DEFECT: `stage-detail-stage: 'demo'` is true from first paint, so the
  // shipped wait returned instantly and read `action` while the POST was in
  // flight. Declared FIRST here, exactly as the pinned beat declares it.
  const page = fakeStudio({ start: '/sessions/onboarding/onb-1', commitMs: 0, pages: handoffPage(MINTED) });
  const v = await driveBeat(page, handoffBeat({ 'stage-detail-stage': 'demo', action: 'view-demo-session' }), 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', v.failures.join(' | '));
});

test('the order of keys in expect.data carries NO meaning — the same beat, keys swapped', async () => {
  // §15.179: swapping the keys to pass would have pinned the trap into a gate.
  // Both orders must reach the same verdict, so no story can encode an
  // ordering rule the runner honours and §3.1 never states.
  const page = fakeStudio({ start: '/sessions/onboarding/onb-1', commitMs: 0, pages: handoffPage(MINTED) });
  const v = await driveBeat(page, handoffBeat({ action: 'view-demo-session', 'stage-detail-stage': 'demo' }), 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', v.failures.join(' | '));
});

test('a later key that NEVER arrives times out at its bound and stays red', async () => {
  // Fail-CLOSED: the first key stays true forever and the second never mints,
  // so waiting for all of them must still give up at the bound and report the
  // honest mismatch — never hang, never pass on the satisfied key alone.
  const page = fakeStudio({ start: '/sessions/onboarding/onb-1', commitMs: 0, pages: handoffPage(null) });
  const started = Date.now();
  const v = await driveBeat(page, handoffBeat({ 'stage-detail-stage': 'demo', action: 'view-demo-session' }), 1, 'http://localhost:4124', {}, 200);
  assert.equal(v.status, 'red');
  assert.ok(Date.now() - started < 2000, 'the wait must respect its bound, not hang');
  assert.match(v.failures.join(' | '), /data-action: expected "view-demo-session", got "back-to-project"/);
});

/* ------------------------------------------------------------------------ *
 * Bead `forge-8vfn.6.11.6` — a press is bounded by the RUNNER's timeout.
 *
 * Measured live on S1 runs 1 and 2: `apply-clause-decision` is disabled while
 * the product applies auto-fixes one clause at a time, and the press failed
 * with `locator.click: Timeout 5000ms exceeded … element is not enabled`.
 * Playwright DOES wait for enabled — at `context.setDefaultTimeout(5000)`
 * (`run.mjs`), not at the runner's own `READY_TIMEOUT_MS`. So the fix is the
 * BOUND, not a new wait; and the failure text must name what actually blocked
 * instead of guessing between four causes.
 * ------------------------------------------------------------------------ */

const clausePage = (enabledAfterMs: number | null) => ({
  '/projects/gitweave': {
    elements: [
      READY_MAIN('project-detail'),
      el(
        'button',
        { 'data-action': 'apply-clause-decision', title: 'Auto-fixes are applying — one clause at a time' },
        null,
        { afterMs: 10, patch: { 'clause-decision': 'applied' } },
        enabledAfterMs,
      ),
    ],
    data: { page: 'project-detail', 'clause-decision': 'pending' },
  },
});

const clauseBeat = {
  act: 'Apply the clause decision',
  do: [{ press: 'apply-clause-decision' }],
  expect: { route: '/projects/gitweave', data: { 'clause-decision': 'applied' } },
  say: 'The operator applies one contract clause.',
};

test('a press waits for a BUSY control past playwright\'s 5s default, up to the runner\'s bound — S1 beat 9, live', async () => {
  // THE DEFECT: the control frees at 8s, inside READY_TIMEOUT_MS (15s) and
  // outside the context default (5s), so the shipped press failed on a
  // control that was about to become pressable.
  // The control frees at 300ms: OUTSIDE the context default (100ms here,
  // 5000ms live) and INSIDE the runner's bound (600ms here, 15000ms live).
  // That gap is the defect — a press that never passes its own timeout can
  // only ever wait the context default, however long the runner would allow.
  const page = fakeStudio({ start: '/projects/gitweave', commitMs: 0, defaultTimeoutMs: 100, pages: clausePage(300) });
  const v = await driveBeat(page, clauseBeat, 1, 'http://localhost:4124', {}, 600);
  assert.equal(v.status, 'green', v.failures.join(' | '));
});

test('a press on a control disabled FOREVER reds at the bound, naming the title', async () => {
  // Fail-CLOSED, and the red must be attributable: the shipped message guessed
  // "absent, disabled, obscured or not yet rendered" — four causes, no answer.
  const page = fakeStudio({ start: '/projects/gitweave', commitMs: 0, defaultTimeoutMs: 100, pages: clausePage(null) });
  const started = Date.now();
  const v = await driveBeat(page, clauseBeat, 1, 'http://localhost:4124', {}, 200);
  assert.equal(v.status, 'red');
  assert.ok(Date.now() - started < 2000, 'the press must respect its bound, not hang');
  const text = v.failures.join(' | ');
  assert.match(text, /still DISABLED/);
  assert.match(text, /Auto-fixes are applying — one clause at a time/);
});

test('a press whose handle is ABSENT reds saying so — not "disabled"', async () => {
  // The other side of the same message: a control that is missing and a
  // control that is busy are different findings and must read differently.
  const page = fakeStudio({
    start: '/projects/gitweave',
    commitMs: 0,
    defaultTimeoutMs: 100,
    pages: { '/projects/gitweave': { elements: [READY_MAIN('project-detail')], data: { page: 'project-detail' } } },
  });
  const v = await driveBeat(page, clauseBeat, 1, 'http://localhost:4124', {}, 200);
  assert.equal(v.status, 'red');
  const text = v.failures.join(' | ');
  assert.match(text, /no element carries that handle/);
  assert.doesNotMatch(text, /still DISABLED/);
});

/* ------------------------------------------------------------------------ *
 * Bead `forge-8vfn.6.11.10` — a beat that waits on a REAL AGENT needs an
 * agent-scale bound (operator ruling 212's family; T1 ruling 220).
 *
 * Measured live on 2026-09-05, three beats across three stories, one cause:
 *   S1 beat 6   could not fill [data-field="session-answer"] … no element
 *               carries that handle
 *   S2 beat 12  the same message, same handle, different session kind
 *   S4 beat 11  data-session-phase: expected "awaiting-verdict", got
 *               "interviewing"
 * `SessionInteractivePanel.tsx` renders `session-answer` only inside a
 * `question-form` affordance — only once the agent has ASKED — and S4's own
 * archived `status.json` reads `"phase": "interviewing"` at reap. The runner
 * had ONE bound, `READY_TIMEOUT_MS = 15_000`, for a local DOM update and for
 * an architect's phase transition alike. Same family as `6.11.6`: the wait
 * existed; the BOUND was wrong for what it was waiting on.
 *
 * The fix is a DECLARED wait, not a bigger global: raising the 15 s would make
 * every genuine product red take fifteen times longer to fail.
 * ------------------------------------------------------------------------ */

/** S4 beat 11's shape: a phase the agent flips well after the DOM bound. */
const phasePage = (afterMs: number | null) => ({
  '/sessions/architect/arch-1': {
    elements: [
      READY_MAIN('session-detail'),
      el('button', { 'data-action': 'open-session' }, null,
        afterMs === null ? null : { afterMs, patch: { 'session-phase': 'awaiting-verdict' } }),
    ],
    data: { page: 'session-detail', 'session-phase': 'interviewing' },
  },
});

const phaseBeat = (wait?: unknown) => ({
  act: 'Open the session from Monitor and wait for the Architect to finish drafting',
  do: [{ press: 'open-session' }],
  ...(wait === undefined ? {} : { wait }),
  expect: { route: '/sessions/architect/arch-1', data: { page: 'session-detail', 'session-phase': 'awaiting-verdict' } },
  say: 'The architect finishes drafting and stops at the gate.',
});

test('6.11.10: a beat with NO declared wait still gives up at the DOM bound — the global stays 15 s', async () => {
  // The control that keeps the fix from becoming "make everything slower":
  // an undeclared beat must be bounded exactly as before, so a genuine
  // product red still fails fast.
  const page = fakeStudio({ start: '/sessions/architect/arch-1', commitMs: 0, pages: phasePage(600) });
  const started = Date.now();
  const v = await driveBeat(page, phaseBeat(), 1, 'http://localhost:4124', {}, 200);
  assert.equal(v.status, 'red');
  assert.ok(Date.now() - started < 500, 'an undeclared beat must not silently inherit the agent bound');
  assert.match(v.failures.join(' | '), /data-session-phase: expected "awaiting-verdict", got "interviewing"/);
});

test('6.11.10: a beat that DECLARES an agent-scale wait waits past the DOM bound and goes green', async () => {
  // THE DEFECT, exactly: the consequence lands at 600 ms, three times the DOM
  // bound this call is given. Without the declaration the beat is red however
  // correct the product is.
  const page = fakeStudio({ start: '/sessions/architect/arch-1', commitMs: 0, pages: phasePage(600) });
  const v = await driveBeat(page, phaseBeat({ for: 'agent', upTo: 3000 }), 1, 'http://localhost:4124', {}, 200);
  assert.equal(v.status, 'green', v.failures.join(' | '));
});

test('6.11.10: a declared agent wait still FAILS CLOSED at its own bound, and the failure names which bound fired', async () => {
  // A longer bound must not become an unbounded one, and the verdict has to
  // say which bound gave up — otherwise "red at 15 s" and "red at 10 min" are
  // indistinguishable in a run record.
  const page = fakeStudio({ start: '/sessions/architect/arch-1', commitMs: 0, pages: phasePage(null) });
  const started = Date.now();
  const v = await driveBeat(page, phaseBeat({ for: 'agent', upTo: 300 }), 1, 'http://localhost:4124', {}, 200);
  assert.equal(v.status, 'red');
  assert.ok(Date.now() - started < 2000, 'a declared wait must respect its own bound, not hang');
  assert.match(v.failures.join(' | '), /agent wait/i);
  assert.match(v.failures.join(' | '), /300/);
});
