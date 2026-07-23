/**
 * flow-runner.ts — Definition-driven DAG executor (ADR-028, M3-1/2/3).
 *
 * Walks a FlowDefinition in topological order and dispatches each node to its
 * executor function. Phase functions are UNCHANGED — they are invoked as node
 * executors and receive the same CycleInput they always have.
 *
 * Unifier node (M8-0): the unifier is its own independently-dispatchable node.
 * execDev runs the per-WI loop only; execUnifier runs runUnifierPhase + the
 * close-contract gates (items 4-8). On a `resumeFrom: 'unifier'` run the dev
 * node is skipped and the unifier node is the resume target.
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
 *   4. commitDevLoopBoundary in execUnifier (after runUnifierPhase)
 *   5. enforceDevLoopCloseInvariant after boundary commit
 *   6. Unifier delivery gate (!unifierOutcome.unifierSucceeded → throw)
 *   7. assertNonEmptyDelivery after unifier gate
 *   8. enforceFinalCiGate before openPrInline
 */

import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import type { EventLogger } from './logging.ts';
import { REFLECTION_LOST_EVENT, type CycleInput, type CycleOutcome, type ReviewerOutcome } from './cycle-context.ts';
import { classifyCrash } from './failure-classifier.ts';
import type { ClosureResult } from './phases/closure.ts';
import type { FlowDefinition, FlowNode, AgentBudgets, AgentDefinition } from './studio/types.ts';
import { CostTracker, WedgeDetector, WedgeKillError, RateLimitGate } from './flow-budgets.ts';

import { runProjectManager as realRunProjectManager } from './phases/project-manager.ts';
import { runDeveloperLoop as realRunDeveloperLoop, runUnifierPhase as realRunUnifierPhase } from './phases/developer-loop.ts';
import { runClosure, promoteMergedToDone } from './phases/closure.ts';
import { runReflector } from './phases/reflector.ts';
import { rebasePreservedBranchOntoMain } from './pr.ts';
import {
  openPrInline,
  assertNonEmptyDelivery,
  commitDevLoopBoundary,
  enforceDevLoopCloseInvariant,
  enforceFinalCiGate,
  preservingForgeScratch,
} from './cycle-helpers.ts';
import { listArtifactTemplates, listAgentDefinitions, PHASE_EXECUTOR_KINDS } from './studio/registry.ts';
import { skillsDir } from './skill-path.ts';
import { findFanOutViolations } from './studio/validate.ts';
import { assertInboundArtifacts, type ArtifactContract } from './flow-artifacts.ts';
import { fireFlowTriggers } from './flow-trigger.ts';
import { stageFlowRunRequest } from './flow-run-requests.ts';
import { runAgent } from './run-agent.ts';

