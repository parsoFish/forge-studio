/**
 * A press on a page that does not carry its control reds at t+0, not at the bound.
 *
 * T1 ruling 531(3), bought by S10 run 2. Beat 4 spent its full declared
 * **600 000 ms** pressing `[data-action="open-session"]` on `/architect/new`,
 * and beat 13 spent **900 000 ms** the same way. Neither was waiting for an
 * agent. `open-session` is the LIST surfaces' handle (Home's session strip, the
 * sessions index, the plan gate); the mint page publishes
 * `view-architect-session` instead. No amount of waiting was going to make that
 * page grow a control it does not have, and the runner had everything it needed
 * to say so before the first poll.
 *
 * The economics are the point. Each of these costs a funded run to discover —
 * one authoring error per $35 attempt. Answered at t+0, one run surfaces every
 * one of them.
 *
 * WHY BOTH CONDITIONS. `performSteps` runs BEFORE the route wait and before
 * real-nav, so a beat is NORMALLY off its declared route while it presses: S10
 * beat 2 presses `start-work-architect` from `/projects/gitpulse`, and that
 * press is what navigates to `/architect/new`. Off-route alone would red every
 * story at its first navigating beat — the third test below is that sentence,
 * and it is in this file because without it the rule is satisfiable by its own
 * wrong half.
 *
 * And handle-absent alone would red every genuine agent wait: a control that
 * appears only once an agent has acted is the entire reason
 * `waitForHandleOrStall` has a bound (S2 beat 12's `session-answer` exists only
 * after the architect ASKS). That beat stands ON its declared route, which is
 * the second test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveBeat } from './beats-drive.mjs';

/** A page whose controls depend on which route it is showing. */
function fakeStudio(spec: {
  start: string;
  /** selector fragment → the routes that render it */
  on: Record<string, string[]>;
  /** which route a click on a given handle navigates to */
  goes?: Record<string, string>;
  /** a handle that only appears after this many ms, on every route that has it */
  appearsAfterMs?: number;
}) {
  let route = spec.start;
  const startedAt = Date.now();
  const present = (sel: string) => {
    const routes = Object.entries(spec.on).find(([frag]) => sel.includes(frag))?.[1] ?? [];
    if (!routes.includes(route)) return false;
    return spec.appearsAfterMs === undefined || Date.now() - startedAt >= spec.appearsAfterMs;
  };
  const locator = (sel: string): any => ({
    first: () => locator(sel),
    evaluateAll: async (fn: any, arg: any) => fn([], arg),
    count: async () => (present(sel) ? 1 : 0),
    // Playwright's `click` WAITS for actionability and throws
    // `Timeout Nms exceeded` if the element never appears — the runner relies on
    // that (`beats-drive.mjs:521` passes `{ timeout: actLeft() }`), and a fake
    // whose click resolves instantly makes an absent control look like a present
    // one. The first version of this file did exactly that and its own positive
    // control failed at base in 1 ms, reporting a bug in the runner that was a
    // bug in the fake.
    async click(opts: { timeout?: number } = {}) {
      const deadline = Date.now() + (opts.timeout ?? 30_000);
      while (!present(sel)) {
        if (Date.now() >= deadline) throw new Error(`locator.click: Timeout ${opts.timeout ?? 30_000}ms exceeded.`);
        await new Promise((r) => setTimeout(r, 5));
      }
      const to = Object.entries(spec.goes ?? {}).find(([frag]) => sel.includes(frag))?.[1];
      if (to !== undefined) route = to;
    },
    async evaluate(fn: (n: any) => unknown) {
      return fn({ tagName: 'BUTTON', textContent: '', type: '', value: '', querySelector: () => null, disabled: false, title: '', getAttribute: () => null });
    },
  });
  return {
    url: () => `http://localhost:4124${route}`,
    goto: async (u: string) => { route = new URL(u).pathname; },
    locator,
    waitForURL: (pred: (u: string) => boolean, o: { timeout: number }) =>
      new Promise<void>((resolve, reject) => {
        const began = Date.now();
        const tick = () => {
          if (pred(`http://localhost:4124${route}`)) return resolve();
          if (Date.now() - began >= o.timeout) return reject(new Error('Timeout exceeded waiting for the URL'));
          setTimeout(tick, 5);
        };
        tick();
      }),
    waitForSelector: () => Promise.resolve(),
    evaluate: async () => ({
      data: { page: route.slice(1).replace(/\//g, '-') || 'home', 'page-ready': 'true' },
      nested: [],
      lifecycle: null,
      lifecycleError: null,
      sessionPhase: null,
    }),
  };
}

/** S10 beat 4, verbatim in shape. */
const beat4 = {
  act: 'Open the session and answer the Architect\'s questions',
  do: [{ press: 'open-session' }],
  wait: { for: 'agent', upTo: 600_000 },
  expect: { route: '/sessions/architect/s1', data: { page: 'sessions-architect-s1', 'page-ready': 'true' } },
  say: 'The operator follows the architect into its session.',
};

test('531(3) (RED) a press whose handle is on no element of this page reds at t+0, not at the bound', async () => {
  // The exact shape that cost run 2 ten minutes: standing on the mint page,
  // pressing the LIST surfaces' handle.
  const page = fakeStudio({ start: '/architect/new', on: { 'open-session': ['/monitor', '/sessions'] } });
  const began = Date.now();
  const verdict = await driveBeat(page as never, beat4, 1, 'http://localhost:4124');
  const took = Date.now() - began;

  assert.equal(verdict.status, 'red');
  assert.ok(took < 10_000, `it must answer at t+0, not spend the declared 600000 ms — took ${took} ms`);
  const said = verdict.failures.join(' | ');
  assert.match(said, /standing on the wrong page/, `the verdict must NAME the problem. Got: ${said}`);
  assert.match(said, /\/architect\/new/, 'it must name where the beat actually is');
  assert.match(said, /\/sessions\/architect\/s1/, 'and where it declared it would be');
});

test('531(3) (positive control) a handle absent at t+0 ON the declared route still waits its bound', async () => {
  // S2 beat 12's shape: the field exists only once the architect has ASKED, and
  // the beat is standing on its own session page. This rule must never touch it.
  const page = fakeStudio({
    start: '/sessions/architect/s1',
    on: { 'open-session': ['/sessions/architect/s1'] },
    appearsAfterMs: 400,
  });
  const began = Date.now();
  const verdict = await driveBeat(page as never, { ...beat4, wait: { for: 'agent', upTo: 3_000 } }, 1, 'http://localhost:4124');
  const took = Date.now() - began;

  assert.doesNotMatch(
    verdict.failures.join(' | '),
    /standing on the wrong page/,
    'a beat on its own declared route is waiting for an agent, not standing in the wrong place',
  );
  assert.ok(took >= 400, `it must actually wait for the control to appear — took ${took} ms`);
});

test('531(3) (positive control) the ordinary NAVIGATING press — handle present while off-route — is untouched', async () => {
  // S10 beat 2: press `start-work-architect` from `/projects/gitpulse`, and the
  // press is what navigates to `/architect/new`. `performSteps` runs BEFORE the
  // route wait, so this beat is off its declared route at press time — as every
  // navigating beat in every story is. Without this control, "red when the
  // handle is missing off-route" is satisfiable by a rule that reds on the
  // off-route condition alone, and the whole campaign goes red at beat 2.
  const page = fakeStudio({
    start: '/projects/gitpulse',
    on: { 'start-work-architect': ['/projects/gitpulse'] },
    goes: { 'start-work-architect': '/architect/new' },
  });
  const verdict = await driveBeat(
    page as never,
    {
      act: 'Press "Architect →"',
      do: [{ press: 'start-work-architect' }],
      expect: { route: '/architect/new', data: { page: 'architect-new', 'page-ready': 'true' } },
      say: 'The operator starts an architect session on this project.',
    },
    1,
    'http://localhost:4124',
  );

  assert.equal(verdict.status, 'green', `a navigating press must be untouched. Got: ${verdict.failures.join(' | ')}`);
});
