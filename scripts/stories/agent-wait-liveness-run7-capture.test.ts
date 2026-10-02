/**
 * Row 179b (bead `forge-8vfn.8.5.27`), T1 ruling 1973ei — a NON-repeat agent
 * wait becomes an inactivity window reset by the agent's own liveness, the
 * declared bound no longer a wall clock: replayed on the REAL costed S1 run 7
 * capture (`/home/parso/forge/_1.0/evidence/m7-e-r7-s1-capture/`).
 *
 * `test-fixtures/run7-s1-beat6/` is copied verbatim from that capture: the
 * onboarding session's `_logs/_onboarding-<sid>/turn.pid` and its dispatched
 * run's `_logs/_agent-onboarding-agent-…-6fxw/{turn.pid,events.jsonl}` (stored
 * under `logs-capture/`, ruling 85's ratchet), the mtimes the runner read
 * before its sweep (`MTIMES.txt`, re-applied below), the session's final
 * `status.json` (`onboarding-status.json`) and the run log's beat-6 lines
 * (`run7-beat6.txt`). The measured timeline:
 *
 *   15:14:01.821  ONE pid written to BOTH turn.pid files (the product's dual
 *                 write, `apps/forge/bridge-agent-dispatch.ts`)
 *   15:14:02.640  beat 5 green; beat 6's `wait: { for: 'agent', upTo:
 *                 420_000 }` starts on `/sessions/onboarding/<sid>`
 *   15:21:02.993  beat 6 RED — `expected "complete", got "running"`, `gave up
 *                 at the agent wait (declared 420000 ms)`, `/proc` SDK child
 *                 utime 12→622: WORKING. The run's events.jsonl held 150
 *                 lines by then, no gap between two over 15 s.
 *   15:23:49.776  status.json `phase: complete` — the agent finished.
 *
 * WHAT THE CAPTURE DOES NOT CARRY, and what stands in for it. The red's
 * liveness evidence was the `/proc` probe, and only its SUMMARY reached the run
 * log (`utime 12→622 over 4375 sample(s)`) — no per-sample times, so no replay
 * can say WHEN the CPU advanced. The closest real artefact is the dispatched
 * run's own `events.jsonl`: append-only, every line stamped `started_at`, so
 * its state at any instant is the prefix of lines started at or before it,
 * and its mtime then is the newest such stamp (the final mtime in MTIMES.txt,
 * 15:23:49.770, is the last line's 15:23:49.771 to the millisecond). That is
 * the channel the wait now reads, so the replay drives the REAL reader over
 * the REAL growth — never a synthetic shape.
 *
 * The wait itself runs for real (`waitForConsequence`, then `driveBeat`) under
 * `node:test`'s mocked `Date`/`setTimeout`, so ~10 minutes of the captured
 * timeline replay in about a second at the wait's own 100 ms poll.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { waitForConsequence } from './beats-page.mjs';
import { driveBeat } from './beats-drive.mjs';
import { runLogIdleMs, sessionLogDir } from './beats-agent-proc.mjs';
import { makeAgentLivenessReader, makeLivenessWindow, pairedRunDir } from './beats-agent-liveness.mjs';
import { CYCLE_WAIT_WALL_CEILING_MS } from './story-wait-schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'test-fixtures', 'run7-s1-beat6');
const SID = '2026-10-02T15-14-01-57656b47';
const ROUTE = `/sessions/onboarding/${SID}`;
const RUN = '_agent-onboarding-agent-2026-10-02T15-14-01-785-6fxw';
const at = (iso: string) => Date.parse(iso);
const WAIT_START = at('2026-10-02T15:14:02.640Z');
const BEAT_RED = at('2026-10-02T15:21:02.993Z');
const DECLARED = 420_000;
const COMPLETE_AT = at(JSON.parse(readFileSync(join(FIXTURE, 'onboarding-status.json'), 'utf8')).updated_at);
const LAST_WRITE = at('2026-10-02T15:23:49.770Z');
const POLL = 100; // CONSEQUENCE_POLL_MS

/** S1 beat 6, verbatim in every field the wait reads (`tests/stories/S1.story.mjs`). */
const BEAT6 = {
  act: 'Watch the Agent work through the contract until the onboarding session finishes',
  do: [],
  wait: { for: 'agent', upTo: DECLARED },
  expect: {
    route: '/sessions/onboarding/<sessionId>',
    data: { page: 'session', 'page-ready': 'true', 'session-kind': 'onboarding', 'session-phase': 'complete' },
  },
  say: 'Onboarding is a dispatch, not a conversation.',
};

