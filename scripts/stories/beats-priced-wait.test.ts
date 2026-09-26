/**
 * `waitForPricedEvent` and its wiring through `driveBeat` — ROW 109 (T1 1549),
 * extended by T1 1583.
 *
 * THE MEASURED SHAPE (T1 1549). S3's terminal beat follows the onboarding
 * session it just launched; the beat's own `expect.data` is satisfied the
 * moment the session page renders — well before that session's first turn
 * prices itself. The run then ends and `reap.mjs`'s own teardown grace
 * (`FIRST_PRICED_EVENT_GRACE_MS`, <= 30 s) is not enough: run 2 measured
 * "terminated before first priced event (30000 ms)". `wait: { for: 'priced',
 * upTo }` gives the beat itself a bounded, real chance to see one first.
 *
 * THE DEFECT THIS EXTENDS TO CLOSE (T1 1583, S3 funded run 3): the wait
 * resolved only the SESSION's own log dir, but the priced event landed in the
 * DISPATCHED AGENT's own run dir instead. The session dir never priced, the
 * wait sat out the full 180 s, and the still-working agent went on to write
 * and commit files in the ground — a containment red caused by watching the
 * wrong directory. The fix also watches every agent run this story
 * dispatched, discovered via `collectAgentRuns` (`reap.mjs`) — the SAME record
 * teardown itself reaps by, never a second discovery rule.
 *
 * THE FIRST GROUP pins `waitForPricedEvent` in isolation, with an injected
 * clock so "mid-wait" and "never" are exact rather than timing-dependent.
 * THE SECOND GROUP pins T1 1583's agent-dir discovery, still in isolation.
 * THE THIRD GROUP pins the wiring through `driveBeat`: the beat's own
 * `expect.data` decides `status`/`failures` regardless of what `priced`
 * says, and `priced` always lands on the returned verdict.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { driveBeat } from './beats-drive.mjs';
import { waitForPricedEvent } from './beats-agent-proc.mjs';
import { PID_READ_UNKNOWN } from './reap.mjs';

// ───────────────────────────────────────────── waitForPricedEvent (pure)
//
// `collectRuns: () => []` is injected throughout this group so these stay
// PURE — no agent run ever qualifies, so behaviour here is exactly the
// single-dir shape row 109 shipped. T1 1583's own dedicated agent-dir
// coverage is the next group down.

test('109: a priced event already on disk resolves immediately, no polling at all', async () => {
  let slept = 0;
  const result = await waitForPricedEvent('/root', '/sessions/onboarding/sid-1', 5000, {
    readEvents: () => [{ cost_usd: 0.42 }],
    collectRuns: () => [],
    sleep: async () => { slept += 1; },
  });
  assert.deepEqual(result, { by: 'event', afterMs: 0, dir: '/root/_logs/_onboarding-sid-1' });
  assert.equal(slept, 0, 'a session that already priced itself must not be made to wait');
});

test('109: a priced event that lands MID-WAIT ends the wait immediately, by: "event"', async () => {
  let reads = 0;
  let clock = 0;
  const result = await waitForPricedEvent('/root', '/sessions/onboarding/sid-1', 5000, {
    readEvents: () => {
      reads += 1;
      return reads >= 3 ? [{ cost_usd: 0.12 }] : [{ event_type: 'start' }];
    },
    collectRuns: () => [],
    pollMs: 100,
    sleep: async () => { clock += 100; },
    now: () => clock,
  });
  assert.deepEqual(
    result,
    { by: 'event', afterMs: 200, dir: '/root/_logs/_onboarding-sid-1' },
    'two poll steps before the third read finds the price',
  );
});

test('109: never priced — ends at the declared upTo, by: "timeout", and logs exactly ONE named line', async () => {
  let clock = 0;
  const lines: string[] = [];
  const result = await waitForPricedEvent('/root', '/sessions/onboarding/sid-1', 300, {
    readEvents: () => [{ event_type: 'start' }],
    collectRuns: () => [],
    pollMs: 100,
    sleep: async () => { clock += 100; },
    now: () => clock,
    log: (line: string) => lines.push(line),
  });
  assert.deepEqual(result, { by: 'timeout', afterMs: 300, dir: null });
  assert.equal(lines.length, 1, 'exactly one named line, not one per poll');
  assert.match(
    lines[0],
    /^priced wait: no priced event from .*_onboarding-sid-1 within 300 ms — the spend line will say why$/,
  );
});

test('109: a non-priced event line (no genuine cost_usd) never ends the wait early', async () => {
  // Guards the PREDICATE REUSE: `hasPricedEvent` (reap.mjs) requires a
  // finite, non-negative `cost_usd`. Every row here looks adjacent to priced
  // and is not — a mutation that treated any of them as priced would end
  // this wait early instead of at the bound.
  let clock = 0;
  const rows = [
    { event_type: 'turn.start' },
    { cost_usd: null },
    { cost_usd: 'not-a-number' },
    { cost_usd: -1 },
  ];
  const result = await waitForPricedEvent('/root', '/sessions/onboarding/sid-1', 200, {
    readEvents: () => rows,
    collectRuns: () => [],
    pollMs: 50,
    sleep: async () => { clock += 50; },
    now: () => clock,
    log: () => {},
  });
  assert.deepEqual(result, { by: 'timeout', afterMs: 200, dir: null });
});

test('109: an unresolvable route ends immediately as by: "unresolved", never throws', async () => {
  const lines: string[] = [];
  const result = await waitForPricedEvent('/root', '/projects/story-s3', 5000, {
    readEvents: () => { throw new Error('must not be called — the route never resolved to a dir'); },
    sleep: async () => { throw new Error('must not sleep — nothing to poll'); },
    log: (line: string) => lines.push(line),
  });
  assert.deepEqual(result, { by: 'unresolved', afterMs: 0, dir: null });
  assert.equal(lines.length, 1);
  assert.match(
    lines[0],
    /^priced wait: no priced event from an unresolved session for route "\/projects\/story-s3" within 5000 ms/,
  );
});

test('109: a missing forgeRoot is also unresolved, never throws', async () => {
  const result = await waitForPricedEvent(null, '/sessions/onboarding/sid-1', 1000, { log: () => {} });
  assert.deepEqual(result, { by: 'unresolved', afterMs: 0, dir: null });
});

test('109: a read that throws mid-poll is treated as not-yet-priced, never crashes the wait', async () => {
  let clock = 0;
  let calls = 0;
  const result = await waitForPricedEvent('/root', '/sessions/onboarding/sid-1', 500, {
    readEvents: () => {
      calls += 1;
      if (calls < 3) throw new Error('torn read');
      return [{ cost_usd: 0.5 }];
    },
    collectRuns: () => [],
    pollMs: 100,
    sleep: async () => { clock += 100; },
    now: () => clock,
  });
  assert.equal(result.by, 'event');
});

// ───────────────────────────────────── T1 1583: the agent's OWN run dir

test('T1 1583 (a) THE INCIDENT: an agent dir born at/after the wait prices while the session dir stays silent', async () => {
  const sessionDir = '/root/_logs/_onboarding-sid-1';
  const agentDir = '/root/_logs/_agent-onboarding-agent-20260926120000-ab12';
  let clock = 0;
  const collectCalls: number[] = [];
  const result = await waitForPricedEvent('/root', '/sessions/onboarding/sid-1', 5000, {
    collectRuns: (root: string, sinceMs: number) => {
      assert.equal(root, '/root');
      collectCalls.push(sinceMs);
      return [{ dir: agentDir, pid: 4242, markers: [] }];
    },
    readEvents: (dir: string) => {
      if (dir === sessionDir) return [{ event_type: 'turn.start' }]; // the session dir NEVER prices — the measured shape
      return clock >= 200 ? [{ event_type: 'turn.end', cost_usd: 0.031 }] : [{ event_type: 'agent.start' }];
    },
    pollMs: 100,
    sleep: async () => { clock += 100; },
    now: () => clock,
  });
  assert.deepEqual(result, { by: 'event', afterMs: 200, dir: agentDir });
  assert.ok(collectCalls.length >= 1, 'the agent run must be discovered via collectAgentRuns, not read some other way');
  assert.ok(collectCalls.every((s) => s === collectCalls[0]), 'the anchor stays fixed for the whole wait');
});

test('T1 1583 (b): an agent dir born BEFORE the wait started is a previous run and must not end it', async () => {
  const agentDir = '/root/_logs/_agent-onboarding-agent-earlier';
  const bornAtMs = -1; // strictly before this wait's own anchor (0, on the injected clock)
  let clock = 0;
  const result = await waitForPricedEvent('/root', '/sessions/onboarding/sid-1', 300, {
    // Mirrors collectAgentRuns's own contract: a run born before `sinceMs` is
    // never returned. Already priced, and still must not be seen.
    collectRuns: (_root: string, sinceMs: number) => (bornAtMs >= sinceMs ? [{ dir: agentDir, pid: 1, markers: [] }] : []),
    readEvents: (dir: string) => (dir === agentDir ? [{ cost_usd: 9.99 }] : [{ event_type: 'turn.start' }]),
    pollMs: 100,
    sleep: async () => { clock += 100; },
    now: () => clock,
  });
  assert.deepEqual(result, { by: 'timeout', afterMs: 300, dir: null });
});

test('T1 1583 (c): an unreadable _logs/ scan ends the wait as by: "unresolved", never a silent timeout', async () => {
  const result = await waitForPricedEvent('/root', '/sessions/onboarding/sid-1', 5000, {
    collectRuns: () => [{ dir: '/root/_logs', pid: PID_READ_UNKNOWN, markers: [] }],
    readEvents: () => { throw new Error('must not be read — the scan itself could not be trusted'); },
    sleep: async () => { throw new Error('must not sleep — the scan fails on the very first check'); },
  });
  assert.deepEqual(result, { by: 'unresolved', afterMs: 0, dir: null });
});

// ───────────────────────────────────────────────── wired through driveBeat

/** A page already standing on `route`, reporting `data` on every read — the
 *  same minimal shape `beats-settle.test.ts`'s `preflightPage` uses. No `do`
 *  steps and no navigation: `bound.label !== null` (the beat declared a
 *  `wait`) is enough on its own to make `driveBeat` enter the wait branch. */
