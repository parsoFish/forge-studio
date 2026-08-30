/**
 * flow-runner.ts — Definition-driven DAG executor (ADR-028, M3-1/2/3).
 *
 * Walks a FlowDefinition in topological order and dispatches each node to its
 * executor function. Phase functions are UNCHANGED — they are invoked as node
 * executors and receive the same CycleInput they always have.
 *
 * Develop-flow nodes (R4-10-F1, ADR-039/040): the live forge-develop flow is
 * dev → demo → adversarial-review → verdict. execDev runs the per-WI loop only;
 * execDemo (the `demo-band`) wraps the R4-07 demo pipeline + the RELOCATED
 * close-contract gates (items 4-8) and the demo-fix loop; execAdversarialReview
 * (the `review-band`) wraps the R4-08 critique pipeline. Both are selected by a
 * declared `composition.guards` band, not a privileged executor enum. The former
 * unifier node — execUnifier / the `developer-unifier` slug — STAYS in the
 * registry (retired at R4-01-F4) but is off the live flow; it still executes for
 * the retained forge-cycle-shaped DAG fixtures.
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
import { type CycleInput, type CycleOutcome } from './cycle-context.ts';
import type { FlowDefinition, FlowNode, AgentBudgets, AgentDefinition } from './studio/types.ts';
import { CostTracker, WedgeDetector, RateLimitGate } from './flow-budgets.ts';
import { listArtifactTemplates, listAgentDefinitions, normalizeProjectId } from './studio/registry.ts';
import { resolveBandGuard } from './agent-bands.ts';
import { skillsDir } from './skill-path.ts';
import { findFanOutViolations } from './studio/validate.ts';
import { assertInboundArtifacts, type ArtifactContract } from './flow-artifacts.ts';
import { fireFlowTriggers } from './flow-trigger.ts';
import { stageFlowRunRequest } from './flow-run-requests.ts';

import type { PhaseExecutor, ProjectGate } from './_pkg/kernel.ts';
import type { NodeExecContext, NodeRunState } from './flow-node-context.ts';
import { resolveNodeKind } from './flow-node-kind.ts';

/**
 * `resolveNodeKind` moved to its own module in M2-B so the executor table can
 * read it without the runner importing a phase. It is re-exported here because
 * the runner uses it for the reflection-close artifact exemption and two pinned
 * golden tests import it from this path.
 */
export { resolveNodeKind };

/** Forge repo root — `<root>/orchestrator/flow-runner.ts` resolves to `<root>`. */
const FLOW_RUNNER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------


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
  opts: {
    origin: 'trigger';
    triggeredBy: string;
    sourceInitiativeId?: string;
    targetKind?: 'flow' | 'agent';
    projects?: string[];
    eventProject?: string;
  },
): void {
  stageFlowRunRequest({
    target: { kind: opts.targetKind ?? 'flow', ref: flowId },
    origin: opts.origin,
    triggeredBy: opts.triggeredBy,
    sourceInitiativeId: opts.sourceInitiativeId,
    // R2-08-F1: absent stays absent — never coerce `undefined` to `[]`.
    ...(opts.projects !== undefined ? { projects: opts.projects } : {}),
    ...(opts.eventProject !== undefined ? { eventProject: opts.eventProject } : {}),
  });
}


// ---------------------------------------------------------------------------
// runFlow
// ---------------------------------------------------------------------------