const eventLines = () =>
  readFileSync(join(FIXTURE, 'logs-capture', RUN, 'events.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '');

/** Stage the capture as `_logs/` under a fresh root, its events as of `asOfMs`, real mtimes re-applied. */
function stageCapture(asOfMs: number) {
  const root = mkdtempSync(join(tmpdir(), 'agent-wait-liveness-run7-'));
  cpSync(join(FIXTURE, 'logs-capture'), join(root, '_logs'), { recursive: true });
  for (const line of readFileSync(join(FIXTURE, 'MTIMES.txt'), 'utf8').split('\n')) {
    const m = /^(\S+)\s+(_logs\/\S+)$/.exec(line.trim());
    if (m === null || !existsSync(join(root, m[2]))) continue; // stderr.log / agent-run.marker are not part of the copy
    const when = new Date(m[1]);
    utimesSync(join(root, m[2]), when, when);
  }
  const events = eventsAsOf(root);
  events(asOfMs);
  return { root, events };
}

/** events.jsonl is append-only: its state at `asOfMs` is the prefix started at or before it, its mtime the newest stamp. */
function eventsAsOf(root: string) {
  const all = eventLines();
  const file = join(root, '_logs', RUN, 'events.jsonl');
  let written = -1;
  return (asOfMs: number) => {
    let kept = 0;
    while (kept < all.length && Date.parse(JSON.parse(all[kept]).started_at) <= asOfMs) kept += 1;
    if (kept === written) return kept;
    written = kept;
    writeFileSync(file, kept === 0 ? '' : `${all.slice(0, kept).join('\n')}\n`);
    const stamp = kept === 0 ? new Date(WAIT_START - 1_000) : new Date(JSON.parse(all[kept - 1]).started_at);
    utimesSync(file, stamp, stamp);
    return kept;
  };
}

/** The session page as beat 6's DOM read it (`data-lifecycle-state="working"`), its phase `complete` from `completeAt`. */
function sessionPage(completeAt: number | null) {
  const phase = () => (completeAt !== null && Date.now() >= completeAt ? 'complete' : 'running');
  const locator = (): any => ({
    first: () => locator(),
    count: async () => 0,
    evaluateAll: async (fn: any, arg: any) => fn([], arg),
    evaluate: async () => null,
  });
  return {
    phase,
    url: () => `http://localhost:4124${ROUTE}`,
    goto: async () => {},
    locator,
    waitForURL: async () => {},
    waitForSelector: async () => {},
    evaluate: async () => ({
      data: { page: 'session', 'page-ready': 'true', 'session-kind': 'onboarding', 'session-phase': phase() },
      nested: [],
      lifecycle: 'working',
      sessionPhase: phase(),
    }),
  };
}

/** Advance the mocked clock one poll at a time, re-staging the capture's growth, until `pending` settles. */
async function replay(t: any, pending: Promise<unknown>, stage: (now: number) => void, limitMs: number) {
  let done = false;
  let value: unknown;
  pending.then((v) => { done = true; value = v; }, (e) => { done = true; value = e; });
  const flush = () => new Promise((r) => setImmediate(r));
  for (let i = 0; !done && Date.now() < limitMs; i += 1) {
    stage(Date.now());
    await flush(); await flush();
    if (done) break;
    t.mock.timers.tick(POLL);
  }
  await flush();
  assert.ok(done, `the wait was still running at ${new Date(Date.now()).toISOString()} — the replay limit ran out first`);
  return { value, endedAt: Date.now() };
}

test('row 179b fixture: the captured run log carries the red this file replays', () => {
  const log = readFileSync(join(FIXTURE, 'run7-beat6.txt'), 'utf8');
  assert.match(log, /\[2026-10-02T15:21:02\.993Z\] .*data-session-phase: expected "complete", got "running"/);
  assert.match(log, /gave up at the agent wait \(declared 420000 ms\)/);
  assert.match(log, /SDK child state=S utime 12→622 — it was WORKING/);
  const lines = eventLines();
  assert.equal(lines.filter((l) => at(JSON.parse(l).started_at) <= BEAT_RED).length, 150, 'the run had written 150 lines by the red');
  assert.equal(JSON.parse(lines[lines.length - 1]).event_type, 'end');
  assert.equal(JSON.parse(readFileSync(join(FIXTURE, 'onboarding-status.json'), 'utf8')).phase, 'complete');
  assert.ok(BEAT_RED - WAIT_START >= DECLARED && BEAT_RED - WAIT_START < DECLARED + 1_000, 'the red is the declared bound firing');
});

test('row 179b (REAL capture): 179\'s session-dir reader sees NO channel for a turn.pid-only session — the paired run\'s channel is the one that was writing', () => {
  const { root, events } = stageCapture(BEAT_RED);
  assert.equal(events(BEAT_RED), 150);
  // The mechanism of the red: the only channel 179 reads is absent here.
  assert.equal(runLogIdleMs(sessionLogDir(root, ROUTE) as string, BEAT_RED), null, 'the onboarding session dir carries turn.pid only');
  assert.equal(pairedRunDir(root, sessionLogDir(root, ROUTE) as string), join(root, '_logs', RUN));
  const idle = makeAgentLivenessReader(root)!(ROUTE, null, null, BEAT_RED);
  assert.equal(typeof idle, 'number');
  assert.ok((idle as number) <= 15_000, `the paired run wrote within the capture's own 15 s max gap of the red — read ${idle} ms`);
});

test('row 179b (RED before the fix, REAL capture): beat 6\'s wait outlives its declared 420 s while the run keeps writing, and ends GREEN on `complete`', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: WAIT_START });
  const { root, events } = stageCapture(WAIT_START);
  const page = sessionPage(COMPLETE_AT);
  const reader = makeAgentLivenessReader(root)!;
  const pending = waitForConsequence(
    page as never, BEAT6, DECLARED, ROUTE, null, null, null, null, null, null, null, null, null,
    (runId: string | null, boundRunId: string | null, now: number) => reader(ROUTE, runId, boundRunId, now),
  );
  const { value, endedAt } = await replay(t, pending, (now) => events(now), COMPLETE_AT + 60_000);
  assert.ok(endedAt > BEAT_RED, `the wait ended at ${new Date(endedAt).toISOString()}, on or before the declared bound the real run reded at — the agent was still writing`);
  assert.equal(value, null);
  assert.equal(page.phase(), 'complete', `ended with the page on "${page.phase()}"`);
  assert.ok(endedAt - COMPLETE_AT < 1_000, `ended ${endedAt - COMPLETE_AT} ms after the session published complete — the page answers, not a clock`);
});

