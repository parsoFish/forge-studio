/**
 * reap-priced-wait.test.ts — M7 findings row 62 (ledger rulings 1136, 1156).
 *
 * THE MEASURED SHAPE. Two runs of the same story hit the identical symptom:
 * an onboarding agent's turn ran ~2.3 s, its beats passed in ~1 s, and the
 * run's OWN teardown SIGTERM'd it (`stderr: exited with code 143`) before any
 * priced event reached its log — "not $0.00, a $25 ceiling on a story whose
 * agent lives 2.3 s describes a different run than the assertions do." Spend
 * was UNMEASURED by construction: the reaper signals the moment its
 * containment checks admit a pid, with no regard for whether that agent has
 * had a chance to price itself yet.
 *
 * THE FIX, here. Before SIGTERM reaches a still-alive pid THIS RUN RECORDED
 * (never a descendant or a group member — those carry no event log of their
 * own), `waitForFirstPricedEvent` gives it a bounded, NAMED window
 * (`FIRST_PRICED_EVENT_GRACE_MS`, <= 30 s) to write one. If a priced event
 * lands, the wait ends immediately — this must never slow down the common
 * case of a turn that already priced itself before teardown. If the window
 * expires first, the pid is still signalled (this is teardown, not a stay of
 * execution) and the outcome is recorded on the reap report so the run's
 * spend column can say WHY nothing was measured, rather than printing the
 * generic UNMEASURED label over a turn we know we killed mid-flight.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_PRICED_EVENT_GRACE_MS,
  waitForFirstPricedEvent,
  reapAgentRuns,
} from './reap.mjs';

// ─────────────────────────────────────────────────── waitForFirstPricedEvent

test('a priced event already on disk resolves immediately, no polling at all', async () => {
  let slept = 0;
  const result = await waitForFirstPricedEvent({
    pid: 7,
    dir: '/r/_logs/_agent-a',
    isAlive: () => true,
    readEvents: () => [{ event_type: 'turn', cost_usd: 0.42 }],
    graceMs: 5000,
    pollMs: 50,
    sleep: async () => { slept += 1; },
  });
  assert.deepEqual(result, { priced: true, waitedMs: 0 });
  assert.equal(slept, 0, 'a turn that already priced itself must not be made to wait');
});

test('a priced event that lands on the SECOND poll resolves as soon as it appears', async () => {
  let reads = 0;
  const result = await waitForFirstPricedEvent({
    pid: 7,
    dir: '/r/_logs/_agent-a',
    isAlive: () => true,
    readEvents: () => {
      reads += 1;
      return reads >= 3 ? [{ cost_usd: 0.10 }] : [{ event_type: 'start' }];
    },
    graceMs: 5000,
    pollMs: 50,
    sleep: async () => {},
  });
  assert.equal(result.priced, true);
  assert.equal(result.waitedMs, 100, 'two poll steps of 50 ms each before the third read finds the price');
});

test('no priced event within the bound: the pid is still alive, and the wait says how long it waited', async () => {
  const result = await waitForFirstPricedEvent({
    pid: 7,
    dir: '/r/_logs/_agent-a',
    isAlive: () => true,
    readEvents: () => [{ event_type: 'start' }],
    graceMs: 200,
    pollMs: 25,
    sleep: async () => {},
  });
  assert.deepEqual(result, { priced: false, waitedMs: 200 });
});

test('the process dies on its own before pricing: the wait ends early, at the last read', async () => {
  let alive = true;
  let polls = 0;
  const result = await waitForFirstPricedEvent({
    pid: 7,
    dir: '/r/_logs/_agent-a',
    isAlive: () => alive,
    readEvents: () => [{ event_type: 'start' }],
    graceMs: 5000,
    pollMs: 25,
    sleep: async () => { polls += 1; if (polls === 2) alive = false; },
  });
  assert.equal(result.priced, false);
  assert.ok(result.waitedMs < 5000, 'must not sit out the whole grace window once the process is confirmed gone');
});

test('FIRST_PRICED_EVENT_GRACE_MS is a named constant, bounded at 30 seconds', () => {
  assert.ok(Number.isInteger(FIRST_PRICED_EVENT_GRACE_MS));
  assert.ok(FIRST_PRICED_EVENT_GRACE_MS > 0 && FIRST_PRICED_EVENT_GRACE_MS <= 30_000);
});

// ───────────────────────────────────────────────────────────── reapAgentRuns

const ROOT = '/home/parso/forge-projects';

test('reapAgentRuns waits for a priced event before SIGTERM, and records the outcome when none arrives', async () => {
  const killed = [];
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: ROOT,
    cwdOf: () => ROOT,
    procTable: () => new Map(),
    isAlive: () => true,
    kill: (pid, sig) => { killed.push(`${sig === 'SIGTERM' ? 'term' : 'kill'}-${pid}`); },
    readEvents: () => [{ event_type: 'start' }], // never prices
    pricedGraceMs: 40,
    graceMs: 20,
    pollMs: 10,
    sleep: async () => {},
  });
  assert.equal(killed[0], 'term-7', 'the pid is still signalled once the bound expires — this is teardown, not a stay');
  const reaped = report.reaped.find((r) => r.pid === 7);
  assert.ok(reaped, `pid 7 must be reaped: ${JSON.stringify(report)}`);
  assert.equal(typeof reaped.terminatedBeforeFirstPricedEvent, 'number');
  assert.ok(reaped.terminatedBeforeFirstPricedEvent > 0);
});

test('reapAgentRuns does NOT wait when the dispatch already priced itself before teardown', async () => {
  let sleptAtAll = false;
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: ROOT,
    cwdOf: () => ROOT,
    procTable: () => new Map(),
    isAlive: () => false, // already exited, priced, on disk
    kill: () => { throw new Error('ESRCH'); },
    readEvents: () => [{ cost_usd: 0.30 }],
    pricedGraceMs: 5000,
    graceMs: 20,
    pollMs: 10,
    sleep: async () => { sleptAtAll = true; },
  });
  const reaped = report.reaped.find((r) => r.pid === 7);
  assert.ok(reaped);
  assert.equal(reaped.terminatedBeforeFirstPricedEvent, undefined, 'a priced turn must not carry the early-termination marker');
  assert.equal(sleptAtAll, false, 'an already-dead, already-priced pid needs no wait at all');
});
