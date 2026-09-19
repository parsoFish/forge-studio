/**
 * A declared `terminal` is a CONDITION of completion (M7-A, T1 1231) — the
 * third instance of 7.6.143's class, "a declared wait that bounds nothing".
 *
 * S10 run 22, beat 10: `wait: { for: 'agent', anchor: 'start-development',
 * terminal: 'ready-for-review', cycleOf: '<runId>', upTo: CYCLE_BOUND }` went
 * GREEN 0.37 s after the press — 0.5 s before the develop cycle it was declared
 * to wait for had even started (captured events: `cycle.start` 01:17:48, the
 * beat green 01:17:47.48). Two causes, one per half:
 *
 *   1. `waitForConsequence` ended the wait the moment `expect.data` answered and
 *      consulted the cycle watch only afterwards, only as an early RED exit — so
 *      a beat whose expectation is the press's immediate consequence
 *      (`enqueue-kind: develop`) never waited for its terminal at all.
 *   2. By identity (`cycleOf`), DEC-2 threads ONE cycle id through the architect
 *      and develop runs, so the cycle dir predates the press and the queue
 *      already reads `ready-for-review` — the ARCHITECT run's terminal. A
 *      terminal seen before the press's own run starts is not the press's.
 *
 * The product was healthy: the developer station ran under the story for the
 * first time, and the story's teardown killed it mid-iteration.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeCycleTerminalDoor, makeCycleTerminalWatch } from './beats-agent-proc.mjs';
import { waitForConsequence } from './beats-page.mjs';

const INIT = 'INIT-2026-09-19-exclude-author-flag';

/** A shared cycle dir as DEC-2 leaves it after the architect run, with the initiative in `state`. */
function sharedCycle(state: string, architectStartedAt: string): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'terminal-condition-'));
  const dir = join(root, '_logs', `2026-09-19T01-12-19_${INIT}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ skill: 'cycle', event_type: 'start', message: 'cycle.start', started_at: architectStartedAt })}\n${JSON.stringify({ skill: 'cycle', event_type: 'end', message: 'cycle.end', started_at: architectStartedAt })}\n`);
  mkdirSync(join(root, '_queue', state), { recursive: true });
  writeFileSync(join(root, '_queue', state, `${INIT}.md`), '# initiative\n');
  return { root, dir };
}

test('identity form: the ARCHITECT run\'s ready-for-review is not the terminal of the run the press started', () => {
  const anchor = Date.now();
  const { root } = sharedCycle('ready-for-review', new Date(anchor - 300_000).toISOString());
  const door = makeCycleTerminalDoor(root, { cycleOf: INIT })!;

  assert.equal(door(null, anchor, 'ready-for-review'), null, 'no run has started since the press, so nothing has terminated for it');
  assert.equal(door.sawCycle, true, 'the cycle IS resolved by identity — it simply has not run for this press yet');
});

