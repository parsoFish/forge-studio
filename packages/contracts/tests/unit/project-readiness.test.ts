/**
 * `projectReadiness` — the ONE readiness rule (SPEC §6). Studio's
 * ContractReadiness and the claim gate both call it; each of the six checks
 * is proved to fail ALONE and to name itself in `failing`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectReadiness } from '../../index.ts';
import type { DemoStep } from '../../index.ts';

const DEMO: readonly DemoStep[] = [
  { kind: 'capture', text: 'npm run demo' },
  { kind: 'verify', text: 'npm test' },
];
const CLAUSES = [
  { clause: 'C1', hard: true, pass: true },
  { clause: 'C3', hard: false, pass: false },
];
const READY = {
  northStar: 'A thing that does one thing',
  instructions: 'Read AGENTS.md',
  demoProcess: DEMO,
  skills: ['some-skill'],
  kb: 'my-kb' as string | null,
  clauses: CLAUSES as readonly { clause: string; hard: boolean; pass: boolean }[] | null,
};

test('all six checks ok → ready, nothing failing, an advisory failure does not block', () => {
  const r = projectReadiness(READY);
  assert.equal(r.ready, true);
  assert.deepEqual(r.failing, []);
  assert.deepEqual(r.checks.map((c) => c.id), ['north-star', 'instructions', 'demo', 'skills', 'kb', 'preflight']);
  assert.ok(r.checks.every((c) => c.ok));
});

const ALONE: Array<[string, typeof READY, string]> = [
  ['north-star (empty)', { ...READY, northStar: '   ' }, 'north-star'],
  ['north-star (141 chars)', { ...READY, northStar: 'x'.repeat(141) }, 'north-star'],
  ['instructions', { ...READY, instructions: ' \n ' }, 'instructions'],
  ['demo (no capture)', { ...READY, demoProcess: [{ kind: 'verify', text: 'v' }] }, 'demo'],
  ['demo (no verify)', { ...READY, demoProcess: [{ kind: 'capture', text: 'c' }, { kind: 'present', text: 'p' }] }, 'demo'],
  ['demo (empty)', { ...READY, demoProcess: [] }, 'demo'],
  ['skills', { ...READY, skills: [] }, 'skills'],
  ['kb (null)', { ...READY, kb: null }, 'kb'],
  ['kb (empty string)', { ...READY, kb: '' }, 'kb'],
];
for (const [name, input, id] of ALONE) {
  test(`${name} false alone → not ready, "${id}" the only failing id`, () => {
    const r = projectReadiness(input);
    assert.equal(r.ready, false);
    assert.deepEqual(r.failing, [id]);
    assert.equal(r.checks.filter((c) => !c.ok).length, 1);
  });
}

test('north star of exactly 140 chars (trimmed) is ok — the boundary', () => {
  assert.equal(projectReadiness({ ...READY, northStar: ` ${'x'.repeat(140)} ` }).ready, true);
});

test('a failing HARD clause → preflight not ok, failing names preflight and the clause', () => {
  const r = projectReadiness({ ...READY, clauses: [{ clause: 'C4', hard: true, pass: false }, ...CLAUSES] });
  assert.equal(r.ready, false);
  assert.deepEqual(r.failing, ['preflight', 'C4']);
  assert.equal(r.checks.find((c) => c.id === 'preflight')!.ok, false);
});

test('clauses null (preflight not answered) → preflight not ok, not ready', () => {
  const r = projectReadiness({ ...READY, clauses: null });
  assert.equal(r.ready, false);
  assert.deepEqual(r.failing, ['preflight']);
});

test('the row texts are the ones Studio has always shown', () => {
  const r = projectReadiness(READY);
  assert.deepEqual(r.checks.slice(0, 5).map((c) => c.text), [
    'North star set (≤ 140 chars)',
    'Instructions present',
    'Demo has ≥ 1 capture + ≥ 1 verify step',
    '≥ 1 relevant skill bound',
    'Knowledge base bound',
  ]);
});

test('does not mutate its input', () => {
  const input = { ...READY, demoProcess: [...DEMO], skills: ['a'] };
  const before = JSON.stringify(input);
  projectReadiness(input);
  assert.equal(JSON.stringify(input), before);
});
