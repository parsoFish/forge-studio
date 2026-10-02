/**
 * Row 184d (forge-8vfn.8.5.24), T1 ruling 1973dz — EARLY DEATH, replayed on
 * the REAL S1 run 6 capture: a turn that EXITED HAVING PUBLISHED its phase is
 * not a turn that published nothing.
 *
 * `test-fixtures/run6-s1-beat11/` is copied verbatim from the red run's own
 * evidence (`_story-red-evidence/S1/2026-10-02T14-15-02-857Z`): the session's
 * `_logs/_architect-<sid>/{turn.pid,events.jsonl,.heartbeat}` (stored under
 * `logs-capture/`, ruling 85's ratchet), the mtimes the runner read before its
 * sweep (`MTIMES.txt`, re-applied below), and the run log's beat-11 lines
 * (`run6-beat11.txt`). The measured timeline:
 *
 *   14:38:38.195  previous (draft) turn ends: `phase=awaiting-verdict`
 *   14:38:41.103  approve-plan "present and enabled" — the beat's LAST press
 *   14:38:41.186  turn.pid rewritten: the finalize turn, spawned by the press
 *   14:38:41.635  `architect.finalize.start`
 *   14:38:41.641  `architect turn end (phase=committed)`; status.json
 *                 `phase: committed` at 41.640 — the product's own word
 *   14:38:41.958  beat RED — `channel-quiet … REAPED … it still carries no
 *                 terminal state`, with the page still on `awaiting-verdict`
 *
 * Row 184c's anchor did its job — nothing fired while the finalize turn was
 * alive. The turn then exited 0.3 s after committing, and the door graced one
 * poll and asked `channelTerminalState`, which only knew `_queue/` states and
 * `event_type=error`: the session's own `end` event (`kind-turn.ts`'s
 * `metadata.phase`) was invisible to it, so a COMMITTED session read as
 * "nothing published". The page polls that session every 2 s
 * (`useArchitectSessionPoll`, `apps/studio/lib/use-architect-session.ts`), so
 * 317 ms after the commit it had not caught up yet — and would have a poll or
 * two later.
 *
 * Liveness is the one thing a file copy cannot carry: pid 3175720 is long
 * gone, so a live stand-in child holds the copied `turn.pid` (mtime
 * re-applied) until the instant the real turn wrote its last line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeAgentChannelDoor } from './beats-agent-proc.mjs';
import { PUBLISHED_TERMINAL_GRACE_MS, STUDIO_SESSION_POLL_MS } from './beats-early-death.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'test-fixtures', 'run6-s1-beat11');
const CHANNEL = '_architect-2026-10-02T14-26-53-f3f34b96';
const at = (iso: string) => Date.parse(iso);
const BEAT_ANCHOR = at('2026-10-02T14:26:54.146Z');
const LAST_PRESS = at('2026-10-02T14:38:41.103Z');
const FINALIZE_END = at('2026-10-02T14:38:41.641Z');
const BEAT_RED = at('2026-10-02T14:38:41.958Z');
const POLL = 100; // CONSEQUENCE_POLL_MS — the consequence wait's own cadence

test('row 184d fixture: the captured run log carries the red this file replays', () => {
  const log = readFileSync(join(FIXTURE, 'run6-beat11.txt'), 'utf8');
  assert.match(log, /\[2026-10-02T14:38:41\.103Z\] .*approve-plan.*present and enabled/);
  assert.match(log, /\[2026-10-02T14:38:41\.958Z\] .*data-architect-phase: expected "committed", got "awaiting-verdict"/);
  assert.match(log, /channel-quiet: the agent channel _architect-2026-10-02T14-26-53-f3f34b96's own process has been REAPED and, one poll later, it still carries no terminal state/);
  const events = readFileSync(join(FIXTURE, 'logs-capture', CHANNEL, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = events[events.length - 1];
  assert.equal(last.event_type, 'end');
  assert.equal(last.metadata.phase, 'committed');
  assert.equal(last.started_at, '2026-10-02T14:38:41.641Z');
});

/** The grace is two of the PAGE's polls — asserted against the product, so the two cannot drift apart. */
test('row 184d: the published-terminal grace is two of the Studio session poll\'s own intervals', () => {
  const src = readFileSync(join(HERE, '..', '..', 'apps', 'studio', 'lib', 'use-architect-session.ts'), 'utf8');
  const m = /intervalMs\s*=\s*(\d[\d_]*)/.exec(src);
  assert.notEqual(m, null, 'useArchitectSessionPoll no longer declares its default intervalMs');
  assert.equal(Number((m as RegExpExecArray)[1].replace(/_/g, '')), STUDIO_SESSION_POLL_MS);
  assert.equal(PUBLISHED_TERMINAL_GRACE_MS, 2 * STUDIO_SESSION_POLL_MS);
});

