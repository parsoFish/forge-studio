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
import { knowledgeRoutes } from '@forge/knowledge/routes.ts';
import { libraryRoutes } from '@forge/library/routes.ts';
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
import { spawnPreflightFix } from '../../cli/bridge-studio-writes.ts';
import { projectsRoutes } from '@forge/projects/routes.ts';
import { sessionsRoutes, type SessionsRouteDeps } from '@forge/sessions/routes.ts';

/**
 * Re-exported so the host imports its whole routing surface from one module:
 * `import { routeTable, dispatchRoute } from '../apps/forge/routes.ts'`. The
 * table and the function that consumes it are one API, and keeping them
 * together costs `cli/ui-bridge.ts` exactly one import line — which matters,
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
export type RouteTableDeps = Omit<SessionsRouteDeps, 'isContainedProjectRepoPath'>;

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

export function makeRouteTable(deps: RouteTableDeps): AssembledRouteTable {
  return [
    ...knowledgeRoutes({ listFlowIds, listFlowBandIds }),
    ...libraryRoutes,
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
    ...sessionsRoutes({
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
      // The host's spawn/serve surface. It stays in `cli/ui-bridge.ts` because
      // host code that does not carve still calls it (see the sessions helper
      // module's header); injecting it here is what keeps the carve at zero new
      // boundary rows in either direction.
      spawnAgentTurn: deps.spawnAgentTurn,
      spawnAgentSpecs: deps.spawnAgentSpecs,
      safeParseJson: deps.safeParseJson,
      servedFileHeaders: deps.servedFileHeaders,
      dryBridgeAgentTurnMarker: deps.dryBridgeAgentTurnMarker,
      isContainedProjectRepoPath,
    }),
  ];
}
