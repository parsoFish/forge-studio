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
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeCycleTerminalDoor, makeCycleTerminalWatch, STALL_CEILING_MS } from './beats-agent-proc.mjs';
import { newestChannelSince, cycleDirForInitiative } from './beats-channel-scan.mjs';
import { waitForConsequence } from './beats-page.mjs';
import { FS_CLOCK_SLACK_MS } from './beats-queue-terminal.mjs';

const INIT = 'INIT-2026-09-19-exclude-author-flag';

/** A shared cycle dir as DEC-2 leaves it after the architect run, with the initiative in `state`.
 *
 * T1 1503 — the manifest's own mtime is backdated to `architectStartedAt`.
 * `queueManifestTerminal` (beats-queue-terminal.mjs) now reads that mtime as
 * evidence of WHEN the product wrote it, and every fixture here narrates the
 * manifest as the ARCHITECT run's leftover — i.e. written `architectStartedAt`,
 * not whenever this helper happened to run `writeFileSync`. Leaving the real
 * mtime at "now" would let every one of these tests pass by accident, for the
 * wrong reason: a manifest whose fixture timestamp does not match its own
 * narrative. */
function sharedCycle(state: string, architectStartedAt: string): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'terminal-condition-'));
  const dir = join(root, '_logs', `2026-09-19T01-12-19_${INIT}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ skill: 'cycle', event_type: 'start', message: 'cycle.start', started_at: architectStartedAt })}\n${JSON.stringify({ skill: 'cycle', event_type: 'end', message: 'cycle.end', started_at: architectStartedAt })}\n`);
  mkdirSync(join(root, '_queue', state), { recursive: true });
  const manifest = join(root, '_queue', state, `${INIT}.md`);
  writeFileSync(manifest, '# initiative\n');
  const at = new Date(architectStartedAt).getTime() / 1000;
  utimesSync(manifest, at, at);
  // The PREVIOUS run's manifest must predate this test's anchor in ctime too
  // (utimesSync back-dates mtime only and stamps ctime NOW); the door accepts
  // a terminal within FS_CLOCK_SLACK_MS of the anchor, so settle past it.
  const settledAt = Date.now() + FS_CLOCK_SLACK_MS + 50;
  while (Date.now() < settledAt) { /* settle */ }
  return { root, dir };
}

test('identity form: the ARCHITECT run\'s ready-for-review is not the terminal of the run the press started', () => {
  const { root } = sharedCycle('ready-for-review', new Date(Date.now() - 300_000).toISOString());
  const anchor = Date.now(); // AFTER the previous run's files exist — see sharedCycle
  const door = makeCycleTerminalDoor(root, { cycleOf: INIT })!;

  assert.equal(door(null, anchor, 'ready-for-review'), null, 'no run has started since the press, so nothing has terminated for it');
  assert.equal(door.sawCycle, true, 'the cycle IS resolved by identity — it simply has not run for this press yet');
});

test('identity form: once the cycle starts AFTER the anchor, its terminal counts', () => {
  const { root, dir } = sharedCycle('ready-for-review', new Date(Date.now() - 300_000).toISOString());
  const anchor = Date.now(); // AFTER the previous run's files exist — see sharedCycle
  appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ skill: 'cycle', event_type: 'start', message: 'cycle.start', started_at: new Date(anchor + 1_000).toISOString() })}\n`);
  const door = makeCycleTerminalDoor(root, { cycleOf: INIT })!;

  const seen = door(null, anchor, 'ready-for-review');
  assert.notEqual(seen, null);
  assert.equal(seen!.done, true, seen?.detail);
});

test('identity form: a WRONG terminal left by the previous run does not red the press early', () => {
  const { root } = sharedCycle('done', new Date(Date.now() - 300_000).toISOString());
  const anchor = Date.now(); // AFTER the previous run's files exist — see sharedCycle
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
  const { root, dir } = sharedCycle('ready-for-review', new Date(Date.now() - 300_000).toISOString());
  const anchor = Date.now(); // AFTER the previous run's files exist — see sharedCycle
  appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ skill: 'cycle', event_type: 'start', message: 'cycle.start', started_at: new Date(anchor + 1_000).toISOString() })}\n`);
  const door = makeCycleTerminalDoor(root, { cycleOf: INIT })!;
  assert.equal(door(null, anchor, 'ready-for-review')?.done, true);
  chmodSync(join(dir, 'events.jsonl'), 0o000);
  try {
    assert.equal(door(null, anchor, 'ready-for-review')?.done, true, 'a proven start stays proven — the multi-hour log is not re-scanned per poll');
  } finally { chmodSync(join(dir, 'events.jsonl'), 0o644); }
});

