/**
 * routes.ts — `@forge/projects`'s HTTP routes, as a table.
 *
 * M4 §4 step 2 (projects routes carve, assembly pass). These sixteen routes
 * used to reach their handlers through TWO monolithic if-chain dispatchers —
 * `handleStudioRoutes` (`apps/forge/bridge-studio.ts`, the read side) and
 * `handleStudioWriteRoutes` (`apps/forge/bridge-studio-writes.ts`, the write side) —
 * which `apps/forge/ui-bridge.ts` called in that order (`handleStudioRoutes`
 * strictly before `handleStudioWriteRoutes`, still true today for the routes
 * that have not carved). Workers A and B moved the HANDLER BODIES, verbatim,
 * into six files (`project-roster.ts`, `project-preflight-read.ts`,
 * `project-roadmap.ts`, `bridge-studio-project-onboard.ts`, `bridge-studio-project-preflight-write.ts`,
 * `project-contract-scaffold.ts` — the last carries pure helpers only, no
 * route, no table row). This file is the DISPATCH: it assembles those
 * handlers into one ordered table, taking over from the if-chains'
 * now-deleted arms.
 *
 * TWO ROUTES DID NOT CARVE and carry NO row here:
 * `GET /api/studio/projects/attention` and `GET /api/studio/projects/:id/
 * roadmap`. Their helpers (`buildProjectAttention` → `scanProjectManifests`,
 * `buildProjectRoadmap`) read `@forge/flows` (queue/manifest/scheduler/
 * work-item/run-list-cache) — a STRICTLY HIGHER package rank than `projects`
 * (`scripts/check-boundaries.mjs`'s `PACKAGE_RANK`: kernel=1 <
 * {library,knowledge,projects}=2 < agents=3 < sessions=4 < flows=5) — moving
 * them would be a NEW, unbaselinable `package-layer-order` violation (the
 * baseline is a shrink-only ratchet; there is no `--write-baseline`). Both
 * routes still live, unchanged, in `apps/forge/bridge-studio.ts`'s
 * `handleStudioRoutes` — see `project-roadmap.ts`'s header for the full
 * accounting of exactly which helpers block the move.
 *
 * ORDER IS THE CONTRACT, NOT A DETAIL — same rule `knowledge`'s table states,
 * and the same reason: `dispatchRoute` is first-match-wins, and the generic
 * `:id` pattern (`^/api/studio/projects/([^/]+)$`) genuinely collides with
 * the literal `/api/studio/projects/create`: nothing in `RESERVED_OBJECT_IDS`
 * reserves the string `create`, so `POST /api/studio/projects/create` MUST be
 * listed before the `PUT`/`POST /api/studio/projects/:id` rows below it, or a
 * project literally id'd `create` becomes permanently un-updatable via POST —
 * still a 200, nothing status-code-visible catches it wrong. The table below
 * preserves the ORIGINAL if-chain's order in full (`save-repo` →
 * `preflight/fix-auto` → `preflight/fix-agent` → `create` → onboard →
 * `:id`, verified against `git show HEAD:apps/forge/bridge-studio-writes.ts` before
 * this file was written) — not only the one collision that matters
 * mechanically, so a future reader diffing this table against the deleted
 * if-chain sees the same sequence.
 *
 * `handleProjectPut` (`bridge-studio-project-onboard.ts`) ANSWERS BOTH `PUT` AND `POST` —
 * its own entry gate, kept verbatim from the original, is
 * `if (!(projectMatch && method !== 'DELETE')) return false;`. `RouteEntry
 * .method` is singular, so it gets TWO rows below, sharing one handler
 * reference — never a `method: 'PUT'` row alone, which would silently drop
 * POST support the original if-chain had. `DELETE` is never registered
 * against it: `dispatchRoute` filters on `entry.method` before it ever calls
 * `matches`, so an unregistered method falls through unhandled (404) exactly
 * as the original W7-B4 comment in `bridge-studio-project-onboard.ts` requires — the
 * in-handler `method !== 'DELETE'` check is defense-in-depth, not the primary
 * guard.
 *
 * `POST /api/studio/projects/:id/preflight/fix-agent` is ONE row, not two.
 * T1 rulings 27/29 (see `bridge-studio-project-preflight-write.ts`'s header for the full
 * argument): the route's real discriminator — which resolution tier a clause
 * falls into — comes from the preflight REPORT, computed inside the handler,
 * never from anything a `matches: (url) => boolean` predicate can read. A
 * `matches` that ran preflight itself to decide would run it TWICE per
 * request (once to route, once to serve) for a purely cosmetic table split.
 * `packages/projects/tests/contract/routes-table.test.ts` pins the single-row
 * count with the reason attached, so a later reader cannot read the single
 * row as an oversight.
 *
 * `POST /api/studio/projects/:id/contract-reset` and `.../contract-reset/
 * apply` are NOT part of the original if-chain carve — they are the S3
 * (1.0.md §3) "Rebuild contract" capability, new at M4, carved straight into
 * this table from day one (their handlers, `bridge-studio-project-reset.ts`,
 * never lived in `apps/forge/bridge-studio-writes.ts`). Neither collides with the
 * `create`/`:id` ambiguity above: both require a literal `/contract-reset`
 * (or `/contract-reset/apply`) suffix the `:id` pattern's `[^/]+` cannot
 * match (no further `/`), so their table position is unconstrained by the
 * ordering rule this header otherwise devotes most of its space to.
 *
 * `dryClassification` — TWO provenances, same distinction `knowledge`'s table
 * draws for the same reason:
 *   · The seven ORIGINAL MUTATING rows (`save-repo`, `preflight/fix-auto`,
 *     `preflight/fix-agent`, `create`, onboard-POST, and the two
 *     `:id` PUT+POST rows) are carried from `cli/dry-bridge.ts`'s
 *     `BRIDGE_ROUTE_CLASSIFICATION` VERBATIM — see each row's own comment for
 *     its exact source line and reason string. The POST `/api/studio/
 *     projects/:id` row is the one exception worth flagging explicitly: the
 *     manifest carries only a `PUT` row for this URL (predating POST being
 *     noticed as a live method on this handler) — the POST row below copies
 *     that SAME row's classification and reason because it dispatches to the
 *     exact same handler through the exact same unconditional `isDryBridge()`
 *     check at the top of `handleProjectPut`, not a re-derived judgement. The
 *     two new contract-reset rows are classified the SAME way — a verbatim
 *     `dry-bridge.ts` row each, added alongside them in the same PR that adds
 *     this table's own rows — for exactly the reason `BRIDGE_ROUTE_
 *     CLASSIFICATION`'s own coverage guard exists: a table row with no
 *     dry-bridge counterpart is a route that spawns/writes unclassified.
 *   · The seven GET rows are NOT in that table and never were — it is a
 *     mutating-route table. They are `exempt-local` here by CONSTRUCTION, not
 *     by lookup: each reads on-disk state (or, for the two starters routes
 *     and the roster, in-memory/config state) and nothing else — no spawn, no
 *     remote call, no write — so running them for real under a dry bridge is
 *     safe. If one ever grows a spawn, this value becomes wrong and the route
 *     must gain a real `dry-bridge.ts` row.
 *
 * The field is non-optional in `RouteEntry` because a carved route that lost
 * its classification would be a route that SPAWNS under `FORGE_DRY_BRIDGE=1`;
 * `tests/contract/routes-table.test.ts` and `apps/forge/dry-bridge-coverage.test.ts`
 * both assert every entry carries one.
 */
