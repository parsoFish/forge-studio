/**
 * Row 176 (forge-8vfn.8.5.12) — the completeness critic's SDK call keeps the
 * session's `.heartbeat` warm, like every other architect call (row 164).
 *
 * Measured on M7-E row 6 (S10 beat 4, 2026-10-02): a real critic pass on
 * gitpulse ran ~8.7 minutes in phase `critiquing`. /proc showed the SDK child
 * working throughout (utime 225 -> 279), but `.heartbeat` never moved:
 * `runDraftRounds` called `runCompletenessCriticStep` without the plumbing's
 * `onHeartbeat`, so `runStructuredTurn`'s interval ticker had nothing to tick.
 * The Studio lifecycle read the silence as `stalled` past the 120 s architect
 * ceiling, and the story beat stopped on it. The session then finished on its
 * own (awaiting-verdict -> committed).
 *
 * The test holds the critic call IN FLIGHT (a stream that has not answered
 * yet) and advances the clock: the heartbeat file must keep moving.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runArchitectTurn, type ArchitectStatus } from '../../kinds/architect.ts';
import { HEARTBEAT_THROTTLE_MS } from '../../heartbeat.ts';
import { stubArchitectManifestPorts } from '../../tests/architect-ports-stub.ts';
import type { EventLogEntry, EventLogger } from '@forge/kernel';

const DRAFT = {
  vision: 'A vision.',
  initiatives: [{
    slug: 'add-a-flag',
    title: 'Add a flag',
    iteration_budget: 3,
    cost_budget_usd: 2,
    class: 'code',
    acceptance_criteria: [{ given: 'the CLI', when: '--flag is passed', then: 'it is honoured' }],
    body: '# Add a flag\n',
  }],
};

const logger: EventLogger = {
  emit: (entry) => ({ event_id: 'stub', cycle_id: 'stub', started_at: '1970-01-01T00:00:00.000Z', ...entry }) as EventLogEntry,
  cycleId: 'stub',
  logFilePath: '',
};

/** Every `.heartbeat` file under `dir` (the session log dir is named by the runner, not by this test). */
function heartbeats(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '.heartbeat') out.push(p);
    else if (statSync(p).isDirectory()) out.push(...heartbeats(p));
  }
  return out;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

test('row 176: a critic call still in flight past the architect ceiling keeps .heartbeat moving', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const root = mkdtempSync(join(tmpdir(), 'arch-critic-hb-'));
  const projectRoot = join(root, 'projects', 'p1');
  const sessionDir = join(root, '_logs', '_sessions', 'p1', '_architect', 'sess-1');
  mkdirSync(sessionDir, { recursive: true });
  const statusPath = join(sessionDir, 'status.json');
  const status: ArchitectStatus = {
    session_id: 'sess-1', project: 'p1', project_repo_path: projectRoot, phase: 'drafting', round: 1,
    idea: 'Add a flag.', updated_at: new Date().toISOString(),
  };
  writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf8');
  const logsRoot = join(root, '_logs');

  let releaseCritic: () => void = () => {};
  const criticAnswered = new Promise<void>((resolve) => { releaseCritic = resolve; });
  let calls = 0;
  const queryFn = () => {
    const i = calls;
    calls += 1;
    async function* gen(): AsyncGenerator<unknown> {
      if (i === 1) await criticAnswered; // the critic: alive, not answering yet
      yield { type: 'result', total_cost_usd: 0.01, structured_output: i === 0 ? DRAFT : { findings: [] } };
    }
    return gen();
  };

  try {
    const turn = runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot, project: 'p1',
      logsRoot, brainCwd: root, queryFn: queryFn as never, logger,
    });

    // Wait for the critic call to be in flight, phase `critiquing`.
    for (let i = 0; i < 200 && calls < 2; i += 1) await flush();
    assert.equal(calls, 2, 'the draft and then the critic must have been called');
    assert.equal((JSON.parse(readFileSync(statusPath, 'utf8')) as ArchitectStatus).phase, 'critiquing');

    // Past the 120 s architect ceiling, in heartbeat-cadence steps.
    const seen = new Set<string>();
    const steps = Math.ceil(150_000 / HEARTBEAT_THROTTLE_MS) + 1;
    for (let s = 0; s < steps; s += 1) {
      t.mock.timers.tick(HEARTBEAT_THROTTLE_MS);
      await flush();
      for (const p of heartbeats(logsRoot)) seen.add(readFileSync(p, 'utf8'));
    }
    assert.ok(
      seen.size >= 2,
      `.heartbeat must keep moving while the critic call is in flight; saw ${seen.size} distinct value(s) over ${steps} ticks`,
    );

    releaseCritic();
    const result = await turn;
    assert.equal(result.phase, 'awaiting-verdict');
  } finally {
    releaseCritic();
    rmSync(root, { recursive: true, force: true });
  }
});