test('row 179b (REAL capture, through driveBeat): beat 6 is GREEN where run 7 was red — the runner wires the agent\'s own liveness', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: WAIT_START });
  const { root, events } = stageCapture(WAIT_START);
  const page = sessionPage(COMPLETE_AT);
  const pending = driveBeat(
    page as never, BEAT6, 5, 'http://localhost:4124', { sessionId: SID }, undefined, null, null, new Map(), null, null, root, WAIT_START,
  );
  const { value, endedAt } = await replay(t, pending, (now) => events(now), COMPLETE_AT + 60_000);
  const verdict = value as any;
  assert.equal(verdict.status, 'green', `beat 6 must be green on the real timeline: ${JSON.stringify(verdict.failures)}`);
  assert.ok(endedAt > BEAT_RED);
});

test('row 179b (negative, REAL capture): an agent that never writes after the wait starts still reds at the declared bound — never extended', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: WAIT_START });
  const { root, events } = stageCapture(WAIT_START);
  const frozen = events(WAIT_START);
  const page = sessionPage(null);
  const reader = makeAgentLivenessReader(root)!;
  const pending = waitForConsequence(
    page as never, BEAT6, DECLARED, ROUTE, null, null, null, null, null, null, null, null, null,
    (runId: string | null, boundRunId: string | null, now: number) => reader(ROUTE, runId, boundRunId, now),
  );
  // No growth across the window: the channel stays exactly as it stood at the wait's start.
  const { value, endedAt } = await replay(t, pending, () => events(WAIT_START), WAIT_START + DECLARED + 60_000);
  assert.equal(events(WAIT_START), frozen);
  assert.equal(value, null);
  assert.equal(page.phase(), 'running');
  assert.ok(endedAt - WAIT_START >= DECLARED && endedAt - WAIT_START < DECLARED + 2 * POLL,
    `a silent agent must red one declared window after the wait began — ended ${endedAt - WAIT_START} ms in`);
});

