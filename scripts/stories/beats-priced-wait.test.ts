/**
 * `waitForPricedEvent` and its wiring through `driveBeat` — ROW 109 (T1 1549).
 *
 * THE MEASURED SHAPE. S3's terminal beat follows the onboarding session it
 * just launched; the beat's own `expect.data` is satisfied the moment the
 * session page renders — well before that session's first turn prices
 * itself. The run then ends and `reap.mjs`'s own teardown grace
 * (`FIRST_PRICED_EVENT_GRACE_MS`, <= 30 s) is not enough: run 2 measured
 * "terminated before first priced event (30000 ms)". `wait: { for: 'priced',
 * upTo }` gives the beat itself a bounded, real chance to see one first.
 *
 * THE FIRST GROUP pins `waitForPricedEvent` in isolation, with an injected
 * clock so "mid-wait" and "never" are exact rather than timing-dependent.
 * THE SECOND GROUP pins the wiring through `driveBeat`: the beat's own
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

// ───────────────────────────────────────────── waitForPricedEvent (pure)

test('109: a priced event already on disk resolves immediately, no polling at all', async () => {
  let slept = 0;
  const result = await waitForPricedEvent('/root', '/sessions/onboarding/sid-1', 5000, {
    readEvents: () => [{ cost_usd: 0.42 }],
    sleep: async () => { slept += 1; },
  });
  assert.deepEqual(result, { by: 'event', afterMs: 0 });
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
    pollMs: 100,
    sleep: async () => { clock += 100; },
    now: () => clock,
  });
  assert.deepEqual(result, { by: 'event', afterMs: 200 }, 'two poll steps before the third read finds the price');
});

test('109: never priced — ends at the declared upTo, by: "timeout", and logs exactly ONE named line', async () => {
  let clock = 0;
  const lines: string[] = [];
  const result = await waitForPricedEvent('/root', '/sessions/onboarding/sid-1', 300, {
    readEvents: () => [{ event_type: 'start' }],
    pollMs: 100,
    sleep: async () => { clock += 100; },
    now: () => clock,
    log: (line: string) => lines.push(line),
  });
  assert.deepEqual(result, { by: 'timeout', afterMs: 300 });
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
    pollMs: 50,
    sleep: async () => { clock += 50; },
    now: () => clock,
    log: () => {},
  });
  assert.deepEqual(result, { by: 'timeout', afterMs: 200 });
});

test('109: an unresolvable route ends immediately as by: "unresolved", never throws', async () => {
  const lines: string[] = [];
  const result = await waitForPricedEvent('/root', '/projects/story-s3', 5000, {
    readEvents: () => { throw new Error('must not be called — the route never resolved to a dir'); },
    sleep: async () => { throw new Error('must not sleep — nothing to poll'); },
    log: (line: string) => lines.push(line),
  });
  assert.deepEqual(result, { by: 'unresolved', afterMs: 0 });
  assert.equal(lines.length, 1);
  assert.match(
    lines[0],
    /^priced wait: no priced event from an unresolved session for route "\/projects\/story-s3" within 5000 ms/,
  );
});

test('109: a missing forgeRoot is also unresolved, never throws', async () => {
  const result = await waitForPricedEvent(null, '/sessions/onboarding/sid-1', 1000, { log: () => {} });
  assert.deepEqual(result, { by: 'unresolved', afterMs: 0 });
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
    pollMs: 100,
    sleep: async () => { clock += 100; },
    now: () => clock,
  });
  assert.equal(result.by, 'event');
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
  assert.deepEqual(Object.keys(v.priced ?? {}).sort(), ['afterMs', 'by']);
  assert.equal(v.priced.by, 'event');
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
  assert.deepEqual(v.priced, { by: 'timeout', afterMs: 200 });
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
  assert.deepEqual(v.priced, { by: 'unresolved', afterMs: 0 });
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