test('D review (2): an UNREADABLE cycle log is named, never read as "not started" (§15.504)', { skip: process.getuid?.() === 0 ? 'root reads mode-000 files' : false }, () => {
  const { root, dir } = sharedCycle('ready-for-review', new Date(Date.now() - 300_000).toISOString());
  const anchor = Date.now(); // AFTER the previous run's files exist — see sharedCycle
  chmodSync(join(dir, 'events.jsonl'), 0o000);
  try {
    const door = makeCycleTerminalDoor(root, { cycleOf: INIT })!;
    assert.equal(door(null, anchor, 'ready-for-review'), null, 'UNKNOWN keeps waiting');
    assert.match(door.lastSeen, /could not read .*events\.jsonl: EACCES/, 'and the bound will say WHY, not claim the product never started');
  } finally { chmodSync(join(dir, 'events.jsonl'), 0o644); }
});

/**
 * `forge-8vfn.8.1.4` — THE STALL DOOR MUST NOT SECOND-GUESS A `cycleOf` WATCH.
 *
 * MEASURED (S10-class shape, reconstructed from the stories runner's own
 * doors). `waitForConsequence` consulted the GENERIC stall door
 * (`makeAgentChannelDoor`) even on a beat that had already declared a
 * `cycleOf`-scoped `cycleWatch`. That door's own channel search —
 * `newestChannelSince`, born-after-the-anchor — knows nothing of `cycleOf`,
 * and the develop station CONTINUES the architect's cycle dir, born BEFORE
 * the press this wait anchors on (`cycleDirForInitiative`'s whole reason to
 * exist, 7.6.143). So the generic door reported `no-channel` about a cycle
 * that was genuinely open and streaming events, ending the wait early on a
 * finding that was never about THIS cycle at all — and the beat's fresh
 * re-read then answered green from its plain `expect.data`, which had held
 * since the press and knows nothing about why the wait ended.
 *
 * A dispatch dir born a moment ago is proof enough of "predates the anchor":
 * a fixture cannot fake BIRTH time (`beats-cycle-terminal.test.ts` learned
 * this the hard way), so the anchor is set a few seconds into the FUTURE —
 * 7.6.143's own trick for the identical relation, "the press happened after
 * this dir already existed".
 */
function openContinuedCycle(initiative: string): { root: string; logs: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'terminal-stall-door-'));
  const logs = join(root, '_logs');
  const dir = join(logs, `2026-09-19T00-00-00_${initiative}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ event_type: 'start' })}\n`);
  mkdirSync(join(root, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(join(root, '_queue', 'in-flight', `${initiative}.md`), '# in flight\n');
  return { root, logs, dir };
}

test('8.1.4 (RED before the fix): the generic stall door is never consulted while a cycleWatch is watching', async () => {
  const initiative = 'INIT-2026-09-19-continued-cycle';
  const { root, logs, dir } = openContinuedCycle(initiative);
  // The press anchors AFTER the dir's real birth — the develop station
  // continuing a cycle the architect already started.
  const anchor = Date.now() + 5_000;
  // A `cycle.start` this wait's own run can credit — dated past the anchor so
  // `cycleStartedSince` accepts it whenever this poll actually runs, however
  // little real time has elapsed (§15.504 doors are read from disk, not a
  // clock this test controls).
  appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ event_type: 'start', message: 'cycle.start', started_at: new Date(anchor + 1_000).toISOString() })}\n`);

  // GROUND TRUTH (7.6.143): the generic, non-`cycleOf` resolver the stall door
  // itself uses really would find nothing for this press.
  assert.equal(newestChannelSince(logs, anchor), null, 'the born-after-the-anchor form must not see a continued cycle');

  let calls = 0;
  // A stand-in for the generic door — the same idiom `beats-offsession-stall
  // .test.ts` uses (`door(NONE)`): "its SHAPE is the contract under test".
  // This is what `makeAgentChannelDoor` concludes for THIS press once its own
  // ceiling elapses: nothing, proven above.
  const stallDoor = () => {
    calls += 1;
    return { reason: 'no-channel', detail: 'modelling the real door\'s blind spot for a continued cycle (7.6.143).' };
  };
  const watch = makeCycleTerminalWatch(root, 'ready-for-review', { cycleOf: initiative })!;

  // The cycle finishes MID-WAIT, exactly as the real scheduler would — moved
  // out of `in-flight` into the wanted state.
  setTimeout(() => {
    unlinkSync(join(root, '_queue', 'in-flight', `${initiative}.md`));
    mkdirSync(join(root, '_queue', 'ready-for-review'), { recursive: true });
    writeFileSync(join(root, '_queue', 'ready-for-review', `${initiative}.md`), '# done\n');
  }, 200);

  const verdict = await waitForConsequence(
    answeringPage() as never, BEAT as never, 2 * STALL_CEILING_MS + 10_000, null, null, null,
    stallDoor as never, anchor, null, watch,
  );

  assert.equal(
    calls, 0,
    'forge-8vfn.8.1.4: the generic stall door must NEVER be consulted while a declared terminal is being ' +
    'watched — it resolves the WRONG channel for a continued cycle and a false `no-channel` must not end this wait',
  );
  assert.equal(verdict, null, 'the cycle is genuinely open and then finishes on its own terminal — nothing may end this wait on a stall-door finding');
});

