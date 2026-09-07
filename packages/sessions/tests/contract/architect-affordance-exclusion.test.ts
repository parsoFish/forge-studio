/**
 * Ruling 382 — the architect's exclusion from the generic WRITABLE affordance
 * is RATIFIED, and this file is what makes the ratification checkable.
 *
 * The exclusion is not a special case written into the dispatch; it is
 * structural. `bridge-studio-sessions-affordance-shell.ts`'s
 * `LegacySpawnableAgentId` names the kinds the generic affordance route may
 * spawn a turn for, and architect is absent from it — which is safe ONLY
 * because architect carries neither a `panel` nor a `turnSpec`, so no phase of
 * it can derive a writable affordance for the route to dispatch in the first
 * place. Delete either half — table the architect's phases, or add `architect`
 * to that union — and this file goes red.
 *
 * WHY IT IS RATIFIED RATHER THAN FIXED (the full reasoning is in
 * `packages/sessions/design.md`). The architect's operator moment is an
 * interview with structured options, not a free-text answer box: it renders
 * `ArchitectQuestionForm` with `data-question-freetext` and its own
 * `submit-answers`, and its verdict is the PLAN GATE, a distinct surface with
 * approve/revise/reject. Giving it the generic `data-field="session-answer"`
 * panel as well would publish TWO writable surfaces for one decision — and
 * bead `forge-8vfn.6.11.21` records what that ambiguity already cost: S2 beat
 * 12 and S1 beat 6 were both authored against `session-answer` on the
 * architect, a handle it has never published, and both were red for as long as
 * the assumption stood.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadSessionKinds } from '../../studio/session-kinds.ts';
import { deriveSessionAffordances } from '../../studio/session-kinds-affordances.ts';
import { REPO_ROOT, byId } from './test-fixtures/session-kinds-core.ts';

/** Every phase `kinds/architect.ts`'s state machine actually writes to
 *  `status.json` — the list that WOULD carry affordances if anyone tabled the
 *  architect, which is exactly the change this file exists to catch. */
const ARCHITECT_PHASES = [
  'interviewing', 'awaiting-answers', 'exploring', 'drafting',
  'awaiting-verdict', 'finalizing', 'committed', 'rejected',
] as const;

describe('ruling 382 — the architect publishes no generic writable affordance', () => {
  it('carries NEITHER a panel NOR a turnSpec — the structural fact the exclusion rests on', () => {
    const architect = byId(loadSessionKinds(REPO_ROOT), 'architect') as Record<string, unknown>;
    assert.equal(architect.panel, undefined, 'a panel would derive affordances for a kind the generic route may not spawn');
    assert.equal(architect.turnSpec, undefined, 'and so would a turnSpec');
  });

  it('derives [] for EVERY phase its own runner writes — not merely for the default stage', () => {
    const architect = byId(loadSessionKinds(REPO_ROOT), 'architect');
    for (const phase of ARCHITECT_PHASES) {
      assert.deepEqual(
        deriveSessionAffordances(architect, phase),
        [],
        `architect phase "${phase}" must derive no affordance — the generic route has no arm that may spawn an architect turn`,
      );
    }
    // The pre-existing assertion checked `defaultStage` alone. A table added to
    // the architect would very likely leave the default stage empty and put the
    // writable row on `awaiting-answers` or `awaiting-verdict` — the two phases
    // that ARE operator moments — so pinning only the default stage would have
    // watched the one phase least likely to change.
  });

  it('the architect is absent from the union of kinds the generic route may spawn', () => {
    // `LegacySpawnableAgentId` is a type, so it cannot be read at runtime; the
    // source line is the artifact, and this asserts the line still says what
    // the ruling ratified. A test that reads the source is the honest way to
    // pin a type-level exclusion — the alternative is no pin at all.
    const src = readShellSource();
    const match = /export type LegacySpawnableAgentId = ([^;]+);/.exec(src);
    assert.ok(match, 'the union must still be declared where the ruling names it');
    assert.ok(!/'architect'/.test(match![1]), `architect must not be spawnable through the generic affordance route — got: ${match![1]}`);
    assert.ok(/never `architect`/.test(src), 'and the exclusion must still carry its stated reason at the declaration');
  });
});

function readShellSource(): string {
  return readFileSync(new URL('../../bridge-studio-sessions-affordance-shell.ts', import.meta.url), 'utf8');
}
