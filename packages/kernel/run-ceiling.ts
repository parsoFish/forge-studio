/**
 * The ONE spend-ceiling derivation (forge-nk1y.4 + forge-nk1y.5).
 *
 * A develop run stops when its spend reaches its ceiling: `FORGE_COST_CEILING_USD`
 * when set, else the manifest's `cost_ceiling_usd`, else `cost_budget_usd` × 1.5
 * (planning spend counts against it). The plan card, the run and the
 * scheduler's stop all read this function — the plan chip used to show the
 * ESTIMATE (`cost_budget_usd`) labelled "cap", which an operator read as the
 * ceiling (stranger attempt 2, Q3/Q5).
 *
 * Every interactive session starts with a ceiling from the same rule:
 * `FORGE_COST_CEILING_USD`, else the agent's own `budgets.maxBudgetUsd`; with
 * neither, the start is refused by name — never an uncapped spawn.
 */

/** Margin over `cost_budget_usd` when a manifest carries no explicit
 *  `cost_ceiling_usd`: the budget estimates the dev loop only, and the
 *  architect, PM, review and reflect bill against the same ceiling. A share,
 *  sized from G1/G2's measured runs (bead forge-8vfn.6.10.23). */
export const DERIVED_CEILING_MARGIN_SHARE = 0.5;

export const COST_CEILING_ENV = 'FORGE_COST_CEILING_USD';

export type RunCeiling =
  | { ceilingUsd: number; source: 'env' | 'manifest' | 'derived' }
  | { ceilingUsd: undefined; source: 'none' };

/** A positive finite number from the env value, else undefined (a blank or
 *  non-positive value is not a ceiling). */
export function parseCeilingEnv(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const positive = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function resolveRunCeiling(input: {
  envRaw: string | undefined;
  costCeilingUsd?: number;
  costBudgetUsd?: number;
}): RunCeiling {
  const env = parseCeilingEnv(input.envRaw);
  if (env !== undefined) return { ceilingUsd: env, source: 'env' };
  if (positive(input.costCeilingUsd)) return { ceilingUsd: input.costCeilingUsd, source: 'manifest' };
  if (positive(input.costBudgetUsd)) {
    return { ceilingUsd: input.costBudgetUsd * (1 + DERIVED_CEILING_MARGIN_SHARE), source: 'derived' };
  }
  return { ceilingUsd: undefined, source: 'none' };
}

export type SessionCeiling =
  | { ok: true; ceilingUsd: number; source: 'env' | 'agent-budget' }
  | { ok: false; reason: string };

export function resolveSessionCeiling(input: {
  envRaw: string | undefined;
  agentSlug: string;
  agentBudgetUsd: number | undefined;
}): SessionCeiling {
  const env = parseCeilingEnv(input.envRaw);
  if (env !== undefined) return { ok: true, ceilingUsd: env, source: 'env' };
  if (positive(input.agentBudgetUsd)) return { ok: true, ceilingUsd: input.agentBudgetUsd, source: 'agent-budget' };
  return {
    ok: false,
    reason: `no spend ceiling: set ${COST_CEILING_ENV} or budgets.maxBudgetUsd on agent "${input.agentSlug}"`,
  };
}
