/**
 * flow-runner.ts — Definition-driven DAG executor (ADR-028, M3-1/2).
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
import type { CycleInput, ReviewerOutcome } from './cycle-context.ts';
import type { ClosureResult } from './phases/closure.ts';
import type { FlowDefinition, FlowNode } from './studio/types.ts';

import { runProjectManager } from './phases/project-manager.ts';
import { runDeveloperLoop } from './phases/developer-loop.ts';
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
  emitSyntheticArchitectEvents,
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
  /**
   * Emits synthetic architect start/end events into the cycle log.
   * The architect ran out-of-cycle; these events make the UI reflect the
   * phase as complete. Reads manifest fields for real cost/duration/sessionId.
   */
  emitSyntheticArchitect: (input: CycleInput, logger: EventLogger) => void;

  runProjectManager: (input: CycleInput, logger: EventLogger) => Promise<void>;

  runDeveloperLoop: (
    input: CycleInput,
    logger: EventLogger,
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
 * Item 2: the architect node in the DAG is a marker — `runCycle` emits the
 * real synthetic architect events (via `emitSyntheticArchitectEvents`) before
 * calling `runFlow`, so that dry-run paths also produce them. The dep here is
 * a no-op by default; tests override it to assert it is NOT called (the
 * architect events come from runCycle's outer scaffolding, not the DAG walk).
 *
 * `emitSyntheticArchitectEvents` is exported from cycle.ts for callers that
 * need to emit outside the flow (e.g., a standalone dry-run harness).
 */
function defaultEmitSyntheticArchitect(_input: CycleInput, _logger: EventLogger): void {
  // no-op: runCycle already emitted architect events before calling runFlow.
  void emitSyntheticArchitectEvents; // keep import alive for external callers
}

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
  emitSyntheticArchitect: defaultEmitSyntheticArchitect,
  runProjectManager,
  runDeveloperLoop,
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
};

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
}: FlowRunArgs): Promise<{
  cycleOutcome: 'ready-for-review' | 'merged' | 'pr-open';
  reflectionStatus: string;
  lintStatus: string;
}> {
  const deps: FlowRunnerDeps = { ...DEFAULT_DEPS, ...depOverrides };

  const order = topoSort(flow);
  const nodeById = new Map<string, FlowNode>(flow.nodes.map((n) => [n.id, n]));

  // Track outcome state — mirrors cycle.ts. 'failed' never appears here:
  // failures throw and are caught by runCycle's outer try/catch.
  let cycleOutcome: 'ready-for-review' | 'merged' | 'pr-open' = 'ready-for-review';
  let reflectionStatus = 'skipped';
  let lintStatus = 'skipped';
  let reviewerOutcome: ReviewerOutcome = 'ready-for-review';
  let closure: ClosureResult | null = null;

  for (const nodeId of order) {
    const node = nodeById.get(nodeId);
    if (!node) continue; // defensive

    const kind = classifyNode(node);

    switch (kind) {
      case 'architect': {
        // Item 2: pre-satisfied gate — emit real synthetic architect events
        deps.emitSyntheticArchitect(input, logger);
        break;
      }

      case 'pm': {
        if (input.resumeFrom === 'unifier') {
          // Item 3: rebase the preserved branch onto main before running the dev-loop
          deps.rebaseForResume(input, logger);
          logger.emit({
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
        await deps.runProjectManager(input, logger);
        break;
      }

      case 'dev': {
        // M3 coupling: runDeveloperLoop calls runUnifier internally.
        // The flow's separate unifier node is a marker (handled in 'unifier' case).
        // Items 4-8: the dev-loop close contract runs immediately after.
        const devLoopOutcome = await deps.runDeveloperLoop(input, logger);

        // Item 4: commit any uncommitted dev-loop work before the reviewer starts.
        deps.commitDevLoopBoundary(input.worktreePath, logger, input.initiativeId);

        // Item 5: push once more + assert local↔remote invariant.
        deps.enforceDevLoopCloseInvariant(input.worktreePath, logger, input.initiativeId);

        // Item 6: delivery gate — unifier must have passed.
        if (!devLoopOutcome.unifierSucceeded) {
          throw new Error(
            `delivery gate: unifier did not pass (${devLoopOutcome.unifierFailureClass ?? 'dev-loop-unifier-gate-failed'}) — ` +
              `the branch is not review-ready, so no PR is opened. Triage the unifier failure before re-running.`,
          );
        }

        // Item 7: empty-branch guard.
        deps.assertNonEmptyDelivery(devLoopOutcome, input.initiativeId, input.worktreePath, logger);

        // Item 8: final CI delivery gate (before openPrInline in review node).
        deps.enforceFinalCiGate(input, logger);

        break;
      }

      case 'unifier': {
        // MARKER ONLY — runDeveloperLoop already called runUnifier internally.
        // Document: M3 coupling. A clean per-node split is deferred.
        logger.emit({
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
        reviewerOutcome = await deps.openPrInline(input, logger);
        closure = await deps.runClosure(input, logger, reviewerOutcome);
        cycleOutcome = closure.outcome as 'ready-for-review' | 'merged' | 'pr-open';
        break;
      }

      case 'reflect': {
        // Only run if the closure confirmed a merge (G10)
        if (closure?.merged) {
          const reflectorResult = await deps.runReflector(input, logger);
          reflectionStatus = reflectorResult.reflection_status;
          lintStatus = reflectorResult.lint_status;
        }
        break;
      }

      default: {
        logger.emit({
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
