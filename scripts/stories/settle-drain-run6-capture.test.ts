/**
 * Row 196 (bead `forge-8vfn.8.5.34`), T1 rulings 1973gf/gg — S6 beat 14
 * ("Open the knowledge base's Health tab and drain it to green", `wait: {
 * for: 'settle', upTo: 180_000, key: 'drain-state', while: 'running' }`),
 * replayed on M7-E run 6's REAL capture.
 *
 * `test-fixtures/run6-s6-beat14/` is copied verbatim from that red: the drain's
 * own `_logs/_kb-drain-<run>/{events.jsonl,status.json}` (under
 * `logs-capture/`), its birth and mtimes (`MTIMES.txt`), and the run log's beat
 * 13–15 lines (`run6-beat14.txt`). The measured timeline:
 *
 *   21:26:23.897  `drain-to-green` "present and enabled" — the beat's LAST press
 *   21:26:23.928  `_kb-drain-…-murh3i5z` born (`kb-drain.queued`) — NO turn.pid
 *   21:26:24.101  beat RED — `expected "green", got "running"` / `gave up at the
 *                 settle wait (declared 180000 ms)`, 0.2 s after the press
 *   21:26:25.018  `kb-drain.end (state=green)` — 1.1 s after the press
 *
 * (A) NO BOUND FIRED. `gave up at the …` is `beats-drive.mjs`'s `named()`
 * wording for a red verdict whose wait returned `null` — no stall. Of
 * `waitForConsequence`'s `null` exits only one is reachable 0.2 s into a
 * 180 s bound with the page not green: the settle SHARPNESS exit, which ended
 * the wait the first time `drain-state` held anything but `running`. The first
 * poll ran before the press had visibly taken effect — the panel still showed
 * its pre-dispatch value (`idle`, then `attaching` while it re-attaches:
 * `deriveDrainDisplayState`, `apps/studio/lib/kb-drain-view.ts`) — so the wait
 * "settled" on a value the drain had not yet reached, and the verdict's own
 * fresh read a moment later saw `running`. The liveness window (#1062/#1064)
 * is never consulted for a settle wait (`for === 'agent'` only); the lead was
 * `agentScaleWait`, which gates the early-death door alone — and that door is
 * (B).
 *
 * (B) NO turn.pid IS NOT A DEAD PID. With (A) fixed the wait keeps polling, and
 * the early-death door's born-after-the-press scan finds the kb-drain dir —
 * which carries no `turn.pid` BY DESIGN, exactly like the Studio bridge's own
 * `_bridge-…-knov2l1s` (every spend line of the run called that one "REAPED/
 * DIED — pid is gone" while `/api/health` answered from it). The classifier
 * read `pid: null` as `alive: false` and so as death, and the door would have
 * reded the beat ~0.5 s in, before the drain's green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { waitForConsequence } from './beats-page.mjs';
import { makeAgentChannelDoor } from './beats-agent-proc.mjs';
import { classifyUnmeasuredDispatch } from './spend.mjs';
import { readDispatchSnapshot, spendSoFar } from './run-observe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'test-fixtures', 'run6-s6-beat14');
const CHANNEL = '_kb-drain-story-s6-drain-murh3i5z';
const RUN_ID = 'story-s6-drain-murh3i5z';
const at = (iso: string) => Date.parse(iso);
const PRESS = at('2026-10-02T21:26:23.897Z');
const GAVE_UP = at('2026-10-02T21:26:24.101Z');
const DRAIN_END = at('2026-10-02T21:26:25.018Z');

/** The beat as S6 declares it (`tests/stories/S6.story.mjs`). */
const BEAT = Object.freeze({
  act: 'Open the knowledge base’s Health tab and drain it to green',
  do: [{ press: 'open-kb-tab-health' }, { press: 'drain-to-green' }],
  wait: { for: 'settle', upTo: 180_000, key: 'drain-state', while: 'running' },
  expect: {
    route: '/knowledge',
    data: { page: 'knowledge', 'page-ready': 'true', 'drain-state': 'green', 'drain-run-id': '<drainRunId>' },
  },
});

