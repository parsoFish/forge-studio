/**
 * strategy:range model routing across Claude tiers (M6-3, ADR-029).
 *
 * Pure, catalog-driven functions. No SDK / IO.
 *
 * The range is a list of model ids (from AgentRuntime.range). Models are
 * ordered cheapest-first by (costIn + costOut) from the catalog. An
 * escalationLevel index picks into that ordering (0 = cheapest), clamped at
 * the most-expensive model in the range. This lets the dev-loop's gate-fail
 * retry path bump the level on each failure (cheapest → next → priciest).
 */

import { MODEL_BY_TIER, type ModelTier } from './phase-agent.ts';
import type { Catalog, CatalogModel } from './studio/types.ts';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Total cost proxy used for ordering: costIn + costOut (per-MTok, as in catalog). */
function totalCost(model: CatalogModel): number {
  return (model.costIn ?? 0) + (model.costOut ?? 0);
}

/**
 * Resolve a model id from the catalog. Falls back to an exact-id match if
 * the model is not found (permits future ids not in the catalog — the catalog
 * can't enforce on models it doesn't know, but we at least return *something*).
 */
function findInCatalog(modelId: string, catalog: Catalog): CatalogModel | undefined {
  return catalog.models.find((m) => m.id === modelId);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a list of model ids to their ModelTiers, ordered cheapest-first by
 * (costIn + costOut) from the catalog.
 *
 * Models not found in the catalog are assigned cost 0 and placed first. Their
 * tier is derived from MODEL_BY_TIER (by matching the tier name from the
 * catalog entry, falling back to 'haiku').
 *
 * @param rangeModelIds - model ids from AgentRuntime.range
 * @param catalog - the loaded studio catalog
 * @returns array of ModelTier values, cheapest first
 */
export function rangeTiers(rangeModelIds: string[], catalog: Catalog): ModelTier[] {
  if (rangeModelIds.length === 0) {
    throw new Error('rangeTiers: range must contain at least one model id');
  }

  const withCost = rangeModelIds.map((id) => {
    const entry = findInCatalog(id, catalog);
    const cost = entry ? totalCost(entry) : 0;
    // Derive the tier: catalog entry's tier field, or reverse-lookup MODEL_BY_TIER
    let tier: ModelTier = 'haiku'; // safe default
    if (entry) {
      const t = entry.tier as ModelTier;
      if (t === 'haiku' || t === 'sonnet' || t === 'opus') {
        tier = t;
      }
    } else {
      // reverse lookup from MODEL_BY_TIER
      const found = (Object.entries(MODEL_BY_TIER) as [ModelTier, string][]).find(
        ([, modelId]) => modelId === id,
      );
      if (found) tier = found[0];
    }
    return { id, cost, tier };
  });

  // Sort cheapest first; stable for equal cost
  withCost.sort((a, b) => a.cost - b.cost);

  return withCost.map((m) => m.tier);
}

/**
 * Pick the model id to spawn, given a range and the current escalation level.
 *
 * The range is ordered cheapest-first (by catalog cost). escalationLevel 0 =
 * cheapest; 1 = next tier up; etc. Clamped at the most-expensive in the range.
 *
 * @param rangeModelIds - model ids from AgentRuntime.range
 * @param catalog - the loaded studio catalog
 * @param escalationLevel - 0 = cheapest (default); bump on gate failure
 * @returns the model id to spawn with
 */
export function resolveRangeModel(
  rangeModelIds: string[],
  catalog: Catalog,
  escalationLevel = 0,
): string {
  if (rangeModelIds.length === 0) {
    throw new Error('resolveRangeModel: range must contain at least one model id');
  }

  if (rangeModelIds.length === 1) {
    return rangeModelIds[0];
  }

  // Sort by cost ascending (cheapest first)
  const withCost = rangeModelIds.map((id) => {
    const entry = findInCatalog(id, catalog);
    return { id, cost: entry ? totalCost(entry) : 0 };
  });
  withCost.sort((a, b) => a.cost - b.cost);

  // Clamp at the end
  const idx = Math.min(escalationLevel, withCost.length - 1);
  return withCost[idx].id;
}
