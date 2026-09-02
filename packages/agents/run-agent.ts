/**
 * runAgent — the generic agent-as-runnable primitive (R2-01-F1).
 *
 * Spawns any studio `AgentDefinition` against a `RunContext` that carries NO
 * required project/initiative binding — the load-bearing seam the rest of
 * R2/R4 build on (a phase-agnostic way to run any roster agent).
 *
 * Two spawn shapes, selected by the def's declared `runtime.loopStrategy`
 * (R4-01-F2, ADR-039):
 *
 *   - absent — the legacy single-iteration `AgentInvocation` path (adapter
 *     `createAgent`, prompt stamped to a scratch PROMPT.md). One call, one
 *     iteration; never a loop.
 *   - `'one-shot'` — a direct `adapter.query` stream: the exact SDK call
 *     shape the phase pipelines (PM / reflector) make, with options built
 *     from the derived spec + declared `budgets` caps. Raw stream messages
 *     flow OUT via `ctx.onMessage`; judgments/telemetry stay caller-side.
 *   - `'ralph'` — REJECTED here. Multi-iteration loops are orchestrator-band
 *     (the flow engine dispatches them to the dev-loop pipeline); the
 *     primitive never drives one.
 *
 * Lifecycle: `ctx.lifecycle: 'caller'` (one-shot only) suppresses runAgent's
 * own start/end/cost events and returns the totals instead — the caller (a
 * phase pipeline) already owns its event lifecycle, and double emission
 * would double-count cost into CostTracker. In caller mode the caller also
 * owns harness-safety — parity: the phase pipelines never carried an env
 * suppression check of their own; suppression is each entry point's
 * responsibility (dry-bridge stub-actions on the bridge routes, the daemon
 * guard + NO_SPAWN-aware harnesses on the scheduler path). The env
 * suppression check below guards the self-lifecycle paths exactly as
 * before.
 *
 * ADR-036: `runAgent` runs NO gate/CI/demo-capture — it only spawns the
 * agent and reports back what happened; gate results flow TO agents, never
 * FROM them. Satisfied by construction: this module never imports
 * `runGateCapturing`, `composedUnifierGate`, `orchestrated-capture.ts`, or
 * `decideFinalCiGate`.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

// `FORGE_ROOT` (this install's root — `orchestrator/studio/` sits two levels
// below it): single source is `studio/derive.ts`'s exported const. This
// module previously defined its own identical local copy, which silently
// duplicated derive.ts's `..`-depth by hand; import it instead so the two
// can't drift out of sync.
import { deriveAgentSpec, FORGE_ROOT } from './studio/derive.ts';
import { modelForSpec, type PhaseAgentSpec } from './phase-agent.ts';
import { createLogger, type EventLogger } from '@forge/kernel';
import { makeToolEventSink, extractLiveToolDetails } from './tool-event-emit.ts';
import { pinnedStreamQuery, type StreamQueryFn } from './pinned-sdk-query.ts';
import { sdkHooksForAgent } from './studio/hook-dispatch.ts';
import { withIdleDeadline } from './stream-deadline.ts';
import type { AgentBudgets, AgentDefinition } from '@forge/contracts/studio/types.ts';
import { getAdapter, resolveSdkId } from './_adapters/registry.ts';
import type { QueryFn } from './_adapters/types.ts';
import { unreadyConnectionsFor, formatUnreadyConnections } from './studio/connection-run-gate.ts';
import type { ProbeResult } from '@forge/library/studio/connection-probe.ts';

/**
 * A `runId` is used verbatim as the log directory name — `createLogger`
 * resolves it against `logsRoot` (`resolve(logsDir, cycleId)`,
 * `orchestrator/logging.ts`) with no validation of its own. Reject anything
 * that could escape `logsRoot` (a path separator, `..`, or an absolute
 * path) before any I/O happens. Single path segment of
 * `[A-Za-z0-9._-]` — deliberately permits a leading `_` (unlike
 * `review-comments.ts`'s `SAFE_CYCLE_ID_RE`, which requires an
 * alnum-first-char and so doesn't fit `runAgent`'s own runId formats,
 * `_agent-<slug>` / `_agent-<slug>-<n>`, and cycleId-like ids).
 */
