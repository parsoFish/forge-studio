/**
 * A bounded wait ends when the PRODUCT says the session is dead — T1 ruling 518.
 *
 * `beats-agent-failed.test.ts` closed one door of this (`6.11.39`, a session
 * whose status.json reached the terminal phase `failed`) and
 * `beats-agent-stall.test.ts` closed another (`6.11.17`, a live pid gone quiet
 * past its kind's ceiling). Two doors, and D's S6 run walked through the third.
 *
 * MEASURED, S6 beat 6: the project-brain runner's turn CRASHED. The page said
 * so in its own words — `div[data-section="session-lifecycle"]
 * [data-lifecycle-state="crashed"]`, headline "The agent turn crashed", the
 * runner's own last stderr line in `pre[data-lifecycle-error]` — and the beat
 * spent its full declared bound anyway.
 *
 * WHY THE TWO EXISTING DOORS BOTH MISS IT. A crash is the shape where the
 * process dies WITHOUT writing a terminal phase, so `status.json` still reads
 * whatever it read mid-flight (`analyzing`) and the `failed` door never opens.
 * And `deriveSessionLifecycle` calls it `crashed`, not `stalled`, so the stall
 * door never opens either. The one signal that IS true is the one nothing read.
 *
 * THE SECOND HALF OF THE RULING: `failed` is not the only terminal phase that
 * ends a session without succeeding. `apps/studio/lib/history-ledger.ts`
 * declares the closed set the product itself classifies against —
 * `SESSION_STOPPED_PHASES = rejected | abandoned | cancelled | failed` — and it
 * is yaml-parity-pinned there against the REAL registry's `step: terminal`
 * rows, so a future kind's new terminal token turns that suite red rather than
 * drifting. A beat waiting on a session the operator rejected has exactly as
 * little to wait for as one waiting on a session that threw.
 *
 * The DONE half of that vocabulary (`committed | locked | applying | applied |
 * complete`) is deliberately NOT a stop reason: a beat may legitimately be
 * waiting for the control a session renders once it has committed, and reding
 * there would invent a failure out of a success. The positive control below
 * pins that.
 *
 * WHAT THE STAKES ARE, in T1's words: "a beat declaring `upTo: 1_800_000` would
 * burn thirty minutes on a session dead at 90 s — every costed run in this
 * campaign is exposed."
 *
 * The fakes are duplicated from the two sibling files rather than imported, for
 * the reason their own headers give — a test file reaching into another test
 * file's fixtures is worse than a few repeated lines.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveBeat } from './beats-drive.mjs';

const MONITOR = '/monitor';
const SESSION = '/sessions/project-brain/s6';

/** The runner's own last stderr line, as `deriveSessionLifecycle` extracts it
 *  and `pre[data-lifecycle-error]` renders it. The verdict must carry THIS,
 *  not a sentence the harness made up about it. */
const CRASH_MESSAGE = 'Error: spawn claude ENOENT';

/** S6 beat 6's shape: press an operator control, then wait on the agent. */
const approveBeat = (upTo: number | null) => ({
  act: 'Approve the brain the agent proposed and wait for it to commit',
  do: [{ press: 'approve-brain' }],
  ...(upTo === null ? {} : { wait: { for: 'agent', upTo } }),
  expect: { route: SESSION, data: { page: 'session', 'page-ready': 'true', 'session-phase': 'committed' } },
  say: 'The operator approves the brain and the agent writes it.',
});

/** S6 beat 6's other half: the wait inside the `do` block, on a control that
 *  only appears once the agent has moved — `waitForHandleOrStall`'s site. */
const answerThenApproveBeat = (upTo: number) => ({
  act: 'Answer the briefing questions, then approve the brain',
  do: [{ press: 'open-session' }, { press: 'approve-brain' }],
  wait: { for: 'agent', upTo },
  expect: { route: SESSION, data: { page: 'session', 'page-ready': 'true', 'session-phase': 'committed' } },
  say: 'The operator answers, then approves.',
});

