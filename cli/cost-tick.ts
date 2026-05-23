/**
 * S7 / C14 — `cost_tick` derived consumer.
 *
 * Subscribes to the existing `tee` hook on `orchestrator/logging.ts` and
 * maintains an in-memory rolling sum of `cost_usd` keyed by `cycle_id` +
 * `wi_id`. Emits a synthetic `cost_tick` event at most once per second per
 * `(cycle_id, wi_id)` partition and ONLY when the cost has changed since
 * the last tick.
 *
 * Per C14 the logger stays append-only / refs-not-contents (ADR-008). This
 * module is the only writer of `cost_tick` events.
 *
 * Public surface:
 *
 *   const sub = subscribeCostTick(logger, { tee: outerTee, now, debounceMs });
 *   sub.consume(entry);   // call from logger.opts.tee
 *   sub.flushAll();       // optional: force-emit pending ticks
 *   sub.unsubscribe();    // stops further emits
 *
 * Wiring (callers): the cycle / scheduler composes `attachCostTickTee` to
 * fold this consumer into the logger's existing `tee` hook, so the logger
 * still has at most one external sink from its own perspective.
 */

import type { EventLogEntry, EventLogger } from '../orchestrator/logging.ts';

export type CostTickOptions = {
  /**
   * Outer `tee` that gets called AFTER this consumer is done with the
   * entry. Lets callers chain: `attachCostTickTee(logger, existingTee)`.
   * Defaults to a noop.
   */
  tee?: (entry: EventLogEntry) => void;
  /**
   * Synthetic clock for tests. Defaults to `Date.now`.
   */
  now?: () => number;
  /**
   * Debounce window in ms. Default 1000 (one tick / sec / partition). The
   * council 07 / plan 07a contract is "≤1 / s".
   */
  debounceMs?: number;
};

const DEFAULT_DEBOUNCE_MS = 1000;

type Partition = {
  cycleId: string;
  wiId: string | null;
  initiativeId: string;
  cycleCostUsd: number;
  wiCostUsd: number;
  lastEmittedCycleCost: number | null;
  lastEmittedAt: number;
};

export type CostTickSubscription = {
  /** Feed one log entry into the consumer. Idempotent on non-cost events. */
  consume: (entry: EventLogEntry) => void;
  /**
   * Force-emit any partition whose cost has changed since the last tick,
   * ignoring the debounce window. Useful at phase boundaries / cycle end
   * where the operator wants the final number even if it lands within the
   * last second.
   */
  flushAll: () => void;
  /** Stop emitting further ticks. The wrapping tee is left alone. */
  unsubscribe: () => void;
  /** Test-only: read the current partition snapshot. */
  partitions: () => ReadonlyArray<Partition>;
};

/**
 * Build a cost-tick consumer that writes `cost_tick` events via the
 * supplied logger. The logger ITSELF is not modified — the caller is
 * responsible for routing `consume(entry)` from the logger's `tee` hook.
 */
