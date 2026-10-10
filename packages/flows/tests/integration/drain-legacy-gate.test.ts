/**
 * Bead forge-nk1y.22 — the fix-loop drain rewrites a legacy no-op gate-fix WI
 * (['true'], compiled before #1172) to the failing gate's command BEFORE it
 * re-enters develop, and names a WI it cannot recover.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drainPendingFixWorkItems } from '../../drain-fix-loop.ts';
import type { PhaseWiring } from '../../phase-wiring.ts';
import { readWorkItemsFromDir } from '../../work-item.ts';
import { FIX_GATE_CMD, plantStrandedFixRound } from '../test-fixtures/stranded-fix-round.ts';

async function drain(failedGate: 'local' | 'docs') {
  const root = mkdtempSync(join(tmpdir(), 'drain-legacy-gate-'));
  try {
    const fx = plantStrandedFixRound(root, { withGit: true, legacyGate: { failedGate } });
    const gateAtReentry: Array<string[] | undefined> = [];
    const results = await drainPendingFixWorkItems({
      queueRoot: join(root, '_queue'), logsRoot: join(root, '_logs'), phaseWiring: {} as PhaseWiring, confirmMerge: () => false,
      runDrainCycle: async (input) => {
        gateAtReentry.push(readWorkItemsFromDir(join(input.worktreePath, '.forge', 'work-items')).items.find((w) => w.work_item_id === 'WI-6')?.quality_gate_cmd);
        return { status: 'ready-for-review' };
      },
    });
    const events = readFileSync(join(fx.logDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as { message: string; event_type: string; metadata: Record<string, unknown> })
      .filter((e) => e.message === 'fix-loop.legacy-gate.normalised');
    return { results, gateAtReentry, events };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('drain: a legacy gate-fix WI carries the failing local gate WHEN develop is re-entered, one log event', async () => {
  const d = await drain('local');
  assert.deepEqual(d.gateAtReentry, [FIX_GATE_CMD], JSON.stringify(d.results));
  assert.equal(d.events.length, 1);
  assert.equal(d.events[0]!.event_type, 'log');
  assert.deepEqual(d.events[0]!.metadata, { rewritten: [{ work_item_id: 'WI-6', cmd: FIX_GATE_CMD }], unresolved: [] });
});

test('drain: an unrecoverable legacy WI stays as built, re-entry still happens, one error event names it', async () => {
  const d = await drain('docs');
  assert.deepEqual(d.gateAtReentry, [['true']]);
  assert.equal(d.events.length, 1);
  assert.equal(d.events[0]!.event_type, 'error');
  assert.deepEqual((d.events[0]!.metadata.unresolved as Array<{ work_item_id: string }>).map((u) => u.work_item_id), ['WI-6']);
});
