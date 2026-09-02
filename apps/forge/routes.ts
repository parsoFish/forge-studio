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
import { listStarterAgents, loadStarterFlow } from '../../orchestrator/studio/registry.ts';
import { spawnPreflightFix } from '../../cli/bridge-studio-writes.ts';
import { projectsRoutes } from '@forge/projects/routes.ts';

/**
 * Re-exported so the host imports its whole routing surface from one module:
 * `import { routeTable, dispatchRoute } from '../apps/forge/routes.ts'`. The
 * table and the function that consumes it are one API, and keeping them
 * together costs `cli/ui-bridge.ts` exactly one import line — which matters,
 * because that file is 6,602 lines against an 800-line cap and `check-file-size`
 * treats its baseline as a ceiling, not a licence. The carve must not grow it.
 */
export { dispatchRoute } from '@forge/kernel';

/** Every carved route, in package order. */
/**
 * Typed on `RouteContext` — `StudioContext` plus the host-supplied `readBody`
 * (kernel, T1 ruling 30). A package table whose handlers accept the narrower
 * `StudioContext` slots in unchanged: a handler taking a supertype is
 * assignable where one taking the subtype is expected.
 */
export const routeTable: RouteTable<RouteContext> = [
  ...knowledgeRoutes,
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
];
