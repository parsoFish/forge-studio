/**
 * ADR 051 decision 5 — the third `creates:` rule, in its own file.
 *
 * These belong beside `validateCompiledWorkItemSet`'s other creates tests in
 * `wi-spec-compile.test.ts`, and they are here instead because that file is
 * 1,059 lines against the 800-line cap and its exemption is a CEILING, not a
 * licence: adding 55 lines of new tests to it would raise a baseline that is
 * only allowed to shrink. The subject is named in the filename so the pairing
 * is not lost.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateCompiledWorkItemSet } from '../../phases/wi-spec-compile.ts';
import type { WorkItem } from '../../work-item.ts';

function fixture(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    work_item_id: 'WI-1',
    initiative_id: 'INIT-2026-05-08-demo',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: 'a request', when: 'the handler runs', then: 'it returns 200' }],
    files_in_scope: ['src/handler.ts'],
    creates: ['src/handler.ts'],
    estimated_iterations: 2,
    quality_gate_cmd: ['node', '--test', 'tests/handler.test.ts'],
    body: 'Implement the handler.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ADR 051 decision 5 — the third `creates:` rule: a path git will never see
//
// The defect it closes: the required-paths check reads the DIFF for a WI's
// `creates:` paths, so one under a gitignored directory can never appear there
// and the check passes on its ABSENCE — the work is graded done because the
// evidence it looks for is invisible. The predicate is injected, so the rule is
// testable without a repository; that the real `git check-ignore` half tells
// the truth is proven in `packages/flows/phases/gitignored-creates.test.ts`.
// ---------------------------------------------------------------------------

test('ADR 051: a gitignored creates entry is a compile error naming the path AND the consequence', () => {
  const errors = validateCompiledWorkItemSet(
    [fixture({ files_in_scope: ['_scratch/notes.md'], creates: ['_scratch/notes.md'] })],
    (p) => p === '_scratch/notes.md',
  );
  const hit = errors.find((e) => e.includes('_scratch/notes.md') && e.includes('gitignored'));
  assert.ok(hit, `expected a gitignored-creates error, got ${JSON.stringify(errors)}`);
  assert.match(hit, /required-paths check/, 'a rule that only says it fired teaches nothing — the message names what breaks');
});

test('ADR 051: the SAME set is clean when the predicate says not ignored — kills "flag every creates entry"', () => {
  const errors = validateCompiledWorkItemSet(
    [fixture({ files_in_scope: ['_scratch/notes.md'], creates: ['_scratch/notes.md'] })],
    () => false,
  );
  assert.deepEqual(errors.filter((e) => e.includes('gitignored')), []);
});

test('ADR 051: with NO predicate the rule does not run — a caller with no repository must not accuse', () => {
  const errors = validateCompiledWorkItemSet([
    fixture({ files_in_scope: ['_scratch/notes.md'], creates: ['_scratch/notes.md'] }),
  ]);
  assert.deepEqual(errors.filter((e) => e.includes('gitignored')), []);
});

test('ADR 051: every entry is checked, not just the first — kills "test creates[0]"', () => {
  const errors = validateCompiledWorkItemSet(
    [fixture({
      files_in_scope: ['src/a.ts', 'build/b.js', 'build/c.js'],
      creates: ['src/a.ts', 'build/b.js', 'build/c.js'],
    })],
    (p) => p.startsWith('build/'),
  );
  assert.equal(errors.filter((e) => e.includes('gitignored')).length, 2);
});

test('ADR 051: the new rule does not displace the two ADR 037 creates rules it sits beside', () => {
  const noCreates = validateCompiledWorkItemSet(
    [fixture({ creates: undefined, verification_artifact: undefined })],
    () => true,
  );
  assert.ok(noCreates.some((e) => e.includes('creates is required (ADR 037)')), 'the mandatory-with-escape rule still fires');
});
