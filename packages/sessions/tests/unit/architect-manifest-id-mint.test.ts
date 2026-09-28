/**
 * Row 129 (bead forge-8vfn.8.1.56) — minting an initiative id must not double
 * its date prefix. `buildManifest` always applies `INIT-<mint-date>-` in
 * front of the architect's slug, but the slug itself can already carry a
 * date (or the literal `INIT-` token) when the architect's own output
 * echoes one back. Real runs minted
 * `INIT-2026-09-26-2026-09-26-exclude-author-flag` (S10 run 34) and
 * `INIT-2026-09-27-2026-09-28-exclude-author-filter` (run 41 — note the two
 * dates DIFFER, the slug carried the PREVIOUS day's date). Minting must
 * strip any such prefix off the slug first, so the mint date always appears
 * exactly once regardless of what the slug already carried.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildManifest } from '../../kinds/architect-manifest.ts';
import type { DraftInitiative } from '../../kinds/architect-session.ts';

const STATUS = {
  session_id: 'arch-2026-09-26',
  project: 'demo',
  project_repo_path: '/tmp/demo',
  phase: 'drafting',
  round: 1,
  idea: 'Something.',
  updated_at: '2026-09-26T00:00:00.000Z',
} as unknown as Parameters<typeof buildManifest>[1];

function draft(overrides: Partial<DraftInitiative> = {}): DraftInitiative {
  return {
    slug: 'add-thing',
    title: 'Add thing',
    iteration_budget: 3,
    cost_budget_usd: 2,
    class: 'code',
    acceptance_criteria: [{ given: 'the CLI', when: '--flag is passed', then: 'it is honoured' }],
    body: '# Body\n',
    ...overrides,
  };
}

const build = (d: DraftInitiative, datePart: string) =>
  buildManifest(d, STATUS, datePart, `${datePart}T00:00:00.000Z`);

test('row 129: an ordinary slug mints normally — control case', () => {
  const m = build(draft({ slug: 'add-thing' }), '2026-09-28');
  assert.equal(m.initiative_id, 'INIT-2026-09-28-add-thing');
});

test('row 129: S10 run 34 — a slug already carrying the SAME mint date is not doubled', () => {
  const m = build(draft({ slug: '2026-09-26-exclude-author-flag' }), '2026-09-26');
  assert.equal(m.initiative_id, 'INIT-2026-09-26-exclude-author-flag');
});

test('row 129: S10 run 41 — a slug carrying a DIFFERENT date is replaced by the mint date, not doubled', () => {
  const m = build(draft({ slug: '2026-09-28-exclude-author-filter' }), '2026-09-27');
  assert.equal(m.initiative_id, 'INIT-2026-09-27-exclude-author-filter');
});

test('row 129: a slug that already starts with INIT- is not doubled', () => {
  const m = build(draft({ slug: 'INIT-2026-09-28-foo' }), '2026-09-28');
  assert.equal(m.initiative_id, 'INIT-2026-09-28-foo');
});

test('row 129: a slug that is nothing but an id prefix is refused, never minted as a stand-in name', () => {
  assert.throws(
    () => build(draft({ slug: '2026-09-28' }), '2026-09-28'),
    /is only an id prefix — no initiative name is left to mint/,
  );
});
