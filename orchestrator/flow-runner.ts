/**
 * flow-runner.ts — Definition-driven DAG executor (ADR-028, M3-1/2/3).
 *
 * Walks a FlowDefinition in topological order and dispatches each node to its
 * executor function. Phase functions are UNCHANGED — they are invoked as node
 * executors and receive the same CycleInput they always have.
 *
 * M3 coupling note: `runDeveloperLoop` internally calls `runUnifier` at the
 * end of every dev pass (developer-loop.ts). The flow's separate `unifier`
 * node is therefore a MARKER only — the flow-runner records it in the visit
 * log but does NOT call a separate executor for it. A clean split (separate
 * executor invocation per node) is deferred to a later milestone once the DAG
 * engine is battle-tested.
 *
 * Architect node: the PLAN gate is satisfied before the queue picks up the
 * run (the architect ran out-of-cycle via the UI). When flow-runner encounters
 * the architect node it emits the same synthetic start/end events that
 * cycle.ts:119-147 emitted — then proceeds.
 *
 * M3-3 budgets/safety (additive — flows without these fields behave exactly as before):
 *   - costCeilingUsd: runner wraps the logger to accumulate cost_usd from every
 *     emitted event; at ≥70% emits flow.cost-warn; at ≥100% at the next clean
 *     node boundary emits flow.cost-ceiling-stop + throws CostCeilingError
 *     (resumable classification).
 *   - wedgeKillMs: per-node WedgeDetector watches the event stream; if heartbeats
 *     fire but no tool_use/file_change/test_run for wedgeKillMs ms → emits
 *     phase.wedge-killed + throws WedgeKillError (resumable). Detection races the
 *     executor via a concurrent poll timer (raceWithWedge) so a hung executor is
 *     killed even if it never returns. An AbortSignal is threaded into PM; dev-loop
 *     accepts the param (best-effort, not yet chained into per-WI Ralphs).
 *   - rate-limit gate: before spawning each node, awaits RateLimitGate.waitIfNeeded();
 *     when an executor throws a rate-limit error, gate.recordRateLimit() is called
 *     and the error is rethrown (scheduler auto-retry handles the actual retry).
 *
 * The 8 ported items from the former hardcoded runCycle sequence:
 *   1. resolveQualityGateCmd → inputWithGate threading (caller's responsibility;
 *      runFlow receives the already-resolved inputWithGate)
 *   2. emitSyntheticArchitect — real manifest-read + architect.start/end events
 *   3. Resume rebase (preservingForgeScratch + rebasePreservedBranchOntoMain)
 *   4. commitDevLoopBoundary after runDeveloperLoop
 *   5. enforceDevLoopCloseInvariant after boundary commit
 *   6. Unifier delivery gate (!devLoopOutcome.unifierSucceeded → throw)
 *   7. assertNonEmptyDelivery after unifier gate
 *   8. enforceFinalCiGate before openPrInline
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EventLogger } from './logging.ts';
import type { CycleInput, CycleOutcome, ReviewerOutcome } from './cycle-context.ts';
import type { ClosureResult } from './phases/closure.ts';
import type { FlowDefinition, FlowNode, AgentBudgets } from './studio/types.ts';
import { CostTracker, WedgeDetector, WedgeKillError, RateLimitGate } from './flow-budgets.ts';

import { runProjectManager as realRunProjectManager } from './phases/project-manager.ts';
import { runDeveloperLoop as realRunDeveloperLoop } from './phases/developer-loop.ts';
import { runClosure } from './phases/closure.ts';
import { runReflector } from './phases/reflector.ts';
import { rebasePreservedBranchOntoMain } from './pr.ts';
import {
  openPrInline,
  assertNonEmptyDelivery,
  commitDevLoopBoundary,
  enforceDevLoopCloseInvariant,
  enforceFinalCiGate,
  preservingForgeScratch,
} from './cycle.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Injectable executor set for testability. Every field defaults to the real
 * implementation. Tests supply spies so the DAG walk can be asserted without
 * touching the filesystem or spawning agents.
 */
