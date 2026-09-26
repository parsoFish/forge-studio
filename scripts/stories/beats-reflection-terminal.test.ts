/**
 * The REFLECTION door — bead `forge-8vfn.8.1.31`, T1 ruling 1693, S10 proof
 * run 35 ("Reflect on the cycle").
 *
 * WHAT RUN 35 MEASURED. Beat 21 pressed `open-reflect`/`submit-reflection`
 * and waited for `[data-action="submit-reflection"]`. At 23:03:15 the runner
 * stopped it: "the agent channel <cycleId> ENDED — the product moved
 * INIT-… into _queue/merged/ and its last event is start. It has been quiet
 * 180s … the product had already published its verdict". But the post-merge
 * reflector had started at 23:00:15 (`reflector.start`) and was STILL
 * RUNNING — a separate row was adding its heartbeats the whole time. `merged`
 * is the PRECONDITION for reflection (`finalize-merged.ts`: closure moves the
 * manifest into `merged/` and only fires the reflector AFTER that, promoting
 * on to `done/` only once reflection has resolved), never its terminal.
 *
 * THE FIRST TEST BELOW reproduces the MECHANISM: `channelTerminalState`
 * (`beats-queue-terminal.mjs`) knows only `_queue/` states, so it correctly,
 * generically, reads `merged` as terminal — that is exactly right for every
 * beat that is NOT watching a reflection. `makeAgentChannelDoor` turns that
 * into `channel-ended` the instant the channel goes quiet, whatever it is
 * quiet ABOUT. That is the defect surface this ruling closes for a reflect
 * beat specifically, by giving it a door that never asks the queue at all.
 *
 * `makeReflectionDoor` reads the SAME cycle dir `cycleDirForInitiative`
 * resolves for every other `cycleOf` wait — the reflector runs inside the
 * SAME cycle process and appends to the SAME `events.jsonl` — for its own
 * three terminal messages: `reflector.end`, `reflector.crashed` and
 * `cycle.reflection-lost`. UNKNOWN (no cycle dir yet, an unreadable one, or
 * one with none of the three) never resolves toward proceeding: `null`, the
 * identical shape `makeCycleTerminalDoor` returns for "nothing resolved this
 * poll" (§15.504).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { makeReflectionDoor, makeReflectionWatch, REFLECTION_TERMINAL_STATE, STALL_CEILING_MS } from './beats-agent-proc.mjs';
import { channelTerminalState } from './beats-queue-terminal.mjs';

const INIT = 'INIT-2026-09-25-exclude-author-flag';

function cycleRoot(): { root: string; logs: string } {
  const root = mkdtempSync(join(tmpdir(), 'story-reflection-terminal-'));
  const logs = join(root, '_logs');
  mkdirSync(logs, { recursive: true });
  return { root, logs };
}

/** The beat's anchor in these fixtures: after the develop cycle merged, before the reflector ran. */
const ANCHOR = Date.parse('2026-09-25T23:00:00.000Z');

/** A develop cycle's own dir, `<ISO-ts>_<initiative>` — the SAME dir
 *  `cycleDirForInitiative` resolves by identity, and the SAME dir the
 *  reflector appends its own events to (`finalize-merged.ts`'s
 *  `latestCycleId` names the identical `_${initiativeId}`-suffixed entry). */
function cycleDir(logs: string, initiative: string, startedAtIso: string): string {
  const dir = join(logs, `2026-09-25T23-00-00_${initiative}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'events.jsonl'),
    `${JSON.stringify({ phase: 'orchestrator', event_type: 'start', message: 'cycle.start', started_at: startedAtIso })}\n`,
  );
  return dir;
}
function appendEvent(dir: string, message: string, whenIso: string): void {
  appendFileSync(
    join(dir, 'events.jsonl'),
    `${JSON.stringify({ phase: 'reflection', event_type: 'log', message, started_at: whenIso })}\n`,
  );
}
function queueFile(root: string, state: string, initiative: string): void {
  mkdirSync(join(root, '_queue', state), { recursive: true });
  writeFileSync(join(root, '_queue', state, `${initiative}.md`), '# an initiative\n');
}

test('the OLD generic reading — the defect this door replaces: `merged` looks terminal to a door that knows only queue states', () => {
  const { root, logs } = cycleRoot();
  const dir = cycleDir(logs, INIT, '2026-09-25T22:58:00.000Z');
  // The reflector's own `reflector.start` emit (`packages/stations/phases/
  // reflector.ts:114`) carries `event_type: 'start'` — the SAME shape run 35's
  // own log line named ("its last event is start").
  appendFileSync(
    join(dir, 'events.jsonl'),
    `${JSON.stringify({ phase: 'reflection', event_type: 'start', message: 'reflector.start', started_at: '2026-09-25T23:00:15.000Z' })}\n`,
  );
  queueFile(root, 'merged', INIT);

  const terminal = channelTerminalState(root, dir)!;
  assert.equal(terminal.state, 'merged', 'the generic door has no concept of reflection — merged reads as THE terminal to it');
  assert.match(terminal.detail, /last event is start/, 'run 35\'s own wording: the last event was the reflector STARTING, not a verdict');
});

