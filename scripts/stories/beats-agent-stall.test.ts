/**
 * beats-agent-stall.test.ts — what a beat that declares `wait: { for: 'agent' }`
 * actually waits for, and when it stops (bead `forge-8vfn.6.11.17`, T1 ruling
 * 241 step 2).
 *
 * Two defects, one wait, measured on S4 run 2's own archive:
 *
 * 1. **The declared bound was never applied to the agent.** `driveBeat` waits
 *    for the beat's declared consequence ONLY on the same-route branch; a beat
 *    whose `do` NAVIGATES got a wait on the URL and nothing else. S4 beat 11 is
 *    exactly that shape (`do: [{ press: 'open-session' }]`, route
 *    `/sessions/architect/<id>`), so its `wait: { for: 'agent', upTo: 600_000 }`
 *    bounded a client-side route change — about a second — and the session's
 *    phase was read immediately afterwards. The verdict then appended `gave up
 *    at the agent wait (declared 600000 ms)`, naming a bound that never fired.
 *    Parsed, surfaced, enforced nowhere: the declared-data-fails-open shape this
 *    campaign keeps paying for, in the field added to close the previous one.
 *
 * 2. **A waiting beat ignored the product telling it the session was hung.**
 *    `deriveSessionLifecycle` had already classified run 2's session `stalled`
 *    at its 120 s architect ceiling, and the session page publishes that on
 *    `div[data-section="session-lifecycle"][data-lifecycle-state]` (a 5-token
 *    contract: working | awaiting-operator | crashed | stalled | terminal). The
 *    runner never asked, so a fixed bound was the only thing that could end the
 *    wait — ten minutes of sitting still to learn what the product knew at two.
 *
 * The positive controls carry as much weight as the pins: a session that is
 * still MOVING must never be cut short, and a beat that declares no agent wait
 * must not gain a new way to fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveBeat } from './beats.mjs';

const MONITOR = '/monitor';
const SESSION = '/sessions/architect/s1';

/**
 * Enough of playwright's page for the wait under test. Deliberately its own
 * fake rather than an import from `beats-waits.test.ts`: a test file reaching
 * into another test file's fixtures is worse than a few repeated lines, and
 * this one models something that one does not — the session lifecycle bar.
 *
 * `phaseAfterMs` is when the architect's phase reaches `awaiting-verdict`
 * (`null` = never, run 2's shape). `stalledAfterMs` is when the product's own
 * lifecycle flips to `stalled` (`null` = it never does).
 */
function fakeStudio(spec: {
  commitMs: number;
  phaseAfterMs: number | null;
  stalledAfterMs: number | null;
}) {
  let route = MONITOR;
  const startedAt = Date.now();
  const since = () => Date.now() - startedAt;
  const phase = () =>
    spec.phaseAfterMs !== null && since() >= spec.phaseAfterMs ? 'awaiting-verdict' : 'interviewing';
  const lifecycle = () =>
    spec.stalledAfterMs !== null && since() >= spec.stalledAfterMs ? 'stalled' : 'working';

  const until = (pred: () => boolean, timeout: number, what: string) =>
    new Promise<void>((resolve, reject) => {
      const began = Date.now();
      const tick = () => {
        if (pred()) return resolve();
        if (Date.now() - began >= timeout) return reject(new Error(`Timeout exceeded waiting for ${what}`));
        setTimeout(tick, 5);
      };
      tick();
    });

  const locator = (sel: string): any => ({
    first: () => locator(sel),
    count: async () => (route === MONITOR && sel.includes('open-session') ? 1 : 0),
    async click() {
      setTimeout(() => {
        route = SESSION;
      }, spec.commitMs);
    },
    async evaluate(fn: (n: any) => unknown) {
      return fn({
        tagName: 'BUTTON',
        textContent: '',
        type: '',
        value: '',
        querySelector: () => null,
        disabled: false,
        title: '',
        getAttribute: () => null,
      });
    },
  });

  return {
    url: () => `http://localhost:4124${route}`,
    goto: async (u: string) => {
      route = new URL(u).pathname;
    },
    locator,
    waitForURL: (pred: (u: string) => boolean, o: { timeout: number }) =>
      until(() => pred(`http://localhost:4124${route}`), o.timeout, 'the URL'),
    waitForSelector: (_sel: string, _o: { timeout: number }) => Promise.resolve(),
    evaluate: async () => ({
      data:
        route === SESSION
          ? { page: 'session', 'page-ready': 'true', 'session-phase': phase() }
          : { page: 'monitor', 'page-ready': 'true' },
      nested: [],
      lifecycle: route === SESSION ? lifecycle() : null,
    }),
  };
}

