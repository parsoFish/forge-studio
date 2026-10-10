/**
 * Bead forge-nk1y.22 — the requeue that resumes develop for a pending gate-fix
 * WI rewrites a legacy no-op gate (['true']) to the failing gate's command
 * before the manifest goes back to pending/, and names a WI it cannot recover.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRequeue } from '../../forge-requeue.ts';
import { readWorkItemsFromDir } from '../../work-item.ts';
import { FIX_GATE_CMD, FIX_INIT, plantStrandedFixRound } from '../test-fixtures/stranded-fix-round.ts';

function requeue(failedGate: 'local' | 'docs') {
  const root = mkdtempSync(join(tmpdir(), 'requeue-legacy-gate-'));
  try {
    const fx = plantStrandedFixRound(root, { withGit: true, legacyGate: { failedGate } });
    const r = runRequeue(FIX_INIT, { forgeRoot: root });
    const gate = readWorkItemsFromDir(join(fx.worktree, '.forge', 'work-items')).items.find((w) => w.work_item_id === 'WI-6')?.quality_gate_cmd;
    const events = readFileSync(join(fx.logDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as { message: string; event_type: string; metadata: Record<string, unknown> })
      .filter((e) => e.message === 'fix-loop.legacy-gate.normalised');
    return { r, gate, events };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('requeue: a legacy gate-fix WI is rewritten to the failing local gate, one log event', () => {
  const { r, gate, events } = requeue('local');
  assert.equal(r.resumeDecision.resume && r.resumeDecision.resume_from, 'develop', r.resumeDecision.reason);
  assert.deepEqual(gate, FIX_GATE_CMD);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event_type, 'log');
  assert.deepEqual(events[0]!.metadata, { rewritten: [{ work_item_id: 'WI-6', cmd: FIX_GATE_CMD }], unresolved: [] });
});

test('requeue: an unrecoverable legacy WI stays as built, the requeue proceeds, one error event names it', () => {
  const { r, gate, events } = requeue('docs');
  assert.equal(r.resumeDecision.resume && r.resumeDecision.resume_from, 'develop');
  assert.deepEqual(gate, ['true']);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event_type, 'error');
  assert.deepEqual((events[0]!.metadata.unresolved as Array<{ work_item_id: string }>).map((u) => u.work_item_id), ['WI-6']);
});
