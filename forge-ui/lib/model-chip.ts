/**
 * model-chip — the provenance strip's model label (W7-C3, sessions-kinds-31).
 *
 * `modelTier ?? 'default'` rendered the literal word "default" for every
 * session started before the tier picker existed — not a tier the picker
 * offers, and no answer to "what did this run cost-wise?". One rule: a
 * recorded tier verbatim; an unrecorded one says so honestly.
 *
 * W7-C3 review (LOW): `??` does not catch `''`, so a status.json with a
 * blank tier rendered a BLANK chip — "model: " with nothing after it, the
 * one output worse than either honest answer. Not wire-reachable today
 * (`resolveKickoffModelTier` routes `''` through `resolveSessionModel`,
 * which throws → 400), so a hand-edited status.json is the precondition;
 * that is a reason to make the boundary true rather than approximately true,
 * not a reason to skip it.
 *
 * KNOWN GAP (not fixed here, deliberately): "not recorded" is honest but
 * hides a KNOWABLE value — `orchestrator/phase-agent.ts` resolves an absent
 * tier to `modelForSpec(spec)`, a statically-known model. Showing it would
 * mean plumbing the spec's default into the session read model, which is new
 * behaviour rather than a review fix. Filed in the C3 fix return.
 */
export function modelChipLabel(modelTier: string | null | undefined): string {
  const tier = typeof modelTier === 'string' ? modelTier.trim() : '';
  return tier.length > 0 ? tier : 'not recorded';
}
