/**
 * beats-cycle-progress.test.ts — the PURE half of T1 ruling 1471 (S10 run 26):
 * what "progress" reads as for a `cycleOf` agent wait, and how that composes
 * against the absolute wall ceiling.
 *
 * `cycleWaitDeadline` is unit-tested here at an INJECTED `wallCeilingMs` —
 * never the real `CYCLE_WAIT_WALL_CEILING_MS` (90 minutes) — so the wall
 * ceiling's own firing is provable without a test that sleeps for minutes.
 * The end-to-end shape, through `waitForConsequence` and a real cycle dir on
 * disk, is `beats-progress-window.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cycleProgressIdleMs, cycleWaitDeadline } from './beats-cycle-progress.mjs';
import { CYCLE_WAIT_WALL_CEILING_MS } from './beats-agent-proc.mjs';
import { MAX_DECLARED_WAIT_MS } from './story-wait-schema.mjs';

test('the wall ceiling is a measured multiple of MAX_DECLARED_WAIT_MS, and strictly wider than it', () => {
  assert.equal(CYCLE_WAIT_WALL_CEILING_MS, 3 * MAX_DECLARED_WAIT_MS);
  assert.ok(
    CYCLE_WAIT_WALL_CEILING_MS > MAX_DECLARED_WAIT_MS,
    'the wall ceiling must be the OUTER backstop — narrower than the declared cap it sits beside would fire before a story could ever legally reach it',
  );
});

test('cycleProgressIdleMs: null when nothing has been written at all — never 0, which would read as fresh progress', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cycle-progress-empty-'));
  assert.equal(cycleProgressIdleMs(dir), null, 'an absent reading must fail CLOSED, not be invented as "just wrote"');
});

test('cycleProgressIdleMs: reads events.jsonl\'s own mtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cycle-progress-events-'));
  writeFileSync(join(dir, 'events.jsonl'), '{"event_type":"start"}\n');
  const idle = cycleProgressIdleMs(dir);
  assert.notEqual(idle, null);
  assert.ok(idle! < 2_000, `a file written this instant should read as freshly idle, got ${idle}ms`);
});

test('cycleProgressIdleMs: a review chunk persisted AFTER events.jsonl counts as the newer progress', () => {
  // The incident's own shape (S10 run 26): a chunk landed at 18:14:35 while
  // the channel's own events.jsonl had gone quiet earlier. Aged the OLD way —
  // `utimesSync` on the channel file, then a chunk written fresh on top.
  const dir = mkdtempSync(join(tmpdir(), 'cycle-progress-chunk-'));
  writeFileSync(join(dir, 'events.jsonl'), '{"event_type":"start"}\n');
  const old = new Date(Date.now() - 10 * 60_000);
  utimesSync(join(dir, 'events.jsonl'), old, old);
  mkdirSync(join(dir, 'artifacts', 'review-chunks'), { recursive: true });
  writeFileSync(join(dir, 'artifacts', 'review-chunks', 'chunk-WI-1.json'), '{"label":"WI-1"}\n');

  const idle = cycleProgressIdleMs(dir);
  assert.notEqual(idle, null);
  assert.ok(
    idle! < 5_000,
    `the chunk is the NEWER write and must be what "idle" is measured from, not the 10-minute-old channel file: got ${idle}ms`,
  );
});

test('cycleProgressIdleMs: a review-chunks dir that does not exist yet is not evidence of silence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cycle-progress-nochunks-'));
  writeFileSync(join(dir, 'events.jsonl'), '{"event_type":"start"}\n');
  // No `artifacts/review-chunks/` at all — must not throw, must still read the channel.
  const idle = cycleProgressIdleMs(dir);
  assert.notEqual(idle, null);
});

test('cycleWaitDeadline: no activity ever observed falls back to the plain, unreset deadline (fail CLOSED)', () => {
  const startedAt = 1_000_000;
  const { deadline, firedBy } = cycleWaitDeadline({
    startedAt, timeoutMs: 5_000, lastActivityAt: null, wallCeilingMs: 3_600_000,
  });
  assert.equal(deadline, startedAt + 5_000, 'an ABSENT reading must not be read as fresh progress — that is the fail-open shape this bead exists to close');
  assert.equal(firedBy, 'inactivity');
});

test('cycleWaitDeadline: progress pushes the inactivity deadline out — the incident\'s own repair', () => {
  const startedAt = 1_000_000;
  const timeoutMs = 5_000;
  // Progress seen well after the wait started — e.g. a chunk persisted 4
  // minutes into a 30-minute window that would otherwise have already expired.
  const lastActivityAt = startedAt + 4_000;
  const { deadline, firedBy } = cycleWaitDeadline({ startedAt, timeoutMs, lastActivityAt, wallCeilingMs: 3_600_000 });
  assert.equal(deadline, lastActivityAt + timeoutMs, 'the window resets from the LAST WRITE, not from the wait\'s start');
  assert.ok(deadline > startedAt + timeoutMs, 'and that must be LATER than the original, unreset deadline — the whole point of the reset');
  assert.equal(firedBy, 'inactivity');
});

test('cycleWaitDeadline: the wall ceiling fires even with continuous progress — a wait cannot reset forever', () => {
  const startedAt = 1_000_000;
  // Progress arriving every tick, always just inside the inactivity window —
  // a cycle that never stops writing. The wall ceiling still binds.
  const lastActivityAt = startedAt + 90_000; // "just now" relative to a long timeoutMs below
  const { deadline, firedBy } = cycleWaitDeadline({
    startedAt, timeoutMs: 10_000_000, lastActivityAt, wallCeilingMs: 300,
  });
  assert.equal(deadline, startedAt + 300, 'the wall ceiling is counted from the WAIT\'S OWN START and must win over an inactivity deadline progress keeps pushing out');
  assert.equal(firedBy, 'wall');
});

test('cycleWaitDeadline: the tighter of the two always wins, whichever it is', () => {
  const startedAt = 0;
  // Inactivity deadline tighter than the wall ceiling here.
  const tight = cycleWaitDeadline({ startedAt, timeoutMs: 100, lastActivityAt: 0, wallCeilingMs: 10_000 });
  assert.equal(tight.deadline, 100);
  assert.equal(tight.firedBy, 'inactivity');
  // Wall ceiling tighter than the inactivity deadline here (heavy progress-reset case).
  const wide = cycleWaitDeadline({ startedAt, timeoutMs: 100, lastActivityAt: 9_950, wallCeilingMs: 10_000 });
  assert.equal(wide.deadline, 10_000);
  assert.equal(wide.firedBy, 'wall');
});

test('cycleWaitDeadline: a write that PREDATES the wait never shortens it below the plain deadline (row 95 review)', () => {
  // The cycle dir already existed when the wait began — its last write was
  // ten minutes earlier. Progress may only EXTEND a wait, never make it end
  // sooner than the fixed deadline it replaced.
  const startedAt = 1_000_000;
  const { deadline } = cycleWaitDeadline({
    startedAt, timeoutMs: 60_000, lastActivityAt: startedAt - 600_000, wallCeilingMs: 10_000_000,
  });
  assert.equal(deadline, startedAt + 60_000);
});

test('cycleProgressIdleMs: a .heartbeat touch alone is liveness, not progress — only events.jsonl and review chunks count (T1 1471; row 95 review)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cycle-progress-hb-'));
  writeFileSync(join(dir, 'events.jsonl'), '{}\n');
  const old = new Date(Date.now() - 300_000);
  utimesSync(join(dir, 'events.jsonl'), old, old);
  writeFileSync(join(dir, '.heartbeat'), String(Date.now())); // fresh: a hung agent's ticker keeps doing this
  const idle = cycleProgressIdleMs(dir);
  assert.ok(idle !== null && idle >= 299_000, `a fresh heartbeat must not read as progress: idle=${idle}`);
});
