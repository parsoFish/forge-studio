/**
 * agent-dispatch-provenance — W7-C1 (agents-27).
 *
 * THE DEFECT: release-finalizer and project-scoped-review are shipped agents
 * that belong to no flow, so their pages read "Not yet used in any flow." —
 * presenting a production-wired agent and a deliberately operator-triggered
 * utility as orphans. Reflector joined them when W7-C1 retired the vestigial
 * reflect flow wrapper (its real dispatch was never the flow).
 *
 * The note is DERIVED from the agent's own SKILL-declared `phase:`
 * frontmatter (already on the wire as `Agent.phase`) — a closed map over the
 * three phases whose agents are dispatched outside the flow graph, never a
 * per-slug hand-kept list. An unknown/absent phase resolves `null` (no note
 * rendered) — never a fabricated provenance.
 */

const NOTE_BY_PHASE: Record<string, string> = {
  // orchestrator/phases/release-finalize.ts — runs inside the approve→merge
  // finalization chain, opt-in per project.
  'release-finalize':
    'Dispatched automatically by the approve→merge finalization chain when the project declares a releaseProcess — not a flow node.',
  // skills/project-scoped-review — surface: operator-triggered, on demand.
  audit:
    'Operator-triggered utility — run it on demand from this page (pick the target project in the Run panel).',
  // orchestrator/finalize-merged.ts — forge-develop's {on: merged} standing
  // trigger, resolved through the reflection-close band guard (R4-09-F1;
  // the flow wrapper was retired in W7-C1).
  reflection:
    'Dispatched standalone after every confirmed merge, via forge-develop’s "on: merged" standing trigger (see Standing triggers below) — and runnable on demand from this page.',
};

/**
 * The dispatch-provenance one-liner for an agent's declared phase, or `null`
 * when the phase is not one of the outside-the-flow-graph dispatch phases.
 */
export function dispatchProvenanceNote(phase: string | undefined): string | null {
  if (phase === undefined) return null;
  return Object.hasOwn(NOTE_BY_PHASE, phase) ? NOTE_BY_PHASE[phase] : null;
}
