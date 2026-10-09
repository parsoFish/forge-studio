/**
 * forge-nk1y.4 + nk1y.5 — the one spend-ceiling derivation. The plan chip,
 * the run and the scheduler's stop read `resolveRunCeiling`; every session
 * start reads `resolveSessionCeiling`. A second formula anywhere else is the
 * defect (the plan chip showed the estimate as "cap"), so the last test
 * greps the production tree for one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  DERIVED_CEILING_MARGIN_SHARE,
  parseCeilingEnv,
  resolveRunCeiling,
  resolveSessionCeiling,
} from '../../run-ceiling.ts';

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');

test('run ceiling: FORGE_COST_CEILING_USD wins over the manifest and the derived figure', () => {
  assert.deepEqual(resolveRunCeiling({ envRaw: '30', costCeilingUsd: 9, costBudgetUsd: 5 }), { ceilingUsd: 30, source: 'env' });
});

test('run ceiling: an unset or blank env is not a ceiling', () => {
  for (const raw of [undefined, '', '  ']) {
    assert.equal(parseCeilingEnv(raw), undefined, `"${raw}"`);
    assert.equal(resolveRunCeiling({ envRaw: raw, costBudgetUsd: 2 }).source, 'derived', `"${raw}"`);
  }
});

test('run ceiling: a SET but invalid env is refused by name, never treated as unset (review finding)', () => {
  for (const raw of ['0', '-3', 'abc', '5abc', 'Infinity', '1e999']) {
    assert.throws(() => resolveRunCeiling({ envRaw: raw, costBudgetUsd: 2 }), /invalid FORGE_COST_CEILING_USD=.*expected a positive number of USD, or unset/, `"${raw}"`);
  }
});

test('run ceiling: an explicit manifest cost_ceiling_usd beats the derived figure', () => {
  assert.deepEqual(resolveRunCeiling({ envRaw: undefined, costCeilingUsd: 12, costBudgetUsd: 5 }), { ceilingUsd: 12, source: 'manifest' });
});

test('run ceiling: derived = cost_budget_usd × 1.5 — the stranger\'s $2.50 estimate is a $3.75 ceiling', () => {
  assert.equal(DERIVED_CEILING_MARGIN_SHARE, 0.5);
  assert.deepEqual(resolveRunCeiling({ envRaw: undefined, costBudgetUsd: 2.5 }), { ceilingUsd: 3.75, source: 'derived' });
});

test('run ceiling: nothing declared → none (the caller falls back to the flow\'s own ceiling)', () => {
  assert.deepEqual(resolveRunCeiling({ envRaw: undefined }), { ceilingUsd: undefined, source: 'none' });
});

test('session ceiling: env wins, then the agent\'s budgets.maxBudgetUsd', () => {
  assert.deepEqual(resolveSessionCeiling({ envRaw: '55', agentSlug: 'a', agentBudgetUsd: 3 }), { ok: true, ceilingUsd: 55, source: 'env' });
  assert.deepEqual(resolveSessionCeiling({ envRaw: undefined, agentSlug: 'a', agentBudgetUsd: 3 }), { ok: true, ceilingUsd: 3, source: 'agent-budget' });
});

test('session ceiling: neither → refused by name (never an uncapped spawn)', () => {
  const r = resolveSessionCeiling({ envRaw: undefined, agentSlug: 'project-brain-builder', agentBudgetUsd: undefined });
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.reason : '', /no spend ceiling: set FORGE_COST_CEILING_USD or budgets\.maxBudgetUsd on agent "project-brain-builder"/);
});

test('one formula: the 1.5× margin is multiplied in run-ceiling.ts and nowhere else in production code', () => {
  const out = execFileSync('git', ['-C', REPO, 'grep', '-n', '-E', '1 \\+ DERIVED_CEILING_MARGIN_SHARE', '--', 'packages', 'apps', ':!*.test.ts', ':!**/tests/**'], { encoding: 'utf8' });
  const code = out.trim().split('\n').filter((l) => {
    const text = l.split(':').slice(2).join(':').trim();
    return l !== '' && !text.startsWith('*') && !text.startsWith('//');
  });
  assert.deepEqual(code.map((l) => l.split(':')[0]), ['packages/kernel/run-ceiling.ts'], `a second ceiling formula:\n${code.join('\n')}`);
});