export function createCostTickConsumer(
  logger: EventLogger,
  opts: CostTickOptions = {},
): CostTickSubscription {
  const now = opts.now ?? (() => Date.now());
  const outerTee = opts.tee ?? (() => undefined);
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  // partition keyed by `${cycleId}::${wiId ?? '*'}` — '*' is the
  // "no-work-item / cycle-level" partition.
  const map = new Map<string, Partition>();
  let active = true;

  function partitionKey(cycleId: string, wiId: string | null): string {
    return `${cycleId}::${wiId ?? '*'}`;
  }

  function emit(p: Partition): void {
    if (!active) return;
    logger.emit({
      initiative_id: p.initiativeId,
      phase: 'orchestrator',
      skill: 'cost-tick',
      event_type: 'cost_tick',
      input_refs: [],
      output_refs: [],
      metadata: {
        cycle_cost_usd: round4(p.cycleCostUsd),
        ...(p.wiId ? { wi_id: p.wiId, wi_cost_usd: round4(p.wiCostUsd) } : {}),
      },
    });
    p.lastEmittedCycleCost = p.cycleCostUsd;
    p.lastEmittedAt = now();
  }

  function maybeEmit(p: Partition): void {
    // Only when cost changed AND we're outside the debounce window.
    if (p.lastEmittedCycleCost !== null && p.cycleCostUsd === p.lastEmittedCycleCost) return;
    const t = now();
    if (p.lastEmittedAt !== 0 && t - p.lastEmittedAt < debounceMs) return;
    emit(p);
  }

  return {
    consume(entry: EventLogEntry): void {
      try {
        // Never re-process our own emits (would loop forever).
        if (entry.event_type === 'cost_tick') return;
        // Only cost-bearing events matter for the rollup.
        const cost = typeof entry.cost_usd === 'number' ? entry.cost_usd : 0;
        if (cost <= 0) return;

        const cycleId = entry.cycle_id;
        const initiativeId = entry.initiative_id;
        const wiId = extractWorkItemId(entry);

        // Cycle-level partition always updates.
        const cycleKey = partitionKey(cycleId, null);
        const cyclePart =
          map.get(cycleKey) ??
          ({
            cycleId,
            wiId: null,
            initiativeId,
            cycleCostUsd: 0,
            wiCostUsd: 0,
            lastEmittedCycleCost: null,
            lastEmittedAt: 0,
          } satisfies Partition);
        cyclePart.cycleCostUsd += cost;
        cyclePart.initiativeId = initiativeId; // last-write-wins; cycle should be stable
        map.set(cycleKey, cyclePart);

        // WI-level partition only when a WI is identified.
        if (wiId) {
          const wiKey = partitionKey(cycleId, wiId);
          const wiPart =
            map.get(wiKey) ??
            ({
              cycleId,
              wiId,
              initiativeId,
              cycleCostUsd: 0,
              wiCostUsd: 0,
              lastEmittedCycleCost: null,
              lastEmittedAt: 0,
            } satisfies Partition);
          wiPart.cycleCostUsd = cyclePart.cycleCostUsd; // mirror cycle total
          wiPart.wiCostUsd += cost;
          map.set(wiKey, wiPart);
          maybeEmit(wiPart);
        }
        maybeEmit(cyclePart);
      } finally {
        try {
          outerTee(entry);
        } catch {
          /* never let an outer tee break our consumer */
        }
      }
    },
    flushAll(): void {
      for (const p of map.values()) {
        if (p.lastEmittedCycleCost === null || p.cycleCostUsd !== p.lastEmittedCycleCost) {
          emit(p);
        }
      }
    },
    unsubscribe(): void {
      active = false;
    },
    partitions(): ReadonlyArray<Partition> {
      return [...map.values()];
    },
  };
}

/**
 * Convenience wrapper: install a cost-tick consumer onto an existing
 * logger by chaining its `tee` hook. Returns the subscription handle so
 * the caller can `unsubscribe()` at cycle end.
 *
 * Note: this MUTATES the logger's options via re-assigning the closure's
 * `tee` reference is not possible (the logger captures `opts` at create
 * time). The correct usage is to compose at logger-construction:
 *
 *   const cost = createCostTickConsumer({ logger: 'placeholder' }, {...});
 *   const logger = createLogger(cycleId, logsDir, { tee: cost.consume });
 *   cost.attachLogger(logger);  // not implemented; we use the simpler form
 *
 * In practice the scheduler / cycle owns construction order and can do:
 *
 *   const tickSink = createCostTickConsumer(logger, { tee: existingTee });
 *   const logger = createLogger(cycleId, logsDir, { tee: tickSink.consume });
 *
 * — which deadlocks (logger needed before consumer). The right pattern is
 * to pass a mutable sink ref:
 *
 *   const ref: { tee?: (e: EventLogEntry) => void } = {};
 *   const logger = createLogger(cycleId, logsDir, {
 *     tee: (e) => ref.tee?.(e),
 *   });
 *   const tickSink = createCostTickConsumer(logger, { tee: existingTee });
 *   ref.tee = tickSink.consume;
 *
 * That's the integration shape the cycle wiring follows.
 */
export function makeCostTickTee(
  logger: EventLogger,
  opts: CostTickOptions = {},
): (entry: EventLogEntry) => void {
  const sub = createCostTickConsumer(logger, opts);
  return (entry) => sub.consume(entry);
}

function extractWorkItemId(entry: EventLogEntry): string | null {
  const md = entry.metadata as { work_item_id?: unknown; wi_id?: unknown } | undefined;
  const w = md?.work_item_id ?? md?.wi_id;
  if (typeof w === 'string' && w.trim() !== '') return w;
  return null;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
