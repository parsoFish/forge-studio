/**
 * Row 184c (forge-8vfn.8.5.22) — EARLY DEATH, replayed on the REAL S1 run 5
 * capture, not a synthetic dir.
 *
 * `test-fixtures/run5-s1-beat11/` is copied verbatim from the red run's own
 * evidence (`_story-red-evidence/S1/2026-10-02T13-30-48-044Z`): the session's
 * `_logs/_architect-<sid>/{turn.pid,events.jsonl,.heartbeat}` (stored under
 * `logs-capture/`), the mtimes the
 * runner read before its sweep (`MTIMES.txt`, re-applied below), and the
 * run log's beat-11 lines (`run5-beat11.txt`). The measured timeline:
 *
 *   13:42:51.972  beat 11 starts (`pressStartedMs`, the wait's ANCHOR)
 *   13:55:25.165  previous turn ends: `phase=awaiting-verdict`
 *   13:55:27.695  approve-plan "present and enabled" — the beat's LAST press
 *   13:55:27.774  turn.pid rewritten: the finalize turn, spawned by the press
 *   13:55:28.129  beat RED — `channel-quiet … REAPED … 0s into the agent wait`
 *   13:55:28.303  the finalize turn's FIRST event (`phase=finalizing`)
 *   13:55:28.309  `phase=committed`
 *
 * The finalize turn was ALIVE at 28.129 — it wrote its own events 174 ms
 * later — but its events.jsonl had not grown since 25.165, and
 * `classifyUnmeasuredDispatch` calls an alive pid over a static log `reaped`.
 * Two static reads (one "free" grace poll) inside the 529 ms between spawn
 * and first event ended the wait. PR #1060's birth rule could not catch it:
 * the turn WAS born after the anchor, and after the press too.
 *
 * The one thing a file copy cannot carry is liveness: pid 2777163 is long
 * gone. A live stand-in child is spawned and its pid written into the copied
 * `turn.pid` (mtime re-applied), so `kill(pid, 0)` answers exactly as it did
 * at 28.129. The page is not modelled at all — the door is driven directly,
 * at the run's own clock, through `makeAgentChannelDoor`'s real resolution
 * (the page named the run: `data-run="_architect-…-e20207b9"` in
 * beat-11-dom.html).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeAgentChannelDoor } from './beats-agent-proc.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'test-fixtures', 'run5-s1-beat11');
const CHANNEL = '_architect-2026-10-02T13-42-51-e20207b9';
const at = (iso: string) => Date.parse(iso);
const BEAT_ANCHOR = at('2026-10-02T13:42:51.972Z');
const LAST_PRESS = at('2026-10-02T13:55:27.695Z');
const BEAT_RED = at('2026-10-02T13:55:28.129Z');
const FINALIZE_FIRST_EVENT = at('2026-10-02T13:55:28.303Z');

/** The captured run log is the source of the timeline above — asserted, not assumed. */
test('row 184c fixture: the captured run log carries the red this file replays', () => {
  const log = readFileSync(join(FIXTURE, 'run5-beat11.txt'), 'utf8');
  assert.match(log, /\[2026-10-02T13:55:27\.695Z\] .*approve-plan.*present and enabled/);
  assert.match(log, /\[2026-10-02T13:55:28\.129Z\] .*✗ 11\. Open the session, read the plan and press Approve/);
  assert.match(log, /channel-quiet: the agent channel _architect-2026-10-02T13-42-51-e20207b9's own process has been REAPED.*0s into the agent wait/);
});

/** Copy the capture into a fresh forge root, holding events.jsonl as it stood at `asOfMs`. */
function stageCapture(livePid: number, asOfMs: number) {
  const root = mkdtempSync(join(tmpdir(), 'early-death-run5-'));
  // Stored as `logs-capture/`, never a tracked nested `_logs/` (ruling 85's ratchet).
  cpSync(join(FIXTURE, 'logs-capture'), join(root, '_logs'), { recursive: true });
  const dir = join(root, '_logs', CHANNEL);
  writeEventsAsOf(dir, asOfMs);
  writeFileSync(join(dir, 'turn.pid'), `${livePid}\n`);
  for (const line of readFileSync(join(FIXTURE, 'MTIMES.txt'), 'utf8').split('\n')) {
    const m = /^(\S+)\s+(_logs\/\S+)$/.exec(line.trim());
    if (m === null || m[2].endsWith('stderr.log')) continue; // stderr.log is not part of the copy
    const when = new Date(m[1]);
    utimesSync(join(root, m[2]), when, when);
  }
  return { root, dir };
}

/** events.jsonl is append-only, so its state at `asOfMs` is the prefix of lines started at or before it. */
function writeEventsAsOf(dir: string, asOfMs: number) {
  const lines = readFileSync(join(FIXTURE, 'logs-capture', CHANNEL, 'events.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '');
  const kept = [];
  for (const line of lines) {
    if (Date.parse(JSON.parse(line).started_at) > asOfMs) break;
    kept.push(line);
  }
  writeFileSync(join(dir, 'events.jsonl'), `${kept.join('\n')}\n`);
}

function liveStandIn() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' });
  assert.ok(typeof child.pid === 'number');
  return child;
}

test('row 184c (RED before the fix, REAL capture): the finalize turn the press started is never called reaped while it is alive and has not written yet', async (t) => {
  const child = liveStandIn();
  t.after(() => child.kill('SIGKILL'));
  const { root } = stageCapture(child.pid as number, BEAT_RED);
  const door = makeAgentChannelDoor(root) as any;
  assert.notEqual(door, null);

  // The consequence wait's own polls (CONSEQUENCE_POLL_MS = 100 ms), from
  // just after the press up to the instant before the finalize turn's first
  // event — every one of them sees the state the red read: an alive pid, a
  // turn.pid born after the press, and an events.jsonl static since 25.165.
  const verdicts = [];
  for (let now = LAST_PRESS + 100; now < FINALIZE_FIRST_EVENT; now += 100) {
    verdicts.push({ now: new Date(now).toISOString(), stop: door.earlyDeath(CHANNEL, BEAT_ANCHOR, null, LAST_PRESS, now) });
  }
  const fired = verdicts.find((v) => v.stop !== null);
  assert.equal(fired, undefined, `early death ended the wait on an ALIVE finalize turn before it wrote a line: ${JSON.stringify(fired)}`);
});

test('row 184c (positive control, REAL capture): once that turn has genuinely exited, the door still reports within its grace', async () => {
  const child = liveStandIn();
  const { root, dir } = stageCapture(child.pid as number, BEAT_RED);
  const door = makeAgentChannelDoor(root) as any;
  let now = LAST_PRESS + 100;
  for (; now < FINALIZE_FIRST_EVENT; now += 100) assert.equal(door.earlyDeath(CHANNEL, BEAT_ANCHOR, null, LAST_PRESS, now), null);

  // The finalize turn writes its real lines and exits.
  writeEventsAsOf(dir, at('2026-10-02T13:55:28.309Z'));
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));

  const after = [];
  for (let i = 0; i < 3; i += 1, now += 100) after.push(door.earlyDeath(CHANNEL, BEAT_ANCHOR, null, LAST_PRESS, now));
  assert.equal(after[0], null, 'one dead reading proves nothing — the first gets its free poll');
  assert.notEqual(after[1], null, 'graced once and still dead: the door reports');
  assert.match(after[1].detail, /REAPED/);
});

test('row 184c (T1 1973dv): early death never fires inside two poll intervals of the beat\'s last press, nor on a turn born before it', async (t) => {
  const child = liveStandIn();
  t.after(() => child.kill('SIGKILL'));
  // The DRAFT turn's reading, the instant before the press's spawn: its
  // turn.pid (born ~13:45:32.6, long after the beat's anchor, so #1060's
  // anchor-at-beat-start rule let it through) names a dead pid.
  const { root, dir } = stageCapture(999_999, at('2026-10-02T13:55:25.200Z'));
  const born = new Date('2026-10-02T13:45:32.600Z');
  utimesSync(join(dir, 'turn.pid'), born, born);
  const door = makeAgentChannelDoor(root) as any;
  for (let now = LAST_PRESS + 50; now < LAST_PRESS + 1_000; now += 50) {
    assert.equal(door.earlyDeath(CHANNEL, BEAT_ANCHOR, null, LAST_PRESS, now), null, `fired at +${now - LAST_PRESS} ms on the previous turn`);
  }
});
