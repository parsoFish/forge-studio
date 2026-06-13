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

import type { EventLogger } from './logging.ts';

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

export type CostTrackerOptions = {
  /** Cost ceiling in USD. 0 or undefined → enforcement disabled. */
  ceilingUsd: number;
  initiativeId: string;
  logger: EventLogger;
};

/**
 * Accumulates cost_usd from event entries.
 *
 * Usage:
 *   1. Call addCost(cost_usd) after each node completes.
 *   2. Call checkCeiling() at each clean phase boundary (after a node, before
 *      spawning the next). Returns true if the ceiling was hit; pass
 *      `{ throw: true }` to throw CostCeilingError instead.
 *
 * Emits:
 *   - flow.cost-warn (once, at ≥70%) with { spentUsd, ceilingUsd, pct }
 *   - flow.cost-ceiling-stop (at ≥100%, on checkCeiling()) with { spentUsd, ceilingUsd, stoppedBeforeNode }
 */
export class CostTracker {
  private spentUsd = 0;
  private warnEmitted = false;
  private readonly ceilingUsd: number;
  private readonly initiativeId: string;
  private readonly logger: EventLogger;

  constructor(opts: CostTrackerOptions) {
    this.ceilingUsd = opts.ceilingUsd ?? 0;
    this.initiativeId = opts.initiativeId;
    this.logger = opts.logger;
  }

  /** Returns true iff enforcement is active (ceiling > 0). */
  get enforcing(): boolean {
    return this.ceilingUsd > 0;
  }

  /** Add cost from a completed node. May emit a cost-warn event. */
  addCost(costUsd: number): void {
    if (!this.enforcing) return;
    this.spentUsd += costUsd;

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
          pct: Math.round(pct * 10) / 10,
        },
      });
    }
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
