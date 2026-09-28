/**
 * ROW 162 (S10 run 42, bead `forge-8vfn.8.1.49`, T1 ruling 1898) — the agent
 * channel door accepts the BOUND RUN's existing dispatch folder, proven by an
 * event after the press, never by directory birth time or "no fresher dir
 * turned up".
 *
 * THE INCIDENT. S10.act2.mjs beat 50 (`tests/stories/S10.act2.mjs:751`)
 * presses `resume-run` and waits `{ for: 'agent', anchor: 'resume-run' }` on
 * `/flows/forge-develop` — the flow monitor, which never publishes `data-run`
 * on `main[data-page]` (`beats-page.mjs`'s `readRunId` reads only that
 * element; the monitor's selected-run id lives on `RunControls`' NESTED
 * `data-run-id`). Run 42 doored `no-channel` at 175 s: the resume continued
 * the run's EXISTING dispatch dir, born long before this beat's own anchor —
 * invisible to `newestChannelSince`'s born-after-the-anchor scan — while the
 * product had already appended a fresh `cycle.start` six seconds after the
 * press. The product resumed correctly; only the door's own evidence was
 * wrong.
 *
 * THE FIX. `makeAgentChannelDoor` (`beats-agent-proc.mjs`) now takes a third
 * argument, `boundRunId` — the story's OWN already-bound run id, threaded
 * from `beat.expect.data['run-id']` + `bindings` (`resolveBoundRunId`,
 * `beats.mjs`) through `waitForConsequence` (`beats-page.mjs`) — and resolves
 * it BY IDENTITY (`runLogDir`, an exact `_logs/` join, never a scan). A
 * resolved dir is accepted ONLY on a POSITIVE SIGNAL: an event in its own
 * `events.jsonl` timestamped at or after the anchor (`channelProvenSince`).
 * Existing is never enough, and a wrong bound id never borrows another run's
 * own evidence.
 *
 * A NOTE ON WHAT THESE TESTS CAN AND CANNOT PROVE AGAINST REAL TIME.
 * `beats-offsession-stall.test.ts`'s own "626" test already states the limit:
 * a directory's birth time cannot be back-dated (`utimes` moves mtime/atime
 * only), so a fixture cannot stage "a dispatch born before a press that is
 * itself older than the stall ceiling" without a real three-minute wait. That
 * means the "channel found and healthy" shape below cannot be shown to
 * discriminate old code from new (a pre-fix door would, by fixture accident,
 * find the SAME directory via the born-after-the-anchor scan and read it as
 * fresh) — it is a CONTROL, not a red/green pair. The "no qualifying event
 * yet" and "wrong bound id" shapes do NOT share that limitation: a stale
 * PRE-anchor event's timestamp is CONTENT, not a filesystem stamp, so a
 * pre-fix door still finds the fixture's own directory by the same accident
 * and reports it healthy — which is the wrong answer, and exactly the
 * defect these two exist to catch. Verified empirically (see the report this
 * change ships with), not merely reasoned about.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { STALL_CEILING_MS, makeAgentChannelDoor } from './beats-agent-proc.mjs';
import { waitForConsequence } from './beats-page.mjs';
import { resolveBoundRunId } from './beats.mjs';

/** Same fixture shape as `beats-offsession-stall.test.ts`'s own `realDoor()`:
 *  a real `_logs` tree and the real door, never a stand-in. */
function realDoor() {
  const root = mkdtempSync(join(tmpdir(), 'forge-resume-channel-'));
  mkdirSync(join(root, '_logs'), { recursive: true });
  return { root, logs: join(root, '_logs'), door: makeAgentChannelDoor(root)! };
}

/** Row 162's own run id shape: `<ISO-dashes>_<initiativeId>` — the exact
 *  `_logs/` dispatch dir name, which IS what the product's `run.id` carries
 *  (`packages/flows/run-model.ts`'s own `cycleId format` comment). */
const RUN_ID = '2026-09-28T02-16-30_INIT-2026-09-28-coupling-sort-flag';