// `SAFE_RUN_ID_RE` + `isSafeRunId` moved to `@forge/kernel` (M4-knowledge s5,
// ruling 57): `packages/knowledge`'s drain routes need the same predicate and
// may not import agents. Re-exported so every existing caller is unchanged.
export { isSafeRunId } from '@forge/kernel';
import { isSafeRunId } from '@forge/kernel';


function assertSafeRunId(runId: string): void {
  if (!isSafeRunId(runId)) {
    throw new Error(`runAgent: unsafe runId (path-traversal risk): ${JSON.stringify(runId)}`);
  }
}

/**
 * R3-04 D9.1 — pre-spawn connection-readiness gate. Throws (naming every
 * unready bound component + its state) if `def` binds a tool/mcp connection
 * that is not `available`. Shares `unreadyConnectionsFor`/
 * `formatUnreadyConnections` (`./studio/connection-run-gate.ts`) with the
 * bridge's D9.2 refusal — one derivation, one vocabulary. `ctx.probeConnection`
 * is test-injection only; production falls through to the real default
 * prober scoped to `FORGE_ROOT`.
 */
function assertConnectionsReady(def: AgentDefinition, ctx: RunContext): void {
  const unready = unreadyConnectionsFor(FORGE_ROOT, def, ctx.probeConnection);
  if (unready.length > 0) {
    throw new Error(formatUnreadyConnections(def, unready));
  }
}

/**
 * Harness-safety env vars that suppress a real SDK spawn (R5-01 dry-bridge
 * seam). SSOT for the dry-bridge predicate is `cli/dry-bridge.ts`
 * (`isDryBridge` / `DRY_BRIDGE_ENV`) — this module reads `process.env`
 * directly rather than importing that CLI module, to avoid an
 * orchestrator → cli reverse import (no existing orchestrator/ module
 * exports an equivalent spawn-suppression predicate).
 */
const FORGE_DRY_BRIDGE_ENV = 'FORGE_DRY_BRIDGE';
const FORGE_ARCHITECT_NO_SPAWN_ENV = 'FORGE_ARCHITECT_NO_SPAWN';

export type ProjectBinding = { name: string; repoPath: string };
export type InitiativeBinding = {
  id: string;
  manifestPath?: string;
  /**
   * The initiative's declared `cost_budget_usd` (R4-01-F2) — the input to
   * the `budgets.maxBudgetUsdShare` proportional cap. Optional: absent ⇒
   * only the flat `budgets.maxBudgetUsd` (if any) applies.
   */
  costBudgetUsd?: number;
};

/**
 * Guard a one-shot stream with the idle-deadline safety net
 * (`stream-deadline.ts`): presence creates an AbortController on the SDK
 * options (chaining `signal` into it when given) and wraps the stream in
 * `withIdleDeadline` so a stalled stream aborts instead of hanging the
 * queue — exactly the PM pipeline's shape. Absent ⇒ a bare stream (the
 * reflector's shape). Parity-preserving by construction: which phases carry
 * the guard is the caller's declaration, not a primitive default.
 */
export type StreamGuard = { label: string; signal?: AbortSignal };

/**
 * The context one `runAgent` call executes under. Deliberately open-ended:
 * `bindings` is conceptually a map of named domain bindings — `project` and
 * `initiative` are the OOTB SWE kinds forge ships, not a closed set. A
 * future non-SWE flow can carry its own binding kinds through the same
 * field without widening this type. Both `bindings` and every field inside
 * it are optional — a pure research/report agent runs with none at all.
 */