import { pathOnly, type RouteContext, type RouteTable } from '@forge/kernel';
import type { AgentDefinition, FlowDefinition } from '@forge/contracts/studio/types.ts';

import { createProjectsListHandler, createStudioStartersHandler, handleProjectsStarters } from './project-roster.ts';
import {
  handleProjectPreflight,
  handleProjectRepoStatus,
  handleProjectPreflightFixAgentStatus,
} from './project-preflight-read.ts';
import { handleProjectContractStages } from './project-roadmap.ts';
import { makeOnboardHandlers } from './bridge-studio-project-onboard.ts';
import { makePreflightWriteHandlers } from './bridge-studio-project-preflight-write.ts';
import { handleProjectContractResetDryRun, handleProjectContractResetApply } from './bridge-studio-project-reset.ts';

/**
 * Structural mirror of `@forge/knowledge/project-brain-seed.ts`'s
 * `ProjectBrainSeedResult` — `bridge-studio-project-onboard.ts` already duplicates this
 * exact shape (unexported) for the same reason: `projects` (rank 2) may not
 * import `@forge/knowledge` (same rank), not even for a type. Duplicated a
 * second time here, rather than importing `bridge-studio-project-onboard.ts`'s copy,
 * because `ProjectsRouteDeps` below is declared FLAT and STRUCTURAL on
 * purpose — see that type's own comment.
 */
