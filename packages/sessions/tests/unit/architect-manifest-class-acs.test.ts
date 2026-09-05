/**
 * ADR 051 acceptance — `buildManifest` REFUSES a draft that omits the change
 * class or malforms a criterion, instead of degrading the way `title` does.
 *
 * WHY THE CONTRAST MATTERS, and what each test kills. `buildManifest` reads its
 * draft from `runStructured`, which CASTS raw model output rather than checking
 * it, so a field the model omits arrives as `undefined` with no complaint. For
 * `title` that is the right trade — a missing title costs a nicer label. For
 * these two it is not: the class selects the gates the work is judged by, and a
 * criterion nobody parsed is one review cannot return a verdict on. The wrong
 * implementation these tests kill is the tempting one — default the class to
 * `code` and skip the criteria that do not parse — which is exactly the
 * declared-data-fails-open shape ADR 051 exists to close.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildManifest } from '../../kinds/architect-manifest.ts';
import type { DraftInitiative } from '../../kinds/architect-session.ts';

const STATUS = {
  session_id: 'arch-2026-09-05',
  project: 'demo',
  project_repo_path: '/tmp/demo',
  phase: 'drafting',
  round: 1,
  idea: 'Something.',
  updated_at: '2026-09-05T00:00:00.000Z',
} as unknown as Parameters<typeof buildManifest>[1];

function draft(overrides: Partial<DraftInitiative> = {}): DraftInitiative {
  return {
    slug: 'add-a-flag',
    title: 'Add a flag',
    iteration_budget: 3,
    cost_budget_usd: 2,
    class: 'code',
    acceptance_criteria: [{ given: 'the CLI', when: '--flag is passed', then: 'it is honoured' }],
    body: '# Body\n',
    ...overrides,
  };
}

const build = (d: DraftInitiative) => buildManifest(d, STATUS, '2026-09-05', '2026-09-05T00:00:00.000Z');

test('ADR 051: a well-formed draft carries its class and criteria onto the manifest', () => {
  const m = build(draft());
  assert.equal(m.class, 'code');
  assert.deepEqual(m.acceptance_criteria, [{ given: 'the CLI', when: '--flag is passed', then: 'it is honoured' }]);
});

test('ADR 051: a draft with NO class is refused, and the message names the initiative and what arrived — kills "default to code"', () => {
  const d = draft();
  delete (d as { class?: unknown }).class;
  assert.throws(() => build(d), /architect draft "add-a-flag": class must be one of code \| docs \| config \| infra, got undefined/);
});

test('ADR 051: a draft with an unknown class is refused rather than coerced — kills "any string is a class"', () => {
  assert.throws(
    () => build(draft({ class: 'chore' as unknown as DraftInitiative['class'] })),
    /class must be one of .*got "chore"/,
  );
});

test('ADR 051: a draft with NO criteria is refused — an initiative review cannot judge is not a plan', () => {
  assert.throws(() => build(draft({ acceptance_criteria: [] })), /acceptance_criteria must be a non-empty list/);
});

test('ADR 051: a malformed criterion is refused BY INDEX — kills "skip the ones that do not parse"', () => {
  assert.throws(
    () => build(draft({
      acceptance_criteria: [
        { given: 'ok', when: 'ok', then: 'ok' },
        { given: 'ok', when: 'ok', then: '   ' },
      ],
    })),
    /acceptance_criteria\[1\]\.then must be a non-empty string/,
  );
});

test('ADR 051: an EMPTY when survives — a criterion may be a state assertion with no trigger', () => {
  const m = build(draft({ acceptance_criteria: [{ given: 'roadmap.md exists', when: '', then: 'it names the follow-on' }] }));
  assert.equal(m.acceptance_criteria[0]?.when, '');
});