test("T1 1693 (a): run 35's shape — merged, reflector.start after it, quiet past the stall ceiling, no end yet — keeps waiting", () => {
  const { root, logs } = cycleRoot();
  const dir = cycleDir(logs, INIT, '2026-09-25T22:58:00.000Z');
  appendEvent(dir, 'reflector.start', '2026-09-25T23:00:15.000Z');
  queueFile(root, 'merged', INIT);
  // Backdate events.jsonl's mtime past the stall ceiling — a SILENCE-based door
  // would fire here. The reflection door must not care: it never asks about
  // quiet, only about the reflector's own three terminal messages.
  const oldMs = Date.now() - (STALL_CEILING_MS + 20_000);
  utimesSync(join(dir, 'events.jsonl'), oldMs / 1000, oldMs / 1000);

  const door = makeReflectionDoor(root, INIT)!;
  const seen = door(null, ANCHOR, REFLECTION_TERMINAL_STATE);
  assert.equal(seen, null, 'no reflector.end/crashed/reflection-lost yet — the wait must not end, quiet or not');
  assert.equal(door.sawCycle, true, 'the cycle dir IS resolved — this is "found, still open", never "nothing found"');
  assert.match(door.lastSeen, /reflector\.end/);
  assert.match(door.lastSeen, /reflector\.crashed/);
  assert.match(door.lastSeen, /reflection-lost/);
});

test("T1 1693 (b): a reflector.end after merged is the reflection's own terminal — done", () => {
  const { root, logs } = cycleRoot();
  const dir = cycleDir(logs, INIT, '2026-09-25T22:58:00.000Z');
  queueFile(root, 'merged', INIT);
  appendEvent(dir, 'reflector.start', '2026-09-25T23:00:15.000Z');
  appendEvent(dir, 'reflector.end', '2026-09-25T23:04:40.000Z');

  const door = makeReflectionDoor(root, INIT)!;
  const seen = door(null, ANCHOR, REFLECTION_TERMINAL_STATE)!;
  assert.equal(seen.done, true, seen.detail);
  assert.equal(seen.state, REFLECTION_TERMINAL_STATE);
  assert.match(seen.detail, /reflector\.end/);
});

test('T1 1693 (c): reflector.crashed is the reflection\'s own terminal too — NOT the wanted state, and named through the watch as an early, named stop', () => {
  const { root, logs } = cycleRoot();
  const dir = cycleDir(logs, INIT, '2026-09-25T22:58:00.000Z');
  queueFile(root, 'merged', INIT);
  appendEvent(dir, 'reflector.start', '2026-09-25T23:00:15.000Z');
  appendEvent(dir, 'reflector.crashed', '2026-09-25T23:02:05.000Z');

  const door = makeReflectionDoor(root, INIT)!;
  const seen = door(null, ANCHOR, REFLECTION_TERMINAL_STATE)!;
  assert.equal(seen.done, false, 'crashed is a terminal, but it is not `reflected`');
  assert.equal(seen.state, 'crashed');
  assert.match(seen.detail, /reflector\.crashed/);

  // Through the watch this is an EARLY, NAMED stop — never a generic timeout —
  // exactly the shape `beats-drive.mjs`'s `named()` appends to a red beat's
  // failures, so the crash is what a reader sees, not "gave up at 900000 ms".
  const watch = makeReflectionWatch(root, INIT)!;
  const stop = watch(null, ANCHOR)!;
  assert.equal(stop.reason, 'cycle-ended');
  assert.match(stop.detail, /crashed/, 'the crash is named, not swallowed into a generic timeout');
});

test('T1 1693: cycle.reflection-lost is read the same way as a crash', () => {
  const { root, logs } = cycleRoot();
  const dir = cycleDir(logs, INIT, '2026-09-25T22:58:00.000Z');
  queueFile(root, 'merged', INIT);
  appendEvent(dir, 'cycle.reflection-lost', '2026-09-25T23:05:00.000Z');

  const door = makeReflectionDoor(root, INIT)!;
  const seen = door(null, ANCHOR, REFLECTION_TERMINAL_STATE)!;
  assert.equal(seen.done, false);
  assert.equal(seen.state, 'lost');
  assert.match(seen.detail, /reflection-lost/);
});

