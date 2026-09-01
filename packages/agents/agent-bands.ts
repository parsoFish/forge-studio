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

import type { AgentDefinition } from '@forge/contracts/studio/types.ts';

/**
 * The band-selecting guard ids. Every id here also has a display row in
 * `studio/catalog.yaml`'s `guards:` section (the palette surface) and an
 * executor registered in flow-runner's band table. `onboard-preflight`
 * (R4-18) is the 5th band: it routes a `{gate:'contract'}` flow node to
 * `execOnboardPreflight`, which runs the REAL forge↔project contract
 * preflight (`runPreflight`, `cli/preflight.ts`) orchestrator-side — no
 * agent spawn (ADR-036: the orchestrator runs gates, the agent never
 * self-certifies).
 */
export { BAND_GUARD_IDS } from '@forge/contracts';
export type { BandGuardId } from '@forge/contracts';
import { BAND_GUARD_IDS } from '@forge/contracts';
import type { BandGuardId } from '@forge/contracts';

/**
 * The toggle-style guard ids and the closed platform-guard set moved to
 * `@forge/contracts` in M4-library PR 2, beside `BAND_GUARD_IDS`, which was
 * already there — `packages/library/studio/hook-library.ts` needs
 * `PLATFORM_GUARD_IDS` and library (rank 2) may not import agents (rank 3).
 * Re-exported here so this module's fifteen existing importers are unchanged.
 */
export { TOGGLE_GUARD_IDS, PLATFORM_GUARD_IDS } from '@forge/contracts';
export type { ToggleGuardId } from '@forge/contracts';

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
  'onboard-preflight': 'contract-check',
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
