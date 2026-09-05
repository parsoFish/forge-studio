/**
 * ADR 051 decision 4 / ruling 229 half B — the plan gate's class rule.
 *
 * WHICH WRONG IMPLEMENTATION EACH TEST KILLS is named per case. Two matter most:
 * a rule that fires without a table installed would make the PLATFORM enforce
 * the example's policy (ADR 048 says a deleted factory takes its policy with
 * it), and a rule that treats an unknown class as forbidden would refuse plans
 * on a table that never spoke to them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planGateClassRefusals, type PlanGateInitiative } from './plan-gate-class-check.ts';

const CODE_SINGLE: PlanGateInitiative = { initiative_id: 'INIT-A', class: 'code', acceptanceCriteriaCount: 1 };
const DOCS_SINGLE: PlanGateInitiative = { initiative_id: 'INIT-B', class: 'docs', acceptanceCriteriaCount: 1 };
const CODE_THREE: PlanGateInitiative = { initiative_id: 'INIT-C', class: 'code', acceptanceCriteriaCount: 3 };

/** The shipped table's answers, without importing the deletable package. */
const table = (cls: string): boolean | null =>
  cls === 'code' || cls === 'infra' ? false : cls === 'docs' || cls === 'config' ? true : null;

test('a one-criterion code initiative is REFUSED, and the message names both ways out', () => {
  const refusals = planGateClassRefusals([CODE_SINGLE], table);
  assert.equal(refusals.length, 1);
  assert.match(refusals[0]!, /INIT-A/);
  assert.match(refusals[0]!, /Split it into criteria/);
  assert.match(refusals[0]!, /docs, config/, 'a refusal that does not say what to do instead is a wall');
});

test('a one-criterion DOCS initiative is fine — kills "refuse every single-criterion plan"', () => {
  assert.deepEqual(planGateClassRefusals([DOCS_SINGLE], table), []);
});

test('a three-criterion code initiative is fine — the rule is about ONE, not about "few"', () => {
  assert.deepEqual(planGateClassRefusals([CODE_THREE], table), []);
});

test('with NO lookup installed the rule does not fire — kills "the platform enforces the example factory\'s policy"', () => {
  // ADR 048: deleting `packages/factory` takes its policy with it. A plan gate
  // that still refused on a class profile would make the example undeletable in
  // everything but name.
  assert.deepEqual(planGateClassRefusals([CODE_SINGLE], undefined), []);
});

test('an UNKNOWN class is not refused — kills "treat null as forbidden"', () => {
  const unknown: PlanGateInitiative = { initiative_id: 'INIT-D', class: 'chore', acceptanceCriteriaCount: 1 };
  assert.deepEqual(planGateClassRefusals([unknown], table), [],
    'a table with no row for a class has no opinion about it — refusing would invent one');
});

test('every offending initiative is reported, not just the first — kills "return on the first refusal"', () => {
  const second: PlanGateInitiative = { initiative_id: 'INIT-E', class: 'infra', acceptanceCriteriaCount: 1 };
  const refusals = planGateClassRefusals([CODE_SINGLE, DOCS_SINGLE, second], table);
  assert.deepEqual(refusals.map((r) => r.split(':')[0]), ['INIT-A', 'INIT-E']);
});
