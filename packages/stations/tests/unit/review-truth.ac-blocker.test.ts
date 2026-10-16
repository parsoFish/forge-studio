/**
 * forge-mfv5.1.43 — a review finding that contradicts one of the work items'
 * own acceptance criteria is a BLOCKER, never a major: I3b round 2 reached
 * pr-open with AC1/AC3/AC5 unmet and flagged only as majors. The finding cites
 * the criterion by `acRef` (copied verbatim, the same rule `acEvaluations` obeys).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ReviewFinding } from '@forge/flows';

import { escalateAcFindings } from '../../phases/review-truth.ts';

const AC3 = '(WI-14) GIVEN the gitweave package WHEN searching for FORGE_RESOURCE_PREFIX THEN there is no match';
const finding = (over: Partial<ReviewFinding>): ReviewFinding => ({
  id: 'RF-1', severity: 'major', category: 'correctness', title: 't', detail: 'd', evidence: [{ file: 'gitweave/plan.py', line: 12 }], ...over,
});

test('a major citing an injected criterion is classed blocker, and says why', () => {
  const [f] = escalateAcFindings([finding({ acRef: AC3 })], [AC3]);
  assert.equal(f!.severity, 'blocker');
  assert.match(f!.detail, /contradicts acceptance criterion .*WI-14.* — classed blocker \(was major\)/);
});

test('a minor citing a criterion is a blocker too; an info stays info (an observation, not a contradiction)', () => {
  const out = escalateAcFindings([finding({ severity: 'minor', acRef: AC3 }), finding({ id: 'RF-2', severity: 'info', acRef: AC3 })], [AC3]);
  assert.deepEqual(out.map((f) => f.severity), ['blocker', 'info']);
});

test('control: a non-AC major, or an acRef naming no injected criterion, is unchanged', () => {
  const plain = finding({});
  const stray = finding({ id: 'RF-2', acRef: 'WI-99' });
  const out = escalateAcFindings([plain, stray], [AC3]);
  assert.deepEqual(out, [plain, stray]);
});

test('inputs are never mutated', () => {
  const f = finding({ acRef: AC3 });
  escalateAcFindings([f], [AC3]);
  assert.equal(f.severity, 'major');
});
