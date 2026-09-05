/**
 * flow-budgets.ts — Runner-level budget enforcement (ADR-028 decision 4, M3-3).
 *
 * Three classes, each a single concern:
 *   CostTracker    — accumulates cost_usd from events; warns at 70%, stops at 100%
 *   WedgeDetector  — heartbeat-without-tool-progress timer; detects wedged agents
 *   RateLimitGate  — holds a resetsAt timestamp; gates spawns until reset time
 *
 * All classes are additive / opt-in: a flow without the relevant fields
 * (costCeilingUsd unset or 0, wedgeKillMs unset, no rate-limit recorded)
 * behaves exactly as today — no enforcement fires.
 *
 * Clocks are injectable for testability (RateLimitGate receives `now()`).
 */

import type { EventLogEntry, EventLogger } from '@forge/kernel';
import { isAuthoritativeCostEvent } from '@forge/kernel';

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

/**
 * Thrown by CostTracker.checkCeiling({ throw: true }) when the flow has
 * crossed its cost ceiling. Classified as resumable — the operator decides
 * whether to continue or abandon.
 */
export class CostCeilingError extends Error {
  readonly spentUsd: number;
  readonly ceilingUsd: number;
  constructor(spentUsd: number, ceilingUsd: number) {
    super(
      `cost-ceiling: flow spent $${spentUsd.toFixed(4)} which meets or exceeds the ` +
        `$${ceilingUsd.toFixed(2)} ceiling — stopping at a clean phase boundary (resumable).`,
    );
    this.name = 'CostCeilingError';
    this.spentUsd = spentUsd;
    this.ceilingUsd = ceilingUsd;
  }
}

/**
 * Thrown (or returned as an error marker) when WedgeDetector fires.
 * Classified as resumable — the operator can re-queue from the wedged node.
 */
export class WedgeKillError extends Error {
  readonly nodeId: string;
  readonly lastProgressAt: number;
  readonly wedgeKillMs: number;
  constructor(nodeId: string, lastProgressAt: number, wedgeKillMs: number) {
    const sinceMs = Date.now() - lastProgressAt;
    super(
      `wedge-kill: node "${nodeId}" received agent_heartbeat events but no tool ` +
        `progress for ${wedgeKillMs}ms (last progress ${Math.round(sinceMs / 1000)}s ago) — ` +
        `aborting node as a likely wedged agent (resumable).`,
    );
    this.name = 'WedgeKillError';
    this.nodeId = nodeId;
    this.lastProgressAt = lastProgressAt;
    this.wedgeKillMs = wedgeKillMs;
  }
}

// ---------------------------------------------------------------------------
// CostTracker
// ---------------------------------------------------------------------------

/** Which knob set this run's ceiling — carried on every warn and stop event so a
 *  stopped run names what bound it (bead forge-8vfn.6.10.23). */
export type CeilingSource = 'env' | 'manifest' | 'derived' | 'flow' | 'none';

export type CostTrackerOptions = {
  /** Cost ceiling in USD. 0 or undefined → enforcement disabled. */
  ceilingUsd: number;
  /** The knob `ceilingUsd` came from; carried on every warn and stop event. */
  ceilingSource?: CeilingSource;
  initiativeId: string;
  logger: EventLogger;
};

/**
 * Accumulates AUTHORITATIVE cost_usd from event entries, under the
 * `event-cost.ts` restatement rule (M0-A Task 1 — see that file's header for
 * the rule and why it exists: iteration phases restate dollars on their
 * per-WI and phase-rollup `end` events; naively summing every event
 * double/triple-counts them).
 *
 * Usage:
 *   1. Call noteEvent(entry) for EVERY emitted event (not just cost-bearing
 *      ones — a phase's first `iteration` event must be seen to latch it,
 *      regardless of that event's own cost_usd).
 *   2. Call checkCeiling() at each clean NODE boundary (after a node, before
 *      spawning the next). Returns true if the ceiling was hit; pass
 *      `{ throw: true }` to throw CostCeilingError instead.
 *   3. Call stopReasonBeforeNextWorkItem(workItemId) at each WI boundary —
 *      non-throwing, for a caller that must skip rather than abort the node.
 *      Checks the cycle total AND that WI's own spend (spec §5 item 7, 257).
 *   4. Hand it any cost-bearing event the cycle incurred before the runner
 *      existed — the architect's, via `runFlow`'s `priorSpendEvents` — or the
 *      ceiling does not bound what the cycle actually spent.
 *
 * Emits:
 *   - flow.cost-warn (once, at ≥70%) with { spentUsd, ceilingUsd, ceilingSource, pct }
 *   - flow.cost-ceiling-stop (at ≥100%, on checkCeiling() — every call while
 *     over ceiling) with { spentUsd, ceilingUsd, ceilingSource, stoppedBeforeNode }
 *   - flow.cost-ceiling-stop from stopReasonBeforeNextWorkItem(), at most once
 *     PER LIMIT, carrying { limit: 'cycle' | 'work-item', spentUsd, ceilingUsd, ceilingSource,
 *     pct, stoppedBeforeWorkItem: true, work_item_id? } — the figures are the
 *     BREACHED limit's, not always the cycle's.
 */
