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

/** One element: a tag, its attrs, the route a click navigates to, and a delayed data-* effect. */
const el = (
  tag: string,
  attrs: Record<string, string>,
  navigatesTo: string | null = null,
  effect: { afterMs: number; patch: Record<string, string> } | null = null,
) => ({ tag, attrs, navigatesTo, effect });

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
}) {
  let route = spec.start;
  let patched: Record<string, string> = {};
  const selected: Array<{ handle: string; value: string }> = [];
  const here = () => spec.pages[route] ?? { elements: [], data: {} };
  const findAll = (sel: string) => here().elements.filter((n) => sel.split(',').some((c) => matchesClause(n, c.trim())));
  const find = (sel: string) => findAll(sel)[0] ?? null;

  const locator = (sel: string): any => ({
    first: () => locator(sel),
    count: async () => findAll(sel).length,
    async click() {
      const node = find(sel);
      if (node === null) throw new Error(`locator.click: Timeout 5000ms exceeded waiting for ${sel}`);
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
      return fn({ tagName: node.tag.toUpperCase(), textContent: '', type: '', value: '', querySelector: () => null });
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