function writeEvent(dir: string, message: string, startedAtMs: number) {
  const line = JSON.stringify({ message, started_at: new Date(startedAtMs).toISOString() });
  writeFileSync(join(dir, 'events.jsonl'), `${line}\n`);
}

test('ROW 162 (control): a bound run proven by a post-anchor event is not doored — run 42\'s shape', () => {
  const { logs, door } = realDoor();
  const dispatch = join(logs, RUN_ID);
  mkdirSync(dispatch, { recursive: true });
  const pressedAt = Date.now() - (STALL_CEILING_MS + 5_000);
  // Run 42's own timeline: `cycle.start` six seconds after the press.
  writeEvent(dispatch, 'cycle.start', pressedAt + 6_000);

  const stop = door(null, pressedAt, RUN_ID);
  assert.equal(stop, null, 'a proven bound run must not door no-channel');
});

test('ROW 162 (RED before the fix): a bound run with NO event since the press still doors no-channel', () => {
  const { logs, door } = realDoor();
  const dispatch = join(logs, RUN_ID);
  mkdirSync(dispatch, { recursive: true });
  const pressedAt = Date.now() - (STALL_CEILING_MS + 5_000);
  // An event exists, but it is from BEFORE the press — the paused run's own
  // history, not evidence the resume produced anything at all. This is
  // CONTENT, so it discriminates cleanly: a pre-fix door falls straight to
  // `newestChannelSince`, which finds this exact directory anyway (its real
  // fs birth is "just now", after any past `sinceMs` a fixture can construct)
  // and reads its freshly-written file as healthy — the SAME false "all
  // clear" row 162 measured, just produced by accident here instead of by a
  // genuinely aged dispatch dir.
  writeEvent(dispatch, 'wi.complete', pressedAt - 120_000);

  const stop = door(null, pressedAt, RUN_ID);
  assert.notEqual(stop, null, 'a bound run cannot be accepted on the strength of merely existing');
  assert.equal(stop!.reason, 'no-channel');
  assert.match(stop!.detail, /the bound run/, stop!.detail);
  assert.match(stop!.detail, new RegExp(RUN_ID.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')), stop!.detail);

  // Before the ceiling it says nothing, exactly like every other shape of
  // this door — a bound run is allowed to take a moment before its resume
  // writes anything at all.
  assert.equal(door(null, Date.now() - 1_000, RUN_ID), null);
});

test('ROW 162 (RED before the fix): a DIFFERENT run\'s dir never satisfies this beat\'s own bound id', () => {
  const { logs, door } = realDoor();
  const someoneElse = join(logs, '2026-09-28T02-00-00_INIT-an-unrelated-initiative');
  mkdirSync(someoneElse, { recursive: true });
  const pressedAt = Date.now() - (STALL_CEILING_MS + 5_000);
  writeEvent(someoneElse, 'cycle.start', pressedAt + 1_000);

  // RUN_ID's own dir was never created. A pre-fix door falls to the scan,
  // finds `someoneElse` (the only, newest candidate) and reads IT as healthy
  // — reporting "all clear" about a channel that has nothing to do with the
  // run this beat was told to watch.
  const stop = door(null, pressedAt, RUN_ID);
  assert.notEqual(stop, null);
  assert.equal(stop!.reason, 'no-channel');
  assert.match(stop!.detail, new RegExp(RUN_ID.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')), stop!.detail);
});

test('ROW 162 (control): no boundRunId at all keeps today\'s born-after-the-anchor scan, unchanged', () => {
  const { logs, door } = realDoor();
  const dispatch = join(logs, RUN_ID);
  mkdirSync(dispatch, { recursive: true });
  const pressedAt = Date.now() - (STALL_CEILING_MS + 5_000);
  writeEvent(dispatch, 'cycle.start', pressedAt + 6_000);

  // Omitting the third argument entirely must change nothing — additive,
  // never a behaviour change for every beat that declares no `run-id`.
  const stop = door(null, pressedAt);
  assert.equal(stop, null, 'a channel the ordinary scan already finds must behave exactly as before');
});

/**
 * `resolveBoundRunId` — the pure lookup `beats-drive.mjs` threads into
 * `waitForConsequence`. Mirrors `resolveCycleOf`'s own test style
 * (`beats-cycle-terminal.test.ts`).
 */
test('resolveBoundRunId: reads the beat\'s own run-id placeholder off the bindings', () => {
  assert.equal(resolveBoundRunId({ 'run-id': '<cycleId2>' }, { cycleId2: RUN_ID }), RUN_ID);
});

test('resolveBoundRunId: null when the beat declares no run-id key', () => {
  assert.equal(resolveBoundRunId({ page: 'flow-monitor' }, { cycleId2: RUN_ID }), null);
});

test('resolveBoundRunId: null when run-id is a literal, not a placeholder', () => {
  assert.equal(resolveBoundRunId({ 'run-id': 'literal-value' }, {}), null);
});

test('resolveBoundRunId: null when the placeholder is declared but not yet bound', () => {
  // The beat that PRODUCES the binding reds before any beat that reads it —
  // `resolveCycleOf`'s own header names the identical shape. Never resolves
  // to the placeholder text itself, which would join `_logs/<cycleId2>` and
  // look up a directory that can never exist.
  assert.equal(resolveBoundRunId({ 'run-id': '<cycleId2>' }, {}), null);
});

/**
 * THE WIRING, not the door alone — `forge-8vfn.27`'s own lesson applied here:
 * a door proved correct in isolation says nothing about whether the caller
 * that is supposed to feed it ever does. A spy in place of the door, so the
 * assertion is about POSITION, not about `_logs/` timing at all — the run-42
 * shape was a plumbing gap (the value never reached the door), which a
 * fixture-based door test cannot see either way.
 */
function monitorPage() {
  // Beat 50's exact shape: a page that renders fine and simply never carries
  // `data-run` on `main[data-page]` — `readRunId` throws on the missing
  // `.evaluate` below and its own try/catch reads that as "names no run",
  // precisely the condition ROW 162 exists for.
  const locator = (): any => ({
    first: () => locator(), count: async () => 1, nth: () => locator(),
    evaluateAll: async (fn: any, a: any) => fn([], a), waitFor: async () => {},
    click: async () => {}, fill: async () => {},
  });
  return {
    url: () => 'http://localhost:4124/flows/forge-develop',
    locator,
    waitForSelector: async () => {},
    evaluate: async (_fn: unknown, arg?: { wanted?: string[] }) => {
      const all: Record<string, string> = { page: 'flow-monitor', 'page-ready': 'true' };
      const w = arg?.wanted ?? null;
      return {
        data: w === null ? all : Object.fromEntries(Object.entries(all).filter(([k]) => w.includes(k))),
        nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null,
      };
    },
  };
}

const MONITOR_BEAT = {
  act: 'ACT 2 — the unfinished work item resumes, not skipped',
  expect: {
    route: '/flows/forge-develop',
    data: { page: 'flow-monitor', section: 'run-controls', 'run-id': RUN_ID, status: 'complete' },
  },
  say: 'row 162 fixture beat',
};

test('ROW 162 (RED before fix): waitForConsequence hands boundRunId to the door as its 3rd arg', async () => {
  const calls: unknown[][] = [];
  const spyDoor = (...args: unknown[]) => {
    calls.push(args);
    return { reason: 'no-channel', detail: 'spy' };
  };
  const pressedAt = Date.now() - (STALL_CEILING_MS + 5_000);

  const stall = await waitForConsequence(
    monitorPage() as never, MONITOR_BEAT, 2 * STALL_CEILING_MS + 10_000, null, null, null,
    spyDoor, pressedAt, null, null, null, RUN_ID,
  );

  assert.notEqual(stall, null, 'the spy door always reports a finding — the wait must end on it');
  assert.equal(calls.length, 1, 'the door must have been consulted exactly once before the wait ended');
  assert.equal(calls[0]![0], null, 'runId (the DOM-named run) must be null — the monitor page names no run');
  assert.equal(calls[0]![1], pressedAt, 'sinceMs must be the resolved anchor');
  assert.equal(
    calls[0]![2], RUN_ID,
    `boundRunId must reach the door as the third positional argument, got ${JSON.stringify(calls[0])}`,
  );
});
