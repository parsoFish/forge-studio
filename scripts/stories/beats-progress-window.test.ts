/**
 * beats-progress-window.test.ts — T1 ruling 1471, S10 run 26: "a bound that
 * does not expire while the agent is demonstrably progressing."
 *
 * THE INCIDENT. The product was healthy — the dev phase took 17 minutes,
 * three WIs merged, integrate and demo finished, and adversarial review was
 * running serially over 4 chunks. Beat 10's `wait: { for: 'agent', cycleOf:
 * … }` hit `MAX_DECLARED_WAIT_MS` (1,800,000 ms) at 18:18:10; a review chunk
 * had been persisted at 18:14:35, four minutes earlier. Teardown killed the
 * reviewer and the cycle failed, after $14.61 of spend.
 *
 * THE RULED SHAPE (see `story-wait-schema.mjs`'s `CYCLE_WAIT_WALL_CEILING_MS`
 * and `beats-cycle-progress.mjs`'s `cycleWaitDeadline`, unit-tested on their
 * own in `beats-cycle-progress.test.ts`): for a `cycleOf` wait, `upTo` is an
 * INACTIVITY window that resets on new cycle activity, bounded on one side by
 * the run's own $ ceiling and on the other by an absolute wall ceiling that
 * progress can never push out. Every case here runs end to end through
 * `waitForConsequence`, on real files under a temp `_logs/`, with short
 * injected bounds — nothing sleeps for minutes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeCycleTerminalWatch } from './beats-agent-proc.mjs';
import { waitForConsequence } from './beats-page.mjs';
import { makeWaitSpendGuard } from './run-observe.mjs';

/** A page whose expectation answers on EVERY poll, from t = 0 — the same
 *  shape `beats-terminal-condition.test.ts` uses: the subject here is the
 *  WAIT, not the DOM read, so the page is never what ends it. */
function answeringPage() {
  const locator = (): any => ({
    first: () => locator(), count: async () => 1, nth: () => locator(),
    evaluateAll: async (fn: any, a: any) => fn([], a), waitFor: async () => {},
  });
  return {
    url: () => 'http://localhost:4124/projects/gitpulse',
    locator,
    goto: async () => {},
    waitForSelector: async () => {},
    evaluate: async () => ({
      data: { page: 'projects', 'project-id': 'gitpulse', 'enqueue-kind': 'develop' },
      nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null,
    }),
  };
}

const BEAT = {
  act: 'Watch the run build',
  expect: { route: '/projects/gitpulse', data: { page: 'projects', 'project-id': 'gitpulse', 'enqueue-kind': 'develop' } },
};

/** A dispatch dir for `initiative`, born now, with ONE `cycle.start` event
 *  dated at-or-after `sinceMs` so the identity door's `cycleStartedSince`
 *  accepts it — the same fixture shape `beats-cycle-terminal.test.ts` uses. */
function liveCycleDispatch(root: string, initiative: string, sinceMs: number): string {
  const dispatch = join(root, '_logs', `2026-09-26T18-00-00_${initiative}`);
  mkdirSync(dispatch, { recursive: true });
  writeFileSync(
    join(dispatch, 'events.jsonl'),
    `${JSON.stringify({ event_type: 'start', message: 'cycle.start', started_at: new Date(sinceMs).toISOString() })}\n`,
  );
  return dispatch;
}

function queueFile(root: string, state: string, initiative: string): void {
  mkdirSync(join(root, '_queue', state), { recursive: true });
  writeFileSync(join(root, '_queue', state, `${initiative}.md`), '# an initiative\n');
}