/**
 * The share of a cycle's ceiling ONE work item may consume before the
 * orchestrator stops dispatching it (spec §5 item 7, ruling 257). A share, not
 * a flat figure (`AgentBudgets.maxBudgetUsdShare`'s shape): it scales with
 * whatever ceiling the run was given and enforces exactly when the cycle
 * ceiling does, so it cannot fail open by nobody setting a second knob. Half is
 * deliberately generous — a two-item cycle spends evenly without either item
 * being stopped, so this fires on a runaway, not on variance.
 */
export const PER_WORK_ITEM_CEILING_SHARE = 0.5;

/**
 * The bucket for authoritative spend that belongs to the cycle but to no work
 * item — today the architect, which runs out-of-cycle and whose dollars reach
 * the log as `emitSyntheticArchitectEvents`' `architect.end` (`cycle.ts`).
 * Ruling 257: a RESERVED PRE-WI key, so the spend stays attributable without
 * pretending to be a work item — it counts toward the cycle ceiling and never
 * against the per-WI one, there being no dispatch to stop. Deliberately not
 * parseable as a work-item id, so a reader that mistakes the map for a WI list
 * fails loudly instead of inventing a phantom work item.
 */
export const ARCHITECT_SPEND_KEY = '__architect__';

export class CostTracker {
  private spentUsd = 0;
  private warnEmitted = false;
  private wiStopEmitted = false;
  private readonly perWiStopEmitted = new Set<string>();
  private readonly iterationPhases = new Set<string>();
  private readonly spentByWorkItemMap = new Map<string, number>();
  private readonly ceilingUsd: number;
  private readonly ceilingSource: CeilingSource;
  private readonly initiativeId: string;
  private readonly logger: EventLogger;

  constructor(opts: CostTrackerOptions) {
    this.ceilingUsd = opts.ceilingUsd ?? 0;
    this.ceilingSource = opts.ceilingSource ?? 'none';
    this.initiativeId = opts.initiativeId;
    this.logger = opts.logger;
  }

  /** Returns true iff enforcement is active (ceiling > 0). */
  get enforcing(): boolean {
    return this.ceilingUsd > 0;
  }