export type FlowRunnerDeps = {
  runProjectManager: (input: CycleInput, logger: EventLogger, signal?: AbortSignal) => Promise<void>;

  runDeveloperLoop: (
    input: CycleInput,
    logger: EventLogger,
    signal?: AbortSignal,
  ) => Promise<{
    unifierSucceeded: boolean;
    unifierFailureClass: string | null;
    commitsAhead: number;
    filesChanged: number;
    insertions: number;
  }>;

  openPrInline: (input: CycleInput, logger: EventLogger) => Promise<ReviewerOutcome>;

  runClosure: (
    input: CycleInput,
    logger: EventLogger,
    reviewerOutcome: ReviewerOutcome,
  ) => Promise<ClosureResult>;

  runReflector: (
    input: CycleInput,
    logger: EventLogger,
  ) => Promise<{ reflection_status: string; lint_status: string }>;

  /**
   * Dev-loop close contract helpers. Injected for testability (tests supply
   * no-ops; production uses the real implementations from cycle.ts).
   */
  commitDevLoopBoundary: (worktreePath: string, logger: EventLogger, initiativeId: string) => void;
  enforceDevLoopCloseInvariant: (worktreePath: string, logger: EventLogger, initiativeId: string) => void;
  assertNonEmptyDelivery: (
    outcome: { commitsAhead: number; filesChanged: number; insertions: number },
    initiativeId: string,
    worktreePath: string,
    logger: EventLogger,
  ) => void;
  enforceFinalCiGate: (input: CycleInput, logger: EventLogger) => void;

  /**
   * Resume rebase: preserving .forge scratch dirs, rebase the preserved branch
   * onto main. Returns the rebase result object.
   */
  rebaseForResume: (
    input: CycleInput,
    logger: EventLogger,
  ) => void;
};

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

/**
 * Returns node ids in topological order over the flow's edges.
 * Preserves the original node declaration order for nodes at equal depth
 * (stable, deterministic).
 * Throws if the graph contains a cycle (validated by validateFlow, but
 * belt-and-suspenders here since the runner must never execute a cyclic graph).
 */
