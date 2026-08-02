/**
 * Agent-band registry (R4-01-F2, ADR-039).
 *
 * A "band" is orchestrator-owned pre/post work wrapped around a generic
 * agent-node spawn — the phase pipelines' judgment machinery (work-item
 * validation, decompose checkpointing, retention/lint/recap, queue-state
 * promotion) that ADR-036 keeps OUT of the agent primitive. The band an
 * agent gets is selected by DECLARED DATA: a `composition.hooks` entry on
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
 * The band-selecting hook ids. Every id here also has a display row in
 * `studio/catalog.yaml`'s `hooks:` section (the palette surface) and an
 * executor registered in flow-runner's band table.
 */
export const BAND_HOOK_IDS = ['wi-contract', 'reflection-close', 'demo-band', 'review-band'] as const;
export type BandHookId = (typeof BAND_HOOK_IDS)[number];

/**
 * Band hook id → the ONE canonical agent slug the band's pipeline loads its
 * SKILL.md from. The band implementations (flow-runner's executor table) load
 * the canonical agent's intent themselves, so a non-canonical def declaring the
 * hook would silently run the wrong identity — every declared-dispatch consumer
 * (execAgent's runtime backstop + validate.ts's `composition/band-hook` lint)
 * checks the declarer's slug against THIS single source. Each hook stays pinned
 * to its slug until the bands generalise (R4-06+).
 */
export const BAND_CANONICAL_SLUG: Readonly<Record<BandHookId, string>> = {
  'wi-contract': 'project-manager',
  'reflection-close': 'reflector',
  'demo-band': 'demo-agent',
  'review-band': 'adversarial-review',
};

/**
 * First declared band hook on the def, or undefined for a bare generic
 * agent. Declaring more than one band is a `composition/band-hook` lint
 * error (validate.ts) — first-wins here is only the defensive runtime
 * order, and execAgent's slug backstop fails loud on any non-canonical
 * declarer regardless.
 */
export function resolveBandHook(def: AgentDefinition): BandHookId | undefined {
  for (const hook of def.composition.hooks) {
    if ((BAND_HOOK_IDS as readonly string[]).includes(hook)) return hook as BandHookId;
  }
  return undefined;
}
