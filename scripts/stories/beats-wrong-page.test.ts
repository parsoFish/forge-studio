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
    nth: () => locator(sel),
    async fill() { /* a fill is exempt from the wrong-page rule; it still has to be doable */ },
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

// ── 569: a step inside a repeat is judged where it STANDS, not where the beat ends

/**
 * T1 ruling 569, P1, bought by A's S1 run 2 (`_1.0/evidence/m6-a-S1-run2/`).
 *
 * The wrong-page check compares the page against the beat's **declared** route,
 * and `performSteps` passes that same route into a repeat's inner steps. But a
 * beat's declared route is where it ENDS, not where each of its steps acts.
 *
 * S1 beat 11 is the shape: declared at `/artifact` — where it lands after
 * `approve-plan` — while its `do` first presses `view-architect-session` and
 * then runs a repeat on the SESSION page, answering the architect round by
 * round. So every inner `submit-answers` stands off the declared route by
 * design, and between rounds the handle is legitimately ABSENT while the
 * architect drafts. Both halves of the check were therefore true of a beat
 * doing exactly what it was written to do, and it was refused mid-loop.
 *
 * WHY THE 2-SECOND GRACE MADE IT WORSE RATHER THAN SAVING IT. The grace waits
 * for the route to arrive or the handle to reappear, capped at two seconds —
 * which is right for a page mid-commit and hopeless for an architect mid-round.
 * Inside a repeat, handle-absence is not a page that is about to settle; it is
 * an agent that is about to answer, and the thing that governs it is the
 * repeat's own `until` plus the beat's declared bound.
 *
 * THE FIX, in two parts, because the ruling names two shapes:
 *
 *   1. a repeat's inner steps are exempt from the declared-route compare
 *      entirely (`declaredRoute` is not passed down), and
 *   2. in a plain multi-surface `do`, the check applies only while NO earlier
 *      step has navigated — while the page is still where the previous BEAT
 *      left it, which is the only situation the check was built for.
 *
 * Part 2 keeps the coverage part 1 would otherwise lose: a `do` of
 * `[{ fill }, { press }]` never navigates before the press, so the press is
 * still judged, which is where an authoring error actually lands.
 */
function fakeArchitectInterview(spec: { rounds: number; gapMs: number }) {
  const SESSION = '/sessions/architect/s1';
  let route = '/projects/gitweave';
  let round = 0;
  let askedAt = Date.now();
  // The architect asks, the operator answers, the architect goes away to think.
  // While it thinks, `submit-answers` is GONE — the product removes it, because
  // it exists only while the session awaits answers.
  // THE SHAPE THAT ACTUALLY BITES, and the first draft of this fake missed it.
  // Making BOTH controls vanish together does not reproduce the defect: the
  // `fillAll` fails first, `runRepeatStep` treats a failed act as its retry, and
  // `submit-answers` is only ever pressed once it is back. The real race is
  // narrower — the questions are still on the page while the SUBMIT is already
  // gone, because the architect took the turn the moment it was answered. That
  // is the window A's S1 run 2 was refused in.
  const thinking = () => Date.now() - askedAt < spec.gapMs;
  const present = (sel: string) => {
    if (sel.includes('view-architect-session')) return route === '/projects/gitweave';
    if (route !== SESSION) return false;
    if (sel.includes('question-freetext')) return round < spec.rounds;
    if (sel.includes('submit-answers')) return round < spec.rounds && !thinking();
    return false;
  };
  const locator = (sel: string): any => ({
    first: () => locator(sel),
    nth: () => locator(sel),
    evaluateAll: async (fn: any, arg: any) => fn([], arg),
    count: async () => (present(sel) ? 1 : 0),
    async click() {
      if (sel.includes('view-architect-session')) { route = SESSION; askedAt = Date.now(); return; }
      if (sel.includes('submit-answers')) { round += 1; askedAt = Date.now(); }
    },
    async fill() {},
    async evaluate(fn: (n: any) => unknown) {
      return fn({ tagName: 'BUTTON', textContent: '', type: '', value: '', querySelector: () => null, disabled: false, title: '', getAttribute: () => null });
    },
  });
  return {
    url: () => `http://localhost:4124${route}`,
    goto: async (u: string) => { route = new URL(u).pathname; },
    locator,
    waitForURL: async () => {},
    waitForSelector: () => Promise.resolve(),
    evaluate: async () => ({
      data: {
        page: route === SESSION ? 'session' : 'projects',
        'page-ready': 'true',
        'session-phase': round >= spec.rounds ? 'awaiting-verdict' : 'interviewing',
      },
      nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null,
    }),
  };
}

/** S1 beat 11's shape: declared where it ENDS, repeating where it ACTS. */
const s1Beat11 = {
  act: 'Open the session, read the plan and press Approve',
  do: [
    { press: 'view-architect-session' },
    {
      repeat: [{ fillAll: 'question-freetext', with: 'the gate command is `npm test`.' }, { press: 'submit-answers' }],
      until: { 'session-phase': 'awaiting-verdict' },
    },
  ],
  wait: { for: 'agent', upTo: 60_000 },
  expect: { route: '/artifact', data: { page: 'artifact', 'page-ready': 'true' } },
  say: 'The operator answers the architect until it has what it needs.',
};

test('569 (RED) a repeat inner step is not refused for standing off the beat\'s declared route', async () => {
  // The think-gap is 2.5 s — deliberately LONGER than the 2 s grace. A shorter
  // gap does not reproduce the defect at all: the grace finds the handle and the
  // check never fires, which is what the first draft of this test measured and
  // why it passed at base. An architect's round takes minutes, not milliseconds;
  // the gap only has to outlast the grace to be faithful to that.
  const page = fakeArchitectInterview({ rounds: 2, gapMs: 2_500 });
  const verdict = await driveBeat(page as never, s1Beat11, 1, 'http://localhost:4124');

  assert.doesNotMatch(
    verdict.failures.join(' | '),
    /standing on the wrong page/,
    'a repeat runs where the beat put it, not where the beat ends — its inner steps are not wrong-page candidates',
  );
});

test('569 (positive control) a `do` that has NOT navigated is still judged', async () => {
  // The coverage part 2 preserves. A fill does not navigate, so the press after
  // it still stands where the PREVIOUS BEAT left the page — which is exactly
  // the situation S10 beat 4 was in, and it must still red at t+0.
  const page = fakeStudio({ start: '/architect/new', on: { 'open-session': ['/monitor'] } });
  const began = Date.now();
  const verdict = await driveBeat(
    page as never,
    {
      act: 'Answer and open the session',
      do: [{ fill: 'idea', with: 'anything' }, { press: 'open-session' }],
      wait: { for: 'agent', upTo: 60_000 },
      expect: { route: '/sessions/architect/s1', data: { page: 'sessions-architect-s1', 'page-ready': 'true' } },
      say: 'The operator opens the session.',
    },
    1,
    'http://localhost:4124',
  );
  const took = Date.now() - began;

  assert.equal(verdict.status, 'red');
  assert.ok(took < 10_000, `a press that has not navigated is still answered at t+0 — took ${took} ms`);
  assert.match(verdict.failures.join(' | '), /standing on the wrong page/);
});
