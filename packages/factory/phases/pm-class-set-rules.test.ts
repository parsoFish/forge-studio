/**
 * ADR 051 — `singleWiAllowed` as a FLAG at the project manager (ruling 229 half
 * A). The GATE for this column runs at the plan gate on the declared criteria,
 * before any spend; these tests cover the observation made afterwards.
 *
 * WHICH WRONG IMPLEMENTATION EACH TEST KILLS is named per case. Two matter:
 * a rule written as `if (items.length === 1)` reads correctly against a `code`
 * initiative and is WRONG for `docs`, where one work item is the normal shape;
 * and a flag that FAILED the pass would punish the PM for the architect's
 * scoping — a one-item decomposition of a genuinely one-item initiative is the
 * PM being correct.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { underDecomposedFlag } from './pm-class-set-rules.ts';
import { CLASS_PROFILES } from '../class-profiles.ts';
import type { InitiativeManifest } from '@forge/flows/manifest.ts';
import type { WorkItem } from '@forge/flows/work-item.ts';

function manifest(cls: InitiativeManifest['class']): InitiativeManifest {
  return {
    initiative_id: 'INIT-2026-09-05-x',
    project: 'demo',
    project_repo_path: '/tmp/demo',
    created_at: '2026-09-05T00:00:00.000Z',
    iteration_budget: 3,
    cost_budget_usd: 2,
    class: cls,
    acceptance_criteria: [{ given: 'a', when: 'b', then: 'c' }],
    phase: 'in-flight',
    origin: 'architect',
    body: '# body',
  };
}

function wi(id: string): WorkItem {
  return {
    work_item_id: id,
    initiative_id: 'INIT-2026-09-05-x',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: 'a', when: 'b', then: 'c' }],
    files_in_scope: ['src/a.ts'],
    creates: ['src/a.ts'],
    estimated_iterations: 1,
    quality_gate_cmd: ['node', '--test'],
    body: 'do it',
  };
}

test('ADR 051: a ONE-item code decomposition produces a flag naming the class and the work item', () => {
  const flag = underDecomposedFlag(manifest('code'), [wi('WI-1')]);
  assert.ok(flag, 'expected a flag');
  assert.match(flag, /code initiative decomposed to ONE work item \(WI-1\)/);
  assert.match(flag, /not enforced here/, 'the message says it is an observation, not a verdict');
});

test('ADR 051: the same one-item set is CLEAN for docs — kills "if (items.length === 1)"', () => {
  assert.equal(underDecomposedFlag(manifest('docs'), [wi('WI-1')]), null);
  assert.equal(underDecomposedFlag(manifest('config'), [wi('WI-1')]), null);
});

test('ADR 051: two items are clean for every class — the rule is about ONE, not about "few"', () => {
  for (const cls of ['code', 'docs', 'config', 'infra'] as const) {
    assert.equal(underDecomposedFlag(manifest(cls), [wi('WI-1'), wi('WI-2')]), null, cls);
  }
});

test('ADR 051: an EMPTY set is not this rule\'s business — "the PM produced nothing" is its own failure', () => {
  for (const cls of ['code', 'docs', 'config', 'infra'] as const) {
    assert.equal(underDecomposedFlag(manifest(cls), []), null, cls);
  }
});

test('ADR 051: the verdict follows the TABLE, not a list in this file — change the table and the rule changes with it', () => {
  // Reads the profile the rule reads. If someone re-derived `singleWiAllowed`
  // from a class name here, this test would still pass — so it is paired with
  // the conformance test's no-branching check, which fails on exactly that.
  for (const cls of ['code', 'docs', 'config', 'infra'] as const) {
    const expected = CLASS_PROFILES[cls].singleWiAllowed ? null : 'flagged';
    const got = underDecomposedFlag(manifest(cls), [wi('WI-1')]) === null ? null : 'flagged';
    assert.equal(got, expected, cls);
  }
});
