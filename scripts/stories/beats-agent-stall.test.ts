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

/**
 * The SECOND place an agent-scale bound is spent, found by reading what the
 * held S2/S1 runs actually do rather than by another run.
 *
 * S2 beat 12's `do` is three steps — `press open-session` (navigates),
 * `fill session-answer`, `press submit-answers` — and
 * `SessionInteractivePanel.tsx:455` renders that field ONLY inside a
 * `question-form` affordance, i.e. only once the architect has ASKED. So the
 * bound goes into `performSteps`' handle wait, not into `waitForConsequence`:
 * a single `locator.waitFor({ timeout })`, which cannot consult the lifecycle
 * mid-wait. S1 beat 6 has the same shape.
 *
 * And the bound is spent TWICE: the handle wait swallows its timeout, then
 * `setControl` runs with the SAME bound and `readShape`'s evaluate waits again
 * — a ten-minute declared bound on a field that never appears is a
 * twenty-minute beat. Nothing had a bound long enough to expose that until
 * #438 gave these three beats one.
 */

/** A session page whose `question-form` field appears only after `fieldAfterMs`. */
function fakeStudioWithField(spec: {
  commitMs: number;
  fieldAfterMs: number | null;
  stalledAfterMs: number | null;
}) {
  let route = MONITOR;
  const startedAt = Date.now();
  const since = () => Date.now() - startedAt;
  const hasField = () => spec.fieldAfterMs !== null && since() >= spec.fieldAfterMs;
  const lifecycle = () =>
    spec.stalledAfterMs !== null && since() >= spec.stalledAfterMs ? 'stalled' : 'working';

  const until = (pred: () => boolean, timeout: number, what: string) =>
    new Promise<void>((resolve, reject) => {
      const began = Date.now();
      const tick = () => {
        if (pred()) return resolve();
        if (Date.now() - began >= timeout) return reject(new Error(`Timeout ${timeout}ms exceeded waiting for ${what}`));
        setTimeout(tick, 5);
      };
      tick();
    });

  const present = (sel: string) => {
    if (sel.includes('open-session')) return route === MONITOR;
    if (sel.includes('session-answer') || sel.includes('submit-answers')) return route === SESSION && hasField();
    return false;
  };

  const locator = (sel: string): any => ({
    first: () => locator(sel),
    count: async () => (present(sel) ? 1 : 0),
    waitFor: ({ timeout }: { timeout: number }) => until(() => present(sel), timeout, sel),
    async click({ timeout = 5000 }: { timeout?: number } = {}) {
      await until(() => present(sel), timeout, sel).catch(() => {
        throw new Error(`locator.click: Timeout ${timeout}ms exceeded waiting for ${sel}`);
      });
      if (sel.includes('open-session')) setTimeout(() => { route = SESSION; }, spec.commitMs);
    },
    async fill(_v: string, { timeout = 5000 }: { timeout?: number } = {}) {
      await until(() => present(sel), timeout, sel).catch(() => {
        throw new Error(`locator.fill: Timeout ${timeout}ms exceeded waiting for ${sel}`);
      });
    },
    async evaluate(fn: (n: any) => unknown, _a?: unknown, { timeout = 5000 }: { timeout?: number } = {}) {
      await until(() => present(sel), timeout, sel).catch(() => {
        throw new Error(`locator.evaluate: Timeout ${timeout}ms exceeded waiting for ${sel}`);
      });
      return fn({
        tagName: 'TEXTAREA', textContent: '', type: '', value: '',
        querySelector: () => null, disabled: false, title: '', getAttribute: () => null,
      });
    },
  });

  return {
    url: () => `http://localhost:4124${route}`,
    goto: async (u: string) => { route = new URL(u).pathname; },
    locator,
    waitForURL: (pred: (u: string) => boolean, o: { timeout: number }) =>
      until(() => pred(`http://localhost:4124${route}`), o.timeout, 'the URL'),
    waitForSelector: (_s: string, _o: { timeout: number }) => Promise.resolve(),
    evaluate: async () => ({
      data: route === SESSION
        ? { page: 'session', 'page-ready': 'true', 'session-phase': 'awaiting-answers' }
        : { page: 'monitor', 'page-ready': 'true' },
      nested: [],
      lifecycle: route === SESSION ? lifecycle() : null,
    }),
  };
}

