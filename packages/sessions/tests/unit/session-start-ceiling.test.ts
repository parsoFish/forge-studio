/**
 * forge-nk1y.5 — every interactive session kind starts with a spend ceiling:
 * the operator's explicit kickoff ceiling, else FORGE_COST_CEILING_USD, else
 * the agent's own budgets.maxBudgetUsd; with none, refused by name.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveStartCeiling } from '../../session-start-ceiling.ts';

/** The agent behind every studio/session-kinds.yaml row. */
const SESSION_AGENTS = ['architect', 'instructions-creator', 'project-brain-builder', 'demo-builder', 'onboarding-agent', 'creation-agent', 'brain-maintenance'];

test('every session kind\'s agent declares a budget: with FORGE_COST_CEILING_USD unset, each start still has a ceiling', () => {
  for (const agent of SESSION_AGENTS) {
    const c = resolveStartCeiling(agent, { env: {} });
    assert.ok(c.ok, `${agent}: ${!c.ok ? c.error : ''}`);
    assert.equal(c.ok && c.costCeilingSource, 'agent-budget', agent);
    assert.ok(c.ok && c.costCeilingUsd > 0, agent);
  }
});

test('FORGE_COST_CEILING_USD wins over the agent budget (the capstone\'s $55)', () => {
  assert.deepEqual(resolveStartCeiling('project-brain-builder', { env: { FORGE_COST_CEILING_USD: '55' } }), { ok: true, costCeilingUsd: 55, costCeilingSource: 'env' });
});

test('an operator\'s explicit kickoff ceiling wins over both', () => {
  assert.deepEqual(resolveStartCeiling('architect', { env: { FORGE_COST_CEILING_USD: '55' }, operatorUsd: 5 }), { ok: true, costCeilingUsd: 5, costCeilingSource: 'operator' });
});

test('REFUSAL: no env and an agent with budgets: {} → refused by name, never an uncapped start', () => {
  const c = resolveStartCeiling('some-agent', { env: {}, agentBudgetUsd: () => undefined });
  assert.deepEqual(c, { ok: false, error: 'no spend ceiling: set FORGE_COST_CEILING_USD or budgets.maxBudgetUsd on agent "some-agent"' });
});

test('REFUSAL: an agent definition that cannot be read is refused by name, not treated as uncapped', () => {
  const c = resolveStartCeiling('no-such-agent-nk1y5', { env: { FORGE_COST_CEILING_USD: '55' } });
  assert.equal(c.ok, false);
  assert.match(!c.ok ? c.error : '', /cannot read the spend budget of agent "no-such-agent-nk1y5"/);
});

test('REFUSAL at turn time: no declared ceiling, no agent budget, no env → NoSpendCeilingError by name + an error row, never an uncapped turn', async () => {
  const { turnBudgetUsd } = await import('../../turn-budget.ts');
  const emitted: Array<{ event_type: string; message: string }> = [];
  const logger = { emit: (e: { event_type: string; message: string }) => { emitted.push(e); } } as unknown as Parameters<typeof turnBudgetUsd>[0]['logger'];
  assert.throws(
    () => turnBudgetUsd({
      declaredCeilingUsd: undefined, agentBudgetUsd: undefined, env: {}, logsRoot: '/nonexistent-nk1y5', spentUsd: () => 0, logger,
      identity: { initiativeId: 'i', phase: 'orchestrator', skill: 'some-agent', sessionId: 's' },
    }),
    (e: Error) => e.name === 'NoSpendCeilingError' && /no spend ceiling for this session turn: set FORGE_COST_CEILING_USD or budgets\.maxBudgetUsd on agent "some-agent"/.test(e.message),
  );
  assert.deepEqual(emitted.map((e) => e.event_type), ['error']);
});

test('turn time: an agent budget is the session arm when no ceiling was stamped (a session minted before nk1y.5)', async () => {
  const { turnBudgetUsd } = await import('../../turn-budget.ts');
  const logger = { emit: () => {} } as unknown as Parameters<typeof turnBudgetUsd>[0]['logger'];
  assert.equal(turnBudgetUsd({
    declaredCeilingUsd: undefined, agentBudgetUsd: 3, env: {}, logsRoot: '/nonexistent-nk1y5', spentUsd: () => 1, logger,
    identity: { initiativeId: 'i', phase: 'orchestrator', skill: 'a', sessionId: 's' },
  }), 2);
});
