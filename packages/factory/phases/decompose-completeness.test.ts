/**
 * decompose-completeness — unit tests (R4-05-T4, F6).
 *
 * Fixture shapes are lifted from the REAL manifest-body format already
 * exercised by the PM's own test suite (`project-manager-contract.test.ts`,
 * `cycle-pm-hallucination.test.ts`, `pm-turn-economy.test.ts`): a
 * `## Acceptance criteria` section containing one or more comma-joined
 * prose sentences of the shape "Given X, when Y, then Z." — NOT a bulleted
 * or YAML-keyed list. Secondary shapes (multi-line Gherkin block, YAML
 * `given:`/`when:`/`then:` triplet) are also covered since the architect
 * SKILL only mandates "GWT blocks" without pinning one exact syntax.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkDecomposeCompleteness } from './decompose-completeness.ts';
import type { WorkItem } from '../work-item.ts';

/** Minimal, valid-shaped WorkItem fixture builder — only the fields the
 * completeness checker actually reads are varied per test. */
function makeWi(opts: {
  wiId: string;
  given: string;
  when: string;
  then: string;
  body?: string;
  files?: string[];
}): WorkItem {
  return {
    work_item_id: opts.wiId,
    initiative_id: 'INIT-2026-07-18-completeness-test',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: opts.given, when: opts.when, then: opts.then }],
    files_in_scope: opts.files ?? ['src/index.ts'],
    estimated_iterations: 1,
    body: opts.body ?? `Implements ${opts.given} ${opts.when} ${opts.then}`,
  };
}

test('well-covered decomposition (prose GWT, near-verbatim WI ACs) → flagged: false', () => {
  const body = `# Payments initiative

## Acceptance criteria

Given a user submits a valid payment request, when the payment gateway processes it, then the transaction is recorded as completed.

Given a user submits an invalid card number, when the payment gateway validates it, then the request is rejected with a 400 error.

### Not in scope

This initiative does not implement refunds or chargebacks.
`;
  const items: WorkItem[] = [
    makeWi({
      wiId: 'WI-1',
      given: 'a user submits a valid payment request',
      when: 'the payment gateway processes it',
      then: 'the transaction is recorded as completed',
    }),
    makeWi({
      wiId: 'WI-2',
      given: 'a user submits an invalid card number',
      when: 'the payment gateway validates it',
      then: 'the request is rejected with a 400 error',
    }),
  ];

  const result = checkDecomposeCompleteness(body, items);
  assert.equal(result.statedUnits, 2);
  assert.equal(result.coveredUnits, 2);
  assert.deepEqual(result.uncovered, []);
  assert.equal(result.flagged, false);
});

test('under-decomposed (3 stated units, 1 WI-domain entirely absent) → flagged: true with the uncovered unit listed', () => {
  const body = `# Payments initiative

## Acceptance criteria

Given a user submits a valid payment request, when the payment gateway processes it, then the transaction is recorded as completed.

Given a user submits an invalid card number, when the payment gateway validates it, then the request is rejected with a 400 error.

Given an admin requests an audit export, when they click the export button, then a CSV file downloads within five seconds.
`;
  const items: WorkItem[] = [
    makeWi({
      wiId: 'WI-1',
      given: 'a user submits a valid payment request',
      when: 'the payment gateway processes it',
      then: 'the transaction is recorded as completed',
    }),
    makeWi({
      wiId: 'WI-2',
      given: 'a user submits an invalid card number',
      when: 'the payment gateway validates it',
      then: 'the request is rejected with a 400 error',
    }),
  ];

  const result = checkDecomposeCompleteness(body, items);
  assert.equal(result.statedUnits, 3);
  assert.equal(result.coveredUnits, 2);
  assert.equal(result.uncovered.length, 1);
  assert.match(result.uncovered[0]!, /audit export/i);
  assert.equal(result.flagged, true);
});

