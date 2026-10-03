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
 * THE CAP = MIN(SESSION-DECLARED REMAINING, BRIDGE-FUNDED REMAINING), each
 * arm built only when its own ceiling exists — row 209 (bead
 * forge-8vfn.8.5.45), correcting this file's prior rule ("the session's
 * declared ceiling wins outright when present"). MEASURED: bridge ceiling
 * $6; three architect sessions each declared $25; two sessions left $0.44 of
 * the $6; the THIRD kept capping against $25 − its own spend (~$25) under
 * the old rule, and one SDK turn overshot the bridge by $2.47. MIN closes
 * that gap: a session's own declaration can never outspend what the bridge
 * actually funded, and a bridge with room to spare never overrides a
 * tighter session declaration either.
 *
 *   - SESSION-DECLARED REMAINING = `status.costCeilingUsd` minus THIS
 *     SESSION'S OWN spend (`spentUsd`, below) — unchanged, and the WHOLE
 *     rule when no bridge ceiling exists.
 *   - BRIDGE-FUNDED REMAINING = `FORGE_COST_CEILING_USD` minus EVERYTHING
 *     SPENT UNDER THIS BRIDGE — every session/dispatch it launched, not just
 *     this one (`bridgeSpentUsd`, below), from the runner's own inherited env
 *     (never an agent's — `AGENT_ENV_ALLOWLIST` excludes it).
 *   - Neither exists → `undefined`, unbounded exactly as before.
 *
 * SPENT (either arm) is the relevant log's priced spend (the authoritative
 * rows `deriveSessionCostUsd` sums) PLUS the `upper_bound_usd` of every
 * unpriced row that carries one. That second term is the harness's own
 * arithmetic (`chargeBoundedTurns`, scripts/stories/spend.mjs): row 193's
 * once-retry re-runs a stalled turn, and a retry that saw only priced spend
 * would get the WHOLE remaining again while the stalled attempt is charged
 * its cap — two caps against one remaining, over the ceiling by design.
 *
 * REMAINING <= 0 REFUSES THE TURN rather than calling the SDK with a zero or
 * negative cap: a cap the SDK checks only after spending is not a refusal, and
 * the turn would spend before it stopped. The caller emits an `error` row and
 * throws `TurnBudgetExhaustedError`; the runner process exits on it, which is
 * the session's published `failed` state with the reason in stderr.log —
 * the same surface architect's turn-start ceiling refusal (W7-B6) uses. The
 * refusal names WHICHEVER arm's remaining was lower (`ceiling_source`), never
 * merely "a ceiling existed somewhere".
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { deriveSessionCostUsd, type EventLogger } from '@forge/kernel';

import { parseGuardedEventsJsonl } from './session-readability.ts';

/** The bridge process's own run ceiling (`scripts/stories/bridge.mjs`, `cycle.ts`). */
export const BRIDGE_COST_CEILING_ENV = 'FORGE_COST_CEILING_USD';

/** The bridge's own boot timestamp (ISO-8601) — row 209. `startBridge` sets
 *  this on ITS OWN env once, before it spawns anything, so every detached
 *  runner inherits it like `FORGE_COST_CEILING_USD` already does.
 *  `bridgeSpentUsd` uses it to exclude an earlier incarnation's money
 *  (`_logs/` is never pruned); absent, it sums everything — the over- rather
 *  than under-reporting side, a ceiling's safe failure direction. */
export const BRIDGE_STARTED_AT_ENV = 'FORGE_BRIDGE_STARTED_AT';

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

/** Shared by `sessionSpentUsd` (one dir) and `bridgeSpentUsd` (every dir,
 *  row 209): priced spend plus every bounded unpriced turn's cap, else $0. */
function spentFromEvents(events: readonly Record<string, unknown>[]): number {
  const bounds = events.reduce((sum, e) => {
    const meta = e['metadata'] as Record<string, unknown> | undefined;
    const bound = meta?.['priced'] === false ? positiveUsd(meta['upper_bound_usd']) : undefined;
    return typeof e['cost_usd'] === 'number' || bound === undefined ? sum : sum + bound;
  }, 0);
  return (deriveSessionCostUsd(events) ?? 0) + bounds;
}

/**
 * Priced spend plus every bounded unpriced turn's cap, from the session's own
 * `events.jsonl`. An absent or unreadable log reads as $0: the reader collapses
 * the two by design (no-oracle rule), and a session's first turn has no log yet.
 */
export function sessionSpentUsd(logsRoot: string, logDirName: string): number {
  return spentFromEvents(parseGuardedEventsJsonl(logsRoot, logDirName) ?? []);
}

