/**
 * Unit tests for packages/stations/phases/pm-acceptance-gate.ts.
 *
 * Row 157 (bead forge-8vfn.8.1.45, ruling 1873): the acceptance-gate
 * requirement text is ONE source shared by the brief (pm-binding.ts) and the
 * post-hoc violation message (project-manager.ts) — `describeAcceptanceRequirement`
 * — and `acceptanceGateViolation` is the ONE check shared by the first pass
 * and the post-revise re-check.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeAcceptanceRequirement, acceptanceGateViolation } from '../../phases/pm-acceptance-gate.ts';
import type { WorkItem } from '@forge/flows';

function wi(overrides: Partial<WorkItem> & { work_item_id: string }): WorkItem {
  return {
    initiative_id: 'INIT-2026-09-27-test',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: 'a', when: 'b', then: 'c' }],
    files_in_scope: ['src/foo.ts'],
    estimated_iterations: 1,
    body: 'Body.',
    ...overrides,
  };
}

test('describeAcceptanceRequirement: null for an advisory class', () => {
  assert.equal(describeAcceptanceRequirement('advisory', { match: 'acceptancetests' }), null);
});

test('describeAcceptanceRequirement: names the match + "the acceptance suite" with no requires_env', () => {
  const text = describeAcceptanceRequirement('required', { match: 'acceptancetests' });
  assert.match(text ?? '', /"acceptancetests"/);
  assert.match(text ?? '', /the acceptance suite/);
  assert.ok(!text?.includes('live acceptance suite'), 'a creds-free gate must not claim "live"');
});

test(
  'describeAcceptanceRequirement: names "the live acceptance suite" + the env ' +
    'vars when requires_env is set',
  () => {
    const text = describeAcceptanceRequirement('required', {
      match: 'acceptancetests',
      requires_env: ['TF_ACC'],
    });
    assert.match(text ?? '', /live acceptance suite/);
    assert.match(text ?? '', /TF_ACC/);
  },
);

test('acceptanceGateViolation: null for an advisory class regardless of items', () => {
  assert.equal(acceptanceGateViolation([], 'advisory', { match: 'acceptancetests' }), null);
});

test('acceptanceGateViolation: null when a WI\'s gate already targets the match', () => {
  const items = [wi({ work_item_id: 'WI-1', quality_gate_cmd: ['go', 'test', './acceptancetests/...'] })];
  assert.equal(acceptanceGateViolation(items, 'required', { match: 'acceptancetests' }), null);
});

test('acceptanceGateViolation: a message naming the requirement when no WI matches', () => {
  const items = [wi({ work_item_id: 'WI-1', quality_gate_cmd: ['go', 'test', './...'] })];
  const violation = acceptanceGateViolation(items, 'required', { match: 'acceptancetests' });
  assert.match(violation ?? '', /no acceptance work item/);
  assert.match(violation ?? '', /"acceptancetests"/);
});
