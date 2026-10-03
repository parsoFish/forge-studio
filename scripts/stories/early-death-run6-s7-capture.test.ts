/**
 * Row 197 (forge-8vfn.8.5.35), T1 rulings 1973gh/gj — EARLY DEATH, replayed
 * on the REAL S7 run 6 capture: an agent RUN that exited having written its
 * own run-level `end` is not a run that published nothing.
 *
 * `test-fixtures/run6-s7-beat24/` is copied verbatim from the red run's own
 * evidence (`S7-red-evidence/_logs/_agent-brain-ingest-…-tjs6`): the channel's
 * `turn.pid`, `events.jsonl` and `agent-run.marker` (stored under
 * `logs-capture/`, ruling 85's ratchet), the mtimes the runner read before its
 * sweep (`MTIMES.txt`, re-applied below), and the run log's beat-24 lines
 * (`run6-beat24.txt`). The measured timeline:
 *
 *   21:28:13.745  turn.pid written — the brain-ingest run beat 23 pressed
 *   21:28:13.990  beat 24 ("Wait for the run to end", no-do) starts — its
 *                 press anchor is its own start (`beats-drive.mjs`)
 *   21:28:14.390  `brain-ingest start` (initiative_id = the dir's own id)
 *   21:28:23.161  SessionEnd hook `start` (skill `hook:story-s7-hook`)
 *   21:28:23.166  the hook's own `end` + `hook.fire`
 *   21:28:23.167  `brain-ingest end`, priced — the run's own terminal word
 *   21:28:23.537  beat RED — `data-run-status: expected "done", got
 *                 "running"` + `channel-quiet … REAPED … no terminal state`
 *
 * Row 184d taught `channelTerminalState` a PHASED turn end (`metadata.phase`,
 * a session's `kind-turn.ts`), so a session's page gets
 * `PUBLISHED_TERMINAL_GRACE_MS` after its terminal. A generic agent run's own
 * `end` (`run-agent.ts`'s `logger.emit({ event_type: 'end', skill: def.slug
 * })`) carries no phase, so it was invisible: the door reded 0.37 s after the
 * run ended, before the page's next poll could show `done`. And reading it
 * backwards, the hook's own `start` stood between the run end and the reader.
 *
 * Liveness is the one thing a file copy cannot carry: pid 3972015 is long
 * gone, so a live stand-in child holds the copied `turn.pid` (mtime
 * re-applied) until the instant the real run wrote its last line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeAgentChannelDoor } from './beats-agent-proc.mjs';
import { PUBLISHED_TERMINAL_GRACE_MS } from './beats-early-death.mjs';
import { channelTerminalState } from './beats-queue-terminal.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'test-fixtures', 'run6-s7-beat24');
const CHANNEL = '_agent-brain-ingest-2026-10-02T21-28-13-741-tjs6';
const at = (iso: string) => Date.parse(iso);
const BEAT_START = at('2026-10-02T21:28:13.990Z'); // anchor AND press: a no-do beat acted on nothing
const HOOK_END = at('2026-10-02T21:28:23.166Z');
const RUN_END = at('2026-10-02T21:28:23.167Z');
const BEAT_RED = at('2026-10-02T21:28:23.537Z');
const POLL = 100; // CONSEQUENCE_POLL_MS — the consequence wait's own cadence

test('row 197 fixture: the captured run log carries the red this file replays', () => {
  const log = readFileSync(join(FIXTURE, 'run6-beat24.txt'), 'utf8');
  assert.match(log, /\[2026-10-02T21:28:13\.990Z\] {3}✓ 23\. Run the agent/);
  assert.match(log, /\[2026-10-02T21:28:23\.537Z\] .*data-run-status: expected "done", got "running"/);
  assert.match(log, /channel-quiet: the agent channel _agent-brain-ingest-2026-10-02T21-28-13-741-tjs6's own process has been REAPED and, one poll later, it still carries no terminal state/);
  const events = readFileSync(join(FIXTURE, 'logs-capture', CHANNEL, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = events[events.length - 1];
  assert.equal(last.event_type, 'end');
  assert.equal(last.skill, 'brain-ingest');
  assert.equal(last.initiative_id, CHANNEL);
  assert.equal(last.started_at, '2026-10-02T21:28:23.167Z');
  assert.equal(last.metadata?.phase, undefined, 'a run-level end carries no phase — row 184d alone cannot see it');
  const hookEnd = events.find((e) => e.event_type === 'end' && e.skill === 'hook:story-s7-hook');
  assert.equal(hookEnd?.initiative_id, CHANNEL, 'the nested hook stamps the SAME id — skill is the only discriminator');
});

function stageCapture(livePid: number, asOfMs: number) {
  const root = mkdtempSync(join(tmpdir(), 'early-death-run6-s7-'));
  cpSync(join(FIXTURE, 'logs-capture'), join(root, '_logs'), { recursive: true });
  const dir = join(root, '_logs', CHANNEL);
  writeEventsAsOf(dir, asOfMs);
  writeFileSync(join(dir, 'turn.pid'), `${livePid}\n`);
  for (const line of readFileSync(join(FIXTURE, 'MTIMES.txt'), 'utf8').split('\n')) {
    const m = /^(\S+)\s+(_logs\/\S+)$/.exec(line.trim());
    if (m === null || m[2].endsWith('stderr.log')) continue; // stderr.log (empty) is not part of the copy
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

/** Drive the door while the run is alive, its events growing exactly as the real file did, then reap it at `diesAt`. */
async function replayUntilDeath(diesAt: number) {
  const child = liveStandIn();
  const { root, dir } = stageCapture(child.pid as number, BEAT_START);
  const door = makeAgentChannelDoor(root) as any;
  assert.notEqual(door, null);
  let now = BEAT_START + POLL;
  for (; now < diesAt; now += POLL) {
    writeEventsAsOf(dir, now);
    assert.equal(door.earlyDeath(CHANNEL, BEAT_START, null, BEAT_START, now), null, `fired at ${new Date(now).toISOString()} while the run was alive`);
  }
  writeEventsAsOf(dir, diesAt);
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
  return { root, dir, door, now };
}

