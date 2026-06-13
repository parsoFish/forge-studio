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
 * cycle.ts:119-147 emits today — then proceeds. No architect execution inside
 * the runner. Synthetic event lifting into the runner is completed in Task 2
 * (the full runCycle → runFlow cutover).
 *
 * TODO (Task 2): lift the full synthetic-architect-events block from cycle.ts
 * into this runner. The `emitSyntheticArchitect` dep below is the seam.
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
import { openPrInline } from './cycle.ts';

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
   * phase as complete.
   *
   * TODO (Task 2): this will be filled with the real synthetic-event block
   * lifted from cycle.ts:119-147. For now the default is a documented no-op
   * so the skeleton is test-driveable without the full lift.
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

function defaultEmitSyntheticArchitect(_input: CycleInput, _logger: EventLogger): void {
  // TODO (Task 2): lift the synthetic architect event block from cycle.ts:119-147
  // into here so the flow-runner is the single source. Until the full runCycle→
  // runFlow cutover (Task 2), cycle.ts still emits these events itself before
  // delegating. This no-op keeps the skeleton test-driveable.
}

const DEFAULT_DEPS: FlowRunnerDeps = {
  emitSyntheticArchitect: defaultEmitSyntheticArchitect,
  runProjectManager,
  runDeveloperLoop,
  openPrInline,
  runClosure,
  runReflector,
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
 * resumeFrom: when `input.resumeFrom === 'unifier'`, the pm node is skipped
 * and the dev-loop runs without per-WI Ralphs (runDeveloperLoop handles this
 * internally; the unifier node is still a marker-only skip).
 *
 * Returns a CycleResult-compatible object. The caller (runCycle, scheduler)
 * maps it to the terminal move as today.
 */
export async function runFlow({
  flow,
  input,
  logger,
  deps: depOverrides,
}: FlowRunArgs): Promise<{
  cycleOutcome: 'ready-for-review' | 'merged' | 'failed';
  reflectionStatus: string;
  lintStatus: string;
}> {
  const deps: FlowRunnerDeps = { ...DEFAULT_DEPS, ...depOverrides };

  const order = topoSort(flow);
  const nodeById = new Map<string, FlowNode>(flow.nodes.map((n) => [n.id, n]));

  // Track outcome state — mirrors cycle.ts
  let cycleOutcome: 'ready-for-review' | 'merged' | 'failed' = 'ready-for-review';
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
        // Pre-satisfied gate: emit synthetic events (no-op in M3-1; real lift in Task 2)
        deps.emitSyntheticArchitect(input, logger);
        break;
      }

      case 'pm': {
        // Skip PM on unifier resume — the WI specs survive in the preserved worktree
        if (input.resumeFrom === 'unifier') {
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
        await deps.runDeveloperLoop(input, logger);
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
        // Gate node: open the PR, then run closure
        reviewerOutcome = await deps.openPrInline(input, logger);
        closure = await deps.runClosure(input, logger, reviewerOutcome);
        cycleOutcome = closure.outcome as 'ready-for-review' | 'merged' | 'failed';
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
