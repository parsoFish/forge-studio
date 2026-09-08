/**
 * `fake-studio.ts` — the fake Studio page the beat-runner tests drive.
 *
 * Shared rather than duplicated, and that takes an argument: this harness is
 * ~250 lines and it IS the choreography under test — a fake whose navigation
 * commits a moment after the click that starts it, whose `evaluate` answers
 * with nodes real enough that a radio test drives the SAME callback production
 * ships. Two copies of that would drift, and a drifted fake is a test that
 * passes for the wrong reason.
 *
 * It lives under `test-fixtures/` deliberately: `check-owner.mjs`'s
 * NOT_PRODUCTION excludes that directory, so this is test support by the
 * repo's own definition and counts toward no production cap. Only test files
 * may import it.
 *
 * Split out when `beats-drive.test.ts` passed the 800-line cap adding ruling
 * 514's route-query tests. SPLIT, NEVER BASELINE.
 */
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
export const el = (
  tag: string,
  attrs: Record<string, string>,
  navigatesTo: string | null = null,
  children: Array<{ tag: string; attrs: Record<string, string> }> = [],
  text = '',
) => ({ tag, attrs, navigatesTo, children, text });

export const READY_MAIN = (page: string) => el('main', { 'data-page': page, 'data-page-ready': 'true' });

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
export function fakeStudio(spec: {
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
      // playwright's own node API — the production callback reads hrefs with
      // it (bead `forge-8vfn.7.5.3`), so the fake must answer it rather than
      // let a test pass against a stand-in that never had attributes.
      getAttribute: (name: string) => node.attrs[name] ?? null,
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
    /** playwright's `evaluateAll` — every match, not the indexed one. */
    async evaluateAll(fn: (ns: any[], arg: any) => unknown, arg: any) {
      return fn(findAll(sel).map(domish), arg);
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
    // HONOURS `wanted`, because production does. Bead `forge-8vfn.6.11.45`:
    // this returned every declared key whatever `readObserved` asked for, so a
    // key the real read never collects still arrived here and no test could
    // see the defect that cost S1 run 9 its beat 11. A fake more forgiving
    // than the thing it stands for cannot fail the way production does — the
    // rule this file already states about `childInput`, applied to the read.
    evaluate: async (_fn: unknown, arg?: { wanted?: string[] }) => {
      const wanted = arg?.wanted ?? null;
      const only = (rec: Record<string, string>) =>
        wanted === null ? rec : Object.fromEntries(Object.entries(rec).filter(([k]) => wanted.includes(k)));
      const nested = (here().nested ?? []).map(only).filter((r) => Object.keys(r).length > 0);
      return { data: only(here().data ?? {}), nested };
    },
  };
}

/** S5 beat 2, verbatim from the pinned story. */
export const pressNewAgent = {
  act: 'Press "+ New agent"',
  do: [{ press: 'new-agent' }],
  expect: {
    route: '/agents/new',
    data: { page: 'agents', 'agent-id': '', 'page-ready': 'true', section: 'starter-picker' },
  },
  say: 'A new agent starts from a starter.',
};

/** `/agents` and `/agents/new` as the product renders them, read off the live DOM in S5. */
export const agentsPages = {
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