test('1471 (the incident): a cycleOf wait must NOT end at upTo while review chunks keep landing, and ends green once the product terminates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'progress-window-incident-'));
  const initiative = 'INIT-progress-incident';
  const t0 = Date.now();
  const dispatch = liveCycleDispatch(root, initiative, t0 - 1_000);

  const upTo = 600; // ms — short and injected, standing in for the declared MAX_DECLARED_WAIT_MS.
  // Chunks keep landing well inside `upTo`'s own window (a wide margin against
  // scheduler jitter under load — the incident's own ratio was far more
  // generous still: a chunk every few minutes against a 30-minute bound) but
  // the RUN as a whole lands well PAST `upTo`, exactly as run 26 measured (a
  // chunk persisted 4 minutes into a 30-minute bound that fired anyway). Each
  // one is fresh cycle progress, so the window must keep resetting.
  const chunks = join(dispatch, 'artifacts', 'review-chunks');
  mkdirSync(chunks, { recursive: true });
  let chunkIndex = 0;
  const timer = setInterval(() => {
    chunkIndex += 1;
    writeFileSync(join(chunks, `chunk-WI-${chunkIndex}.json`), `{"label":"WI-${chunkIndex}"}\n`);
  }, 80);
  // The product terminates at 1800ms — three times `upTo` (600ms) and past
  // many progress resets, which is the entire point: the window must have
  // been extended THROUGH that point for the wait to still be open here.
  setTimeout(() => {
    clearInterval(timer);
    queueFile(root, 'ready-for-review', initiative);
  }, 1_800);

  const watch = makeCycleTerminalWatch(root, 'ready-for-review', { cycleOf: initiative })!;
  const verdict = await waitForConsequence(
    answeringPage() as never, BEAT as never, upTo, null, null, null, null, t0 - 1_000, null, watch,
  );

  clearInterval(timer);
  assert.equal(
    verdict, null,
    `S10 run 26: a progressing cycleOf wait must not die at its declared upTo (${upTo} ms) while review chunks ` +
    `keep landing — with the OLD code this ends red at ~${upTo}ms naming a terminal never reached. Got: ${JSON.stringify(verdict)}`,
  );
});

test('1471: no progress at all — the wait still ends at its declared upTo, naming inactivity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'progress-window-noprogress-'));
  const initiative = 'INIT-progress-none';
  const t0 = Date.now();
  // ONE write, at the wait's own start, and nothing after — the control case:
  // no reset should occur, and the wait must behave exactly as the plain,
  // unreset bound always has.
  liveCycleDispatch(root, initiative, t0 - 1_000);

  const upTo = 300;
  const watch = makeCycleTerminalWatch(root, 'ready-for-review', { cycleOf: initiative })!;
  const verdict = await waitForConsequence(
    answeringPage() as never, BEAT as never, upTo, null, null, null, null, t0 - 1_000, null, watch,
  ) as { why: string; stoppedBy?: string } | null;

  // T1 1509 (row 100) — no elapsed-wall-time assertion: "must not be extended
  // past its declared upTo" is already proven by the message itself naming
  // the exact 300 ms bound, which a wait that HAD been extended would not say.
  // A separate `Date.now()` measurement in the test process adds no coverage
  // this regex does not already give, only a real-time bound this file must
  // not have.
  assert.notEqual(verdict, null, 'a cycleOf wait with no progress at all must still end — never sit open forever');
  assert.match(verdict!.why, /no cycle progress for 300 ms/, `must name INACTIVITY as the reason: ${verdict!.why}`);
  assert.match(verdict!.why, /progress-extended 0 time\(s\)/, verdict!.why);
  assert.equal(verdict!.stoppedBy, 'runner');
});