type ProjectBrainSeedResult = {
  projectId: string;
  brainDir: string;
  files: { path: string; action: 'created' | 'skipped-existing' }[];
};

/**
 * Everything the nine handler factories in this file's imports need,
 * bundled flat. Every field is declared STRUCTURALLY (an inline function
 * type), never as `import type` of the real implementation's own type from
 * `@forge/knowledge`, `@forge/flows`, `@forge/agents` or `orchestrator/` —
 * `scripts/check-boundaries.mjs` cruises with `tsPreCompilationDeps: true`,
 * which tracks TypeScript type-only imports as real dependency edges too, so
 * even a type-only import of one of those packages' types would mint the
 * exact same `package-layer-order` (or `package-to-legacy`) violation a value
 * import would. DO NOT "tidy" this into `import type { X } from
 * '@forge/knowledge/...'` — that tidy IS the violation.
 *
 * `apps/forge/routes.ts` is where the real implementations are supplied:
 * `classify()` gives that assembly point no rule at all, so it may import
 * every package and the legacy tree freely — this file may not.
 */
export type ProjectsRouteDeps = {
  /** `@forge/knowledge/project-brain-seed.ts`'s `seedProjectBrain`. */
  seedBrain: (forgeRoot: string, projectId: string, name: string) => ProjectBrainSeedResult;
  /** `@forge/knowledge/project-brain-seed.ts`'s `checkProjectBrainSeedContainment`. */
  checkBrainSeedContainment: (forgeRoot: string, projectId: string) => void;
  /** `@forge/knowledge/brain-paths.ts`'s `readArtifactRoot`. */
  readArtifactRoot: (projectRoot: string) => string;
  /** `@forge/flows/manifest-path-guard.ts`'s `isContainedProjectRepoPath`. */
  isContainedProjectRepoPath: (p: string, opts: { forgeRoot: string; projectsRoot?: string }) => boolean;
  /** `apps/forge/bridge-studio-writes.ts`'s `spawnPreflightFix` — sessions-owned
   *  (M4-projects routes budget row 12b), kept in its legacy home until the
   *  sessions lane carves its own routes. */
  spawnPreflightFix: (
    forgeRoot: string,
    p: { project: string; clause: string; instruction: string; detail: string; runId: string },
  ) => void;
  /** `@forge/knowledge/kb-sites.ts`'s `projectKbBindings`. */
  projectKbBindings: (forgeRoot: string) => Map<string, string>;
  /** `orchestrator/studio/registry.ts`'s `listStarterAgents` — legacy, no
   *  package-native home. */
  listStarterAgents: (forgeRoot: string) => AgentDefinition[];
  /** `orchestrator/studio/registry.ts`'s `loadStarterFlow`. */
  loadStarterFlow: (forgeRoot: string) => FlowDefinition | null;
  /** `@forge/agents/studio/derive.ts`'s `agentCapabilityDescriptor`. Return
   *  type deliberately `unknown`, mirroring `project-roster.ts`'s own note:
   *  even a type-only import of `AgentCapabilityDescriptor` (rank 3) would be
   *  a `package-layer-order` violation the same as a value import. */
  agentCapabilityDescriptor: (def: AgentDefinition) => unknown;
};

const PROJECTS = String.raw`/api/studio/projects`;

/**
 * Matching strips the query; handlers get the RAW url and normalise for
 * themselves, so an arm that later needs the query string still has it (T1
 * ruling 30's `readBody` note applies to bodies, not urls — the query-string
 * gotcha is the same one `knowledge`'s table documents, and this table's own
 * contract test pins it directly: every `matches` predicate below is asserted
 * to accept its path with `?x=1` appended).
 */
