/**
 * bead forge-8vfn.8.1.9 — `kinds/fix-turn.ts` shares the exact stall/heartbeat
 * shape `runStructuredTurn`/`runAgentTurn` had (its own `withIdleDeadline`
 * call with no `isProgress`, and an unconditional `onHeartbeat()` before the
 * type check) and is itself a session kind the Studio stall detector watches
 * (`bridge-studio-lifecycle.ts`, kb-cleanup/authoring/preflight-fix all route
 * through it). Same fix, same shared helpers
 * (`isProgressMessage`/`makeHeartbeatTick` from `../../interactive-session.ts`
 * — never re-derived here), same test shape as
 * `heartbeat-progress-only.test.ts`.
 *
 * `runFixTurn` never rethrows a stall to its caller (its own catch emits an
 * `error` event and calls the variant's `finish({crashed: true})`), so this
 * pins the SAME two facts through the observable surface `runFixTurn` DOES
 * expose: the `error` event's message, and whether `.heartbeat` exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPreflightFixTurn, type QueryFn } from '../../kinds/preflight-fix.ts';
import { DEFAULT_IDLE_DEADLINE_MS } from '@forge/agents/testing';

/** Yields `count` copies of a non-progress ping, then hangs forever — same
 *  fixture shape as `heartbeat-progress-only.test.ts`. */
function pingsThenSilent(pingType: string, count: number): QueryFn {
  return () => ({
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < count; i += 1) yield { type: pingType };
      await new Promise<never>(() => {});
    },
  });
}

function setup(): { forgeRoot: string; projectDir: string; logsRoot: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'fixturn-progress-only-'));
  const projectDir = join(forgeRoot, 'projects', 'demoproj');
  mkdirSync(projectDir, { recursive: true });
  return { forgeRoot, projectDir, logsRoot: join(forgeRoot, '_logs') };
}

test('runFixTurn (via preflight-fix): a stream producing only non-progress pings logs a stall naming them, and NEVER refreshes .heartbeat', async (t) => {
  const { forgeRoot, projectDir, logsRoot } = setup();
  const runId = 'test-progress-only';
  const logDir = join(logsRoot, `_preflight-fix-${runId}`);

  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const turn = runPreflightFixTurn({
      runId,
      projectDir,
      clause: 'C5',
      instruction: 'x',
      forgeRoot,
      logsRoot,
      queryFn: pingsThenSilent('tool_progress', 5),
    });
    const settled: { resolved?: unknown; rejected?: unknown } = {};
    void turn.then((v) => { settled.resolved = v; }, (e) => { settled.rejected = e; });

    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(DEFAULT_IDLE_DEADLINE_MS + 1_000);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((r) => setImmediate(r));

    assert.ok(settled.resolved, `runFixTurn must never reject — it converts the stall into a crashed result; got rejected=${String(settled.rejected)}`);
    const result = settled.resolved as { cleared: boolean };
    assert.equal(result.cleared, false, 'a crashed turn cannot have cleared the clause');

    const events = readFileSync(join(logDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const errorEv = events.find((e) => e.event_type === 'error');
    assert.ok(errorEv, 'an error event must be logged on the stall path');
    const message = String(errorEv.metadata?.error ?? '');
    assert.match(message, /stream-deadline/, message);
    assert.match(message, /saw only non-progress messages/, message);
    assert.match(message, /tool_progress×5/, message);

    assert.equal(existsSync(join(logDir, '.heartbeat')), false, '.heartbeat must never have been written — every message was a non-progress ping');
  } finally {
    t.mock.timers.reset();
  }
});

test('runFixTurn (via preflight-fix): an assistant/result message DOES refresh .heartbeat (positive control)', async () => {
  const { forgeRoot, projectDir, logsRoot } = setup();
  const runId = 'test-progress-positive';
  const logDir = join(logsRoot, `_preflight-fix-${runId}`);
  const queryFn: QueryFn = () => (async function* () {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'looking' }] } };
    yield { type: 'result', total_cost_usd: 0 };
  })();

  await runPreflightFixTurn({
    runId, projectDir, clause: 'C5', instruction: 'x', forgeRoot, logsRoot, queryFn,
  });

  assert.ok(existsSync(join(logDir, '.heartbeat')), '.heartbeat must be written once a real progress message arrives');
});