test('1471: the run\'s own $ ceiling ends a progressing, otherwise-healthy wait RED, naming the ceiling', async () => {
  // T1 1509 (row 100) — DETERMINISTIC BY CONSTRUCTION, TWO CAUSES.
  //
  // (1) The overspend write no longer races a `setTimeout` against
  // `waitForConsequence`'s own poll cadence. A `setTimeout(..., 150)` writing
  // the event has no fixed relationship to the loop's own
  // `CONSEQUENCE_POLL_MS` ticks once the scheduler is under load. So the write
  // is pinned to a POLL instead: the fake page's `evaluate()` — called once
  // per iteration, always BEFORE the next iteration's guard check — writes
  // the overspend event on its first call. Ordering is then the loop's own
  // single-threaded structure, never two independent timers: iteration 1
  // reads the ORIGINAL ($1) cost and starts the guard's cache; iteration 1's
  // `evaluate()` then writes the overspend row; iteration 2's guard check
  // re-reads it, because real time strictly greater than `CONSEQUENCE_POLL_MS`
  // has necessarily elapsed since iteration 1's check.
  //
  // (2) MEASURED THE DEEPER ONE BY INSTRUMENTING A REPRODUCTION (red 1 of 3
  // runs, alone, at loadavg 6.6 — reproduced here at roughly the same rate).
  // `collectSpendDirs` (run-observe.mjs) excludes a dispatch dir whose
  // directory `mtime < sinceMs`, and `sinceMs` here is `startedMs`. With the
  // shipped `startedMs = Date.now() - 5`, an instrumented run caught
  // `dirMtime` landing BELOW `startedMs` even though `mkdirSync` ran
  // AFTER `Date.now()` was sampled — a 5ms margin is not a safe distance from
  // this filesystem's mtime precision (WSL2's temp mount), and once excluded
  // the dispatch dir stays excluded for the rest of the wait: every poll reads
  // `UNMEASURED`, which `spendCeilingVerdict` correctly never treats as a
  // breach, so the wait sits out its full declared bound and returns `null`.
  // 30 reproduction runs at `Date.now() - 1_000` — matching this file's own
  // `liveCycleDispatch` margin elsewhere — never hit it once.
  const root = mkdtempSync(join(tmpdir(), 'progress-window-spend-'));
  const startedMs = Date.now() - 1_000;
  const dispatch = join(root, '_logs', 'agent-run-spend-1');
  mkdirSync(dispatch, { recursive: true });
  // Under the ceiling at the first read.
  writeFileSync(join(dispatch, 'events.jsonl'), `${JSON.stringify({ event_type: 'phase', phase: 'developer', cost_usd: 1 })}\n`);

  // pollMs is a test seam, never a real-run override (see the doc on
  // `makeWaitSpendGuard`) — small so the SECOND guard check (one real
  // CONSEQUENCE_POLL_MS tick later) always clears its throttle.
  const guard = makeWaitSpendGuard({ root, startedMs, realSpawn: true, ceilingUsd: 2, pollMs: 50 });
  assert.notEqual(guard, null, 'a finite ceilingUsd must always produce a real guard');

  // Spend crosses the ceiling MID-WAIT — the shape row 95 asks for: not
  // already over budget at the press, over budget while still waiting — timed
  // by POLL COUNT via the fake page below, not by a racing wall-clock timer.
  let evaluateCalls = 0;
  const page = {
    ...(answeringPage() as any),
    evaluate: async () => {
      evaluateCalls += 1;
      if (evaluateCalls === 1) {
        appendFileSync(join(dispatch, 'events.jsonl'), `${JSON.stringify({ event_type: 'phase', phase: 'developer', cost_usd: 5 })}\n`);
      }
      // Deliberately mismatches the beat's own `expect.data: { page:
      // 'never-matches' }` on every call, exactly as the fixed fake page did —
      // otherwise the early `expect.data` match would end the wait before the
      // guard ever gets its second check.
      return {
        data: { page: 'projects' }, nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null,
      };
    },
  };

  // The declared bound is a safety CEILING, never a duration this test
  // expects to spend — the breach above ends the wait within two real
  // CONSEQUENCE_POLL_MS ticks, so 5s is headroom for a regression, not a
  // sleep this run pays for.
  const verdict = await waitForConsequence(
    page as never,
    { act: BEAT.act, expect: { route: '/nonexistent', data: { page: 'never-matches' } } } as never,
    5_000, null, null, null, null, null, null, null,
    guard!,
  ) as { why: string; stoppedBy?: string } | null;

  assert.notEqual(verdict, null, 'a wait must not sit past its own run\'s $ ceiling, however healthy it otherwise looks');
  assert.match(verdict!.why, /\$ ceiling/, verdict!.why);
  assert.match(verdict!.why, /CEILING BREACHED/, verdict!.why);
  assert.equal(verdict!.stoppedBy, 'runner');
});

test('1471: a plain agent wait — no cycleOf, no cycleWatch at all — keeps its exact old deadline semantics', async () => {
  // The SCOPE line: "keep the existing behaviour for waits WITHOUT cycleOf".
  // No amount of file-writing anywhere should change when this one ends.
  //
  // T1 1509 (row 100) — no elapsed-wall-time assertion. `answeringPage`'s data
  // already matches `BEAT.expect.data`, so the ONLY path that can produce
  // `null` here is the early match before any poll's sleep — there is no
  // control-flow path that spends real time and still returns `null`, so a
  // separate `Date.now()` bound would guard against nothing this return value
  // does not already prove.
  const verdict = await waitForConsequence(answeringPage() as never, BEAT as never, 5_000, null);
  assert.equal(verdict, null, 'unchanged: a beat whose expectation already holds and declares no wait at all ends immediately');
});