/**
 * A session page that keeps rendering its controls while the session underneath
 * it dies in one of the ways the product can report.
 *
 * `dies` says WHAT the page starts reporting at `afterMs`:
 *   - `{ lifecycle: 'crashed', error }` — the crash banner (S6 beat 6).
 *   - `{ phase: 'abandoned' }`          — a terminal-stopped phase.
 *   - `{ phase: 'committed', lifecycle: 'terminal' }` — a terminal SUCCESS,
 *     which must never stop anything.
 * `null` = the session simply keeps working, forever.
 *
 * `query` appends a live search string to the session URL the page reports —
 * the product's own `?project=…` plumbing, which the beat does not name.
 */
function fakeStudioThatDies(spec: {
  commitMs: number;
  afterMs: number | null;
  dies: { lifecycle?: string; phase?: string; error?: string } | null;
  query?: string;
  holdControlMs?: number;
}) {
  let route = MONITOR;
  const startedAt = Date.now();
  const since = () => Date.now() - startedAt;
  const dead = () => spec.dies !== null && spec.afterMs !== null && since() >= spec.afterMs;
  const phase = () => (dead() ? (spec.dies?.phase ?? 'analyzing') : 'analyzing');
  const lifecycle = () => (dead() ? (spec.dies?.lifecycle ?? 'working') : 'working');
  const lifecycleError = () => (dead() ? (spec.dies?.error ?? null) : null);
  const onSession = () => route === SESSION;

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

  const available = (sel: string) => {
    if (sel.includes('open-session')) return route === MONITOR;
    // The control the `do` block waits for. `holdControlMs` withholds it, which
    // is what puts the beat inside `waitForHandleOrStall` rather than past it.
    if (sel.includes('approve-brain')) {
      return onSession() && (spec.holdControlMs === undefined || since() >= spec.holdControlMs);
    }
    return false;
  };

  const locator = (sel: string): any => ({
    first: () => locator(sel),
    // `driveBeat` asks every page for its links (bead `forge-8vfn.7.5.3`).
    evaluateAll: async (fn: any, arg: any) => fn([], arg),
    count: async () => (available(sel) ? 1 : 0),
    async click() { if (sel.includes('open-session')) setTimeout(() => { route = SESSION; }, spec.commitMs); },
    async evaluate(fn: (n: any) => unknown) {
      return fn({ tagName: 'BUTTON', textContent: '', type: '', value: '', querySelector: () => null, disabled: false, title: '', getAttribute: () => null });
    },
  });

  const href = () => `http://localhost:4124${route}${onSession() ? (spec.query ?? '') : ''}`;

  return {
    url: href,
    goto: async (u: string) => { route = new URL(u).pathname; },
    locator,
    waitForURL: (pred: (u: string) => boolean, o: { timeout: number }) => until(() => pred(href()), o.timeout, 'the URL'),
    waitForSelector: () => Promise.resolve(),
    evaluate: async () => ({
      data: onSession()
        ? { page: 'session', 'page-ready': 'true', 'session-phase': phase() }
        : { page: 'monitor', 'page-ready': 'true' },
      nested: [],
      lifecycle: onSession() ? lifecycle() : null,
      lifecycleError: onSession() ? lifecycleError() : null,
      sessionPhase: onSession() ? phase() : null,
    }),
  };
}

/** Start ON the session page, so the beat's wait is the only thing measured. */
const onSessionFrom = (spec: Parameters<typeof fakeStudioThatDies>[0]) => {
  const page = fakeStudioThatDies({ ...spec, commitMs: 0 });
  return page;
};