test('row 196 fixture: the captured run log carries the red this file replays', () => {
  const log = readFileSync(join(FIXTURE, 'run6-beat14.txt'), 'utf8');
  assert.match(log, /\[2026-10-02T21:26:23\.897Z\] .*drain-to-green.*present and enabled/);
  assert.match(log, /\[2026-10-02T21:26:24\.101Z\] +data-drain-state: expected "green", got "running"/);
  assert.match(log, /\[2026-10-02T21:26:24\.101Z\] +gave up at the settle wait \(declared 180000 ms\)/);
  assert.match(log, new RegExp(`UNMEASURED ${CHANNEL} — REAPED/DIED — pid is gone`));
  assert.match(log, /UNMEASURED _bridge-2026-10-02T18-53-04-785-knov2l1s — REAPED\/DIED — pid is gone/);
  const events = readFileSync(join(FIXTURE, 'logs-capture', CHANNEL, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(events[0].started_at, '2026-10-02T21:26:23.928Z');
  const last = events[events.length - 1];
  assert.equal(last.message, 'kb-drain.end (state=green)');
  assert.equal(at(last.started_at), DRAIN_END);
  assert.ok(GAVE_UP - PRESS < 250, 'the wait ended 0.2 s after the press');
});

/**
 * Stage the capture so the drain dir is BORN and GROWS on the real offsets from
 * the press — the door reads a dir as it was at that instant, never as it ended.
 * The page follows the same clock: its pre-dispatch value until the instant the
 * wait gave up, `running` until the drain's own `end`, then `green`.
 */
function stageReplay() {
  const root = mkdtempSync(join(tmpdir(), 'settle-drain-run6-'));
  mkdirSync(join(root, '_logs'), { recursive: true });
  const src = join(FIXTURE, 'logs-capture', CHANNEL);
  const lines = readFileSync(join(src, 'events.jsonl'), 'utf8').trim().split('\n')
    .map((line) => ({ offset: at(JSON.parse(line).started_at) - PRESS, line }));
  const dir = join(root, '_logs', CHANNEL);
  const pressedAt = Date.now();
  let written = 0;
  const tick = () => {
    const t = Date.now() - pressedAt;
    while (written < lines.length && lines[written].offset <= t) {
      if (written === 0) mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, 'events.jsonl'), lines[written].line + '\n');
      written += 1;
      if (written === lines.length) copyFileSync(join(src, 'status.json'), join(dir, 'status.json'));
    }
    return t;
  };
  const drainState = (t: number) => (t < GAVE_UP - PRESS ? 'idle' : t < DRAIN_END - PRESS ? 'running' : 'green');
  const read = () => {
    const t = tick();
    const state = drainState(t);
    return { page: 'knowledge', 'page-ready': 'true', 'drain-state': state, 'drain-run-id': state === 'idle' ? '' : RUN_ID };
  };
  const node = { getAttribute: () => null }; // the Health tab names no `data-run`
  const page = {
    url: () => 'http://localhost:4124/knowledge',
    locator: () => ({
      first: () => ({ evaluate: async (fn: (n: unknown) => unknown) => fn(node) }),
      count: async () => 0,
      evaluateAll: async (fn: any, arg: any) => fn([], arg),
    }),
    evaluate: async () => ({ data: read(), nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null }),
  };
  return { root, page, pressedAt, read };
}

test('row 196 (A)+(B) RED-FIRST: the settle wait sits through the pre-dispatch value and goes GREEN when the page does, ~1.1 s after the press', async () => {
  const { root, page, pressedAt, read } = stageReplay();
  const stallDoor = makeAgentChannelDoor(root);
  assert.notEqual(stallDoor, null);
  const stall = await waitForConsequence(
    page as never, BEAT as never, BEAT.wait.upTo, null, null, BEAT.wait, stallDoor as never,
    pressedAt, null, null, null, null, pressedAt,
  );
  const took = Date.now() - pressedAt;
  const after = read();
  assert.equal(stall, null, `the drain went green; nothing may stop this wait first. Got: ${JSON.stringify(stall)}`);
  assert.equal(after['drain-state'], 'green', `the wait ended at ${took} ms on a page that does not hold the beat's expectation`);
  assert.ok(took >= DRAIN_END - PRESS - 50, `must wait for the drain's own end (${DRAIN_END - PRESS} ms) — took ${took} ms`);
  assert.ok(took < 5_000, `and stop the poll the page shows green, not sit out the bound — took ${took} ms`);
});