  /**
   * The single ingest point — replaces `addCost`. Applies the STREAMING form
   * of the `event-cost.ts` restatement rule: a phase is latched into the
   * iteration set the moment it emits its first `iteration` event; from then
   * on only that phase's `iteration` events are authoritative spend — every
   * other event on that phase (a per-WI `ralph.end`, the phase rollup `end`)
   * restates dollars already counted and is skipped. A phase that never
   * emits an `iteration` event (e.g. project-manager) stays unlatched and has
   * every one of its cost-bearing events counted.
   *
   * This is equivalent to running `isAuthoritativeCostEvent` over the whole
   * stream: every dev-loop `iteration` event for a WI is emitted before that
   * WI's `ralph.end`, and the phase rollup `end` always comes last — by the
   * time a restating event arrives its phase is already latched.
   *
   * Delegates the authoritative-event decision to `isAuthoritativeCostEvent`
   * (`./event-cost.ts`) — the rule lives there once, not re-implemented here.
   */
  noteEvent(entry: EventLogEntry): void {
    if (entry.event_type === 'iteration') {
      this.iterationPhases.add(entry.phase);
    }

    if (!this.enforcing) return;
    if (!isAuthoritativeCostEvent(entry, this.iterationPhases)) return;

    // Runtime boundary guard (M0-A fix round 1, finding 2): `entry.cost_usd`
    // is TYPED `number | undefined`, but this event may have come off the
    // JSONL log (an untrusted producer's own serialization), where the type
    // annotation is only a compile-time claim. `?? 0` alone only catches
    // `null`/`undefined` — a NaN, an Infinity, or a string from a future
    // untyped producer sails through and corrupts `spentUsd` via `+=`
    // coercion instead of being rejected (the campaign's "widen the type,
    // trust it, drop the check" pattern). A present-but-invalid value must
    // never silently become 0 either — that would just move the swallow one
    // line down — so it is both skipped from the authoritative sum AND
    // surfaced as its own error event.
    const rawCostUsd: unknown = entry.cost_usd;
    const costUsdIsValid = typeof rawCostUsd === 'number' && Number.isFinite(rawCostUsd);
    if (rawCostUsd !== undefined && rawCostUsd !== null && !costUsdIsValid) {
      this.logger.emit({
        initiative_id: this.initiativeId,
        phase: 'orchestrator',
        skill: 'flow-budgets',
        event_type: 'error',
        input_refs: [],
        output_refs: [],
        message: 'flow.cost-invalid',
        metadata: { event_id: entry.event_id, phase: entry.phase, message: entry.message, cost_usd: rawCostUsd },
      });
    }
    const costUsd = costUsdIsValid ? rawCostUsd : 0;
    this.spentUsd += costUsd;

    // Bucket key: the event's own work item, else the reserved pre-WI key for a
    // phase that legitimately has none and whose spend must still be
    // attributable (the architect — 257). Every other work-item-less event
    // (the phase rollup `end`) buckets nowhere, exactly as before.
    const rawWorkItemId = entry.metadata?.work_item_id;
    const bucketKey =
      typeof rawWorkItemId === 'string' && rawWorkItemId.length > 0
        ? rawWorkItemId
        : entry.phase === 'architect'
          ? ARCHITECT_SPEND_KEY
          : null;
    if (bucketKey !== null) {
      this.spentByWorkItemMap.set(
        bucketKey,
        (this.spentByWorkItemMap.get(bucketKey) ?? 0) + costUsd,
      );
    }

    const pct = (this.spentUsd / this.ceilingUsd) * 100;

    if (!this.warnEmitted && pct >= 70) {
      this.warnEmitted = true;
      this.logger.emit({
        initiative_id: this.initiativeId,
        phase: 'orchestrator',
        skill: 'flow-budgets',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'flow.cost-warn',
        metadata: {
          spentUsd: this.spentUsd,
          ceilingUsd: this.ceilingUsd,
          ceilingSource: this.ceilingSource,
          pct: Math.round(pct * 10) / 10,
        },
      });
    }
  }

  /** ceilingUsd - spentUsd, under the same authoritative accounting as noteEvent. Infinity when not enforcing. */
  get remainingUsd(): number {
    return this.enforcing ? this.ceilingUsd - this.spentUsd : Infinity;
  }

  /**
   * Authoritative spend keyed by `metadata.work_item_id`. Only events that
   * pass `isAuthoritativeCostEvent` AND carry a non-empty `work_item_id`
   * contribute — the phase rollup `end` (no work_item_id) never creates a
   * bucket, and a restated per-WI `end` never double-credits its WI.
   */
  get spentByWorkItem(): ReadonlyMap<string, number> {
    return this.spentByWorkItemMap;
  }

  /**
   * The per-work-item ceiling: `PER_WORK_ITEM_CEILING_SHARE` of the cycle's.
   * Zero when not enforcing, so the two limits switch on and off together and
   * neither can be left declared-but-unenforced.
   */
  get perWorkItemCeilingUsd(): number {
    return this.enforcing ? PER_WORK_ITEM_CEILING_SHARE * this.ceilingUsd : 0;
  }