/** S4 beat 11's shape, with a bound small enough to measure. */
const openSessionBeat = (upTo: number | null) => ({
  act: 'Open the session from Monitor and wait for the Architect to finish drafting',
  do: [{ press: 'open-session' }],
  ...(upTo === null ? {} : { wait: { for: 'agent', upTo } }),
  expect: { route: SESSION, data: { page: 'session', 'page-ready': 'true', 'session-phase': 'awaiting-verdict' } },
  say: 'The Architect finishes its interview and the plan is ready to judge.',
});

test('AT-6.11.17-3 (RED) a NAVIGATING beat that declares an agent wait waits for the agent, not just the URL', async () => {
  // The phase arrives 400 ms after the page — long after the route commits,
  // which is precisely the gap S4 beat 11 fell into.
  const page = fakeStudio({ commitMs: 20, phaseAfterMs: 400, stalledAfterMs: null });
  const verdict = await driveBeat(page as never, openSessionBeat(4_000), 1, 'http://localhost:4124');
  assert.equal(
    verdict.status,
    'green',
    `the beat declared a 4000 ms agent wait and the phase arrived at 400 ms — it must wait for it. Failures: ${JSON.stringify(verdict.failures)}`,
  );
});

test('AT-6.11.17-4 (RED) a waiting beat reds EARLY when the product itself says the session is stalled', async () => {
  // The phase NEVER arrives and the product declares the session hung at
  // 200 ms. The declared bound is 60 s: sitting it out is the ten minutes
  // run 2 spent learning what the product knew at two.
  const page = fakeStudio({ commitMs: 20, phaseAfterMs: null, stalledAfterMs: 200 });
  const began = Date.now();
  const verdict = await driveBeat(page as never, openSessionBeat(60_000), 1, 'http://localhost:4124');
  const took = Date.now() - began;

  assert.equal(verdict.status, 'red', 'a session the product calls stalled cannot make this beat pass');
  assert.ok(took < 10_000, `it must stop early, not sit out its declared 60000 ms bound — took ${took} ms`);
  const said = verdict.failures.join(' | ');
  assert.match(said, /stalled/, `the verdict must NAME the stall. Got: ${said}`);
  assert.doesNotMatch(
    said,
    /gave up at the agent wait/,
    `it did not give up at the bound — it stopped because the product said the session was hung. Got: ${said}`,
  );
});

test('AT-6.11.17-5 (positive control) a session that is still MOVING is never cut short', async () => {
  // Lifecycle stays `working` throughout and the phase arrives at 400 ms.
  const page = fakeStudio({ commitMs: 20, phaseAfterMs: 400, stalledAfterMs: null });
  const verdict = await driveBeat(page as never, openSessionBeat(4_000), 1, 'http://localhost:4124');
  assert.equal(verdict.status, 'green', `a working session must reach green. Failures: ${JSON.stringify(verdict.failures)}`);
  assert.doesNotMatch(verdict.failures.join(' | '), /stalled/, 'nothing may claim a stall that never happened');
});

test('AT-6.11.17-6 (positive control) a beat that declares NO agent wait gains no new way to fail', async () => {
  // Same stalled session, but the beat never declared an agent wait, so the
  // early red is not its business: it reds on its own expectation, saying so,
  // and says nothing about a stall.
  const page = fakeStudio({ commitMs: 20, phaseAfterMs: null, stalledAfterMs: 50 });
  const verdict = await driveBeat(page as never, openSessionBeat(null), 1, 'http://localhost:4124', {}, 600);
  assert.equal(verdict.status, 'red', 'the phase never arrives, so the beat is red either way');
  assert.doesNotMatch(
    verdict.failures.join(' | '),
    /stalled/,
    'the stall-aware early red is scoped to beats that declared an agent wait',
  );
});

test('AT-6.11.17-7 (positive control) a beat that really does exhaust its declared bound still says so', async () => {
  // Nothing arrives and nothing stalls: the bound is the only thing that can
  // end this wait, and the verdict must keep naming it (bead 6.11.10).
  const page = fakeStudio({ commitMs: 20, phaseAfterMs: null, stalledAfterMs: null });
  const verdict = await driveBeat(page as never, openSessionBeat(600), 1, 'http://localhost:4124');
  assert.equal(verdict.status, 'red', 'the phase never arrives');
  assert.match(
    verdict.failures.join(' | '),
    /gave up at the agent wait \(declared 600 ms\)/,
    `a bound that genuinely fired must still be named. Got: ${JSON.stringify(verdict.failures)}`,
  );
});
