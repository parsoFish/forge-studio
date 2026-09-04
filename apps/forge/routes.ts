/**
 * routes.ts — the host-owned assembly of every package's route table.
 *
 * M4 §4 step 2. Each package owns `packages/<pkg>/routes.ts`; this file owns
 * nothing but the ORDER they are assembled in. Adding a package here is one
 * `import` and one spread — the only line another lane adds, so two lanes
 * carving at once conflict on one line, not on a dispatcher.
 *
 * The assembled table is dispatched by `dispatchRoute` (`@forge/kernel`)
 * BEFORE the host's remaining switch, so a tabled route always wins over a
 * legacy arm of the same shape — that is what makes a carve a move rather
 * than a fork.
 *
 * ORDER. `dispatchRoute` is first-match-wins, so this list is ordered, but
 * ACROSS packages the ordering is not load-bearing: two packages' routes do
 * not overlap (they own disjoint `/api/*` prefixes, which `check-owner` and
 * the boundary lint keep true). WITHIN a package the order is load-bearing
 * and is that package's own contract test to pin — see
 * `packages/knowledge/tests/contract/routes-table.test.ts`, which pins the
 * `drain/cancel` vs `drain/:runId` collision.
 */
import type { RouteContext, RouteTable } from '@forge/kernel';
import { parseManifestPort } from './session-kind-deps.ts';
import { knowledgeRoutes } from '@forge/knowledge/routes.ts';
// M4 ruling 86 — the real brain-fix turn, bound at the assembly because this
// is the one place that may import both knowledge's port and sessions' turn.
import { realKbDrainFixTurn } from './brain-fix-turn.ts';
import { libraryRoutes } from '@forge/library/routes.ts';
import { libraryAgentFacts } from './library-agent-facts.ts';
import { libraryFlowSource } from './library-flow-source.ts';
import { isSdkAvailable } from '@forge/agents/_adapters/registry.ts';
// M4 §4 step 2 (projects routes carve, assembly pass). `projectsRoutes`'s
// `ProjectsRouteDeps` (packages/projects/routes.ts) declares every one of
// these nine dependencies STRUCTURALLY rather than importing their real
// types — a rank-2 `projects` package may not import `@forge/knowledge`
// (same rank), `@forge/flows`/`@forge/agents` (strictly higher) or
// `orchestrator/` (legacy) at all, not even for a type
// (`scripts/check-boundaries.mjs` runs with `tsPreCompilationDeps: true`).
// THIS file is where the real implementations are supplied: `classify()`
// gives `apps/forge/` no rule at all, so this assembly point may import every
// package and the legacy tree freely — verified by running
// `node scripts/check-boundaries.mjs` after this wiring landed (see the M4
// projects-routes PR notes).
import {
  seedProjectBrain,
  checkProjectBrainSeedContainment,
} from '@forge/knowledge/project-brain-seed.ts';
import { readArtifactRoot } from '@forge/knowledge/brain-paths.ts';
import { projectKbBindings } from '@forge/knowledge/kb-sites.ts';
import { isContainedProjectRepoPath } from '@forge/flows/manifest-path-guard.ts';
import { agentCapabilityDescriptor } from '@forge/agents/studio/derive.ts';
import { listStarterAgents, loadStarterFlow, listFlowIds } from '../../orchestrator/studio/registry.ts';
import { listFlowBandIds } from '@forge/flows/flow-band-vocab.ts';
import { spawnPreflightFix } from './bridge-studio-writes.ts';
import { projectsRoutes } from '@forge/projects/routes.ts';
import { sessionsRoutes, type SessionsRouteDeps } from '@forge/sessions/routes.ts';
// M4 §4 step 2 (agents routes carve, assembly pass). `agentsRoutes`'s
// `AgentsRouteDeps` declares its collaborators STRUCTURALLY for the same reason
// `projectsRoutes` does: `packages/agents` is rank 3, so it may not import
// `@forge/sessions` (4), `@forge/flows` (6) or `orchestrator/` at all, not even
// for a type. THIS file supplies the real implementations. Note what is NOT
// injected: `listAgentDefinitions`, `isStudioAgent`, `serializeAgentDefinition`,
// `SLUG_RE`, `isReservedId` and `PROJECT_ID_RE` all turned out to be
// `@forge/agents` or `@forge/kernel` exports reached through a legacy
// re-export, so the package imports its own owners directly (COMMON §15.43) and
// six would-be dependencies never became injections at all.
import { agentsRoutes } from '@forge/agents/routes.ts';
import { cachedListRuns } from '@forge/flows/run-list-cache.ts';
import { buildAgentSlugToNodeId } from '@forge/flows/run-model.ts';
import { loadFlowDefinition, listFlowIds as listFlowIdsForAgents } from '../../orchestrator/studio/registry.ts';
import { validateAgent } from '../../orchestrator/studio/validate.ts';
import {
  DEFAULT_STALL_CEILING_MS, isTurnAlive, extractErrorMessage, killTrackedRun,
} from '@forge/sessions/bridge-studio-lifecycle.ts';
import { parseGuardedEventsJsonl } from '@forge/sessions/session-readability.ts';
import { guardedReadSessionStatus, guardedWriteSessionStatus } from '@forge/sessions/session-status-io.ts';
import type { SessionStatusIoPort } from '@forge/knowledge/kb-drain-model.ts';
import { loadSessionKinds } from '@forge/sessions/studio/session-kinds.ts';

