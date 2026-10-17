/**
 * forge-mfv5.1.55 — every per-AC check runs on each gate pass, and the next
 * brief names EVERY unsatisfied check, not only the first.
 *
 * Measured on I4 WI-17 (20 checks): the loop stopped at the first unsatisfied
 * check, so each iteration's brief named one gap (it 0 → SB1a, it 1 → SB2a,
 * it 3 → SB2b …) and convergence cost one ~$2 iteration per check.
 *
 * Wired as `developer-loop.ts` wires the gate: `onRun` → one `gate.*` event per
 * run (`emitGateEvent`), `onVerdict` → the brief tracker (`createGateFeedbackTracker`).
 * Real `node -e` child processes in a tmp dir: no network, no agent, no git write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EventLogEntry, EventLogger } from '@forge/kernel';
import type { WorkItem } from '@forge/flows';

import { emitGateEvent } from '../../phases/dev-loop-events.ts';
import { createGateFeedbackTracker, lastGateFailurePath } from '../../phases/gate-feedback.ts';
import { buildWiQualityGate, type AcGateRunInfo } from '../../phases/wi-quality-gate.ts';

const INIT = 'INIT-2026-10-17-i4-modules-overlays';
const GATE = [process.execPath, '-e', 'process.exit(0)'];
/** A check that prints a node:test-shaped summary and the given marker, then exits with `code`. */
const check = (marker: string, code: number): string[] => [
  process.execPath, '-e', `console.log('${marker} stdout\\n# pass ${code === 0 ? 1 : 0}\\n# fail ${code === 0 ? 0 : 1}'); console.error('${marker} stderr'); process.exit(${code})`,
];

type Ac = WorkItem['acceptance_criteria'][number];
const ac = (id: string, argv: string[], expect: 'pass' | 'fail' = 'pass', extra: Partial<NonNullable<Ac['check']>> = {}): Ac =>
  ({ id, given: 'g', when: 'w', then: 't', check: { argv, expect, ...extra } });

function wi(acs: Ac[]): WorkItem {
  return { work_item_id: 'WI-17', initiative_id: INIT, status: 'pending', depends_on: [], acceptance_criteria: acs, files_in_scope: [], quality_gate_cmd: GATE, estimated_iterations: 1, body: '' };
}

function recordingLogger(): { logger: EventLogger; emitted: EventLogEntry[] } {
  const emitted: EventLogEntry[] = [];
  const logger: EventLogger = {
    cycleId: 'cycle-check-all', logFilePath: '/dev/null',
    emit(partial) { const e = { event_id: `e${emitted.length + 1}`, cycle_id: 'cycle-check-all', started_at: '', ...partial } as EventLogEntry; emitted.push(e); return e; },
  };
  return { logger, emitted };
}

/** The developer-loop wiring: events per run, the brief once per gate pass. */
function run(acs: Ac[], iteration = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-check-all-'));
  const ctx = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    const { logger, emitted } = recordingLogger();
    const tracker = createGateFeedbackTracker({ worktreePath: dir, emit: () => {} });
    const verdicts: AcGateRunInfo[] = [];
    const gate = buildWiQualityGate({
      worktreePath: dir, effective: GATE, accGate: undefined, wi: wi(acs), requiredPathsSource: 'files-in-scope',
      ciGateUnsetEnv: undefined, localGateTimeoutMs: 60_000, initiativeId: INIT,
      onRun: (info) => { if (info.ac) emitGateEvent(logger, INIT, 'p', 'WI-17', info); },
      onVerdict: (info) => { verdicts.push(info); tracker.onRun(info); },
    });
    const passed = gate({ iteration });
    const briefPath = lastGateFailurePath(dir);
    const brief = existsSync(briefPath) ? readFileSync(briefPath, 'utf8') : null;
    const events = emitted.map((e) => [e.message, (e.metadata as Record<string, unknown>).acceptance_criterion]);
    return { passed, brief, events, verdicts };
  } finally {
    if (ctx !== undefined) process.env.NODE_TEST_CONTEXT = ctx;
    rmSync(dir, { recursive: true, force: true });
  }
}

const FIVE = (): Ac[] => [
  ac('SB1a', check('SB1A_OUT', 1)),
  ac('SB1b', check('SB1B_OUT', 0)),
  ac('SB2a', check('SB2A_OUT', 2)),
  ac('SB2b', check('SB2B_OUT', 0), 'fail'), // expect fail, exits 0 → unsatisfied
  ac('SB3a', check('SB3A_OUT', 0)),
];

