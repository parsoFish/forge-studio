/**
 * The two turnSpec builders the turnspec AND panel suites both stand on.
 *
 * Hoisted when `studio/session-kinds.test.ts` split (M4 exit row 5, C1): declared
 * in the turnspec half, used by the panel half, so the split would otherwise
 * have left one suite reaching into another's file. Ruling 91, and free under
 * ruling 94 because every importer is a test.
 */

import { baseDescriptor, type FixtureDescriptor } from './session-kinds-core.ts';

/** The exact ADR-043 §1 worked example (kindDir: _authoring, style: agent,
 *  4-phase table) — the POSITIVE control every negative probe below is a
 *  one-field mutation of. */
export function wellFormedTurnSpec(): Record<string, unknown> {
  return {
    kindDir: '_authoring',
    style: 'agent',
    // W7-FIX-A2 (W7A2-03, bead forge-w08): the live authoring row opts into
    // Bash inspection — kept in lockstep here (the deep-equal below is the
    // drift guard for this literal against the real yaml).
    bashFence: 'inspect',
    phases: [
      { phase: 'analyzing', step: 'agent', writes: ['staging'], next: 'awaiting-review' },
      // verdicts (W7-C2, superseding W6-B6's approve-only ruling): the real,
      // live authoring row now declares the full three-way branch —
      // `revise` (feedback -> re-run analyzing) and `reject` (-> the
      // terminal `rejected` row below) joined per sessions-kinds-23 /
      // library-24 — kept in lockstep here so this literal stays a truthful
      // mirror of the checked-in yaml. requires (W6-B9; W7-C2 scoped it to
      // APPROVE): approve ALSO needs an operator-supplied `id` beyond
      // `verdict` itself — same lockstep reasoning.
      { phase: 'awaiting-review', step: 'noop', awaits: 'verdict', verdicts: ['approve', 'revise', 'reject'], requires: ['id'] },
      { phase: 'committing', step: 'finalize', finalizer: 'copyStagingToLibrary', next: 'committed' },
      { phase: 'committed', step: 'terminal' },
      // W7-C2 — reject's terminal landing row.
      { phase: 'rejected', step: 'terminal' },
    ],
  };
}
/** A descriptor fixture carrying `turnSpec`, otherwise identical to
 *  baseDescriptor() — legacyRoutes forced to [] so the unrelated
 *  legacy-route-not-found check never pollutes the turnspec-specific
 *  assertions below (a fresh tmp root has no apps/studio/app/ dir at all). */
export function turnSpecDescriptor(turnSpec: Record<string, unknown>): FixtureDescriptor & { turnSpec: Record<string, unknown> } {
  return { ...baseDescriptor({ legacyRoutes: [] }), turnSpec };
}
