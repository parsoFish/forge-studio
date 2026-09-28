/**
 * bead forge-8vfn.8.1.9 — the Studio architect stall. A turn's SDK stream can
 * emit non-progress message types (`tool_progress`, `system`, `hook_response`,
 * `auth_status`, …) that carry no real work, yet the old code let them (a)
 * reset `withIdleDeadline`'s window and (b) refresh `.heartbeat` — so a turn
 * that was genuinely stuck read as alive on every liveness signal Studio has.
 *
 * `packages/agents/tests/unit/stream-deadline.test.ts` pins the `isProgress`
 * predicate itself; `architect-idle-deadline.test.ts` pins where it lands on
 * the architect path. This file still pins (a): `withIdleDeadline` must
 * reject a ping-only stream, naming what it saw instead of progress.
 *
 * (b) is SUPERSEDED by row 164 (bead forge-8vfn.8.1.51, S10 run 43, ruling
 * 1904): `startHeartbeatTicker` (heartbeat.ts) now keeps
 * `.heartbeat` warm on a fixed interval for as long as the SDK call is in
 * flight, independent of what the stream produces — a ping-only stream is
 * still an ALIVE call, and "a live in-flight turn never reads stalled" makes
 * no exception for what kind of message it emits. The message-driven
 * `isProgressMessage` gate this file used to prove (b) with still exists
 * (`makeHeartbeatTick`, unchanged) and still gates `withIdleDeadline`'s own
 * window below — it is simply no longer the ONLY thing keeping `.heartbeat`
 * warm. The ONE authority on an actual hang is `withIdleDeadline` alone,
 * which this file's rejection assertions still exercise directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runStructuredTurn, runAgentTurn, type QueryFn } from '../../interactive-session.ts';
import { makeHeartbeatWriter } from '../../heartbeat.ts';
import { DEFAULT_IDLE_DEADLINE_MS } from '@forge/agents/testing';

const MODEL = 'claude-sonnet-5';

/** Yields `count` copies of a non-progress ping, then hangs forever (never
 *  resolves, never rejects) — the Studio incident's shape: SOMETHING keeps
 *  arriving, none of it is progress. */
function pingsThenSilent(pingType: string, count: number): QueryFn {
  return () => ({
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < count; i += 1) yield { type: pingType };
      await new Promise<never>(() => {});
    },
  });
}

/** Advances past a real SDK stall without a real 6-minute wait, mirroring
 *  `architect-idle-deadline.test.ts`'s own recipe. */
async function tripDeadline(t: { mock: { timers: { tick: (ms: number) => void } } }): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(DEFAULT_IDLE_DEADLINE_MS + 1_000);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}

test('runStructuredTurn: a stream producing only non-progress pings rejects naming them, but the interval ticker still keeps .heartbeat warm (row 164)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'progress-only-structured-'));
  const hbDir = join(dir, '_logs', 'sess');
  const hbPath = join(hbDir, '.heartbeat');

  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const turn = runStructuredTurn<{ ok: boolean }>({
      queryFn: pingsThenSilent('tool_progress', 5),
      prompt: 'p',
      schema: {},
      model: MODEL,
      allowedTools: ['Read'],
      onHeartbeat: makeHeartbeatWriter(hbDir),
      label: 'interactive-structured',
    });
    const settled: { rejected?: unknown; resolved?: unknown } = {};
    void turn.then((v) => { settled.resolved = v; }, (e) => { settled.rejected = e; });

    await tripDeadline(t);

    assert.equal(settled.resolved, undefined, 'a ping-only stream must never resolve the turn');
    assert.ok(settled.rejected, `the progress deadline must reject the turn — nothing thrown after ${DEFAULT_IDLE_DEADLINE_MS} ms of pings`);
    const err = settled.rejected as Error;
    assert.equal(err.name, 'StreamDeadlineError');
    assert.match(err.message, /stream-deadline/, err.message);
    assert.match(err.message, /saw only non-progress messages/, err.message);
    assert.match(err.message, /tool_progress×5/, err.message);

    // Row 164 — the call was alive the whole time, so the interval ticker
    // kept `.heartbeat` warm regardless of the ping-only stream.
    assert.equal(existsSync(hbPath), true, '.heartbeat must be kept warm by the interval ticker while the call is in flight, even on a ping-only stream');
  } finally {
    t.mock.timers.reset();
  }
});

test('runStructuredTurn: an assistant/result message DOES refresh .heartbeat (positive control)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'progress-only-structured-pos-'));
  const hbDir = join(dir, '_logs', 'sess');
  const hbPath = join(hbDir, '.heartbeat');
  const queryFn: QueryFn = () => (async function* () {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
    yield { type: 'result', total_cost_usd: 0, structured_output: { ok: true } };
  })();

  await runStructuredTurn<{ ok: boolean }>({
    queryFn, prompt: 'p', schema: {}, model: MODEL, allowedTools: ['Read'], onHeartbeat: makeHeartbeatWriter(hbDir),
  });

  assert.ok(existsSync(hbPath), '.heartbeat must be written once a real progress message arrives');
});

test('runAgentTurn: a stream producing only non-progress pings rejects naming them, but the interval ticker still keeps .heartbeat warm (row 164)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'progress-only-agent-'));
  const hbDir = join(dir, '_logs', 'sess');
  const hbPath = join(hbDir, '.heartbeat');

  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const turn = runAgentTurn({
      queryFn: pingsThenSilent('system', 4),
      prompt: 'p',
      cwd: '/tmp',
      model: MODEL,
      allowedTools: ['Read'],
      onHeartbeat: makeHeartbeatWriter(hbDir),
      label: 'agent-turn',
    });
    const settled: { rejected?: unknown; resolved?: unknown } = {};
    void turn.then((v) => { settled.resolved = v; }, (e) => { settled.rejected = e; });

    await tripDeadline(t);

    assert.equal(settled.resolved, undefined, 'a ping-only stream must never resolve the turn');
    const err = settled.rejected as Error;
    assert.equal(err?.name, 'StreamDeadlineError', `expected a stall rejection, got ${String(settled.rejected)}`);
    assert.match(err.message, /saw only non-progress messages/, err.message);
    assert.match(err.message, /system×4/, err.message);

    // Row 164 — the call was alive the whole time, so the interval ticker
    // kept `.heartbeat` warm regardless of the ping-only stream.
    assert.equal(existsSync(hbPath), true, '.heartbeat must be kept warm by the interval ticker while the call is in flight, even on a ping-only stream');
  } finally {
    t.mock.timers.reset();
  }
});
