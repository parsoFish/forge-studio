/**
 * runAgent — the generic agent-as-runnable primitive (R2-01-F1).
 *
 * Spawns any studio `AgentDefinition` against a `RunContext` that carries NO
 * required project/initiative binding — the load-bearing seam the rest of
 * R2/R4 build on (a phase-agnostic way to run any roster agent).
 *
 * Single-shot execution: `AgentRuntime.loopStrategy: 'one-shot'` is
 * documented on the studio object model but intentionally UNWIRED here. This
 * is a real single-iteration spawn path, not a retrofit of
 * `loops/ralph/runner.ts`'s multi-iteration Ralph loop — `runAgent` drives
 * exactly one `AgentInvocation` call and returns.
 *
 * ADR-036: `runAgent` runs NO gate/CI/demo-capture — it only spawns the
 * agent and reports back what happened; gate results flow TO agents, never
 * FROM them. Satisfied by construction: this module never imports
 * `runGateCapturing`, `composedUnifierGate`, `orchestrated-capture.ts`, or
 * `decideFinalCiGate`.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveAgentSpec } from './studio/derive.ts';
import { modelForSpec } from './phase-agent.ts';
import { createLogger } from './logging.ts';
import { pinnedSdkQuery, type SdkQueryFn } from './pinned-sdk-query.ts';
import type { AgentDefinition } from './studio/types.ts';
import { getAdapter, resolveSdkId } from '../loops/_adapters/registry.ts';
import type { QueryFn } from '../loops/_adapters/types.ts';

/**
 * This install's forge root — `orchestrator/` sits one level below it.
 * Mirrors the identical local-const convention in `studio/derive.ts`'s own
 * (private, non-exported) `FORGE_ROOT`; this module defines its own rather
 * than reaching across that module boundary for a path constant that isn't
 * exported.
 */
const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
export type InitiativeBinding = { id: string; manifestPath?: string };

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
  bindings?: { project?: ProjectBinding; initiative?: InitiativeBinding };
  artifactRefs?: string[];
  queryFn?: SdkQueryFn;
};

export type RunAgentResult = {
  costUsd: number;
  outputRefs: string[];
  tokensIn: number;
  tokensOut: number;
  suppressed: boolean;
};

/**
 * Run one studio agent (a resolved `AgentDefinition`) against `ctx`,
 * single-shot. No project/initiative binding is required. Emits a `start`
 * event before the spawn attempt, then either a `spawn-suppressed` `log`
 * event (harness safety) or an `end` event carrying cost/tokens — both to
 * `_logs/<runId>/events.jsonl` via `createLogger`.
 */
export async function runAgent(def: AgentDefinition, ctx: RunContext): Promise<RunAgentResult> {
  if (!ctx.runId) throw new Error('runAgent: ctx.runId is required');
  if (!ctx.workdir) throw new Error('runAgent: ctx.workdir is required');
  if (!ctx.prompt) throw new Error('runAgent: ctx.prompt is required');

  const logger = createLogger(ctx.runId, ctx.logsRoot ?? '_logs');
  const initiativeId = ctx.bindings?.initiative?.id ?? ctx.runId;
  const inputRefs = ctx.artifactRefs ?? [];

  // Step 1: derive the spec from the studio SKILL.md (ADR-027).
  const spec = deriveAgentSpec(relative(FORGE_ROOT, def.path));

  logger.emit({
    initiative_id: initiativeId,
    phase: 'orchestrator',
    skill: def.slug,
    event_type: 'start',
    input_refs: inputRefs,
    output_refs: [],
    metadata: { agent_phase: def.phase, agent_slug: def.slug },
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

  // Step 3: resolve the adapter + build the agent invocation.
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
  const agent = adapter.createAgent({
    model: modelForSpec(spec),
    allowedTools: [...spec.allowedTools],
    disallowedTools: [...spec.disallowedTools],
    queryFn: (ctx.queryFn ?? pinnedSdkQuery) as unknown as QueryFn,
  });

  // Step 4: stamp the prompt + drive ONE iteration.
  if (!existsSync(ctx.workdir)) mkdirSync(ctx.workdir, { recursive: true });
  const promptPath = join(ctx.workdir, 'PROMPT.md');
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

  // Step 5: report + log the end event.
  const durationMs = Date.now() - startedAt;
  const tokensIn = info.tokensIn ?? 0;
  const tokensOut = info.tokensOut ?? 0;

  logger.emit({
    initiative_id: initiativeId,
    phase: 'orchestrator',
    skill: def.slug,
    event_type: 'end',
    input_refs: inputRefs,
    output_refs: info.filesChanged,
    cost_usd: info.costUsd,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    duration_ms: durationMs,
    metadata: { agent_phase: def.phase, agent_slug: def.slug },
  });

  return {
    costUsd: info.costUsd,
    outputRefs: info.filesChanged,
    tokensIn,
    tokensOut,
    suppressed: false,
  };
}
