/**
 * A beat waiting on an agent must stop when the SESSION ITSELF is terminally
 * failed — bead `forge-8vfn.6.11.39`, the mirror of `6.11.38`. That bead is the
 * loop overshooting the phase it waits for; this is the loop waiting on a
 * corpse.
 *
 * Measured, S2 run 7: the architect's SDK child exited code 1 three seconds
 * after start, `status.json` recorded `phase: "failed"` with its error at
 * 11:12:47, and beat 12 then spent its full declared 600 000 ms reporting
 * "answered 0 round(s) … the act kept being available, so the product never
 * moved on" — true, and beside the point. The act was available because the
 * page still rendered it; the SESSION was dead and the product had said so.
 *
 * The waits watch `LIFECYCLE_STALLED` (a live pid gone quiet), and nothing
 * treated a terminal FAILED phase as a reason to stop. The lifecycle bar cannot
 * carry it either: `deriveSessionLifecycle`'s first rule collapses every
 * terminal phase to `terminal` with `error: null`, so a failed session is
 * indistinguishable there from a finished one.
 *
 * Reading the phase is NOT the re-derivation `beats-page.mjs`' header forbids —
 * that rule is "never re-derive the LIFECYCLE from phase names or timestamps".
 * `failed` is the product's own word for its own state, written by
 * `writeSessionTerminalPhase(…, 'failed', msg)` and declared
 * `{ phase: failed, step: terminal }` in `studio/session-kinds.yaml`.
 *
 * SPLIT from `beats-agent-stall.test.ts` at the 800-line cap: that file is the
 * STALL bead (`6.11.17`), this one is the terminal-failure bead, and they share
 * only the shape of their fakes. The fakes are duplicated rather than imported,
 * for the reason that file's own header gives — a test file reaching into
 * another test file's fixtures is worse than a few repeated lines.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveBeat } from './beats.mjs';

const MONITOR = '/monitor';
const SESSION = '/sessions/architect/s1';

/** S4 beat 11's shape, with a bound small enough to measure. */
const openSessionBeat = (upTo: number | null) => ({
  act: 'Open the session from Monitor and wait for the Architect to finish drafting',
  do: [{ press: 'open-session' }],
  ...(upTo === null ? {} : { wait: { for: 'agent', upTo } }),
  expect: { route: SESSION, data: { page: 'session', 'page-ready': 'true', 'session-phase': 'awaiting-verdict' } },
  say: 'The Architect finishes its interview and the plan is ready to judge.',
});

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


/**
 * The navigating shape again, plus the one thing the archive shows: the session
 * can reach a terminal `failed` phase while the page keeps rendering its
 * controls. `failedAfterMs` is when that happens (`null` = never).
 */
function fakeStudioThatDies(spec: { commitMs: number; failedAfterMs: number | null }) {
  let route = MONITOR;
  const startedAt = Date.now();
  const since = () => Date.now() - startedAt;
  const phase = () => (spec.failedAfterMs !== null && since() >= spec.failedAfterMs ? 'failed' : 'interviewing');

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
    async click() { setTimeout(() => { route = SESSION; }, spec.commitMs); },
    async evaluate(fn: (n: any) => unknown) {
      return fn({ tagName: 'BUTTON', textContent: '', type: '', value: '', querySelector: () => null, disabled: false, title: '', getAttribute: () => null });
    },
  });

  return {
    url: () => `http://localhost:4124${route}`,
    goto: async (u: string) => { route = new URL(u).pathname; },
    locator,
    waitForURL: (pred: (u: string) => boolean, o: { timeout: number }) =>
      until(() => pred(`http://localhost:4124${route}`), o.timeout, 'the URL'),
    waitForSelector: () => Promise.resolve(),
    evaluate: async () => ({
      data: route === SESSION ? { page: 'session', 'page-ready': 'true', 'session-phase': phase() } : { page: 'monitor', 'page-ready': 'true' },
      nested: [],
      // The product's lifecycle says NOTHING useful here, which is the point:
      // `deriveSessionLifecycle` collapses a failed phase to `terminal`, so the
      // bar cannot tell this beat that the session is dead.
      lifecycle: route === SESSION ? 'terminal' : null,
      sessionPhase: route === SESSION ? phase() : null,
    }),
  };
}

test('6.11.39 (RED) a beat waiting on an agent stops when the SESSION ITSELF reaches a terminal `failed` phase', async () => {
  // The session dies 200 ms in; the beat declared 60 s. S2 run 7 spent 600 s
  // exactly like this.
  const page = fakeStudioThatDies({ commitMs: 20, failedAfterMs: 200 });
  const began = Date.now();
  const verdict = await driveBeat(page as never, openSessionBeat(60_000), 1, 'http://localhost:4124');
  const took = Date.now() - began;

  assert.equal(verdict.status, 'red', 'a dead session cannot make this beat pass');
  assert.ok(took < 10_000, `it must stop within a poll of the product saying so, not sit out its 60000 ms bound — took ${took} ms`);
  const said = verdict.failures.join(' | ');
  assert.match(said, /failed/, `the verdict must NAME the session's own terminal phase. Got: ${said}`);
  assert.doesNotMatch(
    said,
    /gave up at the agent wait/,
    `it did not give up at the bound — the product had already marked the session failed. Got: ${said}`,
  );
});

