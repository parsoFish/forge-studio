/**
 * Row 207 (bead `forge-8vfn.8.5.57`), T1 ruling 1973qf item C1 — every
 * `cycle.start` gets exactly one `cycle.end`, including an attempt that ends
 * by a throw. Measured on S10 run 2 (ACT 2): the operator-stopped attempt
 * (`EV_muu2r92w_31wkod90`) wrote `flow.operator-stop`, the cycle `error` row
 * and `failure_classification`, and never a `cycle.end` — so the resumed
 * attempt's `cycle.start` read as a second start on a still-open cycle.
 *
 * A stop ends `status: 'stopped'`; any other throw ends with the shared
 * failed marker (`errorEndMetadata`, @forge/kernel). The readers that
 * interpret `cycle.end` read the LAST attempt's status and never take a
 * stopped or failed end as the completion instant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventLogEntry } from '@forge/kernel';
import { runCycle } from '../../cycle.ts';
import { OperatorStopError } from '../../operator-stop.ts';
import { serializeManifest } from '../../manifest.ts';
import { endMetaIndicatesFailure } from '../../run-model-derive-status.ts';
import { aggregateRun } from '../../run-model.ts';
import { buildCycleReport } from '../../cycle-report.ts';
import { UNREACHED_PHASE_WIRING } from '../test-fixtures/phase-wiring.ts';

const INIT = 'INIT-2026-10-04-coupling-sort-flag';

async function runThrowing(err: Error): Promise<{ events: EventLogEntry[]; status: string }> {
  const root = mkdtempSync(join(tmpdir(), 'cycle-end-attempt-'));
  try {
    const manifestPath = join(root, `${INIT}.md`);
    writeFileSync(manifestPath, serializeManifest({
      initiative_id: INIT, class: 'code', acceptance_criteria: [], project: 'gitpulse',
      project_repo_path: '/tmp/gitpulse', created_at: '2026-10-04T17:04:17Z', iteration_budget: 3,
      cost_budget_usd: 2, phase: 'pending', origin: 'architect', body: '# r207\n', flow_id: 'forge-develop',
    }));
    const cycleId = `TEST-r207-${process.pid}-${Date.now()}`;
    const wiring = { ...UNREACHED_PHASE_WIRING, executor: { run: async () => { throw err; } } };
    const result = await runCycle({
      initiativeId: INIT, manifestPath, projectRepoPath: root, worktreePath: root, cycleId, logsRoot: join(root, '_logs'), dryRun: false,
    }, wiring);
    const events = readFileSync(join(root, '_logs', cycleId, 'events.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry);
    return { events, status: result.status };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const cycleRows = (events: EventLogEntry[], type: string) =>
  events.filter((e) => e.phase === 'orchestrator' && e.skill === 'cycle' && e.event_type === type);

test('an operator-stopped attempt writes exactly one cycle.end, status "stopped", after its error row', async () => {
  const { events, status } = await runThrowing(new OperatorStopError());
  assert.equal(status, 'failed', 'the CycleResult the scheduler routes on is unchanged');
  assert.equal(cycleRows(events, 'start').length, 1);
  const ends = cycleRows(events, 'end');
  assert.equal(ends.length, 1, 'every cycle.start gets exactly one cycle.end');
  assert.equal(ends[0].message, 'cycle.end');
  assert.equal(ends[0].metadata?.status, 'stopped');
  assert.match(String(ends[0].metadata?.error), /^OperatorStopError: operator-stop:/);
  const errIdx = events.findIndex((e) => e.skill === 'cycle' && e.event_type === 'error');
  assert.ok(errIdx >= 0 && errIdx < events.indexOf(ends[0]), 'the error row precedes the end, so a reader keyed on the error still sees it first');
});

test('any other throw also ends its attempt, with the shared failed marker', async () => {
  const { events } = await runThrowing(new TypeError('boom'));
  const ends = cycleRows(events, 'end');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].metadata?.status, 'failed');
  assert.equal(ends[0].metadata?.error, 'TypeError: boom');
});

test('endMetaIndicatesFailure: a stopped end is never read as complete', () => {
  assert.equal(endMetaIndicatesFailure({ status: 'stopped' }), true);
});

function stopThenResumeLog(root: string, cycleId: string): void {
  const row = (id: string, at: string, event_type: string, message: string, metadata?: Record<string, unknown>) => ({
    event_id: id, cycle_id: cycleId, initiative_id: INIT, started_at: at, phase: 'orchestrator', skill: 'cycle',
    event_type, input_refs: [], output_refs: [], message, ...(metadata ? { metadata } : {}),
  });
  mkdirSync(join(root, '_logs', cycleId), { recursive: true });
  writeFileSync(join(root, '_logs', cycleId, 'events.jsonl'), [
    row('EV_a', '2026-10-04T17:08:16.184Z', 'start', 'cycle.start', { origin: 'architect' }),
    row('EV_b', '2026-10-04T17:11:43.222Z', 'error', 'operator-stop: the operator requested this run stop'),
    row('EV_c', '2026-10-04T17:11:43.230Z', 'end', 'cycle.end', { status: 'stopped', error: 'OperatorStopError: operator-stop:' }),
    row('EV_d', '2026-10-04T17:11:51.550Z', 'start', 'cycle.start', { origin: 'architect' }),
    row('EV_e', '2026-10-04T17:30:00.000Z', 'end', 'cycle.end', { status: 'ready-for-review', reflection_status: 'skipped' }),
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
}

test('cycle report: a stopped-then-resumed cycle reports the LAST attempt\'s status, never the stop', () => {
  const root = mkdtempSync(join(tmpdir(), 'cycle-end-report-'));
  try {
    const cycleId = `2026-10-04T17-05-02_${INIT}`;
    stopThenResumeLog(root, cycleId);
    const md = buildCycleReport({ cycleId, forgeRoot: root, logsRoot: join(root, '_logs') });
    assert.match(md, /\*\*Status:\*\* `ready-for-review`/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run model: a stopped attempt\'s cycle.end is never the run\'s completion instant', () => {
  const root = mkdtempSync(join(tmpdir(), 'cycle-end-runmodel-'));
  try {
    const cycleId = `2026-10-04T17-05-02_${INIT}`;
    mkdirSync(join(root, '_queue', 'ready-for-review'), { recursive: true });
    const manifestPath = join(root, '_queue', 'ready-for-review', `${INIT}.md`);
    writeFileSync(manifestPath, serializeManifest({
      initiative_id: INIT, class: 'code', acceptance_criteria: [], project: 'gitpulse', project_repo_path: '/tmp/gitpulse',
      created_at: '2026-10-04T17:04:17Z', iteration_budget: 3, cost_budget_usd: 2, phase: 'ready-for-review', origin: 'architect',
      body: '# r207\n', cycle_id: cycleId,
    }));
    stopThenResumeLog(root, cycleId);
    const run = aggregateRun({ root, queueState: 'ready-for-review', manifestPath, nowMs: Date.now() });
    assert.equal(run.completedAt, '2026-10-04T17:30:00.000Z');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