export type FlowRunArgs = {
  flow: FlowDefinition;
  input: CycleInput;
  logger: EventLogger;
  /**
   * The one port every station executes through (SPEC.md §2 Station,
   * `docs/roadmaps/1.0.md` §4 M2 Lane B). The runner imports no phase; the
   * caller supplies the table — `createPhaseExecutor()` in
   * `orchestrator/phases/executor-table.ts` builds the shipped one.
   */
  executor: PhaseExecutor<NodeExecContext>;
  /**
   * The project contract's preflight, injected (SPEC.md §6 Project). The runner
   * declares the port and never imports `cli/preflight.ts`; the caller supplies
   * the implementation — `createProjectGate()` in
   * `orchestrator/phases/executor-deps.ts` builds the shipped one.
   */
  projectGate: ProjectGate;
  /**
   * Stage a triggered flow run. Injectable because the trigger tests assert the
   * call, not its side effect on disk. It is NOT part of the phase set: staging
   * a request is the runner's own act, and the port carries phases only.
   */
  enqueueFlowRun?: typeof defaultEnqueueFlowRun;
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
 * Wrap the logger so every emitted event is fed to the CostTracker. Passes
 * the WHOLE entry (not a bare cost_usd number) — M0-A Task 1: the tracker
 * needs to see every event, cost-bearing or not, to apply the event-cost.ts
 * restatement rule (a phase's first `iteration` event latches it, regardless
 * of that particular event's own cost_usd).
 */
function wrapLoggerForCost(logger: EventLogger, tracker: CostTracker): EventLogger {
  return {
    ...logger,
    emit(partial) {
      const entry = logger.emit(partial);
      tracker.noteEvent(entry);
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
 * resumeFrom: when `input.resumeFrom === 'demo'`, the pm node rebases + skips
 * (item 3), the dev node runs but self-no-ops the per-WI work (toRun=[], still
 * emitting its start/end{resumed:true} events so the dev hex resolves complete),
 * and the `demo` node (declared `resumable`) is the resume target — the DAG walk
 * re-enters the post-develop band (demo → adversarial-review → verdict) against
 * the preserved branch without rebuilding any WI.
 *
 * Returns enough for runCycle to build the full CycleResult.
 */
export async function runFlow({
  flow,
  input: rawInput,
  logger,
  executor,
  projectGate,
  enqueueFlowRun = defaultEnqueueFlowRun,
  nodeBudgets,
  rateLimitGate: injectedGate,
  costCeilingUsd,
}: FlowRunArgs): Promise<{
  cycleOutcome: CycleOutcome;
  reflectionStatus: string;
  lintStatus: string;
}> {

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
    initiativeId: rawInput.initiativeId,
    logger,
  });
  const rateLimitGate = injectedGate ?? new RateLimitGate();

  // M0-A Task 1: give the dev-loop node a way to consult the ceiling at a
  // WORK-ITEM boundary — before a WI's worktree is created — instead of only
  // at the next clean NODE boundary (costTracker.checkCeiling, below). Build
  // this ONCE, here: CycleInput is threaded UNCHANGED to every executor (see
  // the threading note above `runFlow`), so this shadows the destructured
  // `rawInput` with a single augmented object rather than mutating it
  // in place or rebuilding it per node.
  const input: CycleInput = {
    ...rawInput,
    shouldStopBeforeWorkItem: () => costTracker.stopReasonBeforeNextWorkItem(),
  };

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
    terminateEarly: false,
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
      kind,
      projectGate,
      input,
      nodeLogger,
      costLogger,
      wedgeDetector,
      nodeBudget,
      state,
      agents,
      inboundArtifacts,
    };

    // ADR-027: assert the node's inbound artifacts exist before it runs. The
    // reflect node (the agent carrying the reflection-close band, ADR-039) is
    // exempt — its inbound `verdict` is produced by the human review gate
    // (async in unattended mode); verdict.json is persisted at the decision
    // point, not by a producing node. A dry run produces no real artifacts,
    // so enforcement is skipped there.
    const nodeDefForExemption = node.agent ? agents.get(node.agent) : undefined;
    const isReflectionCloseNode =
      kind === 'agent' &&
      nodeDefForExemption !== undefined &&
      resolveBandGuard(nodeDefForExemption) === 'reflection-close';
    if (!isReflectionCloseNode && !input.dryRun) {
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
      // The port, and nothing else. The runner does not know which phase this
      // node is — only that the injected executor runs it and reports the run's
      // outcome as of this node (SPEC.md §2 Station).
      state.cycleOutcome = await executor.run(nodeId, ctx);
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

    // R4-10-F2: a node (execDemo, on a red merge-boundary full-suite gate)
    // requested early termination — the branch is not shippable, so STOP the
    // DAG walk (no demo/adversarial/verdict, no PR) and route the manifest to
    // ready-for-review via closure. The gate-fix WIs it compiled make the drain
    // re-enter resume_from:'develop'; only a green baseline ever reaches openPr.
    // The executor performed the closure (see createPhaseExecutor); the runner
    // only stops walking.
    if (state.terminateEarly) break;

    // M3-3: Cost-ceiling check — at every clean node boundary (after the node
    // completes, before the next spawns). Never mid-write.
    //
    // Peek at the NEXT node id so we can report it in the stop event metadata.
    const currentIdx = order.indexOf(nodeId);
    const nextNodeId = currentIdx >= 0 ? (order[currentIdx + 1] ?? null) : null;
    costTracker.checkCeiling({ throw: true, nextNodeId: nextNodeId ?? undefined });
  }

  // Fire `on: flow-complete` triggers on terminal SUCCESS only (failures
  // exit via throw before reaching here), through the generic declaration-driven
  // path. `on: merged` triggers — e.g. forge-develop's reflect trigger — are NOT
  // fired here: the develop flow terminates at `ready-for-review` (PR open),
  // before the operator merges, so finalize-merged fires those post-merge.
  await fireFlowTriggers(flow, 'flow-complete', {
    onFire: (trigger) => {
      logger.emit({
        initiative_id: input.initiativeId,
        phase: 'orchestrator',
        skill: 'flow-runner',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'flow-runner.trigger-firing',
        metadata: { on: trigger.on, target: trigger.target, source_flow: flow.id },
      });
    },
    dispatch: (trigger) => {
      // R2-08-F1 (ADR-027 amendment; N2, round-4 correction): carry the
      // trigger's own `projects:` declaration + a resolved `eventProject`
      // onto EVERY staged request UNCONDITIONALLY — including `projects: []`.
      // `drainFlowRunRequests` is the ONE enforcement point (rule 2); a
      // fire-time filter made its `skipped-out-of-scope` status unreachable
      // for this kind and turned an out-of-scope event into a silent drop —
      // no staged file, no notify, no result row — forbidden by rule 3.
      // `eventProject` is normalized via the SAME `normalizeProjectId`
      // `discoverProjects` uses (N1, round-4): a raw `basename()` diverges
      // from the normalized ids `forge studio lint` validates `projects:`
      // against, so a project directory like `My_Project` would lint-validate
      // fine but never dispatch-match.
      const eventProject = normalizeProjectId(basename(input.projectRepoPath));
      enqueueFlowRun(trigger.target.ref, {
        origin: 'trigger',
        triggeredBy: flow.id,
        sourceInitiativeId: input.initiativeId,
        targetKind: trigger.target.kind,
        ...(trigger.projects !== undefined ? { projects: trigger.projects } : {}),
        eventProject,
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
