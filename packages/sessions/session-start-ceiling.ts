/**
 * forge-nk1y.5 — every interactive session starts with a spend ceiling.
 * Capstone A (2026-10-09) saw instructions and project-brain sessions start
 * with `budgets: {}` and no ceiling. A start now stamps `costCeilingUsd` +
 * `costCeilingSource` (operator kickoff figure, else FORGE_COST_CEILING_USD,
 * else the agent's `budgets.maxBudgetUsd`) or is refused by name before any
 * session dir; `turnBudgetUsd` caps every turn at what remains.
 */
import { loadAgentDefinition, skillPath } from '@forge/agents';
import { COST_CEILING_ENV, resolveSessionCeiling } from '@forge/kernel';

export type SessionCeilingSource = 'operator' | 'env' | 'agent-budget';

export type StartCeiling =
  | { ok: true; costCeilingUsd: number; costCeilingSource: SessionCeilingSource }
  | { ok: false; error: string };

/** The route-context slice the start routes read (see `SessionRootsContext`). */
export type StartCeilingContext = { readonly agentBudgetUsd?: (agentSlug: string) => number | undefined };

/** What a start route stamps on its first status: both fields, or nothing. */
export function ceilingStatusFields(c: Extract<StartCeiling, { ok: true }>): { costCeilingUsd: number; costCeilingSource: SessionCeilingSource } {
  return { costCeilingUsd: c.costCeilingUsd, costCeilingSource: c.costCeilingSource };
}

/** `resolveStartCeiling` for a route: honours the context's budget-lookup seam
 *  (test injection only; the real roster read is the default). */
export function resolveStartCeilingFor(ctx: StartCeilingContext, agentSlug: string, operatorUsd?: number): StartCeiling {
  const lookup = ctx.agentBudgetUsd;
  return resolveStartCeiling(agentSlug, {
    ...(operatorUsd !== undefined ? { operatorUsd } : {}),
    ...(lookup ? { agentBudgetUsd: () => lookup(agentSlug) } : {}),
  });
}

export function resolveStartCeiling(
  agentSlug: string,
  opts: {
    env?: NodeJS.ProcessEnv;
    /** An operator's explicit kickoff ceiling (architect start) — wins. */
    operatorUsd?: number;
    /** Test seam; defaults to the agent's SKILL.md `budgets.maxBudgetUsd`. */
    agentBudgetUsd?: () => number | undefined;
  } = {},
): StartCeiling {
  if (typeof opts.operatorUsd === 'number') {
    return { ok: true, costCeilingUsd: opts.operatorUsd, costCeilingSource: 'operator' };
  }
  let agentBudgetUsd: number | undefined;
  try {
    agentBudgetUsd = opts.agentBudgetUsd
      ? opts.agentBudgetUsd()
      : loadAgentDefinition(skillPath(agentSlug)).budgets.maxBudgetUsd;
  } catch (err) {
    return { ok: false, error: `cannot read the spend budget of agent "${agentSlug}": ${err instanceof Error ? err.message : String(err)}` };
  }
  const c = resolveSessionCeiling({ envRaw: (opts.env ?? process.env)[COST_CEILING_ENV], agentSlug, agentBudgetUsd });
  return c.ok
    ? { ok: true, costCeilingUsd: c.ceilingUsd, costCeilingSource: c.source }
    : { ok: false, error: c.reason };
}

/** The ceiling stamped on a status (undefined before forge-nk1y.5); onboarding dispatches under it. */
export function stampedCeilingUsd(status: Record<string, unknown>): number | undefined {
  const v = status.costCeilingUsd;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** An agent's own `budgets.maxBudgetUsd` (turn-time arm); an unreadable definition throws. */
export function agentBudgetUsdFor(agentSlug: string): number | undefined {
  return loadAgentDefinition(skillPath(agentSlug)).budgets.maxBudgetUsd;
}