test('row 197 (RED before the fix, REAL capture): a run that exited having written its own end gives the page its full grace, then ends as channel-ended — never channel-quiet', async () => {
  const { door, now: from } = await replayUntilDeath(RUN_END);
  const verdicts: { now: string; stop: any }[] = [];
  for (let now = from; now < RUN_END + PUBLISHED_TERMINAL_GRACE_MS; now += POLL) {
    verdicts.push({ now: new Date(now).toISOString(), stop: door.earlyDeath(CHANNEL, BEAT_START, null, BEAT_START, now) });
  }
  assert.ok(verdicts.some((v) => Date.parse(v.now) >= BEAT_RED), 'the replay covers the instant the real run reded');
  const fired = verdicts.find((v) => v.stop !== null);
  assert.equal(fired, undefined, `early death judged a FINISHED run inside the page's own catch-up grace: ${JSON.stringify(fired)}`);

  // Grace spent and the page still not on `done`: the product's own word, named as such.
  const after = door.earlyDeath(CHANNEL, BEAT_START, null, BEAT_START, RUN_END + PUBLISHED_TERMINAL_GRACE_MS);
  assert.notEqual(after, null, 'once the grace is spent the door reports');
  assert.equal(after.reason, 'channel-ended');
  assert.match(after.detail, /brain-ingest.*end.*2026-10-02T21:28:23\.167Z/);
});

test('row 197 (negative, REAL capture): the nested hook\'s own end is NOT the run\'s terminal — a run reaped right after its SessionEnd hook is still channel-quiet', async () => {
  const { root, dir, door, now: from } = await replayUntilDeath(HOOK_END);
  assert.equal(channelTerminalState(root, dir), null, 'a hook:* end stamped with the channel\'s id is not the run\'s own end');
  const verdicts = [];
  for (let now = from; now < HOOK_END + 1_000; now += POLL) {
    verdicts.push(door.earlyDeath(CHANNEL, BEAT_START, null, BEAT_START, now));
  }
  const fired = verdicts.find((v) => v !== null);
  assert.notEqual(fired, undefined, 'a run dead with only its hook\'s end written still reports within one grace poll');
  assert.equal(fired.reason, 'channel-quiet');
});

test('row 197 (REAL capture): the run\'s own end is read with its own fine timestamp, and an end that predates the press is the previous run\'s', async () => {
  const { root, dir } = stageCapture(999_999, RUN_END);
  const t = channelTerminalState(root, dir) as any;
  assert.equal(t.state, 'end');
  assert.equal(t.atMs, RUN_END);
  // A press AFTER the run ended: the door's own pre-press rule (row 184d) keeps that end the previous run's word.
  const door = makeAgentChannelDoor(root) as any;
  const press = RUN_END + 1_000;
  let fired = null;
  for (let now = press + POLL; fired === null && now < press + 2_000; now += POLL) {
    fired = door.earlyDeath(CHANNEL, BEAT_START, null, press, now);
  }
  // turn.pid was born before this later press, so the door does not judge this dir at all (row 184b).
  assert.equal(fired, null);
  writeFileSync(join(dir, 'turn.pid'), '999999\n'); // a fresh turn.pid, born after the press, whose run wrote nothing new
  const late = makeAgentChannelDoor(root) as any;
  const pressNow = Date.now();
  let quiet = null;
  for (let now = pressNow + 2 * 200; quiet === null && now < pressNow + 2_000; now += POLL) {
    quiet = late.earlyDeath(CHANNEL, BEAT_START, null, pressNow, now);
  }
  assert.notEqual(quiet, null);
  assert.equal(quiet.reason, 'channel-quiet');
  assert.match(quiet.detail, /predates this beat's press/);
});