  /**
   * Non-throwing ceiling check for a WORK-ITEM boundary — call before a WI's
   * worktree is created, so a dev-loop node can skip WIs one at a time instead
   * of only stopping at the next NODE boundary (checkCeiling, below).
   *
   * TWO limits, checked independently (spec §5 item 7, ruling 257): the CYCLE
   * total against the cycle ceiling, which once breached stops every WI
   * including one that has spent nothing; and THIS work item's own spend
   * (`spentByWorkItem`) against `perWorkItemCeilingUsd`, which stops a REQUEUED
   * runaway while its siblings and the cycle are still under budget. The second
   * gave `spentByWorkItem` its first production reader — the map said what each
   * WI had spent and nothing ever asked, and a ceiling that trips only on the
   * cycle total trips after the runaway has taken its siblings' budget.
   *
   * Returns null while under both; at or over either, returns the message text
   * (the caller never throws — it skips the WI and keeps walking, so later WIs
   * also see the reason) and emits `flow.cost-ceiling-stop` once per limit.
   * `ARCHITECT_SPEND_KEY` is not dispatchable: accepted here, answers null.
   */
  stopReasonBeforeNextWorkItem(workItemId: string): string | null {
    if (!this.enforcing) return null;

    if (this.spentUsd >= this.ceilingUsd) {
      this.emitStop({ limit: 'cycle', spentUsd: this.spentUsd, ceilingUsd: this.ceilingUsd });
      return new CostCeilingError(this.spentUsd, this.ceilingUsd).message;
    }

    if (workItemId === ARCHITECT_SPEND_KEY) return null;

    const spentOnThisWi = this.spentByWorkItemMap.get(workItemId) ?? 0;
    const wiCeiling = this.perWorkItemCeilingUsd;
    if (spentOnThisWi >= wiCeiling) {
      this.emitStop({ limit: 'work-item', spentUsd: spentOnThisWi, ceilingUsd: wiCeiling, workItemId });
      return (
        `cost-ceiling: work item ${workItemId} spent $${spentOnThisWi.toFixed(4)} which meets or exceeds its ` +
        `$${wiCeiling.toFixed(2)} share of the $${this.ceilingUsd.toFixed(2)} cycle ceiling — ` +
        `not dispatching it again (the cycle continues; siblings keep their budget).`
      );
    }

    return null;
  }

  /**
   * `flow.cost-ceiling-stop`, at most once per limit. The per-WI latch is a SET,
   * not a boolean: "once" for a work-item breach means once for THAT work item,
   * and one shared latch would let the first runaway silence every later one —
   * the flood this guards against, inverted into a blind spot.
   */
  private emitStop(opts: { limit: 'cycle' | 'work-item'; spentUsd: number; ceilingUsd: number; workItemId?: string }): void {
    if (opts.limit === 'cycle') {
      if (this.wiStopEmitted) return;
      this.wiStopEmitted = true;
    } else {
      const id = opts.workItemId ?? '';
      if (this.perWiStopEmitted.has(id)) return;
      this.perWiStopEmitted.add(id);
    }
    const pct = opts.ceilingUsd > 0 ? (opts.spentUsd / opts.ceilingUsd) * 100 : 0;
    this.logger.emit({
      initiative_id: this.initiativeId,
      phase: 'orchestrator',
      skill: 'flow-budgets',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'flow.cost-ceiling-stop',
      metadata: {
        limit: opts.limit,
        spentUsd: opts.spentUsd,
        ceilingUsd: opts.ceilingUsd,
        ceilingSource: this.ceilingSource,
        pct: Math.round(pct * 10) / 10,
        stoppedBeforeWorkItem: true,
        ...(opts.workItemId !== undefined ? { work_item_id: opts.workItemId } : {}),
      },
    });
  }

  /**
   * Check whether the ceiling has been reached. Call at every clean phase
   * boundary (after a node completes, before the next spawns).
   *
   * @param opts.throw — if true, throws CostCeilingError instead of returning true
   * @returns true if ceiling reached; false otherwise
   */
  checkCeiling(opts: { throw?: boolean; nextNodeId?: string } = {}): boolean {
    if (!this.enforcing) return false;

    const pct = (this.spentUsd / this.ceilingUsd) * 100;
    if (pct < 100) return false;

    this.logger.emit({
      initiative_id: this.initiativeId,
      phase: 'orchestrator',
      skill: 'flow-budgets',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'flow.cost-ceiling-stop',
      metadata: {
        spentUsd: this.spentUsd,
        ceilingUsd: this.ceilingUsd,
        ceilingSource: this.ceilingSource,
        pct: Math.round(pct * 10) / 10,
        stoppedBeforeNode: opts.nextNodeId ?? null,
      },
    });

    if (opts.throw) {
      throw new CostCeilingError(this.spentUsd, this.ceilingUsd);
    }
    return true;
  }

  get totalSpentUsd(): number {
    return this.spentUsd;
  }
}

// ---------------------------------------------------------------------------
// WedgeDetector
// ---------------------------------------------------------------------------

export type WedgeDetectorOptions = {
  /**
   * Maximum ms of heartbeat-only activity (no tool_use / file_change /
   * test_run) before the node is declared wedged. Undefined → disabled.
   */
  wedgeKillMs: number | undefined;
  nodeId: string;
};