function stageCapture(livePid: number, asOfMs: number) {
  const root = mkdtempSync(join(tmpdir(), 'early-death-run6-'));
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

test('row 184d (RED before the fix, REAL capture): a turn that exited having published phase=committed gives the page its full grace, then ends as channel-ended — never channel-quiet', async () => {
  const child = liveStandIn();
  const { root, dir } = stageCapture(child.pid as number, LAST_PRESS);
  const door = makeAgentChannelDoor(root) as any;
  assert.notEqual(door, null);

  // While the finalize turn is alive the door holds (row 184c's own rule),
  // events.jsonl growing exactly as the real file did.
  let now = LAST_PRESS + POLL;
  for (; now < FINALIZE_END; now += POLL) {
    writeEventsAsOf(dir, now);
    assert.equal(door.earlyDeath(CHANNEL, BEAT_ANCHOR, null, LAST_PRESS, now), null, `fired at ${new Date(now).toISOString()} while the turn was alive`);
  }
  // 41.641: the turn writes `phase=committed` and exits.
  writeEventsAsOf(dir, FINALIZE_END);
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));

  const verdicts: { now: string; stop: any }[] = [];
  for (; now < FINALIZE_END + PUBLISHED_TERMINAL_GRACE_MS; now += POLL) {
    verdicts.push({ now: new Date(now).toISOString(), stop: door.earlyDeath(CHANNEL, BEAT_ANCHOR, null, LAST_PRESS, now) });
  }
  const fired = verdicts.find((v) => v.stop !== null);
  assert.ok(verdicts.some((v) => Date.parse(v.now) >= BEAT_RED), 'the replay covers the instant the real run reded');
  assert.equal(fired, undefined, `early death judged a COMMITTED session inside the page's own catch-up grace: ${JSON.stringify(fired)}`);

  // Grace spent and the page still not on `committed`: the product's own word, named as such.
  const after = door.earlyDeath(CHANNEL, BEAT_ANCHOR, null, LAST_PRESS, FINALIZE_END + PUBLISHED_TERMINAL_GRACE_MS);
  assert.notEqual(after, null, 'once the grace is spent the door reports');
  assert.equal(after.reason, 'channel-ended');
  assert.match(after.detail, /phase=committed/);
});

test('row 184d (positive control, REAL capture): a finalize turn that dies BEFORE writing a line is still channel-quiet — the draft turn\'s awaiting-verdict predates the press', async () => {
  const child = liveStandIn();
  const { root } = stageCapture(child.pid as number, LAST_PRESS);
  const door = makeAgentChannelDoor(root) as any;
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));

  const verdicts = [];
  for (let now = LAST_PRESS + POLL; now < LAST_PRESS + 1_000; now += POLL) {
    verdicts.push(door.earlyDeath(CHANNEL, BEAT_ANCHOR, null, LAST_PRESS, now));
  }
  const fired = verdicts.find((v) => v !== null);
  assert.notEqual(fired, undefined, 'a turn dead with nothing of its own published still reports within its grace');
  assert.equal(fired.reason, 'channel-quiet');
  assert.match(fired.detail, /awaiting-verdict.*predates/);
});

test('row 184d (REAL capture): a newer turn\'s `start` hides its predecessor\'s published phase — mid-finalize the channel is open', async () => {
  const { channelTerminalState } = await import('./beats-queue-terminal.mjs');
  // 41.635: `architect turn (phase=finalizing)` has started, its `end` not yet written.
  const { root, dir } = stageCapture(999_999, at('2026-10-02T14:38:41.640Z'));
  assert.equal(channelTerminalState(root, dir), null, 'the draft turn\'s awaiting-verdict is not the finalize turn\'s word');
  writeEventsAsOf(dir, FINALIZE_END);
  const t = channelTerminalState(root, dir) as any;
  assert.equal(t.state, 'phase=committed');
  assert.equal(t.atMs, FINALIZE_END);
});