function sessionPage(route: string, data: Record<string, string>) {
  return {
    url: () => `http://localhost:4124${route}`,
    locator: (): any => ({ first: () => ({ evaluate: async () => null }) }),
    waitForSelector: async () => {},
    goto: async () => {},
    evaluate: async () => ({ data, nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null }),
  };
}

const sessionData = { page: 'session', 'page-ready': 'true', 'session-kind': 'onboarding' };

test('109 wiring: a priced event landing mid-wait ends early — recorded on the beat, verdict unaffected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-priced-'));
  const dir = join(root, '_logs', '_onboarding-sid-1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ event_type: 'turn.start' })}\n`);
  setTimeout(() => {
    appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ event_type: 'turn.end', cost_usd: 0.031 })}\n`);
  }, 150);

  const page = sessionPage('/sessions/onboarding/sid-1', sessionData);
  const beat = {
    act: 'watch it work',
    wait: { for: 'priced', upTo: 3_000 },
    expect: { route: '/sessions/onboarding/sid-1', data: sessionData },
    say: 's',
  };
  const began = Date.now();
  const v = await driveBeat(page as never, beat, 1, 'http://localhost:4124', {}, undefined, null, null, new Map(), null, null, root);
  const took = Date.now() - began;

  assert.equal(v.status, 'green', `failures: ${JSON.stringify(v.failures)}`);
  assert.deepEqual(Object.keys(v.priced ?? {}).sort(), ['afterMs', 'by', 'dir']);
  assert.equal(v.priced.by, 'event');
  assert.equal(v.priced.dir, dir, 'the session dir is the one that actually priced here');
  assert.ok(took < 3_000, `it ended EARLY once the event landed — took ${took} ms of a 3000 ms bound`);
});

test('109 wiring: never priced within upTo — the beat still goes green on its own expectations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-priced-'));
  const page = sessionPage('/sessions/onboarding/sid-2', sessionData);
  const beat = {
    act: 'watch it work',
    wait: { for: 'priced', upTo: 200 },
    expect: { route: '/sessions/onboarding/sid-2', data: sessionData },
    say: 's',
  };
  const originalError = console.error;
  const lines: string[] = [];
  console.error = (line: unknown) => { lines.push(String(line)); };
  let v;
  try {
    v = await driveBeat(page as never, beat, 1, 'http://localhost:4124', {}, undefined, null, null, new Map(), null, null, root);
  } finally {
    console.error = originalError;
  }

  assert.equal(v.status, 'green', `failures: ${JSON.stringify(v.failures)}`);
  assert.deepEqual(v.priced, { by: 'timeout', afterMs: 200, dir: null });
  assert.ok(
    lines.some((l) => /priced wait: no priced event from .*_onboarding-sid-2 within 200 ms/.test(l)),
    `expected a named line, got: ${JSON.stringify(lines)}`,
  );
});

test('109 wiring: a beat on a non-session route is by: "unresolved" — never throws, never reds', async () => {
  const projectData = { page: 'projects', 'project-id': 'story-s3' };
  const page = sessionPage('/projects/story-s3', projectData);
  const beat = {
    act: 'confirm the project',
    wait: { for: 'priced', upTo: 100 },
    expect: { route: '/projects/story-s3', data: projectData },
    say: 's',
  };
  const v = await driveBeat(page as never, beat, 1, 'http://localhost:4124', {}, undefined, null, null, new Map(), null, null, '/some/root');
  assert.equal(v.status, 'green', `failures: ${JSON.stringify(v.failures)}`);
  assert.deepEqual(v.priced, { by: 'unresolved', afterMs: 0, dir: null });
});

test('109 wiring: every OTHER wait kind is unaffected — no `priced` field appears', async () => {
  const page = sessionPage('/sessions/onboarding/sid-3', sessionData);
  const beat = {
    act: 'watch it work',
    wait: { for: 'agent', upTo: 200 },
    expect: { route: '/sessions/onboarding/sid-3', data: sessionData },
    say: 's',
  };
  const v = await driveBeat(page as never, beat, 1, 'http://localhost:4124', {}, undefined, null, null, new Map(), null, null, '/some/root');
  assert.equal(v.status, 'green', `failures: ${JSON.stringify(v.failures)}`);
  assert.equal(Object.hasOwn(v, 'priced'), false, 'an agent wait must never carry a `priced` field');
});

test('T1 1583 wiring: the session page never prices — the AGENT it dispatched does, via the real collectAgentRuns', async () => {
  // The end-to-end reproduction of the incident: a REAL forgeRoot, a REAL
  // `_agent-*` dir carrying a real `turn.pid` (what makes `collectAgentRuns`
  // admit it), discovered with no injected `collectRuns` at all — the
  // production default. `runStartedMs` is captured well BEFORE either dir is
  // created, exactly as `run-story.mjs` captures its own `startedMs` long
  // before any beat dispatches anything — a 1 s margin, not the same tick, so
  // the comparison is never at the mercy of clock-vs-filesystem-mtime skew
  // (measured a few ms on this box) the way "captured the instant before"
  // would be.
  const runStartedMs = Date.now() - 1_000;
  const root = mkdtempSync(join(tmpdir(), 'forge-priced-'));
  const sessionDir = join(root, '_logs', '_onboarding-sid-t11583');
  const agentDir = join(root, '_logs', '_agent-onboarding-agent-20260926-cafe');
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(sessionDir, 'events.jsonl'), `${JSON.stringify({ event_type: 'turn.start' })}\n`); // never prices
  writeFileSync(join(agentDir, 'turn.pid'), '999999');
  writeFileSync(join(agentDir, 'events.jsonl'), `${JSON.stringify({ event_type: 'agent.start' })}\n`);
  setTimeout(() => {
    appendFileSync(join(agentDir, 'events.jsonl'), `${JSON.stringify({ event_type: 'agent.end', cost_usd: 0.077 })}\n`);
  }, 150);

  const page = sessionPage('/sessions/onboarding/sid-t11583', sessionData);
  const beat = {
    act: 'watch it work',
    wait: { for: 'priced', upTo: 3_000 },
    expect: { route: '/sessions/onboarding/sid-t11583', data: sessionData },
    say: 's',
  };
  const began = Date.now();
  const v = await driveBeat(page as never, beat, 1, 'http://localhost:4124', {}, undefined, null, null, new Map(), null, null, root, runStartedMs);
  const took = Date.now() - began;

  assert.equal(v.status, 'green', `failures: ${JSON.stringify(v.failures)}`);
  assert.equal(v.priced.by, 'event');
  assert.equal(v.priced.dir, agentDir, 'the SESSION dir never priced — the dispatched agent did, and the verdict must name that dir');
  assert.ok(took < 3_000, `it ended EARLY once the agent priced — took ${took} ms of a 3000 ms bound`);
});
