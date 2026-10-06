/**
 * Bead forge-8vfn.30.5 — an initiative id already present in the queue
 * (any state dir) must never be re-minted. A real run minted
 * `INIT-2026-10-05-coupling-sort-flag` while an earlier run's manifest of the
 * same id sat in `_queue/done/`; verify-cycle then accepted the OLD manifest as
 * "reached merge". The mint now uniquifies (`-2`, `-3` …) rather than refusing,
 * because a refusal would fail an unattended architect run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildManifest, mintUniqueInitiativeId } from '../../kinds/architect-manifest.ts';
import type { DraftInitiative } from '../../kinds/architect-session.ts';

const STATUS = {
  session_id: 'arch-2026-10-05',
  project: 'demo',
  project_repo_path: '/tmp/demo',
  phase: 'drafting',
  round: 1,
  idea: 'Something.',
  updated_at: '2026-10-05T00:00:00.000Z',
} as unknown as Parameters<typeof buildManifest>[1];

function draft(overrides: Partial<DraftInitiative> = {}): DraftInitiative {
  return {
    slug: 'coupling-sort-flag',
    title: 'Coupling sort flag',
    iteration_budget: 3,
    cost_budget_usd: 2,
    class: 'code',
    acceptance_criteria: [{ given: 'the CLI', when: '--sort is passed', then: 'it sorts' }],
    body: '# Body\n',
    ...overrides,
  };
}

const DATE = '2026-10-05';
const BASE = 'INIT-2026-10-05-coupling-sort-flag';

test('mintUniqueInitiativeId: a free id is returned unchanged', () => {
  assert.equal(mintUniqueInitiativeId(DATE, 'coupling-sort-flag', new Set()), BASE);
});

test('mintUniqueInitiativeId: a taken id gets -2, then -3 while those are taken too', () => {
  assert.equal(mintUniqueInitiativeId(DATE, 'coupling-sort-flag', new Set([BASE])), `${BASE}-2`);
  assert.equal(mintUniqueInitiativeId(DATE, 'coupling-sort-flag', new Set([BASE, `${BASE}-2`])), `${BASE}-3`);
});

test('buildManifest: an id left in the queue by an earlier run is not re-minted', () => {
  const m = buildManifest(draft(), STATUS, DATE, `${DATE}T00:00:00.000Z`, undefined, new Set([BASE]));
  assert.equal(m.initiative_id, `${BASE}-2`);
});

test('buildManifest: depends_on to a sibling resolves to the sibling\'s uniquified id', () => {
  const taken = new Set([BASE]);
  const m = buildManifest(
    draft({ slug: 'second', title: 'Second', depends_on: ['coupling-sort-flag'] }),
    STATUS, DATE, `${DATE}T00:00:00.000Z`, new Set(['coupling-sort-flag', 'second']), taken,
  );
  assert.deepEqual(m.depends_on_initiatives, [`${BASE}-2`]);
});