function topoSort(flow: FlowDefinition): string[] {
  const nodeIds = flow.nodes.map((n) => n.id);
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }
  for (const edge of flow.edges) {
    adj.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  // Seeds: nodes with no incoming edges, in declaration order
  const queue: string[] = nodeIds.filter((id) => inDegree.get(id) === 0);
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const neighbor of adj.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (result.length !== nodeIds.length) {
    throw new Error(`flow-runner: flow "${flow.id}" contains a cycle — cannot execute`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Node kind classification
// ---------------------------------------------------------------------------

type NodeKind =
  | 'architect'   // has gate:'plan' — pre-satisfied, emit synthetic events
  | 'pm'          // agent:'project-manager'
  | 'dev'         // agent:'developer-ralph' with fanOut:'work-items'
  | 'unifier'     // agent:'developer-unifier' — marker only (called inside dev)
  | 'review'      // has gate:'verdict' — openPrInline + runClosure
  | 'reflect'     // agent:'reflector'
  | 'unknown';    // defensive fallback

function classifyNode(node: FlowNode): NodeKind {
  // Architect: has the 'plan' gate (regardless of whether it also has an agent)
  if (node.gate === 'plan') return 'architect';

  // Review gate node: has the 'verdict' gate (gate-only, no agent)
  if (node.gate === 'verdict') return 'review';

  // Agent-driven nodes
  if (node.agent === 'project-manager') return 'pm';
  if (node.agent === 'developer-ralph') return 'dev';
  if (node.agent === 'developer-unifier') return 'unifier';
  if (node.agent === 'reflector') return 'reflect';

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Default deps (real executors)
// ---------------------------------------------------------------------------

/**
 * Item 3 (ported from cycle.ts:176-209): rebase the preserved branch onto
 * main for a unifier resume, preserving .forge scratch dirs across the rebase.
 */
function defaultRebaseForResume(input: CycleInput, logger: EventLogger): void {
  const rebase = preservingForgeScratch(
    input.worktreePath,
    ['.forge/work-items', '.forge/unifier-items'],
    () => rebasePreservedBranchOntoMain(input.worktreePath),
  );
  logger.emit({
    initiative_id: input.initiativeId,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: rebase.ok ? 'log' : 'error',
    input_refs: [input.worktreePath],
    output_refs: [],
    message: rebase.ok
      ? (rebase.rebased ? 'cycle.resume-rebased' : 'cycle.resume-no-rebase-needed')
      : 'cycle.resume-needs-rebase',
    metadata: { base: rebase.base, rebased: rebase.rebased, reason: rebase.reason ?? null },
  });
  if (!rebase.ok) {
    throw new Error(
      `resume-needs-rebase: ${rebase.reason ?? 'the preserved branch must be rebased onto current main before resuming'}`,
    );
  }
}

const DEFAULT_DEPS: FlowRunnerDeps = {
  // Thread the optional wedge-abort signal into real phase functions.
  runProjectManager: (input, logger, signal?) =>
    realRunProjectManager(input, logger, { signal }),
  runDeveloperLoop: (input, logger, signal?) =>
    realRunDeveloperLoop(input, logger, signal),
  openPrInline,
  runClosure,
  runReflector,
  commitDevLoopBoundary,
  enforceDevLoopCloseInvariant,
  assertNonEmptyDelivery,
  enforceFinalCiGate,
  rebaseForResume: defaultRebaseForResume,
};

// ---------------------------------------------------------------------------
// runFlow
// ---------------------------------------------------------------------------

export type FlowRunArgs = {
  flow: FlowDefinition;
  input: CycleInput;
  logger: EventLogger;
  deps?: Partial<FlowRunnerDeps>;
  /**
   * Optional per-node agent budget overrides keyed by node id.
   * Used to supply wedgeKillMs for wedge detection without requiring a full
   * agent registry query inside the runner. Falls back to undefined (no
   * wedge detection) when absent.
   */
  nodeBudgets?: Map<string, AgentBudgets>;
  /**
   * Injectable rate-limit gate. Default: a fresh RateLimitGate (no wait).
   * Inject a shared gate across calls to preserve recorded resetsAt across retries.
   */
  rateLimitGate?: RateLimitGate;
};

// ---------------------------------------------------------------------------
// Budget helpers
// ---------------------------------------------------------------------------

/**
 * Wrap the logger so every emitted event's cost_usd is fed to the CostTracker.
 * Returns a new EventLogger whose emit() intercepts cost and then delegates.
 */
function wrapLoggerForCost(logger: EventLogger, tracker: CostTracker): EventLogger {
  return {
    ...logger,
    emit(partial) {
      const entry = logger.emit(partial);
      if (typeof entry.cost_usd === 'number' && entry.cost_usd > 0) {
        tracker.addCost(entry.cost_usd);
      }
      return entry;
    },
  };
}

/**
 * Wrap the logger so every emitted event feeds the WedgeDetector.
 * Heartbeat events advance the detector's heartbeat clock;
 * tool_use / file_change / test_run events reset the progress clock.
 */
function wrapLoggerForWedge(
  logger: EventLogger,
  detector: WedgeDetector,
  getNow: () => number,
): EventLogger {
  return {
    ...logger,
    emit(partial) {
      const entry = logger.emit(partial);
      const t = getNow();
      // Read event_type from the partial (the caller's input) so this wrapper
      // works with any EventLogger implementation, including test stubs that
      // only return { event_id } from emit().
      const et = partial.event_type;
      if (et === 'agent_heartbeat') {
        detector.onHeartbeat(t);
      } else if (et === 'tool_use' || et === 'file_change' || et === 'test_run') {
        detector.onToolProgress(t);
      }
      return entry;
    },
  };
}

/** True if an error message carries a rate-limit signature. */
function isRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('rate_limit') ||
    msg.includes('rate-limit') ||
    msg.includes('429') ||
    msg.includes('usage limit') ||
    msg.includes('overloaded')
  );
}

/**
 * Extract a resetsAt timestamp (ms) from a rate-limit error if the SDK
 * or error message carries one. Returns null when not parseable.
 *
 * The Claude SDK does not currently expose a structured resetsAt on
 * rate-limit errors — this function is the extension point for when it does.
 * For now it returns null (gate falls back to conservative backoff in callers).
 */
function extractResetsAt(_err: unknown): number | null {
  // TODO: when the Claude SDK surfaces resetsAt on RateLimitError, read it here.
  // For now, use a conservative 60s backoff so the gate still protects spawns.
  return Date.now() + 60_000;
}

// ---------------------------------------------------------------------------
// Wedge-kill race helper
// ---------------------------------------------------------------------------

/**
 * Race an executor promise against a concurrent wedge-kill timer.
 * Returns the executor result when it wins. Throws WedgeKillError when
 * the wedge timer wins (even if the executor never resolves — this is the
 * gap-closing path).
 *
 * The wedgeAbort signal is passed to the executor for best-effort SDK cancel.
 * The poll interval is 100ms — accurate enough for minute-scale wedge windows,
 * imperceptible overhead.
 *
 * Only called when wedgeDetector.active is true (wedgeKillMs is set).
 * Cleans up the poll timer on BOTH outcomes.
 */
async function raceWithWedge<T>(
  executorFn: (signal: AbortSignal) => Promise<T>,
  wedgeDetector: WedgeDetector,
  onKill: (err: WedgeKillError) => void,
): Promise<T> {
  const wedgeAbort = new AbortController();
  let pollHandle: ReturnType<typeof setInterval> | undefined;

  const wedgePromise = new Promise<never>((_, reject) => {
    pollHandle = setInterval(() => {
      if (wedgeDetector.check(Date.now())) {
        const killErr = wedgeDetector.buildKillError(Date.now());
        onKill(killErr);
        // Reject BEFORE abort so the race rejects with WedgeKillError even
        // if the executor's abort listener resolves its promise synchronously.
        reject(killErr);
        wedgeAbort.abort();
      }
    }, 100);
  });

  try {
    return await Promise.race([executorFn(wedgeAbort.signal), wedgePromise]);
  } finally {
    if (pollHandle !== undefined) clearInterval(pollHandle);
  }
}

// ---------------------------------------------------------------------------
// runFlow
// ---------------------------------------------------------------------------

/**
 * Walk the flow's nodes in topological order and execute each node.
 *
 * Threading: CycleInput is passed UNCHANGED to every executor — same object,
 * no mutation. Matches the contract of the hardcoded cycle.ts sequence.
 *
 * The caller (runCycle) must have already resolved resolveQualityGateCmd and
 * threaded inputWithGate — runFlow receives the already-resolved input (item 1).
 *
 * resumeFrom: when `input.resumeFrom === 'unifier'`, the pm node is skipped
 * and a rebase is performed before the dev-loop (item 3). The dev-loop runs
 * without per-WI Ralphs (runDeveloperLoop handles this internally; the unifier
 * node is still a marker-only skip).
 *
 * Returns enough for runCycle to build the full CycleResult.
 */
export async function runFlow({
  flow,
  input,
  logger,
  deps: depOverrides,
  nodeBudgets,
  rateLimitGate: injectedGate,
}: FlowRunArgs): Promise<{
  cycleOutcome: CycleOutcome;
  reflectionStatus: string;
  lintStatus: string;
}> {
  const deps: FlowRunnerDeps = { ...DEFAULT_DEPS, ...depOverrides };

  // M3-3: Budget setup — additive, no-ops when ceiling is 0/absent
  const costTracker = new CostTracker({
    ceilingUsd: flow.costCeilingUsd ?? 0,
    initiativeId: input.initiativeId,
    logger,
  });
  const rateLimitGate = injectedGate ?? new RateLimitGate();

  const order = topoSort(flow);
  const nodeById = new Map<string, FlowNode>(flow.nodes.map((n) => [n.id, n]));

  // Wrap the logger once for cost tracking. Node-level wedge wrapping happens
  // per-node below so each node gets a fresh WedgeDetector.
  const costLogger = wrapLoggerForCost(logger, costTracker);

  // Track outcome state — mirrors cycle.ts. 'failed' never appears here:
  // failures throw and are caught by runCycle's outer try/catch.
  let cycleOutcome: CycleOutcome = 'ready-for-review';
  let reflectionStatus = 'skipped';
  let lintStatus = 'skipped';
  let reviewerOutcome: ReviewerOutcome = 'ready-for-review';
  let closure: ClosureResult | null = null;

  for (const nodeId of order) {
    const node = nodeById.get(nodeId);
    if (!node) continue; // defensive

    const kind = classifyNode(node);

    // M3-3: Rate-limit gate — before every node spawn, wait if a prior
    // rate-limit recorded a resetsAt. No-op when nothing is recorded.
    await rateLimitGate.waitIfNeeded();

    // M3-3: Per-node wedge detector. Each node gets a fresh detector so the
    // clock starts from the first event seen within that node's execution.
    const nodeBudget = nodeBudgets?.get(nodeId);
    const wedgeDetector = new WedgeDetector({
      wedgeKillMs: nodeBudget?.wedgeKillMs,
      nodeId,
    });
    // Wrap costLogger with wedge tracking for this node's execution.
    const nodeLogger = wrapLoggerForWedge(costLogger, wedgeDetector, () => Date.now());

    try {
      switch (kind) {
        case 'architect': {
          // Item 2: pure marker — runCycle emitted the real synthetic architect
          // events (emitSyntheticArchitectEvents) before calling runFlow. The DAG
          // walk records this node as visited but performs no emission itself.
          break;
        }

        case 'pm': {
          if (input.resumeFrom === 'unifier') {
            // Item 3: rebase the preserved branch onto main before running the dev-loop
            deps.rebaseForResume(input, nodeLogger);
            nodeLogger.emit({
              initiative_id: input.initiativeId,
              phase: 'orchestrator',
              skill: 'flow-runner',
              event_type: 'log',
              input_refs: [],
              output_refs: [],
              message: 'flow-runner.pm-skipped-resume',
              metadata: { node_id: nodeId, resume_from: input.resumeFrom },
            });
            break;
          }
          if (wedgeDetector.active) {
            await raceWithWedge(
              (sig) => deps.runProjectManager(input, nodeLogger, sig),
              wedgeDetector,
              (killErr) => {
                costLogger.emit({
                  initiative_id: input.initiativeId,
                  phase: 'orchestrator',
                  skill: 'flow-budgets',
                  event_type: 'error',
                  input_refs: [],
                  output_refs: [],
                  message: 'phase.wedge-killed',
                  metadata: { node: nodeId, wedgeKillMs: nodeBudget?.wedgeKillMs, lastProgressAt: killErr.lastProgressAt },
                });
              },
            );
          } else {
            await deps.runProjectManager(input, nodeLogger);
          }
          break;
        }

        case 'dev': {
          // M3 coupling: runDeveloperLoop calls runUnifier internally.
          // The flow's separate unifier node is a marker (handled in 'unifier' case).
          // Items 4-8: the dev-loop close contract runs immediately after.
          const devLoopOutcome = wedgeDetector.active
            ? await raceWithWedge(
                (sig) => deps.runDeveloperLoop(input, nodeLogger, sig),
                wedgeDetector,
                (killErr) => {
                  costLogger.emit({
                    initiative_id: input.initiativeId,
                    phase: 'orchestrator',
                    skill: 'flow-budgets',
                    event_type: 'error',
                    input_refs: [],
                    output_refs: [],
                    message: 'phase.wedge-killed',
                    metadata: { node: nodeId, wedgeKillMs: nodeBudget?.wedgeKillMs, lastProgressAt: killErr.lastProgressAt },
                  });
                },
              )
            : await deps.runDeveloperLoop(input, nodeLogger);

          // Item 4: commit any uncommitted dev-loop work before the reviewer starts.
          deps.commitDevLoopBoundary(input.worktreePath, nodeLogger, input.initiativeId);

          // Item 5: push once more + assert local↔remote invariant.
          deps.enforceDevLoopCloseInvariant(input.worktreePath, nodeLogger, input.initiativeId);

          // Item 6: delivery gate — unifier must have passed.
          if (!devLoopOutcome.unifierSucceeded) {
            throw new Error(
              `delivery gate: unifier did not pass (${devLoopOutcome.unifierFailureClass ?? 'dev-loop-unifier-gate-failed'}) — ` +
                `the branch is not review-ready, so no PR is opened. Triage the unifier failure before re-running.`,
            );
          }

          // Item 7: empty-branch guard.
          deps.assertNonEmptyDelivery(devLoopOutcome, input.initiativeId, input.worktreePath, nodeLogger);

          // Item 8: final CI delivery gate (before openPrInline in review node).
          deps.enforceFinalCiGate(input, nodeLogger);

          break;
        }

        case 'unifier': {
          // MARKER ONLY — runDeveloperLoop already called runUnifier internally.
          // Document: M3 coupling. A clean per-node split is deferred.
          nodeLogger.emit({
            initiative_id: input.initiativeId,
            phase: 'orchestrator',
            skill: 'flow-runner',
            event_type: 'log',
            input_refs: [],
            output_refs: [],
            message: 'flow-runner.unifier-marker',
            metadata: {
              node_id: nodeId,
              note: 'M3 coupling: runUnifier was called inside runDeveloperLoop; this node is a DAG marker only',
            },
          });
          break;
        }

        case 'review': {
          // Gate node: open the PR, then run closure.
          // Item 8 (enforceFinalCiGate) already ran in the 'dev' node so the
          // branch is CI-clean before we open the PR.
          reviewerOutcome = await deps.openPrInline(input, nodeLogger);
          closure = await deps.runClosure(input, nodeLogger, reviewerOutcome);
          cycleOutcome = closure.outcome as CycleOutcome;
          break;
        }

        case 'reflect': {
          // Only run if the closure confirmed a merge (G10)
          if (closure?.merged) {
            const reflectorResult = await deps.runReflector(input, nodeLogger);
            reflectionStatus = reflectorResult.reflection_status;
            lintStatus = reflectorResult.lint_status;
          }
          break;
        }

        default: {
          nodeLogger.emit({
            initiative_id: input.initiativeId,
            phase: 'orchestrator',
            skill: 'flow-runner',
            event_type: 'log',
            input_refs: [],
            output_refs: [],
            message: 'flow-runner.unknown-node-skipped',
            metadata: { node_id: nodeId, agent: node.agent, gate: node.gate },
          });
          break;
        }
      }
    } catch (err) {
      // M3-3: Rate-limit recording — if the executor threw a rate-limit error,
      // record the resetsAt so the next spawn will wait. Then rethrow so the
      // scheduler's auto-retry machinery handles the actual retry.
      if (isRateLimitError(err)) {
        const resetsAt = extractResetsAt(err);
        if (resetsAt !== null) rateLimitGate.recordRateLimit(resetsAt);
      }
      throw err;
    }

    // M3-3: Cost-ceiling check — at every clean node boundary (after the node
    // completes, before the next spawns). Never mid-write.
    //
    // Peek at the NEXT node id so we can report it in the stop event metadata.
    const currentIdx = order.indexOf(nodeId);
    const nextNodeId = currentIdx >= 0 ? (order[currentIdx + 1] ?? null) : null;
    costTracker.checkCeiling({ throw: true, nextNodeId: nextNodeId ?? undefined });
  }

  return { cycleOutcome, reflectionStatus, lintStatus };
}

// ---------------------------------------------------------------------------
// Convenience: resolve the forge-cycle flow.yaml path
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the forge-cycle/flow.yaml, resolved relative
 * to the forge root (two levels above this file's directory).
 * Used by runCycle (Task 2) and tests that want to load the real definition.
 */
export function forgeCycleFlowPath(): string {
  const forgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return resolve(forgeRoot, 'studio', 'flows', 'forge-cycle', 'flow.yaml');
}