test('518 (RED) the crashed lifecycle banner ends a bounded agent wait at the crash, not at the bound', async () => {
  // S6 beat 6, with a bound small enough to measure a burn against: the page
  // starts saying `crashed` 200 ms in, the beat declared 60 s.
  const page = fakeStudioThatDies({ commitMs: 0, afterMs: 200, dies: { lifecycle: 'crashed', error: CRASH_MESSAGE } });
  await page.goto(`http://localhost:4124${SESSION}`);
  const began = Date.now();
  const verdict = await driveBeat(page as never, approveBeat(60_000), 1, 'http://localhost:4124');
  const took = Date.now() - began;

  assert.equal(verdict.status, 'red', 'a crashed session cannot make this beat pass');
  assert.ok(took < 10_000, `it must end within a poll of the page saying so, not sit out its 60000 ms bound — took ${took} ms`);
  const said = verdict.failures.join(' | ');
  assert.match(said, /crashed/, `the verdict must NAME the crash. Got: ${said}`);
  assert.match(said, /spawn claude ENOENT/, `the verdict must carry the PAGE'S OWN message, not a sentence about it. Got: ${said}`);
  assert.doesNotMatch(said, /gave up at the agent wait/, `it did not give up at the bound — the page had already said the turn crashed. Got: ${said}`);
});

test('518 (RED) the crashed banner ends the wait for a CONTROL too, not only the wait for state', async () => {
  // The `do` block's own wait — `waitForHandleOrStall`. `approve-brain` is
  // withheld for longer than the bound, so the beat is sitting in that wait
  // when the page starts reporting the crash.
  const page = fakeStudioThatDies({
    commitMs: 0, afterMs: 300, dies: { lifecycle: 'crashed', error: CRASH_MESSAGE }, holdControlMs: 90_000,
  });
  const began = Date.now();
  const verdict = await driveBeat(page as never, answerThenApproveBeat(60_000), 1, 'http://localhost:4124');
  const took = Date.now() - began;

  assert.equal(verdict.status, 'red');
  assert.ok(took < 10_000, `the control wait must end at the crash — took ${took} ms of a 60000 ms bound`);
  assert.match(verdict.failures.join(' | '), /crashed/);
});

for (const phase of ['abandoned', 'rejected', 'cancelled']) {
  test(`518 (RED) the terminal phase "${phase}" ends a bounded agent wait, exactly as "failed" already did`, async () => {
    const page = fakeStudioThatDies({ commitMs: 0, afterMs: 200, dies: { phase, lifecycle: 'terminal' } });
    await page.goto(`http://localhost:4124${SESSION}`);
    const began = Date.now();
    const verdict = await driveBeat(page as never, approveBeat(60_000), 1, 'http://localhost:4124');
    const took = Date.now() - began;

    assert.equal(verdict.status, 'red');
    assert.ok(took < 10_000, `"${phase}" is terminal and not a success — took ${took} ms of a 60000 ms bound`);
    assert.match(verdict.failures.join(' | '), new RegExp(phase), `the verdict must name the phase it stopped on`);
  });
}

test('518 (RED) a live `?project=…` on the session URL does not disarm the stop', async () => {
  // Ruling 514 made `readObserved` report `pathname + search`, and the scope
  // compare in `stopReasonFor` was a string equality against the beat's
  // DECLARED route — so the moment the product mounted the page with its own
  // `?project=` parameter, a beat that named no query stopped being "about"
  // the session it was standing on and every stop door silently closed. Three
  // live sites mount exactly that parameter.
  const page = fakeStudioThatDies({
    commitMs: 0, afterMs: 200, dies: { lifecycle: 'crashed', error: CRASH_MESSAGE }, query: '?project=gitpulse',
  });
  await page.goto(`http://localhost:4124${SESSION}`);
  const began = Date.now();
  const verdict = await driveBeat(page as never, approveBeat(60_000), 1, 'http://localhost:4124');
  const took = Date.now() - began;

  assert.equal(verdict.status, 'red');
  assert.ok(took < 10_000, `the beat is standing on its own session; a product parameter is not a different session — took ${took} ms`);
  assert.match(verdict.failures.join(' | '), /crashed/);
});

test('518 (positive control) a session that is merely still WORKING still waits its whole bound', async () => {
  // T1's second half, verbatim: "a page that stays `analyzing` still waits the
  // bound". Nothing may claim a failure that never happened.
  const page = fakeStudioThatDies({ commitMs: 0, afterMs: null, dies: null });
  await page.goto(`http://localhost:4124${SESSION}`);
  const began = Date.now();
  const verdict = await driveBeat(page as never, approveBeat(700), 1, 'http://localhost:4124');
  const took = Date.now() - began;

  assert.equal(verdict.status, 'red', 'the phase never becomes committed');
  assert.ok(took >= 600, `it must actually wait — took only ${took} ms of a 700 ms bound`);
  assert.match(verdict.failures.join(' | '), /gave up at the agent wait \(declared 700 ms\)/);
  assert.doesNotMatch(verdict.failures.join(' | '), /crash|terminal/i, 'nothing may claim a failure that never happened');
});

