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

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

import type { EventLogger } from './logging.ts';
import type { CycleInput, CycleOutcome, ReviewerOutcome } from './cycle-context.ts';
import type { ClosureResult } from './phases/closure.ts';
import type { FlowDefinition, FlowNode, AgentBudgets } from './studio/types.ts';
import { CostTracker, WedgeDetector, WedgeKillError, RateLimitGate } from './flow-budgets.ts';

import { runProjectManager as realRunProjectManager } from './phases/project-manager.ts';
import { runDeveloperLoop as realRunDeveloperLoop, runUnifierPhase as realRunUnifierPhase } from './phases/developer-loop.ts';
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
} from './cycle-helpers.ts';
import { listArtifactTemplates } from './studio/registry.ts';
import { assertInboundArtifacts, type ArtifactContract } from './flow-artifacts.ts';

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

  /** M3-5: Enqueue a target flow's run (trigger firing). Injectable for tests. Default stages a minimal run-request into `_queue/pending/` (M4+ scheduler claim extension required). */
  enqueueFlowRun: (flowId: string, opts: { origin: string; triggeredBy: string }) => void;
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
  | 'pm'          // agent:'project-manager'
  | 'dev'         // agent:'developer-ralph' with fanOut:'work-items'
  | 'unifier'     // agent:'developer-unifier' — real executor (runUnifierPhase + close-contract gates)
  | 'review'      // has gate:'verdict' — openPrInline + runClosure
  | 'reflect'     // agent:'reflector'
  | 'unknown';    // defensive fallback

/**
 * Gate id → node kind. A gate ALWAYS wins over the agent field (the architect
 * node carries both agent:'architect' and gate:'plan' and must classify as
 * 'architect'). Extend by adding a row — no control-flow edit.
 */
const GATE_KIND: Readonly<Record<string, NodeKind>> = {
  plan: 'architect',
  verdict: 'review',
};

/**
 * Agent slug → node kind. Adding a new agent that reuses an existing executor
 * kind is a one-line row here; a brand-new kind also registers an executor in
 * DEFAULT_NODE_EXECUTORS (or is injected via FlowRunArgs.nodeExecutors). Either
 * way the dispatch loop below is never touched — this closes the ADR-028
 * "new flow = no orchestrator change" promise for the common cases.
 */
const AGENT_KIND: Readonly<Record<string, NodeKind>> = {
  'project-manager': 'pm',
  'developer-ralph': 'dev',
  'developer-unifier': 'unifier',
  reflector: 'reflect',
};

/** Resolve a node's executor kind from its gate/agent fields via the data tables. */
export function resolveNodeKind(node: FlowNode): NodeKind {
  if (node.gate && GATE_KIND[node.gate]) return GATE_KIND[node.gate];
  if (node.agent && AGENT_KIND[node.agent]) return AGENT_KIND[node.agent];
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

/**
 * Flow-TRIGGER enqueue (declarative `flow.triggers[]`, fired on terminal
 * success). Writes a structural flow-run-request marker into `_queue/pending/`.
 *
 * NOTE (S7): the operator-driven "start development" path does NOT go through
 * here — it threads a real initiative + cycle_id, so it has its own claimable
 * enqueue (`orchestrator/enqueue-develop-run.ts`, behind `POST /api/develop/start`).
 * This marker covers only auto-chaining BETWEEN flows (e.g. a future
 * architect→develop trigger), which threads the just-completed initiative's
 * manifest when the monolith retirement lands (S8). No seed flow declares a
 * trigger today, so this stays a marker by design.
 */
function defaultEnqueueFlowRun(flowId: string, opts: { origin: string; triggeredBy: string }): void {
  const pendingDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), '_queue', 'pending');
  if (!existsSync(pendingDir)) mkdirSync(pendingDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const now = new Date().toISOString();
  writeFileSync(
    join(pendingDir, `flow-run-${flowId}-${ts}.md`),
    `---\nflow_id: ${flowId}\norigin: ${opts.origin}\ntriggered_by: ${opts.triggeredBy}\ncreated_at: ${now}\n---\n\n# Flow run request: ${flowId}\n\nTriggered by "${opts.triggeredBy}" on terminal completion. Scheduler claim deferred to M4+.\n`,
    'utf8',
  );
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
  if (state.closure?.merged) {
    const reflectorResult = await deps.runReflector(input, nodeLogger);
    state.reflectionStatus = reflectorResult.reflection_status;
    state.lintStatus = reflectorResult.lint_status;
  }
};

/** unknown: graceful skip — record the node as visited and continue. */
const execUnknown: NodeExecutor = async (ctx) => {
  ctx.nodeLogger.emit({
    initiative_id: ctx.input.initiativeId,
    phase: 'orchestrator',
    skill: 'flow-runner',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    message: 'flow-runner.unknown-node-skipped',
    metadata: { node_id: ctx.nodeId, agent: ctx.node.agent, gate: ctx.node.gate },
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

  for (const nodeId of order) {
    const node = nodeById.get(nodeId);
    if (!node) continue; // defensive

    const kind = resolveNodeKind(node);

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

  // M3-5: Trigger firing — fire on terminal SUCCESS only (not on failure,
  // which exits via throw before reaching here). Only `on: complete` is
  // supported in M3; unknown `on` values are logged and skipped.
  for (const trigger of flow.triggers) {
    if (trigger.on === 'complete') {
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
      deps.enqueueFlowRun(trigger.flow, { origin: 'trigger', triggeredBy: flow.id });
    } else {
      logger.emit({
        initiative_id: input.initiativeId,
        phase: 'orchestrator',
        skill: 'flow-runner',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'flow-runner.trigger-skipped-unknown-on',
        metadata: { on: trigger.on, target_flow: trigger.flow, note: 'only "complete" is supported in M3' },
      });
    }
  }

  return {
    cycleOutcome: state.cycleOutcome,
    reflectionStatus: state.reflectionStatus,
    lintStatus: state.lintStatus,
  };
}

// ---------------------------------------------------------------------------
// Convenience: resolve the forge-cycle flow.yaml path
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to a flow's `flow.yaml` by id, relative to the forge
 * root (two levels above this file's directory). The scheduler routes a cycle to
 * the flow named by the initiative manifest's `flow_id` (default `forge-cycle`).
 */
export function flowPathForId(flowId: string): string {
  const forgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return resolve(forgeRoot, 'studio', 'flows', flowId, 'flow.yaml');
}

/**
 * Returns the absolute path to the forge-cycle/flow.yaml, resolved relative
 * to the forge root (two levels above this file's directory).
 * Used by runCycle (Task 2) and tests that want to load the real definition.
 */
export function forgeCycleFlowPath(): string {
  return flowPathForId('forge-cycle');
}