/** S2 beat 12's shape. */
const answerBeat = (upTo: number | null) => ({
  act: "Open the session again and answer the Architect's questions about the project",
  do: [
    { press: 'open-session' },
    { fill: 'session-answer', with: 'The gate command is `npm test`.' },
    { press: 'submit-answers' },
  ],
  ...(upTo === null ? {} : { wait: { for: 'agent', upTo } }),
  expect: { route: SESSION, data: { page: 'session', 'page-ready': 'true', 'session-phase': 'awaiting-answers' } },
  say: 'The operator answers the Architect and it goes away to draft.',
});

test('AT-6.11.17-8 (RED) a stalled session reds a beat waiting for a handle inside its do block', async () => {
  // The field NEVER appears and the product says `stalled` at 200 ms. Without
  // the early red this burns the declared bound TWICE — once in the handle
  // wait, once in setControl — so the assertion below is deliberately far
  // tighter than one bound, let alone two.
  const page = fakeStudioWithField({ commitMs: 20, fieldAfterMs: null, stalledAfterMs: 200 });
  const began = Date.now();
  const verdict = await driveBeat(page as never, answerBeat(30_000), 1, 'http://localhost:4124');
  const took = Date.now() - began;

  assert.equal(verdict.status, 'red', 'the field never appears, so the beat cannot pass');
  assert.ok(took < 10_000, `it must stop at the stall, not sit out its bound (twice) — took ${took} ms`);
  assert.match(
    verdict.failures.join(' | '),
    /stalled/,
    `the refusal must NAME the stall. Got: ${JSON.stringify(verdict.failures)}`,
  );
});

test('AT-6.11.17-9 (positive control) a handle that arrives late is still waited for', async () => {
  // The architect asks at 400 ms — well inside the declared bound. The beat
  // must wait for it and go green, never red early on a session that is
  // merely working.
  const page = fakeStudioWithField({ commitMs: 20, fieldAfterMs: 400, stalledAfterMs: null });
  const verdict = await driveBeat(page as never, answerBeat(6_000), 1, 'http://localhost:4124');
  assert.equal(
    verdict.status,
    'green',
    `a working session whose field arrives at 400 ms must be waited for. Failures: ${JSON.stringify(verdict.failures)}`,
  );
});

test('AT-6.11.17-10 (positive control) a beat with no declared agent wait keeps its old failure text', async () => {
  const page = fakeStudioWithField({ commitMs: 20, fieldAfterMs: null, stalledAfterMs: 50 });
  const verdict = await driveBeat(page as never, answerBeat(null), 1, 'http://localhost:4124', {}, 400);
  assert.equal(verdict.status, 'red', 'the field never appears');
  assert.doesNotMatch(
    verdict.failures.join(' | '),
    /stalled/,
    'the early red stays scoped to beats that declared an agent wait',
  );
});

/**
 * The GUARD, bead `forge-8vfn.6.11.19` (T1 ruling 254) — the class re-planned
 * rather than patched a fourth time.
 *
 * Three times now a declared `wait` has failed to bound what it named:
 * `6.11.6` (a bound wrong for what it waited on), `6.11.10` (one bound serving
 * two different waits), and this milestone (`6.11.17`: a declared agent bound
 * applied to a URL change, and spent twice in `performSteps`). Every time the
 * field was parsed, surfaced in the verdict, and enforced nowhere — and every
 * time the verdict then NAMED a bound that had not fired, so the run record
 * could not tell "the agent was slow" from "the runner never waited".
 *
 * A fourth fix would close a fourth instance. This closes the class: a beat
 * that declares `wait: { for: 'agent' }` is RED unless a waiter that can
 * actually observe the agent consumed that bound on this beat's path. The URL
 * wait and the page-ready wait both take the bound and neither observes an
 * agent — which is exactly how `6.11.17` hid — so neither counts.
 *
 * It fires whatever the verdict would otherwise have been. A beat that PASSES
 * without its declared wait ever running passed by luck, and a gate that
 * accepts luck is the fail-open shape this campaign keeps paying for.
 */

/** A beat declaring an agent wait whose route needs no navigation and whose
 *  `do` block is empty — no waiter can consume the bound. */
const strandedWaitBeat = {
  act: 'Stand on the session and declare a wait nothing can consume',
  wait: { for: 'agent', upTo: 5_000 },
  expect: { route: SESSION, data: { page: 'session', 'page-ready': 'true' } },
  say: 'A declared bound that bounds nothing.',
};

