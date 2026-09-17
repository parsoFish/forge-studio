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
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { EventLogger, Phase } from '@forge/kernel';

import type { UnpricedTurnInfo } from './interactive-session.ts';

/**
 * The sidecar a failed row lands in — `forge-8vfn.7.6.103`, T1 1037/1039.
 *
 * THE BUG THIS CLOSES IS THE `catch {}` BELOW. Both emitters swallowed a failed
 * `logger.emit`, so a write failure left NO row: `endedUnpricedTurns` saw
 * nothing and a funded run carried on indistinguishable from a normally-priced
 * turn. Nothing anywhere counted emit failures. Inherited from 7.6.55, not
 * introduced by 7.6.73.
 *
 * THE SIGNAL CANNOT BE THE ROW, because the row is what could not be written.
 * So a failure appends here instead, in the SAME directory the row was meant
 * for, and `spendSoFar` reads it beside `events.jsonl`.
 *
 * EXPORTED so the reader and the doors use this exact string. A guard whose two
 * halves agree by retyping is a guard one typo from silence.
 */
export const EMIT_FAILED_SIDECAR = '.emit-failed';

/**
 * The stderr marker for THE NAMED RESIDUAL (1037(3)): when the sidecar write
 * ALSO fails, nothing in the run's own filesystem can record anything. The
 * failures are CORRELATED — a full disk or a revoked handle breaks the row and
 * the sidecar together — so this is the case where the sidecar matters most and
 * is least likely to work.
 *
 * This marker is the only trace, and the runner does not parse stderr, so THE
 * RUN CONTINUES BLIND. That hole is named rather than closed: a fourth layer
 * would itself depend on writing something, and throwing would destroy a turn
 * that already ran and cost money (849's objection). Doored through a `chmod 0`
 * logdir, because a residual described only in prose is the door-run-once shape.
 */
export const EMIT_FAILED_STDERR_MARKER = 'FORGE-EMIT-FAILED-UNRECORDABLE';

/**
 * Record an emit failure where a reader can find it. Never throws: this runs
 * inside a catch, and an error here would replace the turn's own.
 */
function recordEmitFailure(logger: EventLogger, message: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  try {
    const dir = dirname(logger.logFilePath);
    appendFileSync(
      join(dir, EMIT_FAILED_SIDECAR),
      `${JSON.stringify({ at: new Date().toISOString(), message, error: detail })}\n`,
    );
  } catch (sidecarErr) {
    const also = sidecarErr instanceof Error ? sidecarErr.message : String(sidecarErr);
    try {
      process.stderr.write(
        `${EMIT_FAILED_STDERR_MARKER} message=${message} emit_error=${detail} sidecar_error=${also}\n`,
      );
    } catch { /* nothing left that can record anything; the residual, named */ }
  }
}

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
  } catch (err) {
    // Still does not fail the turn — but no longer silent. Before 7.6.103 this
    // `catch {}` was the whole of the handling.
    recordEmitFailure(logger, id.message, err);
  }
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
  } catch (err) {
    // The row that says "this turn was never priced" is itself the row that
    // failed to write. Without the sidecar that is silence on top of silence.
    recordEmitFailure(logger, id.message, err);
  }
}
