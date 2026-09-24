import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyClause } from '../../preflight-resolve.ts';
import type { ClauseId, ClauseResult } from '../../preflight.ts';

function clause(id: ClauseId): ClauseResult {
  return { clause: id, title: id, hard: false, pass: false, detail: '' };
}

test('AUTO-tier clauses route to a deterministic fixer', () => {
  for (const id of ['C2', 'ARTIFACTS', 'C4'] as ClauseId[]) {
    assert.equal(classifyClause(clause(id)).resolution, 'auto', `${id} must be auto`);
  }
});

test('AGENT-tier clauses route to the matching runner', () => {
  assert.equal(classifyClause(clause('C8')).resolution, 'agent');
  assert.equal(classifyClause(clause('C8')).route, 'instructions');
  assert.equal(classifyClause(clause('DEMO')).route, 'demo-builder');
  assert.equal(classifyClause(clause('DEMO-SKILL')).route, 'demo-builder');
  assert.equal(classifyClause(clause('BRAIN')).route, 'brain-fix');
});

test('USER-tier clauses need an operator decision (no route)', () => {
  for (const id of ['C1', 'C5', 'C6'] as ClauseId[]) {
    const c = classifyClause(clause(id));
    assert.equal(c.resolution, 'user', `${id} must be user`);
    assert.equal(c.route, undefined, `${id} must carry no agent route`);
  }
});

test('every classification carries a fixHint except the unknown fallback', () => {
  for (const id of ['C1', 'C2', 'C4', 'C5', 'C6', 'C8', 'BRAIN', 'DEMO', 'DEMO-SKILL', 'ARTIFACTS'] as ClauseId[]) {
    assert.ok(classifyClause(clause(id)).fixHint, `${id} must carry a fixHint`);
  }
});

test('unknown clause id → user (safe default)', () => {
  const bogus = { clause: 'C99' as ClauseId, title: 'x', hard: false, pass: false, detail: '' };
  assert.deepEqual(classifyClause(bogus), { resolution: 'user' });
});

// forge-8vfn.6.11.31: the preflight-fix agent had to guess where a clause's
// fix belongs (8 Read calls, 0 writes, maxTurns exhausted). Every USER-tier
// clause must carry a `target` the runner can hand the agent directly.
test('every USER-tier clause carries a target (config key / file / operator-owned)', () => {
  for (const id of ['C1', 'C1b', 'C7', 'C5', 'C6', 'C10', 'BUILD', 'SKILLS', 'DEPS'] as ClauseId[]) {
    const c = classifyClause(clause(id));
    assert.equal(c.resolution, 'user', `${id} must be user`);
    assert.ok(c.target, `${id} must carry a target`);
    if (c.target.kind === 'config') assert.ok(c.target.shape.startsWith('{') || c.target.shape.startsWith('['), `${id}'s config target must state its JSON value shape`);
  }
});
