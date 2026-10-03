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
 * door does not re-export most of them: a package's public API should not
 * claim ownership of another package's vocabulary, and an importer that wants
 * the id rules should take them from the package that defines them. The one
 * exception is `SLUG_RE` itself (below, with `skillPathRelative` and its
 * siblings): AT-89 (`apps/forge/tests/integration/skill-install-agent-
 * identity.test.ts`) pins it as the SAME object kernel defines, surviving two
 * prior relocations, and a pinned regression guard is read as the spec here —
 * this door forwards kernel's live binding, it does not redeclare the regex.
 *
 * M7-E BOUNDARY FIX: `agent-run.ts` and `agent-dispatch-cmd.ts` — the CLI
 * verbs that COMPOSE agents with sessions and flows (`forge agent run` /
 * `forge agent dispatch`) — moved to `apps/forge/` (the assembly, which may
 * import any package), closing the two baselined `agents may not import
 * sessions` allow-graph violations those files carried. This door no longer
 * exports `cmdAgent`, `cmdAgentRun`, `AGENT_RUNNERS`, `cmdAgentDispatch` or
 * `parseAgentDispatchArgs` — see `apps/forge/agent-run.ts` and
 * `apps/forge/agent-dispatch-cmd.ts`. The former "ordering is load-bearing"
 * constraint lived here only because those two files' exports had to sit
 * LAST in this file; with them gone, several `packages/sessions/kinds/*.ts`
 * files still reach this door through the same deep, leaf, non-cyclic
 * subpaths named below (`phase-agent.ts`, `packages/agents/studio/derive.ts`,
 * `skill-path.ts`, `pinned-sdk-query.ts`,
 * `packages/agents/studio/hook-dispatch.ts`, `tool-event-emit.ts`,
 * `stream-deadline.ts`, `packages/agents/studio/agent-registry.ts` — each
 * reaches no higher than `@forge/kernel`/`@forge/library`), which is why
 * those eight files are still legal literal `package.json#exports` subpaths
 * despite this being a one-door package — see each sessions file's own
 * module doc for its specific chain.
 */

// ---- Run one agent -------------------------------------------------------
export { runAgent, isSafeRunId, resolveOneShotBudgetUsd } from './run-agent.ts';
export type { HeartbeatTimers } from './run-agent.ts';
export { dispatchAgentRun } from './agent-dispatch.ts';
export { findSessionProject } from './find-session-project.ts';

// ---- Bands: the develop flow's banded successors --------------------------
export { resolveBandGuard, BAND_GUARD_IDS, PLATFORM_GUARD_IDS, BAND_CANONICAL_SLUG } from './agent-bands.ts';
export { runBandAgentStandalone, isStandaloneBandAgent, dispatchStandaloneBand } from './band-agent-run.ts';

// ---- The Ralph loop and its stop conditions -------------------------------
export { run as runRalphLoop } from './ralph/runner.ts';
export { makeQualityGateFromCmd, resolveGateTimeoutMs, type GateRunInfo } from './ralph/stop-conditions.ts';

// ---- The Agent kind of the studio object model ----------------------------
export {
  loadAgentDefinition, listAgentDefinitions, isStudioAgent, isUnfilteredStudioAgent, listStarterAgents,
  PHASE_EXECUTOR_KINDS,
} from './studio/agent-registry.ts';
export { deriveAgentSpec, agentCapabilityDescriptor, resolveModelTier } from './studio/derive.ts';
export { serializeAgentDefinition } from './studio/skill-md-fidelity.ts';

/**
 * The reverse index (T1 ruling 13/73). Library asks "which agents use this
 * skill/hook/connection?" through THIS door — never by reading agent files
 * itself, which is the rank-2 → rank-3 read the index exists to remove.
 */
export { agentUsageIndex, agentsUsing } from './studio/agent-usage.ts';

// ---- The adapter registry ------------------------------------------------
export { getAdapter, resolveSdkId, isSdkAvailable } from './_adapters/registry.ts';
export type { AgentInvocation } from './_adapters/types.ts';

// ---- The ralph dev-loop runtime: options, live tool detail -----------------
export type { QueryFn, ClaudeAgentOptions, ToolUseLiveDetail } from './ralph/claude-agent.ts';

// ---- Declared-skill composition into an agent's system prompt --------------
export { makeProjectSkillsLoadedSink } from './project-skills.ts';

// ---- The agent-slug route helpers ------------------------------------------
export { SAFE_AGENT_SLUG_RE } from './bridge-agents-slug.ts';

// ---- Studio agent validation -----------------------------------------------
export { validateAgent } from './studio/validate-agent.ts';

// ---- The pinned SDK seam, and spawn containment ---------------------------
export { pinnedSdkQuery, pinnedStreamQuery, withRunMarker } from './pinned-sdk-query.ts';
export { processesCarryingMarker, readRunMarkers, tokenBelongsToRunDir, AGENT_RUN_MARKER_FILE } from './spawn-marker.ts';
export { withIdleDeadline, StreamDeadlineError } from './stream-deadline.ts';

// ---- Skill packages --------------------------------------------------------
// SLUG_RE: see the module doc above — the one deliberate exception to "this
// door does not re-export kernel's id vocabulary" (AT-89 pins it).
export {
  skillPath, skillsDir, skillPathRelative, assertSkillSlug, listSkillMdDirs, listSkillDirs,
  loadSkillTurnPrompt, splitSkillTurnSections, SLUG_RE,
} from './skill-path.ts';

// ---- Model resolution ----------------------------------------------------
export { modelForSpec, resolveSessionModel, MODEL_BY_TIER } from './phase-agent.ts';

// ---- Events, failure classification, scope ---------------------------------
export { makeToolEventSink, extractLiveToolDetails } from './tool-event-emit.ts';
export {
  classifyCycleFailure,
  classifyCrash,
  matchesRateLimitSignature,
  matchesDnsFailureSignature,
} from './failure-classifier.ts';
export { takeScopeSnapshot, scopeViolations } from './phases/agent-scope-guard.ts';
export { sdkHooksForAgent, withForgeRepoGitFence, type ForgeRepoGitFenceRunContext } from './studio/hook-dispatch.ts';

// ---- AGENTS.md composition, and the HTTP routes ---------------------------
export { composeAgentsMd } from './agents-md-compose.ts';
export { agentsRoutes } from './routes.ts';

// ---- Types ---------------------------------------------------------------
export type { BandGuardId } from './agent-bands.ts';
export type { BandAgentDeps } from './band-agent-run.ts';
export type { StreamQueryFn } from './pinned-sdk-query.ts';
export type { ModelTier, PhaseAgentSpec } from './phase-agent.ts';
export type { AgentsRouteDeps } from './routes.ts';
export type { SdkHooksOption } from './studio/hook-dispatch.ts';
export type { AgentUsageIndex, AgentUsageKind } from './studio/agent-usage.ts';
export type { LoopResult } from './ralph/runner.ts';

// ---- Dispatch terminus recording (bead forge-8vfn.5.38) --------------------
// Needed by `apps/forge/agent-dispatch-cmd.ts`'s `cmdAgentDispatch` (the CLI
// verb that composes this package with sessions/flows, and so lives in the
// assembly — see the module doc above), which is the sole caller.
export { installDispatchSignalGuard, recordDispatchTerminal } from './dispatch-terminal.ts';