test('identity form: once the cycle starts AFTER the anchor, its terminal counts', () => {
  const anchor = Date.now();
  const { root, dir } = sharedCycle('ready-for-review', new Date(anchor - 300_000).toISOString());
  appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ skill: 'cycle', event_type: 'start', message: 'cycle.start', started_at: new Date(anchor + 1_000).toISOString() })}\n`);
  const door = makeCycleTerminalDoor(root, { cycleOf: INIT })!;

  const seen = door(null, anchor, 'ready-for-review');
  assert.notEqual(seen, null);
  assert.equal(seen!.done, true, seen?.detail);
});

test('identity form: a WRONG terminal left by the previous run does not red the press early', () => {
  const anchor = Date.now();
  const { root } = sharedCycle('done', new Date(anchor - 300_000).toISOString());
  const watch = makeCycleTerminalWatch(root, 'ready-for-review', { cycleOf: INIT })!;

  assert.equal(watch(null, anchor), null, 'the previous run ended in done — that is not a verdict on the run this press started');
  assert.equal(watch.reached, false);
});

/** A page whose expectation answers on EVERY poll, from t = 0. */
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

const BEAT = { act: 'Hand the plan to the build flow', expect: { route: '/projects/gitpulse', data: { page: 'projects', 'project-id': 'gitpulse', 'enqueue-kind': 'develop' } } };

/** A watch that reaches its terminal after `reachAfterMs` — the production shape: a function plus `reached`. */
function watchReachingAfter(reachAfterMs: number | null) {
  const t0 = Date.now();
  const watch = (() => null) as unknown as ((runId: string | null, sinceMs: number) => null) & { reached: boolean; wantState: string; lastSeen: string };
  Object.defineProperty(watch, 'reached', { get: () => reachAfterMs !== null && Date.now() - t0 >= reachAfterMs });
  Object.defineProperty(watch, 'wantState', { value: 'ready-for-review' });
  Object.defineProperty(watch, 'lastSeen', { get: () => 'the initiative is in _queue/in-flight/' });
  return watch;
}

test('a declared terminal is a CONDITION: an expectation answering at t = 0 does not end the wait before the terminal', async () => {
  const began = Date.now();
  const verdict = await waitForConsequence(
    answeringPage() as never, BEAT as never, 5_000, null, null, null, null, null, null, watchReachingAfter(700) as never,
  );
  assert.equal(verdict, null, 'the wait completes once BOTH hold');
  assert.ok(Date.now() - began >= 650, `it waited for the terminal: ${Date.now() - began} ms (run 22 waited 0.37 s)`);
});

test('a terminal never reached is a NAMED red at the bound — never null, which the caller would judge green on the live page', async () => {
  const verdict = await waitForConsequence(
    answeringPage() as never, BEAT as never, 800, null, null, null, null, null, null, watchReachingAfter(null) as never,
  ) as { why: string; stoppedBy?: string } | null;
  assert.notEqual(verdict, null, 'returning null here is run 22 again, one layer down');
  assert.match(verdict!.why, /ready-for-review/);
  assert.match(verdict!.why, /in-flight/, 'and it names the state the cycle was last seen in');
});

test('a beat with no declared terminal keeps today\'s semantics: it ends when its expectation answers', async () => {
  const began = Date.now();
  const verdict = await waitForConsequence(answeringPage() as never, BEAT as never, 5_000, null);
  assert.equal(verdict, null);
  assert.ok(Date.now() - began < 1_000, `no terminal, no extra wait: ${Date.now() - began} ms`);
});

test('D review (1): once the press\'s run is proven started, the door does not re-read the log every poll (latched)', { skip: process.getuid?.() === 0 ? 'root reads mode-000 files' : false }, () => {
  const anchor = Date.now();
  const { root, dir } = sharedCycle('ready-for-review', new Date(anchor - 300_000).toISOString());
  appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ skill: 'cycle', event_type: 'start', message: 'cycle.start', started_at: new Date(anchor + 1_000).toISOString() })}\n`);
  const door = makeCycleTerminalDoor(root, { cycleOf: INIT })!;
  assert.equal(door(null, anchor, 'ready-for-review')?.done, true);
  chmodSync(join(dir, 'events.jsonl'), 0o000);
  try {
    assert.equal(door(null, anchor, 'ready-for-review')?.done, true, 'a proven start stays proven — the multi-hour log is not re-scanned per poll');
  } finally { chmodSync(join(dir, 'events.jsonl'), 0o644); }
});

test('D review (2): an UNREADABLE cycle log is named, never read as "not started" (§15.504)', { skip: process.getuid?.() === 0 ? 'root reads mode-000 files' : false }, () => {
  const anchor = Date.now();
  const { root, dir } = sharedCycle('ready-for-review', new Date(anchor - 300_000).toISOString());
  chmodSync(join(dir, 'events.jsonl'), 0o000);
  try {
    const door = makeCycleTerminalDoor(root, { cycleOf: INIT })!;
    assert.equal(door(null, anchor, 'ready-for-review'), null, 'UNKNOWN keeps waiting');
    assert.match(door.lastSeen, /could not read .*events\.jsonl: EACCES/, 'and the bound will say WHY, not claim the product never started');
  } finally { chmodSync(join(dir, 'events.jsonl'), 0o644); }
});