test('empty body → statedUnits: 0, flagged: false (no guessing)', () => {
  const items: WorkItem[] = [
    makeWi({ wiId: 'WI-1', given: 'a', when: 'b', then: 'c' }),
  ];
  const result = checkDecomposeCompleteness('', items);
  assert.equal(result.statedUnits, 0);
  assert.equal(result.coveredUnits, 0);
  assert.deepEqual(result.uncovered, []);
  assert.equal(result.flagged, false);
});

test('unparseable body (prose, no GWT/EARS shape at all) → statedUnits: 0, flagged: false', () => {
  const body = `# Some initiative

This initiative improves the onboarding flow. It should feel snappier and
reduce drop-off. No acceptance-criteria structure is stated here at all.
`;
  const items: WorkItem[] = [
    makeWi({ wiId: 'WI-1', given: 'a', when: 'b', then: 'c' }),
  ];
  const result = checkDecomposeCompleteness(body, items);
  assert.equal(result.statedUnits, 0);
  assert.equal(result.flagged, false);
});

test('zero work items + ≥1 stated unit → every unit uncovered, flagged: true', () => {
  const body = `## Acceptance criteria

Given a user opens the settings page, when they toggle dark mode, then the theme flips instantly.
`;
  const result = checkDecomposeCompleteness(body, []);
  assert.equal(result.statedUnits, 1);
  assert.equal(result.coveredUnits, 0);
  assert.equal(result.uncovered.length, 1);
  assert.equal(result.flagged, true);
});

test('multi-line Gherkin-style block (no commas) is also recognised as one stated unit', () => {
  const body = `## Acceptance criteria

Given the user is on the settings page
When they toggle dark mode
Then the theme flips instantly.
`;
  const items: WorkItem[] = [
    makeWi({
      wiId: 'WI-1',
      given: 'the user is on the settings page',
      when: 'they toggle dark mode',
      then: 'the theme flips instantly',
    }),
  ];
  const result = checkDecomposeCompleteness(body, items);
  assert.equal(result.statedUnits, 1);
  assert.equal(result.flagged, false);
});

test('YAML-keyed given:/when:/then: triplet (secondary real shape, per architect-plan.ts renderer) is recognised', () => {
  const body = `## Acceptance criteria

- given: "the system is idle"
  when:  "a scheduled job fires"
  then:  "the job result is persisted to the audit table"
`;
  const items: WorkItem[] = [
    makeWi({
      wiId: 'WI-1',
      given: 'the system is idle',
      when: 'a scheduled job fires',
      then: 'the job result is persisted to the audit table',
    }),
  ];
  const result = checkDecomposeCompleteness(body, items);
  assert.equal(result.statedUnits, 1);
  assert.equal(result.flagged, false);
});

test('"### Not in scope" content is excluded even when GWT-shaped (guards against false-positive uncovered flags)', () => {
  const body = `## Acceptance criteria

Given a user submits a valid payment request, when the payment gateway processes it, then the transaction is recorded as completed.

### Not in scope

Given a user requests a refund, when they contact support, then a refund is NOT automatically processed by this initiative.
`;
  const items: WorkItem[] = [
    makeWi({
      wiId: 'WI-1',
      given: 'a user submits a valid payment request',
      when: 'the payment gateway processes it',
      then: 'the transaction is recorded as completed',
    }),
  ];
  const result = checkDecomposeCompleteness(body, items);
  // Only the ONE in-scope AC counts — the Not-in-scope GWT-shaped sentence
  // must not be picked up as a second stated unit (it would always be
  // "uncovered" by design, a guaranteed false positive).
  assert.equal(result.statedUnits, 1);
  assert.equal(result.flagged, false);
});

test('a stated unit with no significant content words is treated as trivially covered (conservative default)', () => {
  const body = `## Acceptance criteria

Given it, when it, then it.
`;
  const result = checkDecomposeCompleteness(body, []);
  assert.equal(result.statedUnits, 1);
  assert.equal(result.flagged, false, 'a unit with no meaningful tokens must not be flagged uncovered');
});
