/**
 * The cap one session turn runs under — row 193b, bead forge-8vfn.8.5.38, T1
 * ruling 1973gq: "unpriced" is honest only when no bound exists.
 *
 * MEASURED: row 6 run 6, story S10 beat 30. ACT 2's architect turn stalled,
 * `withIdleDeadline` aborted it, and it wrote `architect.turn-ended-unpriced
 * reason=abort` with no figure. The story harness halted CEILING UNENFORCEABLE,
 * correctly: nothing bounded that turn. The SDK has the bound —
 * `maxBudgetUsd` ("query will stop if this budget is exceeded, returning an
 * `error_max_budget_usd` result", sdk.d.ts) — and forge set it only on the
 * cycle/dev-loop path (`run-agent.ts` → `ralph/claude-agent.ts`), never on the
 * two interactive primitives every session turn runs through.
 *
 * REMAINING = SOURCE − SPENT, computed at dispatch, per SDK call:
 *   - SOURCE is the session's OWN declared ceiling first — the figure the
 *     operator typed on the start form (`data-field="cost-ceiling-usd"` →
 *     `POST /api/architect/start` → `status.costCeilingUsd`) — else the
 *     bridge's own ceiling, `FORGE_COST_CEILING_USD`. The runner process is
 *     the bridge's detached child (`spawnAgentTurn`) and inherits its env; the
 *     value is read HERE, in forge's process, and never crosses into an
 *     agent's env (`AGENT_ENV_ALLOWLIST` does not carry it). No ceiling
 *     anywhere → no cap, so an operator session stays unbounded as before.
 *   - SPENT is the session's own priced spend (the authoritative rows
 *     `deriveSessionCostUsd` sums) PLUS the `upper_bound_usd` of every
 *     unpriced row that carries one. That second term is the harness's own
 *     arithmetic (`chargeBoundedTurns`, scripts/stories/spend.mjs): row 193's
 *     once-retry re-runs a stalled turn, and a retry that saw only priced spend
 *     would get the WHOLE remaining again while the stalled attempt is charged
 *     its cap — two caps against one remaining, over the ceiling by design.
 *
 * REMAINING <= 0 REFUSES THE TURN rather than calling the SDK with a zero or
 * negative cap: a cap the SDK checks only after spending is not a refusal, and
 * the turn would spend before it stopped. The caller emits an `error` row and
 * throws `TurnBudgetExhaustedError`; the runner process exits on it, which is
 * the session's published `failed` state with the reason in stderr.log —
 * the same surface architect's turn-start ceiling refusal (W7-B6) uses.
 */
import { deriveSessionCostUsd, type EventLogger } from '@forge/kernel';

import { parseGuardedEventsJsonl } from './session-readability.ts';

/** The bridge process's own run ceiling (`scripts/stories/bridge.mjs`, `cycle.ts`). */
export const BRIDGE_COST_CEILING_ENV = 'FORGE_COST_CEILING_USD';

/** Which knob bounded the turn, so a refusal names the number it compared. */
export type TurnBudgetSource = 'session' | 'bridge';

export class TurnBudgetExhaustedError extends Error {
  constructor(ceilingUsd: number, spentUsd: number, source: TurnBudgetSource) {
    super(
      `session turn budget exhausted: $${spentUsd.toFixed(4)} spent (priced + bounded) >= $${ceilingUsd.toFixed(2)} ` +
      `${source === 'session' ? "session ceiling (the operator's start-form figure)" : `bridge ceiling (${BRIDGE_COST_CEILING_ENV})`} — ` +
      'refusing to start the turn rather than run it under a cap of $0 or less',
    );
    this.name = 'TurnBudgetExhaustedError';
  }
}

function positiveUsd(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Priced spend plus every bounded unpriced turn's cap, from the session's own
 * `events.jsonl`. An absent or unreadable log reads as $0: the reader collapses
 * the two by design (no-oracle rule), and a session's first turn has no log yet.
 */
export function sessionSpentUsd(logsRoot: string, logDirName: string): number {
  const events = parseGuardedEventsJsonl(logsRoot, logDirName) ?? [];
  const bounds = events.reduce((sum, e) => {
    const meta = e['metadata'] as Record<string, unknown> | undefined;
    const bound = meta?.['priced'] === false ? positiveUsd(meta['upper_bound_usd']) : undefined;
    return typeof e['cost_usd'] === 'number' || bound === undefined ? sum : sum + bound;
  }, 0);
  return (deriveSessionCostUsd(events) ?? 0) + bounds;
}

/**
 * The cap for the NEXT SDK call of one session turn, or `undefined` when no
 * ceiling exists anywhere. Throws `TurnBudgetExhaustedError` (after an `error`
 * row) when nothing remains. Called once per SDK call, so a turn that spends
 * across several calls — architect's interview → explore → draft → critic —
 * is capped against what is LEFT, not against the turn-start figure.
 */
export function turnBudgetUsd(args: {
  declaredCeilingUsd: unknown;
  env: NodeJS.ProcessEnv;
  spentUsd: () => number;
  logger: EventLogger;
  identity: { initiativeId: string; phase: Parameters<EventLogger['emit']>[0]['phase']; skill: string; sessionId: string };
}): number | undefined {
  const declared = positiveUsd(args.declaredCeilingUsd);
  const ceilingUsd = declared ?? positiveUsd(args.env[BRIDGE_COST_CEILING_ENV]);
  if (ceilingUsd === undefined) return undefined;
  const source: TurnBudgetSource = declared !== undefined ? 'session' : 'bridge';
  const spentUsd = args.spentUsd();
  const remaining = ceilingUsd - spentUsd;
  if (remaining > 0) return remaining;
  const err = new TurnBudgetExhaustedError(ceilingUsd, spentUsd, source);
  args.logger.emit({
    initiative_id: args.identity.initiativeId, phase: args.identity.phase, skill: args.identity.skill,
    event_type: 'error', input_refs: [], output_refs: [], message: err.message,
    metadata: { session_id: args.identity.sessionId, cost_usd_spent: spentUsd, cost_ceiling_usd: ceilingUsd, ceiling_source: source },
  });
  throw err;
}

/**
 * What a `result` costs, given the cap the turn ran under. A turn the SDK
 * stopped with `error_max_budget_usd` is priced AT LEAST at its cap: the SDK
 * checks the budget after spending, so its own total can sit above the cap
 * (that total is kept when it does), and a crash-shaped result may carry a
 * zeroed or absent total (sdk.d.ts `SDKResultError`) — which must never read
 * as a turn that cost less than the bound it hit. Every other result keeps
 * its own `total_cost_usd`, or `null` when it carries none.
 */
export function budgetedResultCostUsd(result: { subtype?: unknown; total_cost_usd?: unknown }, capUsd: number | undefined): number | null {
  const total = typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null;
  if (result.subtype !== 'error_max_budget_usd' || capUsd === undefined) return total;
  return Math.max(total ?? 0, capUsd);
}
