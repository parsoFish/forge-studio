/**
 * Row 199, T1 ruling 1973gz — consolidate's fix turns run under a ceiling and
 * are COUNTED, by the same rule as the KB drain.
 *
 * Before this, `runBrainConsolidateNow` dispatched one brain-fix turn per
 * target-file group with NO ceiling and discarded each turn's `costUsd`: an
 * unbounded batch whose spend appeared nowhere. Consolidate has no budget of
 * its own (no request field, no config), so it takes the drain's source —
 * `DEFAULT_KB_DRAIN_MAX_COST_USD` — and each turn is handed what is left of it.
 * A turn whose spend is UNKNOWN (`costUsd: null`, unpriced and unbounded)
 * stops the batch and is published as `spendUnknown`, never counted as $0.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  dispatchConsolidateTurns,
  writeConsolidateTerminalEvent,
  type AgentFinding,
} from '../../bridge-studio-kb-consolidate.ts';
import { readBrainFixState } from '../../bridge-studio-kb-routes-maintenance.ts';
import { DEFAULT_KB_DRAIN_MAX_COST_USD } from '../../kb-drain-model.ts';
import { noKbEdits } from '../../kb-drain-edit-soundness.ts';
import type { KbDrainRunFixTurnFn } from '../../kb-drain-model.ts';

function groups(n: number): Map<string, AgentFinding[]> {
  const m = new Map<string, AgentFinding[]>();
  for (let i = 0; i < n; i++) {
    m.set(`/kb/index-${i}.md`, [{ category: 'flag', file: `/kb/themes/t${i}.md`, message: `finding ${i}`, check: 'c', kind: 'k', resolution: 'agent' }]);
  }
  return m;
}

function turn(costs: Array<number | null>, ceilings: Array<number | undefined>): KbDrainRunFixTurnFn {
  let i = 0;
  return async (input) => {
    ceilings.push(input.costCeilingUsd);
    const c = costs[i++];
    const costUsd = c === undefined ? 0 : c; // not `??`: null is the case under test
    return { runId: input.runId, cleared: false, costUsd, editAudit: noKbEdits() };
  };
}

const base = { forgeRoot: '/nowhere', kbId: 'kb', runId: 'run' };

test('each turn is handed what is LEFT of the drain-default budget, and its cost is counted', async () => {
  const ceilings: Array<number | undefined> = [];
  const spend = await dispatchConsolidateTurns({ ...base, groups: groups(2), runFixTurn: turn([0.5, 0.25], ceilings) });
  assert.deepEqual(ceilings, [DEFAULT_KB_DRAIN_MAX_COST_USD, DEFAULT_KB_DRAIN_MAX_COST_USD - 0.5]);
  assert.deepEqual(spend, { costUsd: 0.75, maxCostUsd: DEFAULT_KB_DRAIN_MAX_COST_USD, ceilingHit: false, spendUnknown: false });
});

test('the budget reached stops dispatching the rest of the batch', async () => {
  const ceilings: Array<number | undefined> = [];
  const spend = await dispatchConsolidateTurns({ ...base, groups: groups(3), runFixTurn: turn([DEFAULT_KB_DRAIN_MAX_COST_USD, 0.1, 0.1], ceilings) });
  assert.equal(ceilings.length, 1);
  assert.equal(spend.ceilingHit, true);
});

test('an UNKNOWN spend (null) stops the batch and is flagged, never counted as $0', async () => {
  const ceilings: Array<number | undefined> = [];
  const spend = await dispatchConsolidateTurns({ ...base, groups: groups(3), runFixTurn: turn([0.2, null, 0.1], ceilings) });
  assert.equal(ceilings.length, 2, 'the third group must not be dispatched against an unenforceable budget');
  assert.equal(spend.spendUnknown, true);
  assert.equal(spend.ceilingHit, true);
  assert.equal(spend.costUsd, 0.2, 'only what was priced — a floor, the flag carries the unknown');
});

test('a throwing turn does not abort the batch (unchanged) and charges nothing — it never returned a spend', async () => {
  const ceilings: Array<number | undefined> = [];
  let calls = 0;
  const throwing: KbDrainRunFixTurnFn = async (input) => {
    calls += 1;
    ceilings.push(input.costCeilingUsd);
    if (calls === 1) throw new Error('boom');
    return { runId: input.runId, cleared: false, costUsd: 0.3, editAudit: noKbEdits() };
  };
  const spend = await dispatchConsolidateTurns({ ...base, groups: groups(2), runFixTurn: throwing });
  assert.equal(calls, 2);
  assert.equal(spend.costUsd, 0.3);
});

test('the terminal event publishes the spend, and the route reader passes spendUnknown through', () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-consolidate-spend-'));
  try {
    writeConsolidateTerminalEvent(root, 'r1', {
      total: 3, clearedCount: 1,
      spend: { costUsd: 0.2, maxCostUsd: 2, ceilingHit: true, spendUnknown: true },
    });
    const end = JSON.parse(readFileSync(join(root, '_logs', '_brainfix-r1', 'events.jsonl'), 'utf8').trim()) as { metadata: Record<string, unknown> };
    assert.equal(end.metadata['costUsd'], 0.2);
    assert.equal(end.metadata['maxCostUsd'], 2);
    assert.equal(end.metadata['ceilingHit'], true);
    assert.equal(end.metadata['spendUnknown'], true);
    const state = readBrainFixState(root, 'r1');
    assert.equal(state.spendUnknown, true);
    assert.equal(state.ceilingHit, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