test('6.11.39 (positive control) a session that is merely still WORKING is never cut short', async () => {
  // Same fake, nothing ever fails: the beat must red on its own expectation at
  // its own bound, and claim no failure that never happened.
  const page = fakeStudioThatDies({ commitMs: 20, failedAfterMs: null });
  const verdict = await driveBeat(page as never, openSessionBeat(600), 1, 'http://localhost:4124');

  assert.equal(verdict.status, 'red', 'the phase never becomes awaiting-verdict');
  assert.match(verdict.failures.join(' | '), /gave up at the agent wait \(declared 600 ms\)/);
  assert.doesNotMatch(verdict.failures.join(' | '), /terminal phase/, 'nothing may claim a failure that never happened');
});

test('6.11.39 (positive control) a beat that declares NO agent wait gains no new way to fail', async () => {
  // Scoped exactly like the stall check above (AT-6.11.17-6): a beat that never
  // declared an agent wait is not standing on a session, so this is not its
  // business.
  const page = fakeStudioThatDies({ commitMs: 20, failedAfterMs: 50 });
  const verdict = await driveBeat(page as never, openSessionBeat(null), 1, 'http://localhost:4124', {}, 600);

  assert.equal(verdict.status, 'red', 'the phase never arrives, so the beat is red either way');
  assert.doesNotMatch(
    verdict.failures.join(' | '),
    /terminal phase/,
    'the terminal-failure early red is scoped to beats that declared an agent wait',
  );
});

/**
 * S2 beat 12's actual shape, for `6.11.39`. Run 7 spent its 600 s HERE — in the
 * handle wait inside the `do` block, waiting for `session-answer` on a session
 * whose SDK child had already exited. The navigating case above exercises
 * `waitForConsequence`; this one exercises `waitForHandleOrStall`, which is the
 * site that actually cost the run.
 */
function fakeStudioFieldThatDies(spec: { commitMs: number; failedAfterMs: number | null; fieldAfterMs?: number | null }) {
  let route = MONITOR;
  const startedAt = Date.now();
  const since = () => Date.now() - startedAt;
  const phase = () =>
    spec.failedAfterMs !== null && since() >= spec.failedAfterMs ? 'failed' : 'awaiting-answers';

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

  // With `fieldAfterMs` null the field NEVER appears — the architect died
  // before it could ask, while the page kept rendering, which is exactly why
  // "the act kept being available" was a true and useless thing for run 7's
  // beat to report. A number instead gives the positive control a session that
  // really does ask, late.
  const hasField = () => spec.fieldAfterMs != null && since() >= spec.fieldAfterMs;
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
      return fn({ tagName: 'TEXTAREA', textContent: '', type: '', value: '', querySelector: () => null, disabled: false, title: '', getAttribute: () => null });
    },
  });

  return {
    url: () => `http://localhost:4124${route}`,
    goto: async (u: string) => { route = new URL(u).pathname; },
    locator,
    waitForURL: (pred: (u: string) => boolean, o: { timeout: number }) =>
      until(() => pred(`http://localhost:4124${route}`), o.timeout, 'the URL'),
    waitForSelector: () => Promise.resolve(),
    evaluate: async () => ({
      data: route === SESSION ? { page: 'session', 'page-ready': 'true', 'session-phase': phase() } : { page: 'monitor', 'page-ready': 'true' },
      nested: [],
      lifecycle: route === SESSION ? 'terminal' : null,
      sessionPhase: route === SESSION ? phase() : null,
    }),
  };
}

test('6.11.39 (RED) the SAME early stop applies to a handle wait inside a `do` block — S2 run 7\'s actual site', async () => {
  // Run 7's shape exactly: the field never appears because the architect died
  // 200 ms in, and the beat declared 60 s. Without this, the bound is spent
  // TWICE (the handle wait, then the act), which is the twenty-minute beat
  // `6.11.22` measured — so the assertion is far tighter than one bound.
  const page = fakeStudioFieldThatDies({ commitMs: 20, failedAfterMs: 200 });
  const began = Date.now();
  const verdict = await driveBeat(page as never, answerBeat(60_000), 1, 'http://localhost:4124');
  const took = Date.now() - began;

  assert.equal(verdict.status, 'red', 'a dead session cannot make this beat pass');
  assert.ok(took < 10_000, `it must stop within a poll of the product saying so — took ${took} ms`);
  const said = verdict.failures.join(' | ');
  assert.match(said, /terminal "failed"/, `the failure must NAME the session's own phase. Got: ${said}`);
  assert.match(said, /session-answer/, 'and say which handle it was waiting for when it stopped');
});

test('6.11.39 (positive control) a field that arrives late is still waited for', async () => {
  // The mirror of AT-6.11.17-9: nothing dies, so nothing may be cut short.
  const page = fakeStudioFieldThatDies({ commitMs: 20, failedAfterMs: null, fieldAfterMs: 300 });
  const verdict = await driveBeat(page as never, answerBeat(5_000), 1, 'http://localhost:4124');
  assert.equal(verdict.status, 'green', `a working session must reach green. Failures: ${JSON.stringify(verdict.failures)}`);
});