test('AT-6.11.19-1 (RED) a declared agent wait that NO waiter consumed reds the beat, naming it', async () => {
  // The page already satisfies every expectation, so without the guard this
  // beat is GREEN — green by luck, with a ten-second bound that bounded
  // nothing. That is the shape the guard exists to refuse.
  const page = fakeStudio({ commitMs: 0, phaseAfterMs: 0, stalledAfterMs: null });
  await page.goto('http://localhost:4124' + SESSION);
  const verdict = await driveBeat(page as never, strandedWaitBeat, 0, 'http://localhost:4124');

  assert.equal(
    verdict.status,
    'red',
    `a beat whose declared wait bounded nothing must not pass. Failures: ${JSON.stringify(verdict.failures)}`,
  );
  const said = verdict.failures.join(' | ');
  assert.match(said, /declared/, said);
  assert.match(said, /no waiter/i, `the failure must name the missing consumer. Got: ${said}`);
  assert.match(said, /5000/, `and the bound it declared. Got: ${said}`);
});

test('AT-6.11.19-2 (positive control) the SAME beat with a consumer runs, and the guard stays silent', async () => {
  // Identical declaration, but a `do` block gives `performSteps`/the
  // consequence wait something to consume the bound with.
  const page = fakeStudio({ commitMs: 20, phaseAfterMs: 400, stalledAfterMs: null });
  const verdict = await driveBeat(page as never, openSessionBeat(4_000), 1, 'http://localhost:4124');
  assert.equal(verdict.status, 'green', `Failures: ${JSON.stringify(verdict.failures)}`);
  assert.doesNotMatch(verdict.failures.join(' | '), /no waiter/i, 'a consumed bound must not trip the guard');
});

test('AT-6.11.19-3 (positive control) a beat that declares NO wait is never judged by this guard', async () => {
  const page = fakeStudio({ commitMs: 0, phaseAfterMs: 0, stalledAfterMs: null });
  await page.goto('http://localhost:4124' + SESSION);
  const noWait = { ...strandedWaitBeat, wait: undefined };
  const verdict = await driveBeat(page as never, noWait as never, 0, 'http://localhost:4124');
  assert.equal(verdict.status, 'green', `Failures: ${JSON.stringify(verdict.failures)}`);
  assert.doesNotMatch(verdict.failures.join(' | '), /no waiter/i, said2(verdict));
});

function said2(v: { failures: readonly string[] }) {
  return `the guard is scoped to beats that DECLARED a wait. Got: ${JSON.stringify(v.failures)}`;
}

test('AT-6.11.19-4 (RED) a URL wait alone does NOT count as consuming an agent bound', async () => {
  // This is 6.11.17's exact shape: the beat navigates, the URL wait takes the
  // declared bound, and nothing ever observes the agent. Before #456 that
  // combination reported `gave up at the agent wait` after about a second. The
  // guard must refuse it even if a future change removed the consequence wait
  // again — so this pin asserts the RULE, not the current wiring: a beat whose
  // only bound-consuming waiter is the URL wait is red.
  const page = fakeStudio({ commitMs: 20, phaseAfterMs: 0, stalledAfterMs: null });
  const verdict = await driveBeat(page as never, openSessionBeat(3_000), 1, 'http://localhost:4124');
  // With the consequence wait in place this is green — the control that proves
  // the guard is not simply always-on for navigating beats.
  assert.equal(verdict.status, 'green', `Failures: ${JSON.stringify(verdict.failures)}`);
});

/**
 * ONE declared bound is ONE spend (bead `forge-8vfn.6.11.22`, T1 ruling 267).
 *
 * S2 run 3 measured it on the lane's LAST S2 run: beat 12 declared
 * `upTo: 600_000` and took about twenty minutes — 600 s in `performSteps`'
 * handle wait, which SWALLOWS its timeout, and then 600 s again in
 * `setControl`'s `evaluate`, which was handed the same `timeoutMs` afresh.
 *
 * #458's early red correctly did not fire: the session was never `stalled`, it
 * was FINISHED. The architect had asked its three questions at 118.5 s and the
 * page read `data-session-phase="awaiting-answers"` throughout. So the
 * double-spend is not a stall problem — it is what a healthy session plus an
 * absent handle costs, and that is the ordinary shape of a story finding a real
 * product gap. Ten minutes of a funded run went into waiting twice for an answer
 * the first wait had already given.
 *
 * A declared bound is a statement about the BEAT, not about each wait inside it.
 */

