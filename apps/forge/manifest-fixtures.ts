/**
 * The shared manifest fixture — one `realManifest`, at the assembly.
 *
 * M4 ruling 83's row-5 obligation (mechanics settled by ruling 91): the tests
 * that read back what the REAL manifest functions write cannot live in
 * `packages/sessions`, because flows is rank 5 and sessions rank 4, so naming
 * `serializeManifest` there is a `package-layer-order` violation. They move
 * here, where the assembly may import both, and a hand-rolled serializer is
 * expressly NOT the alternative — it would let a test assert a format the
 * product never produces, which is the failure mode ruling 83 named.
 *
 * `realManifest` was defined THREE times before this file existed — once each
 * in `bridge-studio-sessions.test.ts`, `studio/session-transcript.test.ts` and
 * `tests/integration/architect-runner.test.ts` (where it was in fact dead: 0
 * of that file's 35 tests used it). Ruling 91 forbids duplicating a fixture
 * across the files that need it, so the shape lives once, here.
 *
 * It is a `.ts` and not a `.test.ts` on purpose — it defines no tests — and it
 * sits under `apps/forge/`, which `check-owner` quarries, so it carries a
 * QUARRY row like any other file here.
 */
import type { InitiativeManifest } from '@forge/contracts/manifest-types.ts';

/**
 * A manifest with every required field populated, so `serializeManifest`
 * produces a genuine document rather than one the parser would reject.
 *
 * Overrides are shallow and deliberately unvalidated: a case that wants a
 * malformed manifest passes the malformation, and the cast is what lets it.
 */
export function realManifest(overrides: Partial<InitiativeManifest> = {}): InitiativeManifest {
  return {
    initiative_id: 'INIT-2026-01-01-fixture-a',
    project: 'demoproj',
    project_repo_path: '/tmp/demoproj',
    created_at: '2026-01-01T00:00:00.000Z',
    iteration_budget: 10,
    cost_budget_usd: 5,
    phase: 'pending',
    origin: 'architect',
    body: '# Fixture initiative\n\nDo the thing.\n',
    ...overrides,
  } as InitiativeManifest;
}