export type RunContext = {
  runId: string;
  workdir: string;
  prompt: string;
  logsRoot?: string;
  /**
   * Inject an existing logger instead of creating a fresh one from
   * `runId`/`logsRoot` (R2-01-F2). Lets a caller (e.g. flow-runner's
   * execAgent) route this run's events through an already cost/wedge-wrapped
   * logger so cost_usd flows into the caller's own CostTracker with no
   * double emission — runAgent remains the only emitter either way. Absent
   * ⇒ unchanged standalone behaviour: a fresh logger under
   * `_logs/<runId>/`.
   */
  logger?: EventLogger;
  bindings?: { project?: ProjectBinding; initiative?: InitiativeBinding };
  artifactRefs?: string[];
  /**
   * One-shot spawn shaping (R4-01-F2). `systemPrompt` stays caller-assembled
   * (brain-nav indexes are forge state, not def data); `cwd` overrides the
   * spawn cwd (default `workdir` — the PM runs at the worktree, the
   * reflector at forge root); `permissionMode` defaults to 'acceptEdits'
   * (the unattended default every phase uses).
   */
  systemPrompt?: string;
  cwd?: string;
  permissionMode?: string;
  streamGuard?: StreamGuard;
  /**
   * Observer for every raw streamed SDK message on the one-shot path,
   * called before runAgent's own result-message handling. Telemetry
   * (tool-use tallies, turn counting/warnings) stays caller-side — the
   * ADR-036 boundary: observations flow out, judgments never move in.
   */
  onMessage?: (msg: unknown) => void;
  /**
   * 'self' (default): runAgent owns the event lifecycle — start/end (+cost)
   * to its logger, env spawn-suppression enforced. 'caller' (one-shot
   * only): NO events are emitted here; totals are returned for the caller's
   * own end event. See the module doc for why (cost double-emission).
   */
  lifecycle?: 'self' | 'caller';
  /**
   * Test-injection only. Production callers must omit this — the default
   * is `pinnedStreamQuery` (the env-pinned SDK query in its loosened
   * stream shape); a real alternate SDK `queryFn` can't exist outside that
   * wrapper because `pinned-sdk-query.enforce.test.ts` forbids importing
   * the raw SDK `query` anywhere under orchestrator/, loops/, cli/.
   */
  queryFn?: StreamQueryFn;
  /**
   * Pre-spawn connection-readiness gate (R3-04 D9.1) — TEST-INJECTION ONLY,
   * mirrors `queryFn`'s seam exactly. Production omits this: the default is
   * the REAL per-connection prober (`defaultProbeConnection`,
   * `./studio/connection-run-gate.ts`) against `FORGE_ROOT`'s curated
   * catalog. `runAgent` calls this once per id `def` actually binds
   * (`composition.tools` + `composition.mcps`) — an agent binding nothing
   * never calls it at all, real or injected (cost discipline).
   */
  probeConnection?: (id: string) => ProbeResult;
  /**
   * R6-04 (WI-2): an explicit per-run operator cost ceiling (one-shot path
   * only). WINS over the agent's own declared `budgets` cap —
   * `kickoffCeilingUsd ?? resolveOneShotBudgetUsd(def.budgets, initiative)` —
   * never a `max()`/`min()` of the two. Absent ⇒ today's behaviour
   * (`resolveOneShotBudgetUsd` alone) unchanged. Threaded to the SDK via the
   * SAME `options.maxBudgetUsd` key an agent's own declared budget already
   * uses — there is no second enforcement path.
   */
  kickoffCeilingUsd?: number;
};

export type RunAgentResult = {
  costUsd: number;
  outputRefs: string[];
  tokensIn: number;
  tokensOut: number;
  suppressed: boolean;
  /** SDK-reported duration (one-shot path; the `result` message's `duration_ms`). */
  durationMs?: number;
  /** SDK result subtype (one-shot path) — 'success' | 'error_max_turns' | 'error_max_budget_usd' | …. */
  resultSubtype?: string;
};

/**
 * Effective one-shot budget cap: `max(flat, share × initiative budget)` —
 * a declared floor and a proportional share compose (the PM policy as data).
 * Undefined when the def declares neither (no cap passed to the SDK).
 * Note: an explicit `maxBudgetUsd: 0` does NOT mean "no spend" — any
 * positive share contribution wins the max. A true no-spend agent belongs
 * behind the dry-bridge seam, not a zero budget.
 */
