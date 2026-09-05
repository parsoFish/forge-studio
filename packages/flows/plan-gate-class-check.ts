/**
 * The plan gate's class rule (ADR 051 decision 4, T1 ruling 229 half B).
 *
 * WHAT IT REFUSES, AND WHY HERE. A class whose profile sets
 * `singleWiAllowed: false` — `code` and `infra` as the operator ratified them —
 * may not be approved as a ONE-CRITERION initiative. One declared criterion is
 * the under-decomposed shape, and this is the last moment it can be caught
 * BEFORE ANY SPEND: after approval the architect finalizes, the queue claims,
 * and the project manager takes a turn, and by then the cheapest possible fix
 * (the operator splitting a criterion) costs two agent turns to reach.
 *
 * The same column is a FLAG at the project manager, on the decomposed work-item
 * count, and never a failure there — a one-item decomposition of a genuinely
 * one-item initiative is the PM being correct.
 *
 * WHY THE PROFILE ARRIVES BY INJECTION. The table is
 * `packages/factory`'s — the deletable example (ADR 048) — and this package may
 * not import it. The assembly binds the lookup; when it is absent, or the class
 * is one the installed table does not know, the rule DOES NOT FIRE. A platform
 * with no example factory installed enforces no example's policy, which is
 * exactly what "deletable" has to mean.
 */

/**
 * Resolve a class to its profile's `singleWiAllowed`, or `null` when the
 * question cannot be answered (no table installed, or an unknown class).
 */
export type SingleWiAllowedLookup = (changeClass: string) => boolean | null;

/** The shape this rule needs off a draft manifest — no cross-package type. */
export type PlanGateInitiative = {
  initiative_id: string;
  class: string;
  acceptanceCriteriaCount: number;
};

/**
 * One refusal message per offending initiative; empty when the plan may be
 * approved. Pure: the caller reads the drafts and decides what to do with the
 * answer.
 */
export function planGateClassRefusals(
  initiatives: readonly PlanGateInitiative[],
  singleWiAllowed: SingleWiAllowedLookup | undefined,
): string[] {
  if (singleWiAllowed === undefined) return [];
  const refusals: string[] = [];
  for (const init of initiatives) {
    if (init.acceptanceCriteriaCount !== 1) continue;
    if (singleWiAllowed(init.class) !== false) continue;
    refusals.push(
      `${init.initiative_id}: a ${init.class} initiative declares ONE acceptance criterion, and the ` +
        `${init.class} gate profile does not accept a single-outcome initiative. Split it into criteria ` +
        `that can be delivered and judged independently, or give it a class that accepts one (docs, ` +
        `config) if that is what this work really is.`,
    );
  }
  return refusals;
}