/** Clock-skew slack for the mtime birth check below (same technique as the
 *  harness's `collectSpendDirs`, which packages may not import — §0). */
const BRIDGE_SPEND_CLOCK_SLACK_MS = 2_000;

/**
 * Every session's and agent dispatch's spend under ONE bridge, summed from
 * every directory directly under its `_logs/` root — row 209 (bead
 * forge-8vfn.8.5.45): the bridge ceiling bounds the WHOLE run, not one
 * session's slice of it. `sinceIso` (`BRIDGE_STARTED_AT_ENV`) excludes dirs
 * born before this bridge; `undefined` sums everything unfiltered —
 * over-reporting, a ceiling's safe failure side, never a silent $0. An
 * unreadable root or dir reads as $0 FOR THAT DIR (`sessionSpentUsd`'s own
 * no-oracle collapse) rather than throwing — never crash the turn it caps.
 */
export function bridgeSpentUsd(logsRoot: string, sinceIso: string | undefined): number {
  const sinceMs = sinceIso === undefined ? undefined : Date.parse(sinceIso);
  const hasSince = typeof sinceMs === 'number' && Number.isFinite(sinceMs);
  let names: string[];
  try {
    names = readdirSync(logsRoot);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of names) {
    let st;
    try {
      st = statSync(join(logsRoot, name));
    } catch {
      continue; // raced away between readdir and stat — honestly gone.
    }
    if (!st.isDirectory()) continue;
    if (hasSince && st.mtimeMs < sinceMs! - BRIDGE_SPEND_CLOCK_SLACK_MS) continue;
    total += spentFromEvents(parseGuardedEventsJsonl(logsRoot, name) ?? []);
  }
  return total;
}

/** One ceiling's own figure, spend and the label a refusal names it with. */
type BudgetArm = { ceilingUsd: number; spentUsd: number; source: TurnBudgetSource };

/**
 * The cap for the NEXT SDK call of one session turn, or `undefined` when no
 * ceiling exists anywhere. Throws `TurnBudgetExhaustedError` (after an `error`
 * row) when nothing remains. Called once per SDK call, so a turn that spends
 * across several calls — architect's interview → explore → draft → critic —
 * is capped against what is LEFT, not against the turn-start figure. Row
 * 209 — MIN(session-declared, bridge-funded) remaining; see this file's
 * header for the full rule and the measured overshoot it closes.
 */
export function turnBudgetUsd(args: {
  declaredCeilingUsd: unknown;
  env: NodeJS.ProcessEnv;
  /** Row 209 — `_logs/`, the root `bridgeSpentUsd` walks (every caller already resolves this). */
  logsRoot: string;
  spentUsd: () => number;
  logger: EventLogger;
  identity: { initiativeId: string; phase: Parameters<EventLogger['emit']>[0]['phase']; skill: string; sessionId: string };
}): number | undefined {
  const declared = positiveUsd(args.declaredCeilingUsd);
  const bridgeCeiling = positiveUsd(args.env[BRIDGE_COST_CEILING_ENV]);

  const sessionArm: BudgetArm | undefined = declared === undefined ? undefined
    : { ceilingUsd: declared, spentUsd: args.spentUsd(), source: 'session' };
  const bridgeArm: BudgetArm | undefined = bridgeCeiling === undefined ? undefined
    : { ceilingUsd: bridgeCeiling, spentUsd: bridgeSpentUsd(args.logsRoot, args.env[BRIDGE_STARTED_AT_ENV]), source: 'bridge' };

  if (sessionArm === undefined && bridgeArm === undefined) return undefined;

  // MIN of the two remainings: whichever arm would exhaust FIRST binds this turn.
  const remainingOf = (arm: BudgetArm): number => arm.ceilingUsd - arm.spentUsd;
  const binding: BudgetArm = sessionArm === undefined ? bridgeArm!
    : bridgeArm === undefined ? sessionArm
    : remainingOf(bridgeArm) < remainingOf(sessionArm) ? bridgeArm : sessionArm;

  const remaining = remainingOf(binding);
  if (remaining > 0) return remaining;
  const err = new TurnBudgetExhaustedError(binding.ceilingUsd, binding.spentUsd, binding.source);
  args.logger.emit({
    initiative_id: args.identity.initiativeId, phase: args.identity.phase, skill: args.identity.skill,
    event_type: 'error', input_refs: [], output_refs: [], message: err.message,
    metadata: { session_id: args.identity.sessionId, cost_usd_spent: binding.spentUsd, cost_ceiling_usd: binding.ceilingUsd, ceiling_source: binding.source },
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