test('row 179b (negative, REAL capture): a page that never publishes `complete` reds one declared window after the run\'s REAL last write — far inside the ceiling', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: WAIT_START });
  const { root, events } = stageCapture(WAIT_START);
  const page = sessionPage(null);
  const reader = makeAgentLivenessReader(root)!;
  const pending = waitForConsequence(
    page as never, BEAT6, DECLARED, ROUTE, null, null, null, null, null, null, null, null, null,
    (runId: string | null, boundRunId: string | null, now: number) => reader(ROUTE, runId, boundRunId, now),
  );
  const { value, endedAt } = await replay(t, pending, (now) => events(now), LAST_WRITE + DECLARED + 60_000);
  assert.equal(value, null);
  assert.equal(page.phase(), 'running');
  // The run's `end` line is stamped 15:23:49.771; its mtime-equivalent is that stamp.
  const lastStamp = at(JSON.parse(eventLines().at(-1) as string).started_at);
  assert.ok(endedAt - lastStamp >= DECLARED && endedAt - lastStamp < DECLARED + 2 * POLL,
    `went quiet at ${new Date(lastStamp).toISOString()}, ended ${endedAt - lastStamp} ms later`);
  assert.ok(endedAt - WAIT_START < CYCLE_WAIT_WALL_CEILING_MS);
});

test('row 179b: a channel that never stops writing is still stopped by the absolute ceiling, counted from the wait\'s start', () => {
  const window = makeLivenessWindow({ startedAt: 0, timeoutMs: 1_000, wallCeilingMs: 5_000 });
  let d = window.observe(0, 0);
  for (let now = 100; now <= 6_000; now += 100) d = window.observe(now, 0);
  assert.equal(d.deadline, 5_000);
  assert.equal(d.firedBy, 'wall');
  assert.equal(makeLivenessWindow({ startedAt: 0, timeoutMs: 1 }).wallCeilingMs, CYCLE_WAIT_WALL_CEILING_MS,
    'a non-repeat agent wait answers to the SAME backstop 179 and cycleOf do');
});

test('row 179b: a recycled pid in a stale `_logs/` dir is never the pair — and could not buy the wait time if it were', () => {
  const { root } = stageCapture(BEAT_RED);
  const stale = join(root, '_logs', '_agent-stale-2026-09-01T00-00-00-000-zzzz');
  mkdirSync(stale);
  const pid = readFileSync(join(root, '_logs', RUN, 'turn.pid'), 'utf8');
  writeFileSync(join(stale, 'turn.pid'), pid);
  writeFileSync(join(stale, 'events.jsonl'), '{}\n');
  const old = new Date('2026-09-01T00:00:00.000Z');
  utimesSync(join(stale, 'turn.pid'), old, old);
  utimesSync(join(stale, 'events.jsonl'), old, old);
  assert.equal(pairedRunDir(root, sessionLogDir(root, ROUTE) as string), join(root, '_logs', RUN));
  // And a stale write alone never moves a deadline past `startedAt + timeoutMs`.
  const window = makeLivenessWindow({ startedAt: WAIT_START, timeoutMs: DECLARED });
  assert.equal(window.observe(WAIT_START + 1_000, WAIT_START + 1_000 - old.getTime()).deadline, WAIT_START + DECLARED);
});