/**
 * The cost ceiling ACTUALLY in force for one standalone run, from whichever
 * source supplied it: an explicit operator kickoff ceiling WINS over the
 * agent's own declared budget (`??`, never max/min — the operator is
 * overriding, not bidding). One derivation, three readers — the `start`
 * event's `effective_ceiling_usd`, `runOneShotSpawn`'s `options.maxBudgetUsd`
 * and `runInvocationSpawn`'s `maxBudgetUsdPerIteration` — so what a run
 * RECORDS as its ceiling and what the SDK is actually HANDED can never
 * drift apart. `undefined` = genuinely uncapped; never a fabricated default.
 */
function effectiveCeilingUsd(def: AgentDefinition, ctx: RunContext): number | undefined {
  return ctx.kickoffCeilingUsd ?? resolveOneShotBudgetUsd(def.budgets, ctx.bindings?.initiative);
}

export function resolveOneShotBudgetUsd(
  budgets: AgentBudgets,
  initiative?: InitiativeBinding,
): number | undefined {
  const flat = budgets.maxBudgetUsd;
  const share =
    budgets.maxBudgetUsdShare !== undefined && initiative?.costBudgetUsd !== undefined
      ? budgets.maxBudgetUsdShare * initiative.costBudgetUsd
      : undefined;
  if (flat === undefined && share === undefined) return undefined;
  return Math.max(flat ?? 0, share ?? 0);
}

/**
 * Run one studio agent (a resolved `AgentDefinition`) against `ctx`,
 * single-shot. No project/initiative binding is required. In the default
 * 'self' lifecycle: emits a `start` event before the spawn attempt, then
 * either a `spawn-suppressed` `log` event (harness safety) or an `end`
 * event carrying cost/tokens — both to `_logs/<runId>/events.jsonl` via
 * `createLogger`.
 */
