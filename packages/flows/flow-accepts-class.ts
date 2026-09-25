/**
 * Seam F6 half 1 (ADR 051 decision 4, spec §5 item 8): "the manifest's class
 * is one the target flow declares it accepts — a flow registers its accepted
 * classes, and the pair is checked before spend."
 *
 * ONE pure predicate, used by every door that starts a run of an initiative
 * on a flow (`enqueue-flow-run.ts`'s `enqueueFlowRun`, `claim-validator.ts`'s
 * `validateClaimable`) — never re-derived independently at either site, so
 * the rule cannot drift between doors. `mint-triggered-initiative.ts` reads
 * `flow.accepts` directly (it is DERIVING the class, not checking a manifest
 * against it) and does not call this function.
 */
import type { FlowDefinition } from '@forge/contracts';
import type { ManifestClass } from '@forge/contracts';

/** True iff `flow` declares `manifestClass` in its `accepts` list. */
export function flowAcceptsClass(
  flow: Pick<FlowDefinition, 'accepts'>,
  manifestClass: ManifestClass,
): boolean {
  return flow.accepts.includes(manifestClass);
}

/**
 * The ONE refusal message every door renders on a mismatch, so an operator
 * (or a log) sees the identical sentence regardless of which door refused.
 */
export function flowClassRefusalMessage(
  flowId: string,
  manifestClass: ManifestClass,
  accepts: readonly ManifestClass[],
): string {
  return `flow ${flowId} does not accept class ${manifestClass}; it accepts ${accepts.join(', ')}`;
}
