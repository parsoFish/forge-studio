/**
 * session-phases.ts — the phase vocabulary of the two session kinds that carry
 * neither a `turnSpec` nor a `panel` table.
 *
 * These three tables moved here from `cli/bridge-studio.ts` (M4 sessions lane).
 * They were put in the host originally to break an import cycle: the generic
 * session route lived in `cli/bridge-studio-sessions.ts`, `cli/ui-bridge.ts`
 * imported its handler, and a shared constant in either would have closed the
 * loop — so a third, dependency-free host module held it. That reason expired
 * when the route moved into this package: a package never imports the host, so
 * there is no cycle to break, and session phase vocabulary belongs with the
 * sessions seam (SPEC.md §5) rather than in the bridge that happens to serve
 * it. `cli/bridge-studio.ts` re-exports all three so its own consumers keep
 * their single import — the same shape it already uses for `CANCELLED_PHASE`,
 * which likewise lives here and is re-exported there.
 *
 * "LEGACY" names the KINDS, not the code: `architect` is permanently bespoke
 * (ADR 043 amendment §4) and `project-brain` has no table yet, so both need
 * their phases written down somewhere instead of derived from a phase row.
 * Every table-bearing kind derives the same facts from its own `turnSpec`.
 */

/** The ONE universal, reserved terminal phase every session kind shares,
 *  re-exported from the status-write seam that DEFINES it
 *  (`interactive-session.ts`, where `cancelledPhaseWins` enforces sticky-cancel
 *  for every writer — W7-FIX-A2). It is re-exported here, not moved, because
 *  `isTerminalPhase` consults the universal phase and the per-kind table below
 *  as one decision: a reader of session phase vocabulary should need one door,
 *  and the enforcement should stay where the writes are. */
export { CANCELLED_PHASE } from './interactive-session.ts';

/** The per-kind terminal phases for the four kinds whose runners predate the
 *  ADR-043 phase table (architect, instructions, demo and project-brain —
 *  the four with no `turnSpec` to derive a `step: terminal` row from, unlike
 *  kb-cleanup/authoring). ONE named constant that both `cli/ui-bridge.ts`
 *  (its four per-kind list routes, which gate `ensureSessionTail` on it) and
 *  `packages/sessions/bridge-studio-sessions.ts` (the generic
 *  `/api/studio/sessions/:kind/:id` route) read, so neither hand-writes its
 *  own copy. Keyed by session-kind id — the SAME string `SPAWN_AGENT_SPECS`'s
 *  `logPrefix` uses, so `descriptor.id` indexes it with no translation. */
export const LEGACY_SESSION_TERMINAL_PHASES: Readonly<Record<string, ReadonlySet<string>>> = {
  architect: new Set(['committed', 'rejected']),
  instructions: new Set(['committed', 'rejected']),
  demo: new Set(['locked', 'abandoned']),
  'project-brain': new Set(['committed', 'abandoned']),
};

/** W7-A2 — operator-gate phases for the two kinds that carry NEITHER a
 *  `turnSpec` nor a `panel` table (architect and project-brain): which phases
 *  WAIT ON THE OPERATOR, and for what (`questions` | `verdict`, the SAME
 *  AWAITS_KINDS vocabulary the yaml rows use). The lifecycle derivation
 *  (`packages/sessions/bridge-studio-lifecycle.ts`) reads a table-bearing
 *  kind's `awaits:` from its own phase row and falls back to THIS table for
 *  the two legacy kinds — mirroring how `isTerminalPhase` falls back to
 *  `LEGACY_SESSION_TERMINAL_PHASES` above. Sourced from the runners' own
 *  phase vocabularies: `ArchitectPhase`
 *  (`packages/sessions/architect-runner.ts`) and `ProjectBrainPhase`
 *  (`orchestrator/project-brain-builder-runner.ts`) + the two bespoke panels
 *  (SessionArchitectPanel / SessionProjectBrainPanel), which render an
 *  operator control at exactly these phases and nowhere else. */
export const LEGACY_SESSION_AWAITS_PHASES: Readonly<Record<string, Readonly<Record<string, 'questions' | 'verdict'>>>> = {
  architect: { 'awaiting-answers': 'questions', 'awaiting-verdict': 'verdict' },
  'project-brain': { briefing: 'questions', 'awaiting-review': 'verdict' },
};

/** W7-A2 — the AGENT-WORKING phases for the same two legacy kinds (the twin
 *  of a table-bearing kind's `step: agent | finalize` rows): a session sitting
 *  here is the runner's to advance, so silence past the stall ceiling means
 *  "stalled", never "needs you". Same sourcing as
 *  `LEGACY_SESSION_AWAITS_PHASES` above. */
export const LEGACY_SESSION_WORKING_PHASES: Readonly<Record<string, ReadonlySet<string>>> = {
  architect: new Set(['interviewing', 'exploring', 'drafting', 'finalizing']),
  'project-brain': new Set(['analyzing', 'committing']),
};