export async function runAgent(def: AgentDefinition, ctx: RunContext): Promise<RunAgentResult> {
  const lifecycle = ctx.lifecycle ?? 'self';
  if (!ctx.workdir) throw new Error('runAgent: ctx.workdir is required');
  if (!ctx.prompt) throw new Error('runAgent: ctx.prompt is required');

  const loopStrategy = def.runtime.loopStrategy;
  if (loopStrategy === 'ralph') {
    throw new Error(
      `runAgent: agent "${def.slug}" declares loopStrategy 'ralph' — multi-iteration loops are orchestrator-band (the flow engine dispatches them to the dev-loop pipeline); the one-shot primitive never drives one`,
    );
  }
  if (loopStrategy !== undefined && loopStrategy !== 'one-shot') {
    throw new Error(
      `runAgent: agent "${def.slug}" declares unknown loopStrategy ${JSON.stringify(loopStrategy)} (expected 'ralph' or 'one-shot')`,
    );
  }
  // W7-B5 (agents-21) RETIRES R6-04's "refuse a ceiling for any non-one-shot
  // agent" guard: the legacy invocation path now ENFORCES the ceiling for
  // real — `runInvocationSpawn` threads it to the adapter's
  // `maxBudgetUsdPerIteration`, which `createClaudeAgent` hands the SDK as
  // `options.maxBudgetUsd` (loops/ralph/claude-agent.ts:228), and one
  // invocation-path run is exactly ONE iteration, so a per-iteration cap IS
  // the run ceiling. 'ralph' needs no ceiling guard of its own here — the
  // loopStrategy check above already rejects a standalone ralph dispatch
  // outright (there is no run to cap). Pinned by run-agent-w7b5.test.ts;
  // the R6-04 refusal pins were amended in the same commit.

  // Step 1: derive the spec from the studio SKILL.md (ADR-027).
  const spec = deriveAgentSpec(relative(FORGE_ROOT, def.path));

  if (lifecycle === 'caller') {
    if (loopStrategy !== 'one-shot') {
      throw new Error(
        `runAgent: lifecycle 'caller' requires loopStrategy 'one-shot' (agent "${def.slug}" declares ${JSON.stringify(loopStrategy)}) — the legacy invocation path has no caller-owned event shape`,
      );
    }
    // D9.1 (caller lifecycle, round-6 FIX-FIRST correction of the round-2/4
    // ruling): the gate is skipped exactly when the spawn is genuinely
    // suppressed — and on the caller branch it never is. Unlike the 'self'
    // path below, `FORGE_DRY_BRIDGE`/`FORGE_ARCHITECT_NO_SPAWN` do NOT
    // suppress anything here: `runOneShotSpawn` is called UNCONDITIONALLY on
    // this branch regardless of either env var (module doc, "In caller mode
    // the caller also owns harness-safety" — the phase pipelines suppress at
    // their own level, before ever reaching runAgent). So gating on those env
    // vars here would have skipped the check for a spawn that was about to
    // happen for real. The gate therefore always runs on this branch.
    assertConnectionsReady(def, ctx);
    return runOneShotSpawn(def, ctx, spec);
  }

  if (!ctx.runId) throw new Error('runAgent: ctx.runId is required');
  assertSafeRunId(ctx.runId);

  const logger = ctx.logger ?? createLogger(ctx.runId, ctx.logsRoot ?? '_logs');
  const initiativeId = ctx.bindings?.initiative?.id ?? ctx.runId;
  const inputRefs = ctx.artifactRefs ?? [];

  const inForceCeilingUsd = effectiveCeilingUsd(def, ctx);
  const startEvent = logger.emit({
    initiative_id: initiativeId,
    phase: 'orchestrator',
    skill: def.slug,
    event_type: 'start',
    input_refs: inputRefs,
    output_refs: [],
    metadata: {
      agent_phase: def.phase,
      agent_slug: def.slug,
      // W7-B5 (agents-31): the ceiling in force is a fact known at START
      // time — recording it only on the terminal `end` event left every
      // failed/still-running run claiming "no ceiling was recorded" about a
      // ceiling that was submitted and enforced. The end event keeps its
      // copy (terminal provenance, unchanged).
      ...(ctx.kickoffCeilingUsd !== undefined ? { kickoff_ceiling_usd: ctx.kickoffCeilingUsd } : {}),
      // Review round 1 — the OPERATOR ceiling is not the only ceiling. Both
      // spawn paths resolve `kickoffCeilingUsd ?? resolveOneShotBudgetUsd(
      // def.budgets, …)`, so an agent with a declared `budgets.maxBudgetUsd`
      // and NO operator ceiling still runs under a real cap. Recorded under
      // its own key rather than folded into `kickoff_ceiling_usd`, which
      // would lie about where it came from: the onboarding route dispatches
      // with no operator ceiling, yet onboarding-agent declares $5 — and
      // every honesty surface read "no ceiling was recorded" for it. Same
      // `effectiveCeilingUsd()` derivation the spawn functions apply, so
      // what is recorded is what is enforced, by construction.
      ...(inForceCeilingUsd !== undefined ? { effective_ceiling_usd: inForceCeilingUsd } : {}),
    },
  });

  const startedAt = Date.now();

  // Step 2: harness safety — suppress the real spawn under dry-bridge / the
  // architect no-spawn seam, BEFORE any SDK call is made.
  const dryBridgeOn = process.env[FORGE_DRY_BRIDGE_ENV] === '1';
  const noSpawnOn = process.env[FORGE_ARCHITECT_NO_SPAWN_ENV] === '1';
  if (dryBridgeOn || noSpawnOn) {
    const reason = dryBridgeOn ? FORGE_DRY_BRIDGE_ENV : FORGE_ARCHITECT_NO_SPAWN_ENV;
    logger.emit({
      initiative_id: initiativeId,
      phase: 'orchestrator',
      skill: def.slug,
      event_type: 'log',
      input_refs: inputRefs,
      output_refs: [],
      message: 'run-agent.spawn-suppressed',
      metadata: { reason, agent_slug: def.slug },
    });
    return { costUsd: 0, outputRefs: [], tokensIn: 0, tokensOut: 0, suppressed: true };
  }

  // D9.1 — pre-spawn connection-readiness gate, placed AFTER the
  // dry-bridge/no-spawn suppression early-return above: a suppressed
  // rehearsal must not be blocked by an environment fact about a spawn that
  // never happens. "Pre-spawn" is exact — immediately before the real spawn.
  assertConnectionsReady(def, ctx);

  // W7-B5 (agents-23): per-turn transcript events for the SELF lifecycle —
  // a standalone run used to leave only start+end lines, so an operator who
  // spent real money had no record of what the agent did. Both spawn shapes
  // ride the SAME shared sink (`makeToolEventSink`, the dev-loop/PM/
  // interactive-session machinery — one sampler, one vocabulary): the
  // legacy path hands the sink's callbacks to the adapter; the one-shot
  // path derives tool details from its own observed stream below.
  const turnSink = makeToolEventSink(logger, {
    initiativeId,
    parentEventId: startEvent.event_id,
    phase: 'orchestrator',
    skill: def.slug,
  });

  let spawned: RunAgentResult;
  if (loopStrategy === 'one-shot') {
    let toolSeq = 0;
    const callerOnMessage = ctx.onMessage;
    const observedCtx: RunContext = {
      ...ctx,
      onMessage: (msg) => {
        callerOnMessage?.(msg);
        const m = msg as { type?: string; message?: unknown };
        if (m?.type !== 'assistant') return;
        const details = extractLiveToolDetails(m.message, toolSeq);
        for (const detail of details) turnSink.onToolUse(detail);
        toolSeq += details.length;
      },
    };
    spawned = await runOneShotSpawn(def, observedCtx, spec);
    turnSink.flushIteration(1);
  } else {
    spawned = await runInvocationSpawn(def, ctx, spec, logger, initiativeId, inputRefs, turnSink);
    turnSink.flushIteration(1);
  }

  // Report + log the end event.
  const durationMs = spawned.durationMs ?? Date.now() - startedAt;

  logger.emit({
    initiative_id: initiativeId,
    phase: 'orchestrator',
    skill: def.slug,
    event_type: 'end',
    input_refs: inputRefs,
    output_refs: spawned.outputRefs,
    cost_usd: spawned.costUsd,
    tokens_in: spawned.tokensIn,
    tokens_out: spawned.tokensOut,
    duration_ms: durationMs,
    metadata: {
      agent_phase: def.phase,
      agent_slug: def.slug,
      // R6-04 (WI-2): a ceiling-stop must be a DISTINCT, honestly-recorded
      // terminal fact, never collapsed into an ordinary success log — record
      // BOTH the operator ceiling that was in force (when one was given) and
      // the SDK's reported result subtype ('success' | 'error_max_budget_usd'
      // | …) so a downstream reader (GET /api/agents/runs/:runId) can tell
      // the two apart without re-deriving anything from cost alone.
      ...(ctx.kickoffCeilingUsd !== undefined ? { kickoff_ceiling_usd: ctx.kickoffCeilingUsd } : {}),
      ...(inForceCeilingUsd !== undefined ? { effective_ceiling_usd: inForceCeilingUsd } : {}),
      ...(spawned.resultSubtype !== undefined ? { result_subtype: spawned.resultSubtype } : {}),
    },
  });

  return spawned;
}