test('row 196 (A) CONTROL: once the transient was seen, a WRONG settled value is still not waited out', async () => {
  // 621(ii)'s sharpness, unregressed: `running` → `needs-you` ends the wait on sight.
  const startedAt = Date.now();
  const state = () => {
    const t = Date.now() - startedAt;
    return t < 150 ? 'idle' : t < 400 ? 'running' : 'needs-you';
  };
  const page = {
    url: () => 'http://localhost:4124/knowledge',
    locator: () => ({ count: async () => 0, evaluateAll: async (fn: any, arg: any) => fn([], arg) }),
    evaluate: async () => ({
      data: { page: 'knowledge', 'page-ready': 'true', 'drain-state': state(), 'drain-run-id': RUN_ID },
      nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null,
    }),
  };
  const stall = await waitForConsequence(page as never, BEAT as never, 20_000, null, null, BEAT.wait);
  const took = Date.now() - startedAt;
  assert.equal(stall, null);
  assert.equal(state(), 'needs-you');
  assert.ok(took >= 380 && took < 2_000, `stopped as soon as the value left the transient — took ${took} ms`);
});

// ───────────── (B) — no turn.pid is UNKNOWN, never dead ─────────────

test('row 196 (B) RED-FIRST: a dir with no turn.pid classifies UNKNOWN, never REAPED/DIED or NEVER STARTED', () => {
  // The bridge dir's own reads from the capture: 1962→1962 lines, then its
  // very first read (1 line), which printed NEVER STARTED.
  const steady = classifyUnmeasuredDispatch(
    { pid: null, alive: false, eventLines: 1962, stderrTail: '', exitCode: null },
    { pid: null, alive: false, eventLines: 1962 },
  );
  assert.equal(steady.arm, 'unknown');
  assert.match(steady.detail, /UNKNOWN/);
  assert.doesNotMatch(steady.detail, /REAPED|DIED|pid is gone/);
  const first = classifyUnmeasuredDispatch({ pid: null, alive: false, eventLines: 1, stderrTail: '', exitCode: null });
  assert.equal(first.arm, 'unknown');
  assert.doesNotMatch(first.detail, /NEVER STARTED/);
  // A pid that WAS written and is gone is still death — 7.6.76's arm, unchanged.
  const dead = classifyUnmeasuredDispatch(
    { pid: 4242, alive: false, eventLines: 12, stderrTail: '', exitCode: null },
    { pid: 4242, alive: true, eventLines: 12 },
  );
  assert.equal(dead.arm, 'reaped');
});

test('row 196 (B): the spend line for a pid-less dir reads UNKNOWN (the kb-drain dir, as captured at the give-up)', () => {
  const root = mkdtempSync(join(tmpdir(), 'settle-drain-run6-spend-'));
  const dir = join(root, '_logs', CHANNEL);
  mkdirSync(dir, { recursive: true });
  const three = readFileSync(join(FIXTURE, 'logs-capture', CHANNEL, 'events.jsonl'), 'utf8').trim().split('\n').slice(0, 3);
  writeFileSync(join(dir, 'events.jsonl'), three.join('\n') + '\n');
  const { lines } = spendSoFar({ root, startedMs: 0, realSpawn: true, ceilingUsd: 25, label: 'after beat 14' });
  const line = lines.find((l) => l.includes(`UNMEASURED ${CHANNEL}`));
  assert.ok(line !== undefined, `no spend line names the dir: ${lines.join('\n')}`);
  assert.match(line as string, /UNKNOWN/);
  assert.doesNotMatch(line as string, /REAPED|DIED|pid is gone/);
  assert.equal(readDispatchSnapshot(dir).pid, null);
});

test('row 196 (B): the early-death door never ends a wait on a pid-less channel, however long it is static', () => {
  const root = mkdtempSync(join(tmpdir(), 'settle-drain-run6-door-'));
  const pressMs = Date.now() - 10_000;
  const dir = join(root, '_logs', CHANNEL);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), readFileSync(join(FIXTURE, 'logs-capture', CHANNEL, 'events.jsonl'), 'utf8').split('\n').slice(0, 3).join('\n') + '\n');
  const door = makeAgentChannelDoor(root) as unknown as { earlyDeath: (...a: unknown[]) => unknown };
  for (let i = 0; i < 5; i += 1) {
    assert.equal(door.earlyDeath(null, pressMs, null, pressMs, Date.now() + i * 100), null, `poll ${i} ended the wait`);
  }
});
