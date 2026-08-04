/**
 * Agent-band registry (R4-01-F2, ADR-039).
 *
 * A "band" is orchestrator-owned pre/post work wrapped around a generic
 * agent-node spawn — the phase pipelines' judgment machinery (work-item
 * validation, decompose checkpointing, retention/lint/recap, queue-state
 * promotion) that ADR-036 keeps OUT of the agent primitive. The band an
 * agent gets is selected by DECLARED DATA: a `composition.guards` entry on
 * its SKILL.md, not a privileged executor enum. The band implementations
 * remain platform code (flow-runner registers them against these ids) —
 * deliberately, per ADR-039's "the platform bakes only execution machinery"
 * doctrine; what this module makes compositional is the KEY.
 *
 * Kept tiny + import-light so `validate.ts`/UI surfaces can consult the
 * known band ids without pulling in the flow engine.
 */

import type { AgentDefinition } from './studio/types.ts';

/**
 * The band-selecting guard ids. Every id here also has a display row in
 * `studio/catalog.yaml`'s `guards:` section (the palette surface) and an
 * executor registered in flow-runner's band table.
 */
export const BAND_GUARD_IDS = ['wi-contract', 'reflection-close', 'demo-band', 'review-band'] as const;
export type BandGuardId = (typeof BAND_GUARD_IDS)[number];

/**
 * The toggle-style guard ids (ADR-027 R3-03 amendment) — platform behaviours
 * an agent switches on/off, as opposed to BAND_GUARD_IDS's dispatch-routing
 * ids. Each has a display row in `studio/catalog.yaml`'s `guards:` section
 * but, unlike a band guard, resolves nothing through `resolveBandGuard` —
 * each is read directly by its own subsystem (event-log by the logger
 * config, cost-guard by the budget enforcer, ...).
 */
export const TOGGLE_GUARD_IDS = ['event-log', 'cost-guard', 'stall-watchdog', 'merge-gate', 'scratch-strip'] as const;
export type ToggleGuardId = (typeof TOGGLE_GUARD_IDS)[number];

/**
 * The full closed set of platform guard ids (ADR-027 R3-03 amendment) — the
 * union of the 5 toggle ids and the 4 band ids. This is the "is this id
 * platform machinery, not a library hook" check `lintHookComposition`
 * (`orchestrator/studio/hook-library.ts`) needs to enforce the
 * `composition.hooks` vs `composition.guards` split — sourced as a fixed
 * platform-vocabulary constant, deliberately NOT re-derived from
 * `studio/catalog.yaml`, because catalog.yaml is a DISPLAY surface over
 * these ids (a hand-edited name/desc row), not their source of truth, and a
 * lint fixture root legitimately may not seed a catalog.yaml at all.
 */
export const PLATFORM_GUARD_IDS: readonly string[] = [...TOGGLE_GUARD_IDS, ...BAND_GUARD_IDS];

/**
 * Band guard id → the ONE canonical agent slug the band's pipeline loads its
 * SKILL.md from. The band implementations (flow-runner's executor table) load
 * the canonical agent's intent themselves, so a non-canonical def declaring the
 * guard would silently run the wrong identity — every declared-dispatch consumer
 * (execAgent's runtime backstop + validate.ts's `composition/band-guard` lint)
 * checks the declarer's slug against THIS single source. Each guard stays pinned
 * to its slug until the bands generalise (R4-06+).
 */
export const BAND_CANONICAL_SLUG: Readonly<Record<BandGuardId, string>> = {
  'wi-contract': 'project-manager',
  'reflection-close': 'reflector',
  'demo-band': 'demo-agent',
  'review-band': 'adversarial-review',
};

/**
 * First declared band guard on the def, or undefined for a bare generic
 * agent. Declaring more than one band is a `composition/band-guard` lint
 * error (validate.ts) — first-wins here is only the defensive runtime
 * order, and execAgent's slug backstop fails loud on any non-canonical
 * declarer regardless.
 */
export function resolveBandGuard(def: AgentDefinition): BandGuardId | undefined {
  for (const guard of def.composition.guards) {
    if ((BAND_GUARD_IDS as readonly string[]).includes(guard)) return guard as BandGuardId;
  }
  return undefined;
}