test('T1 1693: a rerun RECOVERS from an earlier crash — the LAST event in log order wins', () => {
  const { root, logs } = cycleRoot();
  const dir = cycleDir(logs, INIT, '2026-09-25T22:58:00.000Z');
  appendEvent(dir, 'reflector.crashed', '2026-09-25T23:02:05.000Z');
  appendEvent(dir, 'reflector.start', '2026-09-26T00:00:00.000Z'); // boot-reconcile rerun
  appendEvent(dir, 'reflector.end', '2026-09-26T00:03:00.000Z');

  const door = makeReflectionDoor(root, INIT)!;
  const seen = door(null, ANCHOR, REFLECTION_TERMINAL_STATE)!;
  assert.equal(seen.done, true, 'the LATER reflector.end recovers the earlier crash — a stale crash must not win');
});

test('T1 1693 (d): no reflector run ever appears — the door names what it saw, never a silent "still open"', () => {
  const { root, logs } = cycleRoot();
  cycleDir(logs, INIT, '2026-09-25T22:58:00.000Z'); // dev/review only, never reflects
  queueFile(root, 'merged', INIT);

  const door = makeReflectionDoor(root, INIT)!;
  assert.equal(door(null, ANCHOR, REFLECTION_TERMINAL_STATE), null);
  assert.match(door.lastSeen, /no reflector\.end/);
  assert.match(door.lastSeen, /event since the anchor/);

  // No cycle dir at all — an initiative that never even started developing.
  const bare = makeReflectionDoor(root, 'INIT-nothing-here')!;
  assert.equal(bare(null, Date.now(), REFLECTION_TERMINAL_STATE), null);
  assert.match(bare.lastSeen, /no cycle directory found yet/);
});

test(
  'T1 1693: an unreadable events.jsonl is UNKNOWN, never a silent "still open" (§15.504)',
  { skip: process.getuid?.() === 0 ? 'root reads mode-000 files' : false },
  () => {
    const { root, logs } = cycleRoot();
    const dir = cycleDir(logs, INIT, '2026-09-25T22:58:00.000Z');
    chmodSync(join(dir, 'events.jsonl'), 0o000);
    try {
      const door = makeReflectionDoor(root, INIT)!;
      assert.equal(door(null, Date.now(), REFLECTION_TERMINAL_STATE), null, 'a read that could not happen must not resolve toward proceeding');
      assert.match(door.lastSeen, /could not read/);
    } finally {
      chmodSync(join(dir, 'events.jsonl'), 0o644); // so tmp cleanup can delete it
    }
  },
);

test('makeReflectionDoor/-Watch guard their inputs the same way every other opt-in door does', () => {
  assert.equal(makeReflectionDoor('', 'INIT-x'), null, 'no forgeRoot');
  assert.equal(makeReflectionDoor('/root', ''), null, 'no cycleOf');
  assert.equal(makeReflectionWatch('/root', null), null, 'an unresolved cycleOf leaves the watch inert, never a new way for a beat to fail');
});

test("D's review (row 125's class): a reflector.end BEFORE the anchor is an earlier round's", () => {
  const { root, logs } = cycleRoot();
  const dir = cycleDir(logs, INIT, '2026-09-25T22:58:00.000Z');
  appendEvent(dir, 'reflector.end', '2026-09-25T22:59:30.000Z');

  const door = makeReflectionDoor(root, INIT)!;
  const early = door(null, ANCHOR, REFLECTION_TERMINAL_STATE);
  assert.equal(early, null, 'a pre-anchor terminal must not end this wait');
  assert.match(door.lastSeen, /since the anchor/);

  appendEvent(dir, 'reflector.end', '2026-09-25T23:04:40.000Z');
  const seen = door(null, ANCHOR, REFLECTION_TERMINAL_STATE)!;
  assert.equal(seen.done, true, 'the post-anchor reflector.end is this reflection\'s terminal');
});

test("D's review: an unparseable started_at is skipped, never counted", () => {
  const { root, logs } = cycleRoot();
  const dir = cycleDir(logs, INIT, '2026-09-25T22:58:00.000Z');
  appendEvent(dir, 'reflector.end', 'not-a-timestamp');

  const door = makeReflectionDoor(root, INIT)!;
  assert.equal(door(null, ANCHOR, REFLECTION_TERMINAL_STATE), null);
});