/**
 * Re-exported so the host imports its whole routing surface from one module:
 * `import { routeTable, dispatchRoute } from './routes.ts'`. The
 * table and the function that consumes it are one API, and keeping them
 * together costs `apps/forge/ui-bridge.ts` exactly one import line — which matters,
 * because that file is 6,602 lines against an 800-line cap and `check-file-size`
 * treats its baseline as a ceiling, not a licence. The carve must not grow it.
 */
export { dispatchRoute } from '@forge/kernel';

/**
 * The bridge-instance state the assembled table needs, as the COMPOSITION of
 * each package's own deps type (T1 ruling 59 §2). No package's vocabulary is
 * spelled out here and none of it reaches `@forge/kernel`: a package that later
 * needs instance state adds its `XRouteDeps` to this intersection and nothing
 * else in the repository moves.
 */
/**
 * What the HOST must supply. `isContainedProjectRepoPath` is deliberately not
 * here: it ships in `@forge/flows` and this assembly module already imports it
 * for `projectsRoutes`, so the host never names a symbol from a package above
 * the one it is wiring.
 */
export type RouteTableDeps = Omit<SessionsRouteDeps, 'isContainedProjectRepoPath' | 'runFixTurn'> & {
  /** The bridge's OWN `ensureTailFor`/`stopTailFor` closures — the same pair
   *  that backs session and live-cycle tailing. The agent-run detail and start
   *  routes arm and release a tail on them; injecting rather than duplicating
   *  is what keeps one tail registry instead of two that drift. */
  ensureAgentRunTail(runId: string): void;
  releaseAgentRunTail(runId: string): void;
};

/**
 * Build the assembled table for ONE bridge instance.
 *
 * This was a module-level constant until M4's sessions lane (T1 ruling 59).
 * Three session routes act on the live bridge — they start a tail on its WS
 * fan-out and broadcast to its connections — and those closures do not exist at
 * module load, so a table built at import time could never hold them. Building
 * it where the host builds its own context is both the fix and the honest
 * place: a table of handlers that act on a bridge is built when that bridge is.
 *
 * Deliberately NOT a module-level holder the host assigns into: two bridges in
 * one process would silently share it. Every call returns its own table closed
 * over its own deps, and `tests/…/routes-assembly.test.ts` pins that by calling
 * this twice with distinct closures and asserting each table calls its own.
 *
 * Packages with no instance state spread in exactly as before — a package that
 * does not need `deps` never sees it.
 */
/** The assembled table's type, named so the host states it in one word. */
export type AssembledRouteTable = RouteTable<RouteContext>;