/** Forge repo root — `<root>/orchestrator/flow-runner.ts` resolves to `<root>`. */
const FLOW_RUNNER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  ) => Promise<void>;

  runUnifier: (
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
   * R4-11-F1 — the second terminal move of a confirmed merge: promotes the
   * manifest `merged/ → done/`. `orchestrator/finalize-merged.ts` is the
   * production caller for the normal (deferred) merge-confirmation path; a
   * flow that combines a review node with a downstream reflect node in ONE
   * DAG pass (the retired forge-cycle monolith shape, kept as a generic
   * DAG-engine fixture) needs this call too — finalize-merged.ts only scans
   * `ready-for-review/`, and closure's own terminal move already left this
   * manifest sitting in `merged/`, not there. `phases/closure.ts` remains
   * the single terminal-move authority (this is that same function, not a
   * duplicate); injectable so tests needn't touch the fs.
   */
  promoteMergedToDone: (input: CycleInput, logger: EventLogger, parentEventId?: string) => void;

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

  /**
   * Stage C: enqueue a target flow's run when an `on: complete` trigger fires.
   * Injectable for tests. The default stages a claimable flow-run request into
   * `_queue/flow-runs/`, carrying the source initiative so a drain can repoint it
   * at the target flow. (`on: merged` triggers are fired by finalize-merged, not
   * here.)
   */
  enqueueFlowRun: (
    flowId: string,
    opts: { origin: string; triggeredBy: string; sourceInitiativeId?: string },
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
// Node kind classification (data tables, not control flow)
// ---------------------------------------------------------------------------

export type NodeKind =
  | 'architect'   // has gate:'plan' — pre-satisfied, emit synthetic events
  | 'pm'          // agent def declares executor:'pm' (project-manager)
  | 'dev'         // agent def declares executor:'dev' (developer-ralph, fanOut:'work-items')
  | 'unifier'     // agent def declares executor:'unifier' (developer-unifier) — runUnifierPhase + close-contract gates
  | 'review'      // has gate:'verdict' — openPrInline + runClosure
  | 'reflect'     // agent def declares executor:'reflect' (reflector)
  | 'agent'       // agent def exists, no executor declared — generic F1 runAgent path (R2-01-F2)
  | 'unknown';    // defensive fallback — no def, or an invalid declared executor

/**
 * Gate id → node kind. A gate ALWAYS wins over the agent field (the architect
 * node carries both agent:'architect' and gate:'plan' and must classify as
 * 'architect'). Extend by adding a row — no control-flow edit.
 */
const GATE_KIND: Readonly<Record<string, NodeKind>> = {
  plan: 'architect',
  verdict: 'review',
};

type PhaseExecutorKind = (typeof PHASE_EXECUTOR_KINDS)[number];

function isPhaseExecutorKind(value: string): value is PhaseExecutorKind {
  return (PHASE_EXECUTOR_KINDS as readonly string[]).includes(value);
}

/**
 * Resolve a node's executor kind from its gate/agent fields. Gates resolve
 * via the GATE_KIND table (unchanged). Agent nodes resolve from the AGENT
 * DEFINITION (R2-01-F2) instead of a hardcoded slug table:
 *   - no def for `node.agent` → 'unknown' (genuinely unresolvable ref).
 *   - def declares a valid `executor` (one of PHASE_EXECUTOR_KINDS) → that kind.
 *   - def declares an `executor` NOT in PHASE_EXECUTOR_KINDS → 'unknown'
 *     (invalid declared executor; also caught by lint's node-executor check).
 *   - def exists with no `executor` → 'agent' (generic library agent, runs
 *     via the F1 execAgent path).
 */
export function resolveNodeKind(node: FlowNode, agents: ReadonlyMap<string, AgentDefinition>): NodeKind {
  if (node.gate && GATE_KIND[node.gate]) return GATE_KIND[node.gate];
  if (!node.agent) return 'unknown';
  const def = agents.get(node.agent);
  if (!def) return 'unknown';
  if (def.executor !== undefined) return isPhaseExecutorKind(def.executor) ? def.executor : 'unknown';
  return 'agent';
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

/**
 * Stage C — flow-TRIGGER enqueue (declarative `flow.triggers[]`, `on: complete`,
 * fired on terminal success). Stages a CLAIMABLE flow-run request into
 * `_queue/flow-runs/` (carrying the source initiative), which the scheduler's
 * drain repoints at the target flow. Lives outside `_queue/pending/` so the
 * initiative claim never mis-reads it.
 *
 * NOTE (S7): the operator-driven "start development" path does NOT go through
 * here — it threads a real initiative + cycle_id via `enqueue-develop-run.ts`
 * (behind `POST /api/develop/start`). This path covers auto-chaining BETWEEN
 * flows. No seed flow declares an `on: complete` trigger today (reflect fires on
 * `merged`, via finalize-merged), so the drain has no live consumer yet.
 */
function defaultEnqueueFlowRun(
  flowId: string,
  opts: { origin: string; triggeredBy: string; sourceInitiativeId?: string },
): void {
  stageFlowRunRequest({
    flowId,
    origin: opts.origin,
    triggeredBy: opts.triggeredBy,
    sourceInitiativeId: opts.sourceInitiativeId,
  });
}

const DEFAULT_DEPS: FlowRunnerDeps = {
  // Thread the optional wedge-abort signal into real phase functions.
  runProjectManager: (input, logger, signal?) =>
    realRunProjectManager(input, logger, { signal }),
  runDeveloperLoop: (input, logger, signal?) =>
    realRunDeveloperLoop(input, logger, signal),
  runUnifier: (input, logger, signal?) =>
    realRunUnifierPhase(input, logger, signal),
  openPrInline,
  runClosure,
  runReflector,
  promoteMergedToDone,
  commitDevLoopBoundary,
  enforceDevLoopCloseInvariant,
  assertNonEmptyDelivery,
  enforceFinalCiGate,
  rebaseForResume: defaultRebaseForResume,
  enqueueFlowRun: defaultEnqueueFlowRun,
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
  /**
   * Optional node-executor overrides keyed by node kind, merged over the
   * defaults. The extension seam (ADR-028): register or replace an executor
   * without editing the dispatch loop. Used by tests and by flows that supply
   * custom node behaviour.
   */
  nodeExecutors?: Partial<Record<NodeKind, NodeExecutor>>;
  /**
   * Optional per-run cost ceiling (USD) that OVERRIDES the flow's own
   * `costCeilingUsd` for this run. Resolved by the caller (cycle.ts) from
   * `FORGE_COST_CEILING_USD` env ?? manifest `cost_ceiling_usd`. Absent =
   * fall back to `flow.costCeilingUsd`. Lets one initiative carry a higher
   * ceiling than the shared seed flow without mutating the flow file.
   */
  costCeilingUsd?: number;
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
// Edit-lock version seam (ADR-028 §6, M3-6 minimal)
// ---------------------------------------------------------------------------

/**
 * Synchronously re-read the flow version from disk using a lightweight regex.
 * Returns null when the path is unavailable or the version field cannot be parsed.
 * Exported for tests.
 */
export function readOnDiskFlowVersion(flowPath: string): number | null {
  try {
    const content = readFileSync(flowPath, 'utf8');
    const m = content.match(/^version:\s*(\d+)/m);
    if (!m) return null;
    const v = parseInt(m[1], 10);
    return isNaN(v) ? null : v;
  } catch {
    return null;
  }
}

/**
 * Check the on-disk flow version against the version the runner started with.
 * Emits a `flow.version-changed-during-run` warning when they differ.
 * Full edit-lock enforcement (refusing in-flight mutations) is M4.
 * Exported for tests.
 */
export function checkFlowVersionSeam(
  flow: FlowDefinition,
  startVersion: number,
  initiativeId: string,
  logger: EventLogger,
): void {
  if (!flow.path) return; // no path — test stub or seed flow
  const currentVersion = readOnDiskFlowVersion(flow.path);
  if (currentVersion === null) return; // unreadable — skip
  if (currentVersion !== startVersion) {
    logger.emit({
      initiative_id: initiativeId,
      phase: 'orchestrator',
      skill: 'flow-runner',
      event_type: 'log',
      input_refs: [flow.path],
      output_refs: [],
      message: 'flow.version-changed-during-run',
      metadata: {
        flow_id: flow.id,
        start_version: startVersion,
        current_version: currentVersion,
        note: 'M3 seam: full edit-lock enforcement is M4',
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Node executors (registry dispatch — ADR-028)
// ---------------------------------------------------------------------------

/** Mutable cross-node outcome state, threaded through every executor. */
type NodeRunState = {
  cycleOutcome: CycleOutcome;
  reflectionStatus: string;
  lintStatus: string;
  reviewerOutcome: ReviewerOutcome;
  closure: ClosureResult | null;
};

/** Everything a node executor needs. Built fresh per node by runFlow. */
type NodeExecContext = {
  node: FlowNode;
  nodeId: string;
  input: CycleInput;
  /** Per-node logger (cost + wedge wrapped). Executors emit here. */
  nodeLogger: EventLogger;
  /** Cost-only logger — used for out-of-band events (e.g. wedge-kill). */
  costLogger: EventLogger;
  deps: FlowRunnerDeps;
  wedgeDetector: WedgeDetector;
  nodeBudget: AgentBudgets | undefined;
  state: NodeRunState;
  /** The run's agent roster (R2-01-F2), slug → definition. Built once per run. */
  agents: ReadonlyMap<string, AgentDefinition>;
  /** Artifact names produced by this node's inbound edges (R2-01-F2, execAgent's prompt context). */
  inboundArtifacts: string[];
};

export type NodeExecutor = (ctx: NodeExecContext) => Promise<void>;

/**
 * Run a phase fn under optional wedge detection. When wedgeKillMs is set
 * (wedgeDetector.active), races the fn against the wedge timer and emits
 * phase.wedge-killed on kill; otherwise calls it with an undefined signal.
 */
async function runWithWedge<T>(
  ctx: NodeExecContext,
  fn: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  const { wedgeDetector, costLogger, input, nodeId, nodeBudget } = ctx;
  if (!wedgeDetector.active) return fn(undefined);
  return raceWithWedge(
    (sig) => fn(sig),
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
}

/** architect: silent DAG marker — runCycle already emitted the synthetic events. */
const execArchitect: NodeExecutor = async () => { /* marker only */ };

/** pm: skip + rebase on unifier-resume; otherwise run the project manager. */
const execPm: NodeExecutor = async (ctx) => {
  const { input, nodeLogger, deps, nodeId } = ctx;
  if (input.resumeFrom === 'unifier') {
    // Item 3: rebase the preserved branch onto main before running the dev-loop.
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
    return;
  }
  await runWithWedge(ctx, (sig) => deps.runProjectManager(input, nodeLogger, sig));
};

/**
 * dev: the per-WI developer loop. The unifier is its own node (execUnifier).
 * On a `resumeFrom: 'unifier'` run, runDeveloperLoop self-no-ops the per-WI work
 * (toRun=[]) and STILL emits the dev-loop start/end{resumed:true} events — so the
 * dev hex resolves to complete and the unifier node is the resume target. We do
 * NOT short-circuit here: skipping the call would drop those phase-boundary
 * events and leave the dev hex stuck active on a resume cycle.
 */
const execDev: NodeExecutor = async (ctx) => {
  const { input, nodeLogger, deps } = ctx;
  await runWithWedge(ctx, (sig) => deps.runDeveloperLoop(input, nodeLogger, sig));
};

/**
 * unifier: the unifier sub-phase (runUnifierPhase), then items 4-8 of the close
 * contract. A real executor (M8-0) — no longer a marker. Gets its own wedge
 * detector. The delivery gate (6-8) lives here so it runs against the unified
 * branch, in the same order as the former in-dev-loop sequence.
 */
const execUnifier: NodeExecutor = async (ctx) => {
  const { input, nodeLogger, deps } = ctx;
  const unifierOutcome = await runWithWedge(ctx, (sig) => deps.runUnifier(input, nodeLogger, sig));

  // Item 4: commit any uncommitted work before the reviewer starts.
  deps.commitDevLoopBoundary(input.worktreePath, nodeLogger, input.initiativeId);
  // Item 5: push once more + assert local↔remote invariant.
  deps.enforceDevLoopCloseInvariant(input.worktreePath, nodeLogger, input.initiativeId);
  // Item 6: delivery gate — unifier must have passed.
  if (!unifierOutcome.unifierSucceeded) {
    throw new Error(
      `delivery gate: unifier did not pass (${unifierOutcome.unifierFailureClass ?? 'dev-loop-unifier-gate-failed'}) — ` +
        `the branch is not review-ready, so no PR is opened. Triage the unifier failure before re-running.`,
    );
  }
  // Item 7: empty-branch guard.
  deps.assertNonEmptyDelivery(unifierOutcome, input.initiativeId, input.worktreePath, nodeLogger);
  // Item 8: final CI delivery gate (before openPrInline in the review node).
  deps.enforceFinalCiGate(input, nodeLogger);
};

/** review: open the PR, then run closure. */
const execReview: NodeExecutor = async (ctx) => {
  const { input, nodeLogger, deps, state } = ctx;
  state.reviewerOutcome = await deps.openPrInline(input, nodeLogger);
  state.closure = await deps.runClosure(input, nodeLogger, state.reviewerOutcome);
  state.cycleOutcome = state.closure.outcome as CycleOutcome;
};

/** reflect: only when the closure confirmed a merge (G10). */
const execReflect: NodeExecutor = async (ctx) => {
  const { input, nodeLogger, deps, state } = ctx;
  if (!state.closure?.merged) return;
  try {
    try {
      const reflectorResult = await deps.runReflector(input, nodeLogger);
      state.reflectionStatus = reflectorResult.reflection_status;
      state.lintStatus = reflectorResult.lint_status;
    } catch (err) {
      // 2.10 reflector pipeline honesty: runReflector's log-and-continue
      // contract means a throw here is a CALLER-side death (prompt/brain-index
      // build, an injected adapter) that would otherwise vanish into the
      // cycle-failure catch with nothing marking the reflection as lost.
      // Instrument-only: record the loss, then rethrow — control flow unchanged.
      const errMsg = err instanceof Error ? err.message : String(err);
      const crash = classifyCrash(errMsg, null);
      state.reflectionStatus = 'failed';
      nodeLogger.emit({
        initiative_id: input.initiativeId,
        phase: 'reflection',
        skill: 'reflector',
        event_type: 'error',
        input_refs: [],
        output_refs: [],
        message: REFLECTION_LOST_EVENT,
        metadata: { cause: 'crash', detail: errMsg, crash_kind: crash.kind, crash_reason: crash.reason },
      });
      throw err;
    }
  } finally {
    // R4-11-F1: `merged` is a transient pass-through, never a parking state —
    // promote merged/ → done/ NOW, in this SAME node, regardless of whether
    // reflection succeeded or was lost (recorded above via
    // cycle.reflection-lost, then rethrown). Mirrors finalize-merged.ts's
    // unconditional promote-after-reflect-dispatch: the reflection-lost path
    // must ALSO still reach done/.
    deps.promoteMergedToDone(input, nodeLogger);
  }
};

/**
 * unknown: a genuinely unresolvable node — no agent def for `node.agent`, or
 * an invalid declared `executor` (R2-01-F2). This is now an ERROR, not a
 * quiet skip (AC #4): the flow proceeds (the DAG walk itself is not aborted
 * here — the node just performs no work), but the event is loud so a
 * misconfigured flow surfaces instead of silently doing nothing.
 */
const execUnknown: NodeExecutor = async (ctx) => {
  ctx.nodeLogger.emit({
    initiative_id: ctx.input.initiativeId,
    phase: 'orchestrator',
    skill: 'flow-runner',
    event_type: 'error',
    input_refs: [],
    output_refs: [],
    message: 'flow-runner.unknown-node-skipped',
    metadata: { node_id: ctx.nodeId, agent: ctx.node.agent, gate: ctx.node.gate },
  });
};

/**
 * Assemble a minimal prompt for a generic execAgent run: the agent's own
 * SKILL.md process intent (`def.body`) followed by a small "## Run context"
 * section naming the project, initiative, and any inbound artifact refs.
 * Richer assembly (composition.tools/mcps/hooks, artifact bodies) is later
 * work (R2-05/R4) — kept deliberately small here.
 */
function buildAgentPrompt(def: AgentDefinition, ctx: NodeExecContext): string {
  const { input, inboundArtifacts } = ctx;
  const projectName = basename(input.projectRepoPath);
  const lines = [
    def.body.trim(),
    '',
    '## Run context',
    `- Project: ${projectName} (${input.projectRepoPath})`,
    `- Initiative: ${input.initiativeId}`,
    `- Inbound artifacts: ${inboundArtifacts.length > 0 ? inboundArtifacts.join(', ') : 'none'}`,
  ];
  return lines.join('\n');
}

/**
 * agent: the generic F1 runAgent path (R2-01-F2, AC #1). Resolves ONLY when
 * `resolveNodeKind` picked 'agent' — a real roster def with no declared
 * `executor` (i.e. not one of the four legacy phase executors). No gate, no
 * runWithWedge (runAgent takes no AbortSignal — abort-chaining is R2-03-F4's
 * job; wedge budgets are inert in production regardless, ADR-036 forbids the
 * primitive running its own gate).
 */
const execAgent: NodeExecutor = async (ctx) => {
  const { node, input, nodeLogger, agents } = ctx;
  const def = agents.get(node.agent ?? '');
  if (!def) {
    // Defensive: resolution only ever picks 'agent' when the def exists.
    throw new Error(`execAgent: no agent definition for node "${ctx.nodeId}" (agent:"${node.agent}")`);
  }

  const prompt = buildAgentPrompt(def, ctx);

  await runAgent(def, {
    runId: input.cycleId ?? input.initiativeId,
    logger: nodeLogger,
    workdir: input.worktreePath,
    prompt,
    bindings: {
      project: { name: basename(input.projectRepoPath), repoPath: input.projectRepoPath },
      initiative: { id: input.initiativeId, manifestPath: input.manifestPath },
    },
    artifactRefs: ctx.inboundArtifacts,
  });
};

/**
 * Default executor per node kind. The dispatch loop resolves a node's kind via
 * resolveNodeKind() and looks it up here — no switch. Inject overrides/additions
 * through FlowRunArgs.nodeExecutors to register a custom executor without
 * touching this file.
 */
const DEFAULT_NODE_EXECUTORS: Readonly<Record<NodeKind, NodeExecutor>> = {
  architect: execArchitect,
  pm: execPm,
  dev: execDev,
  unifier: execUnifier,
  review: execReview,
  reflect: execReflect,
  agent: execAgent,
  unknown: execUnknown,
};

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
 * resumeFrom: when `input.resumeFrom === 'unifier'`, the pm node rebases + skips
 * (item 3), the dev node runs but self-no-ops the per-WI work (toRun=[], still
 * emitting its start/end{resumed:true} events so the dev hex resolves complete),
 * and the unifier node (execUnifier → runUnifierPhase) is the resume target —
 * it publishes the preserved branch, runs the unifier, then the close gates.
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
  nodeExecutors: executorOverrides,
  costCeilingUsd,
}: FlowRunArgs): Promise<{
  cycleOutcome: CycleOutcome;
  reflectionStatus: string;
  lintStatus: string;
}> {
  const deps: FlowRunnerDeps = { ...DEFAULT_DEPS, ...depOverrides };

  // G6: fan-out truth — a node declaring `fanOut` must be fed by an inbound
  // edge carrying a matching artifact (an entry node, having no inbound edges
  // at all, can never satisfy this). `forge studio lint` already rejects this
  // shape at authoring time via the SAME predicate (findFanOutViolations);
  // this is belt-and-suspenders here since the runner must never execute a
  // flow with an illegal fanOut — fail fast, before any node runs, not
  // mid-run.
  const fanOutViolations = findFanOutViolations(flow);
  if (fanOutViolations.length > 0) {
    const detail = fanOutViolations
      .map((v) => `"${v.nodeId}" declares fanOut:"${v.fanOut}" with no inbound edge carrying that artifact`)
      .join('; ');
    throw new Error(`flow-runner: flow "${flow.id}" has an illegal fanOut — ${detail} (see \`forge studio lint\`)`);
  }

  // M3-3: Budget setup — additive, no-ops when ceiling is 0/absent.
  // Per-run override (cycle.ts resolves FORGE_COST_CEILING_USD ?? manifest
  // cost_ceiling_usd) wins over the flow's own ceiling when provided.
  const costTracker = new CostTracker({
    ceilingUsd: costCeilingUsd ?? flow.costCeilingUsd ?? 0,
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
  const state: NodeRunState = {
    cycleOutcome: 'ready-for-review',
    reflectionStatus: 'skipped',
    lintStatus: 'skipped',
    reviewerOutcome: 'ready-for-review',
    closure: null,
  };

  // Registry dispatch: defaults + any caller-injected overrides (ADR-028 seam).
  const executors: Record<NodeKind, NodeExecutor> = {
    ...DEFAULT_NODE_EXECUTORS,
    ...(executorOverrides ?? {}),
  };

  // ADR-027 runtime artifact contracts — built once per run (7 small files; an
  // absent template dir → empty map → the guard no-ops).
  const artifactTemplates = new Map<string, ArtifactContract>(
    listArtifactTemplates(FLOW_RUNNER_ROOT).map((t) => [t.id, { id: t.id, kind: t.kind, schema: t.schema }]),
  );

  // R2-01-F2: the run's agent roster, built once per run (cheap — a handful
  // of skill dirs). Node-kind resolution reads `AgentDefinition.executor` off
  // this map instead of a hardcoded slug table.
  const agents = new Map<string, AgentDefinition>(
    listAgentDefinitions(skillsDir(FLOW_RUNNER_ROOT)).map((a) => [a.slug, a]),
  );

  for (const nodeId of order) {
    const node = nodeById.get(nodeId);
    if (!node) continue; // defensive

    const kind = resolveNodeKind(node, agents);

    // M3-3: Rate-limit gate — before every node spawn, wait if a prior
    // rate-limit recorded a resetsAt. No-op when nothing is recorded.
    await rateLimitGate.waitIfNeeded();

    // M3-6 edit-lock version seam: check at each node boundary whether the
    // on-disk flow version has changed since claim time. Logs a warning;
    // full enforcement is M4.
    checkFlowVersionSeam(flow, flow.version, input.initiativeId, costLogger);

    // M3-3: Per-node wedge detector. Each node gets a fresh detector so the
    // clock starts from the first event seen within that node's execution.
    const nodeBudget = nodeBudgets?.get(nodeId);
    const wedgeDetector = new WedgeDetector({
      wedgeKillMs: nodeBudget?.wedgeKillMs,
      nodeId,
    });
    // Wrap costLogger with wedge tracking for this node's execution.
    const nodeLogger = wrapLoggerForWedge(costLogger, wedgeDetector, () => Date.now());

    const inboundArtifacts = flow.edges.filter((e) => e.to === nodeId).map((e) => e.artifact);

    const ctx: NodeExecContext = {
      node,
      nodeId,
      input,
      nodeLogger,
      costLogger,
      deps,
      wedgeDetector,
      nodeBudget,
      state,
      agents,
      inboundArtifacts,
    };

    // ADR-027: assert the node's inbound artifacts exist before it runs. The
    // reflect node is exempt — its inbound `verdict` is produced by the human
    // review gate (async in unattended mode); verdict.json is persisted at the
    // decision point, not by a producing node. A dry run produces no real
    // artifacts, so enforcement is skipped there.
    if (kind !== 'reflect' && !input.dryRun) {
      assertInboundArtifacts({
        flow,
        nodeId,
        input,
        forgeRoot: FLOW_RUNNER_ROOT,
        templates: artifactTemplates,
        onMissing: (detail) =>
          nodeLogger.emit({
            initiative_id: input.initiativeId,
            phase: 'orchestrator',
            skill: 'flow-runner',
            event_type: 'error',
            input_refs: [],
            output_refs: [],
            message: 'flow-runner.artifact-missing',
            metadata: detail,
          }),
      });
    }

    try {
      // Registry dispatch — no switch. Resolve the kind's executor (or the
      // graceful unknown-node skip) and run it. Adding a node kind never edits
      // this loop (see DEFAULT_NODE_EXECUTORS / FlowRunArgs.nodeExecutors).
      await (executors[kind] ?? execUnknown)(ctx);
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

  // Stage C: fire `on: complete` triggers on terminal SUCCESS only (failures
  // exit via throw before reaching here), through the generic declaration-driven
  // path. `on: merged` triggers — e.g. forge-develop's reflect trigger — are NOT
  // fired here: the develop flow terminates at `ready-for-review` (PR open),
  // before the operator merges, so finalize-merged fires those post-merge.
  await fireFlowTriggers(flow, 'complete', {
    onFire: (trigger) => {
      logger.emit({
        initiative_id: input.initiativeId,
        phase: 'orchestrator',
        skill: 'flow-runner',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'flow-runner.trigger-firing',
        metadata: { on: trigger.on, target_flow: trigger.flow, source_flow: flow.id },
      });
    },
    dispatch: (trigger) => {
      deps.enqueueFlowRun(trigger.flow, {
        origin: 'trigger',
        triggeredBy: flow.id,
        sourceInitiativeId: input.initiativeId,
      });
    },
  });

  return {
    cycleOutcome: state.cycleOutcome,
    reflectionStatus: state.reflectionStatus,
    lintStatus: state.lintStatus,
  };
}

// ---------------------------------------------------------------------------
// Convenience: resolve a flow.yaml path by id
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to a flow's `flow.yaml` by id, relative to the forge
 * root (two levels above this file's directory). The scheduler routes a cycle to
 * the flow named by the initiative manifest's `flow_id`. S8/DEC-3 retired the
 * forge-cycle default — there is no fallback; an unknown id resolves to a
 * non-existent path and runCycle throws (see orchestrator/cycle.ts).
 */
export function flowPathForId(flowId: string): string {
  const forgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return resolve(forgeRoot, 'studio', 'flows', flowId, 'flow.yaml');
}