test('8.1.4: a cycleOf initiative whose dispatch dir never appears is still red at the bound — no false comfort from the identity resolver either', async () => {
  const root = mkdtempSync(join(tmpdir(), 'terminal-stall-door-none-'));
  const watch = makeCycleTerminalWatch(root, 'ready-for-review', { cycleOf: 'INIT-never-dispatched' })!;
  const verdict = await waitForConsequence(
    answeringPage() as never, BEAT as never, 300, null, null, null, null, null, null, watch,
  ) as { why: string; stoppedBy?: string } | null;

  assert.notEqual(verdict, null, 'a cycleOf cycle that never appears must still end the wait red, at the declared bound');
  assert.match(verdict!.why, /ready-for-review/);
  assert.equal(verdict!.stoppedBy, 'runner');
});

// Row 31 of the guard-catch-on-UNKNOWN audit (M7-COMMON §6.16) —
// `cycleDirForInitiative` must not read a persistently unreadable `_logs/` as
// "hasn't started yet": that is indistinguishable from a genuinely absent one
// and would burn a wait's full declared bound toward a false red on a cycle
// that actually finished.
test('row 31: a persistently unreadable _logs/ is UNKNOWN, never "hasn\'t started yet" — §6.16', { skip: process.getuid?.() === 0 ? 'root reads mode-000 dirs' : false }, () => {
  const root = mkdtempSync(join(tmpdir(), 'terminal-cycledir-eacces-'));
  const logs = join(root, '_logs');
  mkdirSync(logs, { recursive: true });
  chmodSync(logs, 0o000);
  try {
    const found = cycleDirForInitiative(logs, 'INIT-row-31');
    assert.notEqual(found, null, 'an unreadable _logs/ must not read as "no matching dir" — the exact false-red shape row 31 exists to catch');
    assert.equal((found as { unknown?: true }).unknown, true);
    assert.match((found as { detail: string }).detail, /EACCES/);
  } finally {
    chmodSync(logs, 0o755);
  }
});

test('row 31 (control): a genuinely absent _logs/ (ENOENT) still reads as null, not unknown', () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'terminal-cycledir-missing-')), '_logs');
  assert.equal(cycleDirForInitiative(missing, 'INIT-row-31'), null);
});

test('row 31 (door integration): makeCycleTerminalDoor never crashes or fabricates a verdict on an unreadable _logs/, and records why', { skip: process.getuid?.() === 0 ? 'root reads mode-000 dirs' : false }, () => {
  const root = mkdtempSync(join(tmpdir(), 'terminal-cycledir-door-eacces-'));
  const logs = join(root, '_logs');
  mkdirSync(logs, { recursive: true });
  chmodSync(logs, 0o000);
  try {
    const door = makeCycleTerminalDoor(root, { cycleOf: 'INIT-row-31-door' })!;
    const verdict = door(null, Date.now(), 'ready-for-review');
    assert.equal(verdict, null, 'an unreadable check is never `done` (§15.504) — it must keep waiting, not fabricate a verdict');
    assert.match(door.lastSeen, /EACCES/, `the door must SAY it could not read the scan, not stay silent: ${door.lastSeen}`);
  } finally {
    chmodSync(logs, 0o755);
  }
});
