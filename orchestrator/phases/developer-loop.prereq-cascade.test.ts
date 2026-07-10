/**
 * Item 2.4 / N9 (brain/cycles/themes/2026-07-04-rate-limit-crash-prereq-failed-
 * cascade.md): when a work item dies for an ENVIRONMENT reason (rate-limit hit
 * — time-bounded, not a code defect), its dependents must be left QUEUED
 * (`pending`) for the cycle's transient auto-retry, not cascaded to `failed`
 * with reason `prerequisite-failed`. Only a genuine WORK failure of a
 * prerequisite still fails its dependents.
 *
 * Tests drive the exported pure decision function `prerequisiteBlockage`
 * (the dev-loop and unifier per-item loops are its only production callers),
 * following the repo pattern of testing exported functions directly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { prerequisiteBlockage } from './developer-loop.ts';
import type { WorkItem } from '../work-item.ts';

function wi(id: string, dependsOn: string[]): WorkItem {
  return {
    work_item_id: id,
    initiative_id: 'INIT-2026-07-04-fixture',
    status: 'pending',
    depends_on: dependsOn,
    acceptance_criteria: [],
    files_in_scope: [],
    estimated_iterations: 3,
    body: '',
  };
}

type Outcome = { id: string; status: WorkItem['status']; environment?: boolean };

test('prerequisiteBlockage: no dependencies → none', () => {
  assert.equal(prerequisiteBlockage(wi('WI-2', []), []), 'none');
});

test('prerequisiteBlockage: all prerequisites complete → none', () => {
  const outcomes: Outcome[] = [{ id: 'WI-1', status: 'complete' }];
  assert.equal(prerequisiteBlockage(wi('WI-2', ['WI-1']), outcomes), 'none');
});

test('prerequisiteBlockage: prerequisite failed for a WORK reason → work-failure (existing cascade preserved)', () => {
  const outcomes: Outcome[] = [{ id: 'WI-1', status: 'failed' }];
  assert.equal(prerequisiteBlockage(wi('WI-2', ['WI-1']), outcomes), 'work-failure');
});

test('prerequisiteBlockage: prerequisite failed for an ENVIRONMENT reason (rate-limit) → environment-failure, dependents stay queued', () => {
  const outcomes: Outcome[] = [{ id: 'WI-1', status: 'failed', environment: true }];
  assert.equal(prerequisiteBlockage(wi('WI-2', ['WI-1']), outcomes), 'environment-failure');
});

test('prerequisiteBlockage: transitive — a dependent left pending by an environment skip blocks ITS dependents as environment too', () => {
  // WI-1 env-failed; WI-2 was left pending (environment skip); WI-3 depends
  // only on WI-2 and must not run against missing prerequisite work — but it
  // must also not be marked failed.
  const outcomes: Outcome[] = [
    { id: 'WI-1', status: 'failed', environment: true },
    { id: 'WI-2', status: 'pending', environment: true },
  ];
  assert.equal(prerequisiteBlockage(wi('WI-3', ['WI-2']), outcomes), 'environment-failure');
});

test('prerequisiteBlockage: a genuine work failure DOMINATES an environment failure across mixed prerequisites', () => {
  const outcomes: Outcome[] = [
    { id: 'WI-1', status: 'failed', environment: true },
    { id: 'WI-2', status: 'failed' },
  ];
  assert.equal(prerequisiteBlockage(wi('WI-3', ['WI-1', 'WI-2']), outcomes), 'work-failure');
});

test('prerequisiteBlockage: unifier-item shaped outcomes (no environment flag anywhere) behave exactly like the old prerequisiteFailed', () => {
  const uwiOutcomes = [
    { id: 'UWI-1', status: 'failed' as const, result: null, failureClass: 'dev-loop-unifier-gate-failed', runnerError: null, crashed: false },
  ];
  assert.equal(prerequisiteBlockage(wi('UWI-2', ['UWI-1']), uwiOutcomes), 'work-failure');
});