/**
 * The one-shot spawn: a direct `adapter.query` stream, options built from
 * the derived spec + the def's declared `budgets` caps — the exact SDK call
 * shape the phase pipelines make (byte-parity is pinned by the golden
 * spawn-capture suite). No PROMPT.md is written: the prompt travels inline,
 * as the phases have always passed it.
 */
async function runOneShotSpawn(
  def: AgentDefinition,
  ctx: RunContext,
  spec: PhaseAgentSpec,
): Promise<RunAgentResult> {
  const options: Record<string, unknown> = {
    cwd: ctx.cwd ?? ctx.workdir,
    ...(ctx.systemPrompt !== undefined ? { systemPrompt: ctx.systemPrompt } : {}),
    model: modelForSpec(spec),
    permissionMode: ctx.permissionMode ?? 'acceptEdits',
    allowedTools: [...spec.allowedTools],
    disallowedTools: [...spec.disallowedTools],
  };
  if (def.budgets.maxTurns !== undefined) options['maxTurns'] = def.budgets.maxTurns;
  // W8-B6 — the agent's bound library hooks. Derived from `spec.skill` (the
  // SKILL.md this spec came from) rather than from a copy carried on the spec,
  // so nothing here can hold a stale binding. Absent for every agent that binds
  // none, which keeps the golden spawn-capture option bags byte-identical.
  const oneShotHooks = sdkHooksForAgent({
    skill: spec.skill,
    logger: () => ctx.logger ?? createLogger(ctx.runId, ctx.logsRoot ?? '_logs'),
    initiativeId: ctx.bindings?.initiative?.id ?? ctx.runId,
  });
  if (oneShotHooks !== undefined) options['hooks'] = oneShotHooks;
  // R6-04 (WI-2): an explicit operator ceiling WINS over the agent's own
  // declared budget — not max()/min() of the two. `??` gives exactly that:
  // `ctx.kickoffCeilingUsd` short-circuits `resolveOneShotBudgetUsd` entirely
  // when present, regardless of which is numerically larger.
  const budgetUsd = effectiveCeilingUsd(def, ctx);
  if (budgetUsd !== undefined) options['maxBudgetUsd'] = budgetUsd;

  let abortController: AbortController | undefined;
  if (ctx.streamGuard) {
    abortController = new AbortController();
    const upstream = ctx.streamGuard.signal;
    if (upstream) {
      upstream.addEventListener('abort', () => abortController!.abort(upstream.reason), {
        once: true,
      });
    }
    options['abortController'] = abortController;
  }

  const queryFn = ctx.queryFn ?? pinnedStreamQuery;

  let stream: AsyncIterable<unknown> = queryFn({ prompt: ctx.prompt, options });
  if (ctx.streamGuard && abortController) {
    stream = withIdleDeadline(stream, { label: ctx.streamGuard.label, abortController });
  }

  let costUsd = 0;
  let durationMs = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let resultSubtype: string | undefined;
  // Defect fix: this path used to return `outputRefs: []` unconditionally, so
  // every one-shot run (reflector/adversarial-review/PM/demo-agent/
  // contract-check/release-finalizer) reported zero outputs even when it
  // really wrote files. Derive real refs the same way the sibling adapter
  // path does (`loops/ralph/claude-agent.ts`'s `filesChanged`): accumulate
  // file-modifying tool_use paths — via the SAME shared `extractLiveToolDetails`
  // helper the adapter path's `fileChangeForTool` backs — into an
  // order-preserving dedup Set.
  const outputRefs = new Set<string>();
  let toolSeq = 0;

  for await (const msg of stream) {
    ctx.onMessage?.(msg);
    if (typeof msg !== 'object' || msg === null) continue;
    const m = msg as {
      type?: string;
      subtype?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      usage?: { input_tokens?: number; output_tokens?: number };
      message?: unknown;
    };
    if (m.type === 'assistant') {
      const details = extractLiveToolDetails(m.message, toolSeq);
      for (const detail of details) {
        if (detail.filePath) outputRefs.add(detail.filePath);
      }
      toolSeq += details.length;
    }
    if (m.type !== 'result') continue;
    if (typeof m.duration_ms === 'number') durationMs = m.duration_ms;
    if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
    if (m.usage) {
      tokensIn = m.usage.input_tokens ?? 0;
      tokensOut = m.usage.output_tokens ?? 0;
    }
    resultSubtype = m.subtype ?? 'success';
    break;
  }

  return {
    costUsd,
    outputRefs: [...outputRefs],
    tokensIn,
    tokensOut,
    suppressed: false,
    durationMs,
    resultSubtype,
  };
}