test('518 (positive control) a terminal SUCCESS is never a stop reason', async () => {
  // `committed` is terminal and it is what this beat is WAITING FOR. A stop
  // predicate that read "terminal" rather than "terminal and not succeeded"
  // would red the very beat it was meant to protect.
  const page = fakeStudioThatDies({ commitMs: 0, afterMs: 200, dies: { phase: 'committed', lifecycle: 'terminal' } });
  await page.goto(`http://localhost:4124${SESSION}`);
  const verdict = await driveBeat(page as never, approveBeat(60_000), 1, 'http://localhost:4124');

  assert.equal(verdict.status, 'green', `a session that committed is what the beat asked for. Got: ${verdict.failures.join(' | ')}`);
});

test('518 (positive control) a beat that declares NO agent wait gains no new way to fail', async () => {
  // Scoped exactly like the stall and terminal-failure checks it joins
  // (`6.11.47`): a beat that never declared an agent wait is not standing on a
  // session as far as this predicate is concerned.
  const page = fakeStudioThatDies({ commitMs: 0, afterMs: 50, dies: { lifecycle: 'crashed', error: CRASH_MESSAGE } });
  await page.goto(`http://localhost:4124${SESSION}`);
  const verdict = await driveBeat(page as never, approveBeat(null), 1, 'http://localhost:4124', {}, 700);

  assert.equal(verdict.status, 'red', 'the phase never arrives, so the beat is red either way');
  assert.doesNotMatch(verdict.failures.join(' | '), /crashed/, 'the crash-aware early red is scoped to beats that declared an agent wait');
});

/**
 * The copy cannot drift.
 *
 * `TERMINAL_STOPPED_PHASES` is a COPY of `apps/studio/lib/history-ledger.ts`'s
 * `SESSION_STOPPED_PHASES`, and it is copied for a real reason: the harness is
 * plain `.mjs` run by `node scripts/stories/run.mjs` with no type stripping, so
 * it cannot import the `.ts` that declares it. A copy with a comment naming its
 * source is a copy that drifts the first time the product adds a terminal
 * token — and the drift is INVISIBLE, because the harness would simply go back
 * to waiting out the bound on a state the product had already called final.
 *
 * A TEST can import it: `npm test` runs these under
 * `--experimental-strip-types`, and `history-ledger.ts` is the pure,
 * transport-free module (its only import is a `type`). So the copy is pinned to
 * its source here rather than trusted, and the product's own yaml-parity pin
 * (`apps/studio/tests/unit/history-ledger.test.ts`) carries the other half:
 * every REAL `step: terminal` row in `studio/session-kinds.yaml` lands in
 * `SESSION_DONE_PHASES ∪ SESSION_STOPPED_PHASES`. Between the two, a future
 * kind's new terminal token turns something red instead of costing a run.
 */
test('518 — the runner’s stopped-phase set IS the product’s, not a copy that drifted', async () => {
  const { TERMINAL_STOPPED_PHASES } = await import('./beats-page.mjs');
  const { SESSION_STOPPED_PHASES, SESSION_DONE_PHASES } = await import('../../apps/studio/lib/history-ledger.ts');

  assert.deepEqual(
    [...TERMINAL_STOPPED_PHASES].sort(),
    [...SESSION_STOPPED_PHASES].sort(),
    'the harness stops on exactly the phases the product classifies as "did not succeed"',
  );
  for (const done of SESSION_DONE_PHASES) {
    assert.ok(
      !TERMINAL_STOPPED_PHASES.has(done),
      `"${done}" is a SUCCESS terminal — stopping a wait there would invent a failure out of a success`,
    );
  }
});
