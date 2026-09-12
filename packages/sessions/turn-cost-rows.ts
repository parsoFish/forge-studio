/**
 * The TWO spend rows a turn can leave behind, rendered in ONE place —
 * `forge-8vfn.7.6.73`, T1 ruling 993.
 *
 * WHY A MODULE RATHER THAN A LINE AT EACH CALL SITE. Four callers spend money
 * through the session primitives (`interactive-runner`, `architect-steps`,
 * `architect-critic`, `instructions`) and each must leave exactly one terminal
 * row per turn. Before this, one of them emitted a priced row, one emitted a
 * priced row and swallowed the unpriced case, and two discarded the cost
 * entirely — `const { output } = await runStructuredTurn(...)`. That is not
 * four bugs; it is one absent renderer, and the evidence is that the totals
 * still reconciled: S1 run 11 reported $5.2497 and that figure is the exact
 * sum of the nine rows it did record, while the completeness critic ran twice
 * and contributed none. A number that reconciles perfectly against an
 * incomplete record is the hardest kind of wrong to notice.
 *
 * THE INVARIANT THESE TWO FUNCTIONS EXIST TO HOLD: a turn leaves a PRICED row
 * or an UNPRICED row, never both and never neither. The primitives make that
 * mutually exclusive by construction — `costUsd` is non-null exactly when
 * `onTurnEndedUnpriced` did not fire — so the caller's rule is mechanical:
 * call `emitTurnCostRow` when the cost is non-null, and wire
 * `emitTurnEndedUnpricedRow` to the callback.
 *
 * THE UNPRICED ROW CARRIES ITS MARKERS OR IT DOES NOT COUNT. `spend.mjs`'s
 * `endedUnpricedTurns` recognises a row two ways — `message ===
 * 'interactive.turn-ended-unpriced'` OR `metadata.priced === false` — and
 * ignores everything else, so a row that says "unpriced" in prose alone is
 * invisible to 7.6.71's halt. `metadata.priced: false` is therefore set HERE,
 * not left to callers with their own messages, and the door drives a real row
 * through `ceilingHaltVerdict` rather than reading this file.
 *
 * `cost_usd` IS OMITTED FROM THE UNPRICED ROW, NEVER ZEROED (ruling 849).
 * `endedUnpricedTurns` skips any row carrying a numeric `cost_usd`, so a zero
 * would make the turn read as measured-at-nothing — the ceiling would
 * under-count in silence instead of halting.
 *
 * Both are BEST-EFFORT: a logging failure must not fail a turn that ran, and
 * must not replace the error a failed turn is already carrying.
 */
import type { EventLogger, Phase } from '@forge/kernel';

import type { UnpricedTurnInfo } from './interactive-session.ts';

/** Where a row belongs: the log identity its emitter owns. */
export type TurnRowIdentity = {
  initiativeId: string;
  phase: Phase;
  skill: string;
  /** The row's own message, e.g. `architect.turn-cost`. */
  message: string;
  /** Merged into the row's metadata; `priced` is set by these functions. */
  metadata?: Record<string, unknown>;
};

/** One turn's measured spend. Call ONLY with a non-null cost. */
export function emitTurnCostRow(logger: EventLogger, id: TurnRowIdentity, costUsd: number): void {
  try {
    logger.emit({
      initiative_id: id.initiativeId,
      phase: id.phase,
      skill: id.skill,
      event_type: 'end',
      input_refs: [],
      output_refs: [],
      cost_usd: costUsd,
      message: id.message,
      metadata: { ...(id.metadata ?? {}), priced: true },
    });
  } catch { /* a logging failure must not fail a turn that already ran */ }
}

/** One turn that ENDED without a price. Tokens when the stream showed any. */
export function emitTurnEndedUnpricedRow(
  logger: EventLogger,
  id: TurnRowIdentity,
  info: UnpricedTurnInfo,
): void {
  try {
    logger.emit({
      initiative_id: id.initiativeId,
      phase: id.phase,
      skill: id.skill,
      event_type: 'end',
      input_refs: [],
      output_refs: [],
      ...(info.tokensIn !== undefined ? { tokens_in: info.tokensIn } : {}),
      ...(info.tokensOut !== undefined ? { tokens_out: info.tokensOut } : {}),
      ...(info.cacheReadTokens !== undefined ? { cache_read_tokens: info.cacheReadTokens } : {}),
      ...(info.cacheCreationTokens !== undefined ? { cache_creation_tokens: info.cacheCreationTokens } : {}),
      message: id.message,
      metadata: { ...(id.metadata ?? {}), unpriced_reason: info.reason, priced: false },
    });
  } catch { /* never replace the turn's own error with a logging one */ }
}
