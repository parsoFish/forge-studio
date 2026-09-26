/**
 * forge-8vfn.8.1.14 — the lifecycle derivation must treat the architect's new
 * `critiquing`/`revising` phases exactly like `drafting`: the runner's to
 * advance, not a stall/idle/terminal reading. `phaseShapeFor`
 * (`bridge-studio-lifecycle.ts`) falls back to `LEGACY_SESSION_WORKING_PHASES`
 * (`session-phases.ts`) for architect (no turnSpec/panel table) — a phase
 * missing from that table derives `working:false`, and a session sitting on
 * it past the stall ceiling reads `working` with `needsYou:false` forever
 * (the `failed-phase-terminal.test.ts` shape, on the working side of the same
 * table instead of the terminal side).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { phaseShapeFor } from '../../bridge-studio-lifecycle.ts';
import { loadSessionKinds } from '../../studio/session-kinds.ts';
import { FORGE_ROOT } from '@forge/kernel';

const architect = loadSessionKinds(FORGE_ROOT).find((k) => k.id === 'architect');
assert.ok(architect, 'the architect kind must exist in the real registry — this test is not about a fixture');

test('8.1.14: critiquing/revising derive working:true, awaits:null — the runner is working, not the operator', () => {
  for (const phase of ['critiquing', 'revising']) {
    const shape = phaseShapeFor(architect!, phase);
    assert.equal(shape.working, true, `phase '${phase}' must derive working:true, or a silent turn here reads idle-forever instead of eventually stalled`);
    assert.equal(shape.awaits, null, `phase '${phase}' is not an operator gate`);
  }
});

test('8.1.14 (positive control): the pre-existing drafting/finalizing phases are unchanged', () => {
  for (const phase of ['interviewing', 'exploring', 'drafting', 'finalizing']) {
    assert.equal(phaseShapeFor(architect!, phase).working, true, `phase '${phase}' regressed`);
  }
  for (const phase of ['awaiting-answers', 'awaiting-verdict']) {
    const shape = phaseShapeFor(architect!, phase);
    assert.equal(shape.working, false, `phase '${phase}' must stay an operator gate, not working`);
    assert.notEqual(shape.awaits, null);
  }
});