/**
 * The legacy single-iteration invocation path (adapter `createAgent`) —
 * unchanged behaviour for defs with no declared loopStrategy, except the
 * prompt now lands in a `.forge/agent-run/` scratch dir instead of the
 * worktree root (known-gaps §8: a root-level PROMPT.md could leak into a
 * PR when a generic-agent node runs in a develop-style flow; `.forge/` is
 * already excluded by the dev-loop's scratch-strip and gitignore
 * conventions). The agent's cwd stays on the worktree.
 */
async function runInvocationSpawn(
  def: AgentDefinition,
  ctx: RunContext,
  spec: PhaseAgentSpec,
  logger: EventLogger,
  initiativeId: string,
  inputRefs: string[],
  turnSink?: ReturnType<typeof makeToolEventSink>,
): Promise<RunAgentResult> {
  // Resolve the adapter + build the agent invocation.
  const sdkId = resolveSdkId(spec.sdk, (event) => {
    logger.emit({
      initiative_id: initiativeId,
      phase: 'orchestrator',
      skill: def.slug,
      event_type: 'log',
      input_refs: inputRefs,
      output_refs: [],
      message: event.type,
      metadata: { sdk: event.sdk },
    });
  });
  const adapter = getAdapter(sdkId);
  // W7-B5 (agents-21): the run ceiling, ENFORCED on this path via the
  // adapter's per-iteration budget — one invocation-path run is exactly ONE
  // iteration (`iteration: 1` below), so a per-iteration cap IS the run
  // ceiling. Same precedence rule as the one-shot path: an explicit operator
  // ceiling WINS over the agent's own declared budget (`??`, not max/min).
  const invocationBudgetUsd = effectiveCeilingUsd(def, ctx);
  const agent = adapter.createAgent({
    model: modelForSpec(spec),
    allowedTools: [...spec.allowedTools],
    disallowedTools: [...spec.disallowedTools],
    // NOT `maxTurnsPerIteration` (review round 1). An earlier draft also
    // threaded `def.budgets.maxTurns` here; that is a DIFFERENT cap from the
    // one this lane is about, and it had never applied on this path before.
    // `createClaudeAgent` maps it straight to the SDK's `options.maxTurns`,
    // so onboarding-agent (`budgets: { maxTurns: 60 }`, no loopStrategy)
    // would have started truncating standalone runs at 60 turns — and the
    // SDK's `error_max_turns` is not mapped to a distinct run state, so a
    // truncated run would surface as an ordinary `done`. A silent behaviour
    // change riding along inside a cost-ceiling lane. Wiring the turn cap
    // (with its own honest terminal state) is its own piece of work.
    ...(invocationBudgetUsd !== undefined ? { maxBudgetUsdPerIteration: invocationBudgetUsd } : {}),
    // W7-B5 (agents-23): the adapter's own live telemetry hooks feed the
    // shared per-turn sink, so a standalone legacy-path run leaves a real
    // transcript (tool calls + file changes + heartbeats), not just
    // start/end lines.
    ...(turnSink !== undefined ? { onToolUse: turnSink.onToolUse, onHeartbeat: turnSink.onHeartbeat } : {}),
    // W8-B6 — same derivation as the one-shot path above; this path already
    // holds the run's real logger, so no thunk is needed.
    ...(() => {
      const hooks = sdkHooksForAgent({ skill: spec.skill, logger, initiativeId });
      return hooks !== undefined ? { hooks } : {};
    })(),
    // StreamQueryFn requires an options bag; the adapter's QueryFn keeps it
    // optional — the closure always supplies one, so the cast is sound.
    queryFn: (ctx.queryFn ?? pinnedStreamQuery) as QueryFn,
  });

  // Stamp the prompt + drive ONE iteration.
  const promptPath = join(ctx.workdir, '.forge', 'agent-run', 'PROMPT.md');
  if (!existsSync(dirname(promptPath))) mkdirSync(dirname(promptPath), { recursive: true });
  writeFileSync(promptPath, ctx.prompt);

  const info = await agent({
    promptPath,
    // Ralph's own AGENT.md / fix_plan.md scaffolding (prepareWorkspace) is
    // deliberately NOT reused here — createClaudeAgent's closure only reads
    // `promptPath` + `worktreePath`; these two paths exist solely to satisfy
    // AgentInvocation's required-string shape, no files are created for them.
    agentMdPath: join(ctx.workdir, 'AGENT.md'),
    fixPlanPath: join(ctx.workdir, 'fix_plan.md'),
    worktreePath: ctx.workdir,
    iteration: 1,
  });

  return {
    costUsd: info.costUsd,
    outputRefs: info.filesChanged,
    tokensIn: info.tokensIn ?? 0,
    tokensOut: info.tokensOut ?? 0,
    suppressed: false,
  };
}