/**
 * Detects a wedged agent: one whose heartbeats continue but no tool/file/test
 * progress events have been seen for wedgeKillMs milliseconds.
 *
 * Usage (per-node):
 *   detector.onHeartbeat(nowMs)    — call on every agent_heartbeat event
 *   detector.onToolProgress(nowMs) — call on tool_use / file_change / test_run events
 *   detector.check(nowMs)          — returns true iff wedge condition is met
 *   detector.buildKillError(nowMs) — returns a WedgeKillError for logging/throwing
 *
 * The detector only fires if AT LEAST ONE heartbeat has been observed
 * (so a slow-starting agent is not prematurely killed).
 */
export class WedgeDetector {
  private readonly wedgeKillMs: number | undefined;
  private readonly nodeId: string;
  private lastProgressAt: number | null = null;
  private firstHeartbeatAt: number | null = null;

  constructor(opts: WedgeDetectorOptions) {
    this.wedgeKillMs = opts.wedgeKillMs;
    this.nodeId = opts.nodeId;
  }

  /** Returns true iff wedge detection is active. */
  get active(): boolean {
    return typeof this.wedgeKillMs === 'number' && this.wedgeKillMs > 0;
  }

  onHeartbeat(nowMs: number): void {
    if (!this.active) return;
    if (this.firstHeartbeatAt === null) {
      this.firstHeartbeatAt = nowMs;
      // First heartbeat counts as implicit "started" — set progress to now so
      // the window begins from the first heartbeat, not from construction.
      if (this.lastProgressAt === null) {
        this.lastProgressAt = nowMs;
      }
    }
  }

  onToolProgress(nowMs: number): void {
    if (!this.active) return;
    this.lastProgressAt = nowMs;
  }

  /**
   * Check at the current time. Returns true iff:
   *   - Active (wedgeKillMs is set)
   *   - At least one heartbeat has been seen
   *   - Time since last tool progress ≥ wedgeKillMs
   */
  check(nowMs: number): boolean {
    if (!this.active) return false;
    if (this.firstHeartbeatAt === null) return false; // no heartbeats yet
    if (this.lastProgressAt === null) return false;

    const sinceProgress = nowMs - this.lastProgressAt;
    return sinceProgress >= this.wedgeKillMs!;
  }

  buildKillError(nowMs: number): WedgeKillError {
    return new WedgeKillError(
      this.nodeId,
      this.lastProgressAt ?? nowMs,
      this.wedgeKillMs ?? 0,
    );
  }
}

// ---------------------------------------------------------------------------
// RateLimitGate
// ---------------------------------------------------------------------------

export type RateLimitGateOptions = {
  /** Injected clock; defaults to Date.now. Tests supply a fake clock. */
  now?: () => number;
};

/**
 * Gates spawns when a rate-limit error recorded a future reset time.
 *
 * Usage:
 *   gate.recordRateLimit(resetsAtMs) — call when an SDK error carries a reset time
 *   await gate.waitIfNeeded()        — call before spawning any node; resolves after resetsAt
 *
 * The `now()` clock is injected for testability — tests advance a fake clock
 * so the gate does not use real wall-clock time.
 *
 * Implementation: polls `now()` in 10ms ticks until now >= resetsAt. This keeps
 * the logic simple and testable without real timers while staying accurate in
 * production (polling at 10ms with a 30–60s gate is essentially free).
 */
export class RateLimitGate {
  /** @internal — exposed for test assertions only */
  resetsAt: number | null = null;
  private readonly now: () => number;

  constructor(opts: RateLimitGateOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Record a rate-limit reset time. Keeps the latest (largest) value so
   * multiple errors within a burst converge to the furthest reset.
   */
  recordRateLimit(resetsAtMs: number): void {
    if (this.resetsAt === null || resetsAtMs > this.resetsAt) {
      this.resetsAt = resetsAtMs;
    }
  }

  /**
   * Wait until the recorded resetsAt has passed. If no resetsAt is set (or it
   * has already passed), resolves immediately. Clears resetsAt after waiting.
   */
  async waitIfNeeded(): Promise<void> {
    if (this.resetsAt === null) return;

    const target = this.resetsAt;
    const remaining = target - this.now();
    if (remaining <= 0) {
      this.resetsAt = null;
      return;
    }

    // Poll in 10ms ticks until the injected clock passes the target.
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (this.now() >= target) {
          this.resetsAt = null;
          resolve();
        } else {
          setTimeout(tick, 10);
        }
      };
      setTimeout(tick, 10);
    });
  }
}