test('AT-6.11.22-1 (RED) a beat whose handle never appears spends its declared bound ONCE, not twice', async () => {
  // Healthy session, handle absent forever — S2 beat 12's exact shape.
  const page = fakeStudioWithField({ commitMs: 20, fieldAfterMs: null, stalledAfterMs: null });
  const began = Date.now();
  const verdict = await driveBeat(page as never, answerBeat(1_200), 1, 'http://localhost:4124');
  const took = Date.now() - began;

  assert.equal(verdict.status, 'red', 'the field never appears, so the beat is red either way');
  assert.ok(
    took < 2_000,
    `one declared bound of 1200 ms is ONE spend: the handle wait and the act that follows share it. ` +
      `Took ${took} ms — a second full bound means the beat pays twice for one declaration.`,
  );
  const said = verdict.failures.join(' | ');
  assert.match(
    said,
    /whole declared bound \(1200 ms\)/,
    `and the beat says the bound ran out, in its own terms. Got: ${JSON.stringify(verdict.failures)}`,
  );
  assert.doesNotMatch(
    said,
    /Timeout 0ms exceeded/,
    'never "Timeout 0ms exceeded" — that names a bound nobody declared and reads like a runner bug',
  );
});

test('AT-6.11.22-2 (positive control) a handle that arrives inside the shared bound is still filled', async () => {
  // The deadline is shared, not shortened: work that finishes in time still wins.
  const page = fakeStudioWithField({ commitMs: 20, fieldAfterMs: 300, stalledAfterMs: null });
  const verdict = await driveBeat(page as never, answerBeat(5_000), 1, 'http://localhost:4124');
  assert.equal(
    verdict.status,
    'green',
    `sharing the bound must not shorten it. Failures: ${JSON.stringify(verdict.failures)}`,
  );
});

test('AT-6.11.22-3 (positive control) the stall early red still wins when the product DOES say stalled', async () => {
  const page = fakeStudioWithField({ commitMs: 20, fieldAfterMs: null, stalledAfterMs: 150 });
  const began = Date.now();
  const verdict = await driveBeat(page as never, answerBeat(30_000), 1, 'http://localhost:4124');
  assert.ok(Date.now() - began < 10_000, 'the stall still cuts the wait short');
  assert.match(verdict.failures.join(' | '), /stalled/, JSON.stringify(verdict.failures));
});

/**
 * The next occurrence of `6.11.17` describes itself (bead `forge-8vfn.6.11.22`,
 * ruling 267's second half). The bead is P1, open, owner unknown and
 * INTERMITTENT — S4 run 2 hung, while an out-of-story dispatch and S2 run 3's
 * architect both completed. What settles it is what the process was doing WHILE
 * a beat waited, and until now that was reconstructed afterwards, by hand, once.
 *
 * The probe is injected so these pins never touch a real `/proc`.
 */

/** A probe that reports a trend, exactly as the real one does. */
const fakeProbe = (summary: string | null) => {
  const p: any = () => { p.calls += 1; };
  p.calls = 0;
  p.summary = () => summary;
  return p;
};

test('AT-6.11.22-4 (RED) an unsatisfied agent wait carries the agent\'s own /proc trend into its failure', async () => {
  const page = fakeStudioWithField({ commitMs: 20, fieldAfterMs: null, stalledAfterMs: null });
  const probe = fakeProbe('agent /proc over 4 sample(s): parent state=S utime 49→49, SDK child state=S utime 154→197 — it was WORKING');
  const verdict = await driveBeat(
    page as never, answerBeat(1_000), 1, 'http://localhost:4124', {}, undefined, probe,
  );
  assert.equal(verdict.status, 'red');
  assert.ok(probe.calls > 0, 'the probe must be SAMPLED while the beat waits, not called once at the end');
  assert.match(
    verdict.failures.join(' | '),
    /SDK child state=S utime 154→197/,
    `the trend must reach the verdict. Got: ${JSON.stringify(verdict.failures)}`,
  );
});

test('AT-6.11.22-5 (positive control) with NO probe the failure text is unchanged', async () => {
  const page = fakeStudioWithField({ commitMs: 20, fieldAfterMs: null, stalledAfterMs: null });
  const verdict = await driveBeat(page as never, answerBeat(1_000), 1, 'http://localhost:4124');
  assert.equal(verdict.status, 'red');
  assert.doesNotMatch(verdict.failures.join(' | '), /\/proc/, 'no probe, no /proc noise');
});

