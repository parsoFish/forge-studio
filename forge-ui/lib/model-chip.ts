/**
 * model-chip — the provenance strip's model label (W7-C3, sessions-kinds-31).
 *
 * `modelTier ?? 'default'` rendered the literal word "default" for every
 * session started before the tier picker existed — not a tier the picker
 * offers, and no answer to "what did this run cost-wise?". One rule: a
 * recorded tier verbatim; an unrecorded one says so honestly.
 */
export function modelChipLabel(modelTier: string | null | undefined): string {
  return modelTier ?? 'not recorded';
}
