/**
 * forge-8vfn.8.1.30 / T1 ruling 1693 — the reflector's turn must emit
 * `agent_heartbeat` while it runs, the same as every dev-loop turn.
 *
 * DEFECT (live S10 proof run 35): `finalize.trigger-firing → agent
 * reflector`, then `reflection reflector start` (reflect-mode interactive),
 * wrote NO event into the cycle's events.jsonl for 3m32s, until an external
 * SIGTERM (`reflector.crashed: exited with code 143`). Dev-loop turns emit
 * `agent_heartbeat` roughly every 15s via `runAgent`'s shared tool-event sink
 * (`makeToolEventSink`, packages/agents/tool-event-emit.ts); the reflector's
 * spawn (`runReflectorBrainWrites`, packages/stations/phases/
 * reflector-brain-writes.ts ~:124 `runAgent(def, {...})`) calls `runAgent`
 * with `lifecycle: 'caller'` — the branch that returned `runOneShotSpawn`
 * with NO sink at all, so a slow reflector turn was indistinguishable from a
 * dead one.
 *
 * `deps.heartbeatTimers` (this fix) mirrors `runAgent`'s own
 * `RunContext.heartbeatTimers` test-injection seam (7.6.148) one layer up,
 * so this test drives a "slow" turn on a fake clock instead of a real 15s
 * wait — same fake-timer shape `run-agent-w7b5.test.ts` uses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runReflector, type ReflectorDeps } from '../../phases/reflector.ts';
import { createLogger, type EventLogEntry } from '@forge/kernel';
import type { CycleInput } from '@forge/flows';
import { acquireIsolatedReflectorLease } from '../test-fixtures/reflector-lease-test-fixture.ts';
import { canonicalDef } from '../test-fixtures/canonical-def-fixture.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');

function uniqueCycleId(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `HB-TEST-${ts}-${rnd}`;
}

/** One tool_use (clears the F-13 brain-first gate) then a result — the same
 *  clean shape reflector.test.ts's `fakeSdkQueryClean` uses. The heartbeat
 *  ticks below simulate the "slow" turn; the test never waits on a real
 *  clock. */
async function* stallingReflectorSdkQuery(): AsyncIterable<unknown> {
  yield {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'brain/INDEX.md' } }] },
  };
  yield { type: 'result', subtype: 'success', total_cost_usd: 0.05, duration_ms: 1234 };
}

/** `ticks` immediate fires, then nothing (run-agent-w7b5.test.ts's own
 *  `fakeTimers`) — asserts the emitted heartbeats without a real wait. */
function fakeTimers(ticks: number) {
  let now = 0;
  return {
    setInterval: (fn: () => void, ms: number) => {
      for (let i = 0; i < ticks; i += 1) {
        now += ms;
        fn();
      }
      return 'handle';
    },
    clearInterval: (_h: unknown) => {},
    now: () => now,
  };
}

function readEvents(logFilePath: string): EventLogEntry[] {
  if (!existsSync(logFilePath)) return [];
  const raw = readFileSync(logFilePath, 'utf8');
  const out: EventLogEntry[] = [];
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      /* skip */
    }
  }
  return out;
}

test('8.1.30: a reflector turn that is SLOW emits agent_heartbeat, named for the reflector', async () => {
  const cycleId = uniqueCycleId();
  const tmp = mkdtempSync(join(tmpdir(), 'reflector-hb-'));
  const cycleLogDir = resolve(FORGE_ROOT, '_logs', cycleId);
  try {
    const manifestPath = join(tmp, 'manifest.md');
    writeFileSync(
      manifestPath,
      [
        '---',
        'initiative_id: INIT-2026-09-27-hb',
        'project: demo-project',
        'created_at: 2026-09-27T00:00:00Z',
        'iteration_budget: 3',
        'cost_budget_usd: 1.0',
        'class: code',
        'phase: done',
        'origin: architect',
        '---',
        '',
        'body',
        '',
      ].join('\n'),
    );
    const logger = createLogger(cycleId, resolve(FORGE_ROOT, '_logs'));
    const input: CycleInput = {
      initiativeId: 'INIT-2026-09-27-hb',
      manifestPath,
      projectRepoPath: FORGE_ROOT,
      worktreePath: FORGE_ROOT,
      cycleId,
    };
    const deps: ReflectorDeps = {
      sdkQuery: stallingReflectorSdkQuery,
      brainLint: () => ({ findings: [], exitCode: 0 }),
      acquireBrainWriteLease: acquireIsolatedReflectorLease,
      agentDef: canonicalDef('reflector'),
      heartbeatTimers: fakeTimers(3),
    };

    const result = await runReflector(input, logger, deps);
    assert.equal(result.reflection_status, 'closed', 'sanity: the stubbed pass must close cleanly');

    const events = readEvents(logger.logFilePath);
    const heartbeats = events.filter((e) => e.event_type === 'agent_heartbeat');
    assert.ok(
      heartbeats.length > 0,
      `a reflector turn must emit agent_heartbeat while it runs — got ${JSON.stringify(events.map((e) => e.event_type))}`,
    );
    for (const hb of heartbeats) {
      assert.equal(hb.phase, 'reflection', 'the reflector heartbeat must say phase reflection, not orchestrator');
      assert.equal(hb.skill, 'reflector', 'the reflector heartbeat must name the reflector, not a generic skill');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(cycleLogDir, { recursive: true, force: true });
  }
});
