import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyClause } from './preflight-resolve.ts';
import type { ClauseId, ClauseResult } from './preflight.ts';

function clause(id: ClauseId): ClauseResult {
  return { clause: id, title: id, hard: false, pass: false, detail: '' };
}

test('AUTO-tier clauses route to a deterministic fixer', () => {
  for (const id of ['C2', 'ARTIFACTS', 'DEMO-SKILL', 'C4'] as ClauseId[]) {
    assert.equal(classifyClause(clause(id)).resolution, 'auto', `${id} must be auto`);
  }
});

test('AGENT-tier clauses route to the matching runner', () => {
  assert.deepEqual(
    { ...classifyClause(clause('C8')) , fixHint: undefined },
    { resolution: 'agent', route: 'instructions', fixHint: undefined },
  );
  assert.equal(classifyClause(clause('DEMO')).route, 'demo-builder');
  assert.equal(classifyClause(clause('BRAIN')).route, 'brain-fix');
});

test('USER-tier clauses need an operator decision (no route)', () => {
  for (const id of ['C1', 'C3', 'C5', 'C6'] as ClauseId[]) {
    const c = classifyClause(clause(id));
    assert.equal(c.resolution, 'user', `${id} must be user`);
    assert.equal(c.route, undefined, `${id} must carry no agent route`);
  }
});

test('every classification carries a fixHint except the unknown fallback', () => {
  for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C8', 'BRAIN', 'DEMO', 'DEMO-SKILL', 'ARTIFACTS'] as ClauseId[]) {
    assert.ok(classifyClause(clause(id)).fixHint, `${id} must carry a fixHint`);
  }
});

test('unknown clause id → user (safe default)', () => {
  const bogus = { clause: 'C99' as ClauseId, title: 'x', hard: false, pass: false, detail: '' };
  assert.deepEqual(classifyClause(bogus), { resolution: 'user' });
});