/**
 * Knowledge's session-status port (M4 ruling 99), bound here because this is
 * the assembly: `@forge/knowledge` is rank 2 and `@forge/sessions` is rank 4,
 * so the package declares the shape and the app supplies the functions.
 *
 * The `SessionStatusIoPort` annotation is the drift check between the two
 * sides — exactly as `KbDrainRunFixTurnFn` is for `realKbDrainFixTurn`. If
 * either real function's signature moves, this line fails to compile rather
 * than silently satisfying a port that no longer describes it.
 */
const knowledgeSessionStatusIo: SessionStatusIoPort = {
  read: guardedReadSessionStatus,
  write: guardedWriteSessionStatus,
};

export function makeRouteTable(deps: RouteTableDeps): AssembledRouteTable {
  return [
    ...knowledgeRoutes({ listFlowIds, listFlowBandIds, runFixTurn: realKbDrainFixTurn, sessionStatusIo: knowledgeSessionStatusIo }),
    ...libraryRoutes({ agentFacts: libraryAgentFacts, isSdkAvailable, flowSource: libraryFlowSource }),
    ...projectsRoutes({
      seedBrain: seedProjectBrain,
      checkBrainSeedContainment: checkProjectBrainSeedContainment,
      readArtifactRoot,
      isContainedProjectRepoPath,
      spawnPreflightFix,
      projectKbBindings,
      listStarterAgents,
      loadStarterFlow,
      agentCapabilityDescriptor,
    }),
    ...agentsRoutes({
      agentFacts: libraryAgentFacts,
      // Rank 4/5 reads the package may not import.
      parseGuardedEventsJsonl,
      isTurnAlive,
      extractErrorMessage,
      stallCeilingMs: DEFAULT_STALL_CEILING_MS,
      killTrackedRun,
      loadSessionKinds,
      cachedListRuns,
      buildAgentSlugToNodeId,
      loadFlowDefinition,
      // The Agent kind's VALIDATOR — the half of the registry split still in
      // `orchestrator/studio/validate.ts`; it comes home when that lands.
      validateAgent,
      listFlowIds: listFlowIdsForAgents,
      // Bridge-instance state, from the host's own closures.
      projectsRoot: deps.projectsRoot,
      safeInputKeyRe: deps.safeInputKeyRe,
      newRunStamp: deps.newRunStamp,
      spawnAgentDispatch: deps.spawnAgentDispatch,
      dryBridgeAgentTurnMarker: deps.dryBridgeAgentTurnMarker,
      ensureAgentRunTail: deps.ensureAgentRunTail,
      releaseAgentRunTail: deps.releaseAgentRunTail,
    }),
    ...sessionsRoutes({
      parseManifest: parseManifestPort,
      ensureSessionTail: deps.ensureSessionTail,
      broadcastKindChanged: deps.broadcastKindChanged,
      broadcastArchitectChanged: deps.broadcastArchitectChanged,
      broadcastInstructionsChanged: deps.broadcastInstructionsChanged,
      broadcastProjectBrainChanged: deps.broadcastProjectBrainChanged,
      spawnAgentDispatch: deps.spawnAgentDispatch,
      newRunStamp: deps.newRunStamp,
      safeInputKeyRe: deps.safeInputKeyRe,
      broadcastDemoChanged: deps.broadcastDemoChanged,
      projectsRoot: deps.projectsRoot,
      // The host's spawn/serve surface. It stays in `apps/forge/ui-bridge.ts` because
      // host code that does not carve still calls it (see the sessions helper
      // module's header); injecting it here is what keeps the carve at zero new
      // boundary rows in either direction.
      spawnAgentTurn: deps.spawnAgentTurn,
      spawnAgentSpecs: deps.spawnAgentSpecs,
      safeParseJson: deps.safeParseJson,
      servedFileHeaders: deps.servedFileHeaders,
      dryBridgeAgentTurnMarker: deps.dryBridgeAgentTurnMarker,
      isContainedProjectRepoPath,
      // ruling 86 — the same real turn `knowledgeRoutes` above is given. Bound
      // here, at the assembly, so neither package names the other's function.
      runFixTurn: realKbDrainFixTurn,
    }),
  ];
}