const m = {
  starters: /^\/api\/studio\/starters$/,
  projectStarters: new RegExp(`^${PROJECTS}/starters$`),
  list: new RegExp(`^${PROJECTS}$`),
  preflight: new RegExp(`^${PROJECTS}/([^/]+)/preflight$`),
  repoStatus: new RegExp(`^${PROJECTS}/([^/]+)/repo-status$`),
  preflightFixAgentStatus: new RegExp(`^${PROJECTS}/([^/]+)/preflight/fix-agent/([^/]+)$`),
  contractStages: new RegExp(`^${PROJECTS}/([^/]+)/contract-stages$`),
  saveRepo: new RegExp(`^${PROJECTS}/([^/]+)/save-repo$`),
  preflightFixAuto: new RegExp(`^${PROJECTS}/([^/]+)/preflight/fix-auto$`),
  preflightFixAgent: new RegExp(`^${PROJECTS}/([^/]+)/preflight/fix-agent$`),
  contractReset: new RegExp(`^${PROJECTS}/([^/]+)/contract-reset$`),
  contractResetApply: new RegExp(`^${PROJECTS}/([^/]+)/contract-reset/apply$`),
  create: new RegExp(`^${PROJECTS}/create$`),
  // Same pattern as `create` above — genuinely ambiguous on the URL alone,
  // which is exactly why `create`'s row MUST precede these two (see header).
  id: new RegExp(`^${PROJECTS}/([^/]+)$`),
} as const;

/**
 * Ordered, first-match-wins. The order is the ORIGINAL if-chains' order,
 * preserved whole: `handleStudioRoutes`'s seven read routes (the order fixed
 * at `git show HEAD:apps/forge/bridge-studio.ts`'s now-deleted arms), followed by
 * `handleStudioWriteRoutes`'s seven write routes (same provenance,
 * `apps/forge/bridge-studio-writes.ts`) — matching the host's own original call
 * order, `handleStudioRoutes` strictly before `handleStudioWriteRoutes`
 * (`apps/forge/ui-bridge.ts`, still true today for the two routes that did not
 * carve).
 */
