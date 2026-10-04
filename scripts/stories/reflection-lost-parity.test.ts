/**
 * Row 207 (bead `forge-8vfn.8.5.57`), T1 ruling 1973qh (3) — the integration
 * proof: the REAL `runReflector` driven down its budget-exhausted
 * `cycle.reflection-lost` path writes a cycle log that every judge reads the
 * same way: run-end agent parity holds (the start has its one end), and no
 * reader takes the failed end for a completed reflection.
 *
 * The cycle's own lifecycle and the operator's rerun are the R6j capture's
 * rows (S10 `2026-10-02T05-13-08_…exclude-author-flag-complete`), appended
 * around the reflector's real output; the reflector rows between them are
 * whatever the product writes today.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLogger } from '@forge/kernel';
import { runReflector } from '../../packages/stations/phases/reflector.ts';
import { findReflectionLoss } from '../../packages/flows/run-model-derive-status.ts';
import { acquireIsolatedReflectorLease } from '../../packages/stations/tests/test-fixtures/reflector-lease-test-fixture.ts';
import { canonicalDef } from '../../packages/stations/tests/test-fixtures/canonical-def-fixture.ts';
import { channelParityVerdict } from './agent-parity.mjs';
import { readRunEvents } from './run-observe.mjs';
import { loadRegisteredSessionKindIds } from './session-kind-registry.mjs';
import { makeReflectionDoor, REFLECTION_TERMINAL_STATE } from './beats-reflection-terminal.mjs';
import { classifyReflectorProgress } from '../lib/verify-outcomes.mjs';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INIT = 'INIT-2026-10-02-exclude-author-flag-complete';

async function* budgetExhausted(): AsyncIterable<unknown> {
  yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'brain/INDEX.md' } }] } };
  yield { type: 'result', subtype: 'error_max_budget_usd', total_cost_usd: 3.04, duration_ms: 617_470 };
}

test('R6j end to end: a budget-exhausted reflection ends its start once, failed — parity holds and no judge reads it as reflected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'reflection-lost-parity-'));
  try {
    const logsRoot = join(root, '_logs');
    const cycleId = `2026-10-02T05-13-08_${INIT}`;
    const logger = createLogger(cycleId, logsRoot);
    // The develop cycle's own closed lifecycle (R6j rows 682's pair), so the
    // channel is the multi-phase cycle log the parity rule judges.
    const cycleStart = logger.emit({ initiative_id: INIT, phase: 'orchestrator', skill: 'cycle', event_type: 'start', input_refs: [], output_refs: [], message: 'cycle.start' });
    logger.emit({ initiative_id: INIT, parent_event_id: cycleStart.event_id, phase: 'orchestrator', skill: 'cycle', event_type: 'end', input_refs: [], output_refs: [], message: 'cycle.end', metadata: { status: 'pr-open' } });

    const manifestPath = join(root, 'manifest.md');
    writeFileSync(manifestPath, [
      '---', `initiative_id: ${INIT}`, 'project: demo-project', 'created_at: 2026-10-02T05:13:08Z',
      'iteration_budget: 3', 'cost_budget_usd: 1.0', 'class: code', 'phase: done', 'origin: architect', '---', '', 'body', '',
    ].join('\n'));
    const result = await runReflector(
      { initiativeId: INIT, manifestPath, projectRepoPath: root, worktreePath: root, cycleId, logsRoot },
      logger,
      { acquireBrainWriteLease: acquireIsolatedReflectorLease, agentDef: canonicalDef('reflector'), sdkQuery: budgetExhausted, brainLint: () => ({ findings: [], exitCode: 0 }) },
    );
    assert.equal(result.reflection_status, 'failed');

    const dir = join(logsRoot, cycleId);
    const kinds = loadRegisteredSessionKindIds(FORGE_ROOT);
    const lostOnly = readRunEvents(dir);
    const lines = lostOnly.map((r: object) => JSON.stringify(r));

    // Parity: the lost reflection's start has exactly one end.
    const verdict = channelParityVerdict(dir, lostOnly, { registeredSessionKindIds: kinds });
    assert.equal(verdict.kind, 'cycle', verdict.detail);
    assert.deepEqual(verdict.violations, [], JSON.stringify(verdict.violations));

    // No judge reads the failed end as a completed reflection.
    assert.equal(classifyReflectorProgress(lines).state, 'lost');
    const door = makeReflectionDoor(root, INIT)!(null, Date.parse(cycleStart.started_at), REFLECTION_TERMINAL_STATE)!;
    assert.equal(door.state, 'lost', door.detail);
    assert.equal(findReflectionLoss(lostOnly, { queueComplete: true, isStale: false })?.cause, 'budget-exhausted');

    // R6j's own tail: the operator's rerun (capture rows 738 + 750). Pre-fix,
    // FIFO paired the rerun's end with the lost start — double-start plus
    // missing-end. Now each start closes on its own end.
    appendFileSync(join(dir, 'events.jsonl'), [
      { event_id: 'EV_muqkc7s4_3wrx4wzu', cycle_id: cycleId, started_at: new Date(Date.now() + 1000).toISOString(), initiative_id: INIT, phase: 'reflection', skill: 'reflector', event_type: 'start', input_refs: [], output_refs: [], message: 'reflector.start' },
      { event_id: 'EV_muqkdcfe_zf9vr1q2', cycle_id: cycleId, started_at: new Date(Date.now() + 2000).toISOString(), initiative_id: INIT, parent_event_id: 'EV_muqkc7s4_3wrx4wzu', phase: 'reflection', skill: 'reflector', event_type: 'end', input_refs: [], output_refs: [], message: 'reflector.end', metadata: { status: 'closed', result_subtype: 'success' } },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n');
    const withRerun = readRunEvents(dir);
    const rerunVerdict = channelParityVerdict(dir, withRerun, { registeredSessionKindIds: kinds });
    assert.deepEqual(rerunVerdict.violations, [], JSON.stringify(rerunVerdict.violations));
    assert.equal(findReflectionLoss(withRerun, { queueComplete: true, isStale: false }), undefined, 'the closed rerun recovers the loss');
    assert.equal(classifyReflectorProgress(withRerun.map((r: object) => JSON.stringify(r))).state, 'ended');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