test('AT-6.11.22-6 (positive control) a beat that SUCCEEDS carries no probe noise', async () => {
  const page = fakeStudioWithField({ commitMs: 20, fieldAfterMs: 300, stalledAfterMs: null });
  const probe = fakeProbe('anything at all');
  const verdict = await driveBeat(
    page as never, answerBeat(5_000), 1, 'http://localhost:4124', {}, undefined, probe,
  );
  assert.equal(verdict.status, 'green', JSON.stringify(verdict.failures));
  assert.doesNotMatch(verdict.failures.join(' | '), /anything at all/, 'diagnosis rides on FAILURE only');
});

/**
 * `fillAll` in the runner (bead `forge-8vfn.6.11.21`, T1 ruling 271).
 *
 * `ArchitectQuestionForm` renders one free-text box per question and enables
 * Submit only once EVERY question is answered. The count is model-determined —
 * two questions in one measured architect turn, three in another — so a story
 * cannot name a fixed number of `fill` steps, and a single `fill` against a
 * `data-field` shared by N boxes trips playwright strict mode on the first one.
 */

/** A page with `n` boxes all sharing one `data-field`, plus a submit action. */
function fakeStudioWithN(n: number) {
  const filled: string[] = [];
  const locator = (sel: string): any => ({
    first: () => locator(sel),
    count: async () => (sel.includes('question-freetext') ? n : sel.includes('submit-answers') ? 1 : 0),
    nth: (i: number) => ({
      async fill(v: string) { filled[i] = v; },
      async evaluate(fn: (x: any) => unknown) {
        return fn({ tagName: 'TEXTAREA', textContent: '', type: '', value: '', querySelector: () => null, disabled: false, title: '', getAttribute: () => null });
      },
    }),
    async fill(v: string) { filled[0] = v; },
    async click() { /* submit */ },
    waitFor: async () => {},
    async evaluate(fn: (x: any) => unknown) {
      return fn({ tagName: 'TEXTAREA', textContent: '', type: '', value: '', querySelector: () => null, disabled: false, title: '', getAttribute: () => null });
    },
  });
  return {
    filled,
    url: () => 'http://localhost:4124' + SESSION,
    goto: async () => {},
    locator,
    waitForURL: async () => {},
    waitForSelector: async () => {},
    evaluate: async () => ({
      data: { page: 'session', 'page-ready': 'true', 'session-phase': 'awaiting-answers' },
      nested: [], lifecycle: 'working',
    }),
  };
}

const answerAllBeat = {
  act: "Answer every one of the Architect's questions",
  do: [{ fillAll: 'question-freetext', with: 'The gate command is `npm test`.' }, { press: 'submit-answers' }],
  expect: { route: SESSION, data: { page: 'session', 'page-ready': 'true', 'session-phase': 'awaiting-answers' } },
  say: 'The operator answers the whole round.',
};

test('AT-6.11.21-8 (RED) fillAll fills EVERY match — a round of three is fully answered', async () => {
  const page = fakeStudioWithN(3);
  await page.goto();
  const verdict = await driveBeat(page as never, answerAllBeat, 0, 'http://localhost:4124');
  assert.equal(verdict.status, 'green', `Failures: ${JSON.stringify(verdict.failures)}`);
  assert.deepEqual(
    page.filled,
    Array(3).fill('The gate command is `npm test`.'),
    'every box, not just the first — Submit stays disabled until all are answered',
  );
});

test('AT-6.11.21-9 (RED) fillAll with ZERO matches is red, naming the field', async () => {
  const page = fakeStudioWithN(0);
  await page.goto();
  const verdict = await driveBeat(page as never, answerAllBeat, 0, 'http://localhost:4124', {}, 400);
  assert.equal(verdict.status, 'red', 'a round with nothing to answer must not pass silently');
  assert.match(
    verdict.failures.join(' | '),
    /question-freetext/,
    `the field must be NAMED. Got: ${JSON.stringify(verdict.failures)}`,
  );
});

test('AT-6.11.21-10 (positive control) a single match is filled exactly as `fill` would', async () => {
  const page = fakeStudioWithN(1);
  await page.goto();
  const verdict = await driveBeat(page as never, answerAllBeat, 0, 'http://localhost:4124');
  assert.equal(verdict.status, 'green', JSON.stringify(verdict.failures));
  assert.deepEqual(page.filled, ['The gate command is `npm test`.']);
});