export function projectsRoutes(deps: ProjectsRouteDeps): RouteTable<RouteContext> {
  const startersHandler = createStudioStartersHandler({
    listStarterAgents: deps.listStarterAgents,
    loadStarterFlow: deps.loadStarterFlow,
    agentCapabilityDescriptor: deps.agentCapabilityDescriptor,
  });
  const listHandler = createProjectsListHandler({ projectKbBindings: deps.projectKbBindings });
  const { handleProjectsCreate, handleProjectsOnboard, handleProjectPut } = makeOnboardHandlers({
    seedBrain: deps.seedBrain,
    checkBrainSeedContainment: deps.checkBrainSeedContainment,
    readArtifactRoot: deps.readArtifactRoot,
    isContainedProjectRepoPath: deps.isContainedProjectRepoPath,
  });
  const { handleProjectSaveRepo, handleProjectPreflightFixAuto, handleProjectPreflightFixAgent } =
    makePreflightWriteHandlers({ spawnPreflightFix: deps.spawnPreflightFix });

  return [
    // ---- read side (apps/forge/bridge-studio.ts's former handleStudioRoutes) ------
    {
      method: 'GET',
      path: '/api/studio/starters',
      matches: (url) => m.starters.test(pathOnly(url)),
      dryClassification: 'exempt-local',
      handler: startersHandler,
    },
    {
      method: 'GET',
      path: '/api/studio/projects/starters',
      matches: (url) => m.projectStarters.test(pathOnly(url)),
      dryClassification: 'exempt-local',
      handler: handleProjectsStarters,
    },
    {
      method: 'GET',
      path: '/api/studio/projects',
      matches: (url) => m.list.test(pathOnly(url)),
      dryClassification: 'exempt-local',
      handler: listHandler,
    },
    {
      method: 'GET',
      path: '/api/studio/projects/:id/preflight',
      matches: (url) => m.preflight.test(pathOnly(url)),
      dryClassification: 'exempt-local',
      handler: handleProjectPreflight,
    },
    {
      method: 'GET',
      path: '/api/studio/projects/:id/repo-status',
      matches: (url) => m.repoStatus.test(pathOnly(url)),
      dryClassification: 'exempt-local',
      handler: handleProjectRepoStatus,
    },
    {
      method: 'GET',
      path: '/api/studio/projects/:id/preflight/fix-agent/:runId',
      matches: (url) => m.preflightFixAgentStatus.test(pathOnly(url)),
      dryClassification: 'exempt-local',
      handler: handleProjectPreflightFixAgentStatus,
    },
    {
      method: 'GET',
      path: '/api/studio/projects/:id/contract-stages',
      matches: (url) => m.contractStages.test(pathOnly(url)),
      dryClassification: 'exempt-local',
      handler: handleProjectContractStages,
    },

    // ---- write side (apps/forge/bridge-studio-writes.ts's former handleStudioWriteRoutes) ----
    {
      method: 'POST',
      path: '/api/studio/projects/:id/save-repo',
      matches: (url) => m.saveRepo.test(pathOnly(url)),
      // dry-bridge.ts:131 — 'saveProjectRepo merges + pushes the project default branch'.
      dryClassification: 'refuse',
      handler: handleProjectSaveRepo,
    },
    {
      method: 'POST',
      path: '/api/studio/projects/:id/preflight/fix-auto',
      matches: (url) => m.preflightFixAuto.test(pathOnly(url)),
      // dry-bridge.ts:219 — 'local git commit to forge-studio branch, no push'.
      dryClassification: 'exempt-local',
      handler: handleProjectPreflightFixAuto,
    },
    {
      method: 'POST',
      path: '/api/studio/projects/:id/preflight/fix-agent',
      matches: (url) => m.preflightFixAgent.test(pathOnly(url)),
      // dry-bridge.ts:172 — 'spawnPreflightFix — marker on the user-tier spawn
      // branch (auto/agent-tier branches never spawn)'. ONE row for a route
      // whose real discriminator (clause resolution tier) is server/body
      // state a `matches` predicate cannot see — see this file's header and
      // `bridge-studio-project-preflight-write.ts`'s (T1 rulings 27/29).
      dryClassification: 'stub-actions',
      handler: handleProjectPreflightFixAgent,
    },
    {
      method: 'POST',
      path: '/api/studio/projects/:id/contract-reset',
      matches: (url) => m.contractReset.test(pathOnly(url)),
      // dry-bridge.ts (added alongside this row) — computes the drift report
      // from the request body's optional appType; writes nothing at all, no
      // spawn, no remote (a POST only because the app-type override arrives
      // as a body — the same shape /api/studio/agents/:slug/
      // instructions-draft already carries this classification for).
      dryClassification: 'exempt-local',
      handler: handleProjectContractResetDryRun,
    },
    {
      method: 'POST',
      path: '/api/studio/projects/:id/contract-reset/apply',
      matches: (url) => m.contractResetApply.test(pathOnly(url)),
      // dry-bridge.ts (added alongside this row) — applyContractReset commits
      // ONLY to the local forge-studio branch via withStudioWrite /
      // commitStudioChange (no push) — the same shape preflight/fix-auto
      // above already carries this classification for.
      dryClassification: 'exempt-local',
      handler: handleProjectContractResetApply,
    },
    {
      method: 'POST',
      // MUST precede the `:id` rows below: the generic `:id` pattern matches
      // the literal `create` as an id, and `RESERVED_OBJECT_IDS` does not
      // reserve it — see this file's header.
      path: '/api/studio/projects/create',
      matches: (url) => m.create.test(pathOnly(url)),
      // dry-bridge.ts:221 — 'greenfield create (R4-03): local template
      // scaffold + brain seed, no spawn/remote'.
      dryClassification: 'exempt-local',
      handler: handleProjectsCreate,
    },
    {
      method: 'POST',
      path: '/api/studio/projects',
      matches: (url) => pathOnly(url) === PROJECTS,
      // dry-bridge.ts:220 — 'onboard: local git init + file scaffolds only'.
      dryClassification: 'exempt-local',
      handler: handleProjectsOnboard,
    },
    {
      method: 'PUT',
      path: '/api/studio/projects/:id',
      matches: (url) => m.id.test(pathOnly(url)),
      // dry-bridge.ts:133 — 'the durable save merges + pushes via
      // saveProjectRepo after the local .forge/project.json write'.
      dryClassification: 'refuse',
      handler: handleProjectPut,
    },
    {
      method: 'POST',
      // Same handler, same URL, same unconditional isDryBridge() guard at its
      // top as the PUT row directly above — TWO rows because RouteEntry.method
      // is singular, not two independent judgements. See this file's header
      // for why dry-bridge.ts's manifest carries only the PUT spelling.
      path: '/api/studio/projects/:id',
      matches: (url) => m.id.test(pathOnly(url)),
      dryClassification: 'refuse',
      handler: handleProjectPut,
    },
  ];
}