test('3 unsatisfied + 2 satisfied: one gate pass runs all 5 (5 events) and the brief names all 3 with their tails', () => {
  const r = run(FIVE());
  assert.equal(r.passed, false);
  assert.deepEqual(r.events, [
    ['gate.fail', 'SB1a'], ['gate.pass', 'SB1b'], ['gate.fail', 'SB2a'], ['gate.fail', 'SB2b'], ['gate.pass', 'SB3a'],
  ]);
  assert.equal(r.verdicts.length, 1, 'one brief per gate pass');
  assert.ok(r.brief, 'the brief exists while checks are unsatisfied');
  for (const id of ['SB1a', 'SB2a', 'SB2b']) assert.match(r.brief!, new RegExp(`${id} \\(expect (pass|fail)\\)`), `brief names ${id}`);
  for (const m of ['SB1A_OUT stdout', 'SB1A_OUT stderr', 'SB2A_OUT stdout', 'SB2B_OUT stdout']) assert.ok(r.brief!.includes(m), `brief carries ${m}`);
  assert.match(r.brief!, /SB1a \(expect pass\) — exit 1/);
  assert.match(r.brief!, /SB2a \(expect pass\) — exit 2/);
  assert.match(r.brief!, /SB2b \(expect fail\) — exit 0/);
  assert.match(r.brief!, /SB2b expected the check to FAIL/);
  assert.match(r.brief!, /node:test 0 passed, 1 failed, 0 skipped/, 'the runner summary of a failing check');
  assert.match(r.brief!, /3 of 5 acceptance checks unsatisfied: SB1a, SB2a, SB2b/);
  for (const id of ['SB1b', 'SB3a']) assert.doesNotMatch(r.brief!, new RegExp(`${id} \\(expect`), `a satisfied ${id} is not in the brief`);
});

test('an errored live check is reported as ERRORED, never a pass, and the checks after it still run', () => {
  const r = run([
    ac('L1', check('L1_OUT', 0), 'pass', { requiresEnv: ['FORGE_CHECK_ALL_NEVER_SET'] }),
    ac('L2', check('L2_OUT', 1)),
    ac('L3', check('L3_OUT', 0)),
  ]);
  assert.equal(r.passed, false);
  assert.deepEqual(r.events, [['gate.errored', 'L1'], ['gate.fail', 'L2'], ['gate.pass', 'L3']]);
  assert.match(r.brief!, /L1 \(expect pass\) — ERRORED \(live-env-missing\)/);
  assert.match(r.brief!, /FORGE_CHECK_ALL_NEVER_SET/);
  assert.match(r.brief!, /L2 \(expect pass\) — exit 1/);
  assert.equal(r.verdicts[0]!.errored ?? false, false, 'a fixable failure remains: the loop is not stopped as a broken gate');
});

test('every unsatisfied check errored → the verdict is errored (nothing the agent can fix this pass)', () => {
  const r = run([
    ac('E1', ['forge-no-such-binary-check-all'], 'pass'),
    ac('E2', check('E2_OUT', 0)),
  ]);
  assert.equal(r.passed, false);
  assert.equal(r.verdicts[0]!.errored, true);
  assert.match(r.brief!, /E1 \(expect pass\) — ERRORED \(gate-errored\)/);
});

test('all checks satisfied → pass, every check logged, no brief left behind', () => {
  const r = run([ac('A1', check('A1', 0)), ac('A2', check('A2', 1), 'fail')]);
  assert.equal(r.passed, true);
  assert.deepEqual(r.events, [['gate.pass', 'A1'], ['gate.pass', 'A2']]);
  assert.equal(r.brief, null);
  assert.equal(r.verdicts[0]!.passed, true);
});

test('the WI gate failing: its own run is the verdict (checks do not run — unchanged)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-check-all-'));
  try {
    const verdicts: AcGateRunInfo[] = [];
    const gate = buildWiQualityGate({
      worktreePath: dir, effective: [process.execPath, '-e', 'process.exit(3)'], accGate: undefined, wi: wi(FIVE()), requiredPathsSource: 'files-in-scope',
      ciGateUnsetEnv: undefined, localGateTimeoutMs: 60_000, initiativeId: INIT, onRun: () => {}, onVerdict: (i) => { verdicts.push(i); },
    });
    assert.equal(gate({ iteration: 1 }), false);
    assert.equal(verdicts.length, 1);
    assert.equal(verdicts[0]!.exitCode, 3);
    assert.equal(verdicts[0]!.ac, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
