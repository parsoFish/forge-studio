/**
 * `@forge/agents` — the public door.
 *
 * Owns ONE seam (`SPEC.md` §1): run one agent. Everything below is either that
 * seam or something another package genuinely needs to reach it; the test that
 * holds this file honest is `contract.test.ts` beside it, which reads the API
 * list out of `README.md` at run time and fails against an empty index
 * (T1 ruling 31).
 *
 * WHAT IS DELIBERATELY NOT HERE. `skill-path.ts` re-exports `@forge/kernel`'s
 * id vocabulary (`SLUG_RE`, `PROJECT_ID_RE`, `FORGE_ROOT`, `isReservedId`, …)
 * so its own callers need no second import. Those are KERNEL's names and this
 * door does not re-export them: a package's public API should not claim
 * ownership of another package's vocabulary, and an importer that wants the id
 * rules should take them from the package that defines them.
 */

// ---- Run one agent -------------------------------------------------------
export { runAgent, isSafeRunId } from './run-agent.ts';
export { dispatchAgentRun } from './agent-dispatch.ts';
export { cmdAgent, cmdAgentRun, AGENT_RUNNERS } from './agent-run.ts';
export { cmdAgentDispatch, parseAgentDispatchArgs } from './agent-dispatch-cmd.ts';
export { findSessionProject } from './find-session-project.ts';

// ---- Bands: the develop flow's banded successors --------------------------
export { resolveBandGuard, BAND_GUARD_IDS, PLATFORM_GUARD_IDS, BAND_CANONICAL_SLUG } from './agent-bands.ts';
export { runBandAgentStandalone, isStandaloneBandAgent, dispatchStandaloneBand } from './band-agent-run.ts';

// ---- The Ralph loop and its stop conditions -------------------------------
export { run as runRalphLoop } from './ralph/runner.ts';
export { makeQualityGateFromCmd, resolveGateTimeoutMs } from './ralph/stop-conditions.ts';

// ---- The Agent kind of the studio object model ----------------------------
export {
  loadAgentDefinition, listAgentDefinitions, isStudioAgent, isUnfilteredStudioAgent, listStarterAgents,
} from './studio/agent-registry.ts';
export { deriveAgentSpec, agentCapabilityDescriptor } from './studio/derive.ts';
export { serializeAgentDefinition } from './studio/skill-md-fidelity.ts';

/**
 * The reverse index (T1 ruling 13/73). Library asks "which agents use this
 * skill/hook/connection?" through THIS door — never by reading agent files
 * itself, which is the rank-2 → rank-3 read the index exists to remove.
 */
export { agentUsageIndex, agentsUsing } from './studio/agent-usage.ts';

// ---- The adapter registry ------------------------------------------------
export { getAdapter, resolveSdkId, isSdkAvailable } from './_adapters/registry.ts';

// ---- The pinned SDK seam, and spawn containment ---------------------------
export { pinnedSdkQuery, pinnedStreamQuery, withRunMarker } from './pinned-sdk-query.ts';
export { processesCarryingMarker } from './spawn-marker.ts';
export { withIdleDeadline } from './stream-deadline.ts';

// ---- Skill packages ------------------------------------------------------
export {
  skillPath, skillsDir, skillPathRelative, assertSkillSlug, listSkillMdDirs,
  loadSkillTurnPrompt, splitSkillTurnSections,
} from './skill-path.ts';

// ---- Model resolution ----------------------------------------------------
export { modelForSpec, resolveSessionModel, MODEL_BY_TIER } from './phase-agent.ts';

// ---- Events, failure classification, scope ---------------------------------
export { makeToolEventSink, extractLiveToolDetails } from './tool-event-emit.ts';
export { classifyCycleFailure, classifyCrash, matchesRateLimitSignature } from './failure-classifier.ts';
export { takeScopeSnapshot, scopeViolations } from './phases/agent-scope-guard.ts';
export { sdkHooksForAgent } from './studio/hook-dispatch.ts';

// ---- AGENTS.md composition, and the HTTP routes ---------------------------
export { composeAgentsMd } from './agents-md-compose.ts';
export { agentsRoutes } from './routes.ts';

// ---- Types ---------------------------------------------------------------
export type { BandGuardId } from './agent-bands.ts';
export type { BandAgentDeps } from './band-agent-run.ts';
export type { StreamQueryFn } from './pinned-sdk-query.ts';
export type { ModelTier } from './phase-agent.ts';
export type { AgentsRouteDeps } from './routes.ts';
export type { AgentUsageIndex, AgentUsageKind } from './studio/agent-usage.ts';
export type { LoopResult } from './ralph/runner.ts';
