/**
 * routes.ts — `@forge/knowledge`'s HTTP routes, as a table.
 *
 * M4 §4 step 2. These routes used to reach their handlers through two
 * monolithic prefix dispatchers that `cli/ui-bridge.ts` called in sequence
 * (`:2366-2367`). The handlers have not moved; what has moved is the
 * DISPATCH, out of an if-chain buried in a 6,602-line host and into a table
 * `apps/forge/routes.ts` assembles.
 *
 * ORDER IS THE CONTRACT, NOT A DETAIL. `dispatchRoute` is first-match-wins
 * and the patterns below genuinely overlap: `/api/studio/kbs/<id>/drain/cancel`
 * also matches the `drain/:runId` pattern with `runId === 'cancel'`. Today
 * the methods differ too (POST vs GET), but the order is what the if-chain
 * relied on and the order is what is preserved here. Getting this wrong
 * dispatches the wrong handler and still returns 200 — which no status-code
 * assertion catches — so `tests/contract/routes-table.test.ts` pins each
 * colliding URL to the entry that must claim it.
 *
 * CARVED: all seventeen. The six `bridge-studio-kb-drain.ts` routes came
 * first (they carry the sharpest ordering collision, `drain/cancel` vs
 * `drain/:runId`, so they proved the table end-to-end); the eleven
 * `bridge-studio-kbs.ts` routes followed in the PR that split that 2,068-line
 * file five ways under the 800-line cap — extracting eleven arms from a file
 * that is simultaneously being broken up is one rewrite, not two.
 * `handleStudioKbRoutes` is now DELETED, along with `cli/ui-bridge.ts`'s
 * import of it and its call at `:2367`; nothing dispatches these routes but
 * this table.
 *
 * `dryClassification` — three provenances, stated separately because they are
 * NOT the same kind of claim:
 *   · The drain POSTs are carried from `cli/dry-bridge.ts` VERBATIM:
 *     `:233` `POST /api/studio/kbs/:id/drain` and `:235`
 *     `POST /api/studio/kbs/:id/drain/cancel`, both `exempt-local` there.
 *     So are the three lifecycle writes: `:265` `POST /api/studio/kbs`,
 *     `:266` `POST /api/studio/kbs/:id (delete)` and `:274`
 *     `POST /api/studio/kbs/:id/guidance`.
 *   · The GETs are NOT in that table and never were — it is a mutating-route
 *     table (70 `POST` rows against 2 `GET`). They are `exempt-local` here by
 *     CONSTRUCTION, not by lookup: each reads on-disk state and nothing else —
 *     no spawn, no remote call, no write — so running them for real under a
 *     dry bridge is safe. If one ever grows a spawn, this value becomes wrong
 *     and the route must gain a real `dry-bridge.ts` row.
 *   · `POST /api/studio/kbs/:id/maintenance` is ONE row classified
 *     `stub-actions`, and it is the only entry in this table whose
 *     classification is a JUDGEMENT rather than a copy. See its own comment
 *     below; the short version is T1 ruling 29 — `op` is a BODY field, and a
 *     discriminator `matches: (url) => boolean` cannot read is not one the
 *     table can split on.
 *
 * A NOTE ON `DELETE`. `cli/dry-bridge.ts` spells the delete route
 * `POST /api/studio/kbs/:id (delete)` because that manifest predates the
 * method being modelled at all. The table states the method the handler
 * actually guards (`method === 'DELETE'`), because the method is what
 * `dispatchRoute` filters on before it ever calls `matches` — T1 ruling 28.
 *
 * The field is non-optional in `RouteEntry` because a carved route that lost
 * its classification would be a route that SPAWNS under `FORGE_DRY_BRIDGE=1`;
 * the contract test asserts every entry carries one.
 */
import { pathOnly, type RouteContext, type RouteTable } from '@forge/kernel';

import {
  handleKbList,
  handleKbResolveNode,
  handleKbNode,
  handleKbGet,
} from './bridge-studio-kb-routes-read.ts';
import {
  createKbCreateHandler,
  type KbCreateDeps,
  handleKbDelete,
  handleKbGuidance,
} from './bridge-studio-kb-routes-lifecycle.ts';
import {
  handleKbFixAgentStatus,
  handleKbConsolidateActive,
  handleKbIngestActivity,
  createKbMaintenanceHandler,
} from './bridge-studio-kb-routes-maintenance.ts';
import {
  handleKbDrainCancel,
  handleKbActiveJob,
  handleKbRuns,
  handleKbDrainRun,
  createKbDrainStartHandler,
  handleKbDrainStatus,
} from './kb-drain-routes.ts';
import type { KbDrainRunFixTurnFn } from './bridge-studio-kb-drain.ts';

/**
 * The context these handlers receive. `StudioContext` moved to `@forge/kernel`
 * with the rest of the HTTP envelope (T1 ruling on PARK 2), so this is now a
 * re-export rather than the structural duplicate it had to be while the type
 * still lived in `cli/bridge-studio.ts`.
 */
export type KnowledgeRouteContext = RouteContext;

const KB = String.raw`/api/studio/kbs`;

/**
 * Matching strips the query; handlers get the RAW url and normalise for
 * themselves, so an arm that later needs the query string still has it.
 * `pathOnly` is imported from `@forge/kernel` now — the local copy existed only
 * to avoid a `package-to-legacy` import, and that reason is gone.
 */
const pathOf = pathOnly;

/** Matchers, verbatim from the if-chain arms they replace — see the note in
 *  `@forge/kernel`'s `RouteEntry` on why `matches` is a predicate rather than
 *  something derived from `path`: these are existing hand-written regexes and
 *  deriving a matcher would quietly re-specify them. */
const m = {
  resolveNode: new RegExp(String.raw`^${KB}/resolve-node/(.+)$`),
  node: new RegExp(`^${KB}/([^/]+)/nodes/([^/]+)$`),
  one: new RegExp(`^${KB}/([^/]+)$`),
  guidance: new RegExp(`^${KB}/([^/]+)/guidance$`),
  fixAgent: new RegExp(`^${KB}/([^/]+)/fix-agent/([^/]+)$`),
  consolidateActive: new RegExp(`^${KB}/([^/]+)/consolidate/active$`),
  ingestActivity: new RegExp(`^${KB}/([^/]+)/ingest-activity$`),
  maintenance: new RegExp(`^${KB}/([^/]+)/maintenance$`),
  drainCancel: new RegExp(`^${KB}/([^/]+)/drain/cancel$`),
  activeJob: new RegExp(`^${KB}/([^/]+)/active-job$`),
  runs: new RegExp(`^${KB}/([^/]+)/runs$`),
  drainRun: new RegExp(`^${KB}/([^/]+)/drain/([^/]+)$`),
  drain: new RegExp(`^${KB}/([^/]+)/drain$`),
} as const;

/**
 * Ordered, first-match-wins. The order below is the order the two if-chains
 * matched these arms in at `161c5abb`, and `cli/ui-bridge.ts:2366-2367` called
 * `handleStudioKbRoutes` BEFORE `handleStudioKbDrainRoutes`, so the eleven
 * `bridge-studio-kbs.ts` arms (:1156 :1178 :1214 :1266 :1337 :1553 :1625 :1753
 * :1783 :1809 :1842) precede the six `bridge-studio-kb-drain.ts` arms (:1490
 * :1544 :1565 :1582 :1607 :1676).
 */
/**
 * The collaborators this package cannot import, supplied by the host.
 *
 * `apps/forge/routes.ts` is where the real implementations live, because
 * `classify()` gives that tree no rule at all — the same assembly point, and
 * the same reason, as `projectsRoutes(deps)`. Declared structurally so this
 * package names no forbidden module even in a type position.
 */
export type KnowledgeRouteDeps = KbCreateDeps & {
  /**
   * The real brain-fix turn (M4 ruling 86). This package is rank 2 and
   * `@forge/sessions` is rank 4, so the drain and the consolidate loop declare
   * a PORT (`KbDrainRunFixTurnFn`, in this package's own vocabulary) and the
   * assembly supplies the implementation — `apps/forge/brain-fix-turn.ts`,
   * where the `KbDrainRunFixTurnFn` annotation on the real function is also
   * the drift check between the two sides.
   */
  runFixTurn: KbDrainRunFixTurnFn;
};

export function knowledgeRoutes(deps: KnowledgeRouteDeps): RouteTable<KnowledgeRouteContext> {
  const handleKbCreate = createKbCreateHandler(deps);
  // The two routes that dispatch a real fix turn take it from `deps`; every
  // other row is bound directly, as before.
  const handleKbMaintenance = createKbMaintenanceHandler(deps);
  const handleKbDrainStart = createKbDrainStartHandler(deps);
  return [
  {
    method: 'GET',
    path: '/api/studio/kbs',
    matches: (url) => pathOf(url) === '/api/studio/kbs',
    dryClassification: 'exempt-local',
    handler: handleKbList,
  },
  {
    method: 'GET',
    path: '/api/studio/kbs/resolve-node/:nodeId',
    // MUST precede the bare `:id` GET, which would capture `resolve-node` as
    // a kb id — the hazard the source recorded at bridge-studio-kbs.ts:1177.
    matches: (url) => m.resolveNode.test(pathOf(url)),
    dryClassification: 'exempt-local',
    handler: handleKbResolveNode,
  },
  {
    method: 'GET',
    path: '/api/studio/kbs/:id/nodes/:nodeId',
    matches: (url) => m.node.test(pathOf(url)),
    dryClassification: 'exempt-local',
    handler: handleKbNode,
  },
  {
    method: 'GET',
    path: '/api/studio/kbs/:id',
    matches: (url) => m.one.test(pathOf(url)),
    dryClassification: 'exempt-local',
    handler: handleKbGet,
  },
  {
    method: 'POST',
    path: '/api/studio/kbs',
    matches: (url) => pathOf(url) === '/api/studio/kbs',
    // dry-bridge.ts:265 — 'creates a local KB directory'.
    dryClassification: 'exempt-local',
    handler: handleKbCreate,
  },
  {
    method: 'DELETE',
    path: '/api/studio/kbs/:id',
    // Same URL shape as the GET above; `dispatchRoute` filters on method
    // BEFORE it calls `matches` (route-entry.ts), so the two never contend.
    // dry-bridge.ts:266 spells this row `POST … (delete)`; ruling 28 says the
    // table states the method the handler actually guards.
    matches: (url) => m.one.test(pathOf(url)),
    dryClassification: 'exempt-local',
    handler: handleKbDelete,
  },
  {
    method: 'POST',
    path: '/api/studio/kbs/:id/guidance',
    // dry-bridge.ts:274 — 'writes a local guidance markdown file'.
    dryClassification: 'exempt-local',
    handler: handleKbGuidance,
    matches: (url) => m.guidance.test(pathOf(url)),
  },
  {
    method: 'GET',
    path: '/api/studio/kbs/:id/fix-agent/:runId',
    matches: (url) => m.fixAgent.test(pathOf(url)),
    dryClassification: 'exempt-local',
    handler: handleKbFixAgentStatus,
  },
  {
    method: 'GET',
    path: '/api/studio/kbs/:id/consolidate/active',
    matches: (url) => m.consolidateActive.test(pathOf(url)),
    dryClassification: 'exempt-local',
    handler: handleKbConsolidateActive,
  },
  {
    method: 'GET',
    path: '/api/studio/kbs/:id/ingest-activity',
    matches: (url) => m.ingestActivity.test(pathOf(url)),
    dryClassification: 'exempt-local',
    handler: handleKbIngestActivity,
  },
  {
    method: 'POST',
    path: '/api/studio/kbs/:id/maintenance',
    matches: (url) => m.maintenance.test(pathOf(url)),
    // ONE row for five ops (T1 ruling 29, which amends 26/27 to
    // MATCHER-VISIBLE discriminators only). `op` arrives in the request BODY;
    // `matches` is `(url) => boolean` and the body is a consumable stream, so
    // unlike a path, method or query, `op` is not something this table can
    // split on. Buffering the body before matching was rejected for the seam:
    // it would read a body on every GET and change the contract for every
    // lane.
    //
    // `stub-actions` is the honest value, MEASURED not assumed — it is what
    // the handler does under `FORGE_DRY_BRIDGE=1`:
    //   · `op=fix-agent` is refused by the inline `isDryBridge()` guard
    //     (bridge-studio-kb-routes-maintenance.ts) — the one op that spawns;
    //   · `op=consolidate` proceeds and applies its deterministic fixes, with
    //     its agent turn suppressed through the same seam
    //     (`bridge-studio-kb-consolidate.ts`'s `noSpawn` reads `isDryBridge()`);
    //   · `op=lint|fix-auto|index` proceed in full — all local.
    // That is precisely dry-bridge.ts's own definition of `stub-actions`
    // (`:44`): proceed with the local bookkeeping, skip the real-acting steps.
    // `refuse` would cost harness runs three ops they have today.
    //
    // `BRIDGE_ROUTE_CLASSIFICATION` KEEPS its two finer-grained op rows
    // (`:121` fix-agent → refuse, `:224` lint|fix-auto|index → exempt-local):
    // it CLASSIFIES, it does not DISPATCH. The coverage test pairs this one
    // table row to both of them. `tests/contract/routes-table.test.ts` pins
    // the guard with a positive control in both directions, so a
    // classification that stops matching the handler cannot go quiet.
    dryClassification: 'stub-actions',
    handler: handleKbMaintenance,
  },
  {
    method: 'POST',
    path: '/api/studio/kbs/:id/drain/cancel',
    // MUST precede `drain/:runId`, which also matches this URL with
    // runId === 'cancel'.
    matches: (url) => m.drainCancel.test(pathOf(url)),
    dryClassification: 'exempt-local',
    handler: handleKbDrainCancel,
  },
  {
    method: 'GET',
    path: '/api/studio/kbs/:id/active-job',
    matches: (url) => m.activeJob.test(pathOf(url)),
    dryClassification: 'exempt-local',
    handler: handleKbActiveJob,
  },
  {
    method: 'GET',
    path: '/api/studio/kbs/:id/runs',
    matches: (url) => m.runs.test(pathOf(url)),
    dryClassification: 'exempt-local',
    handler: handleKbRuns,
  },
  {
    method: 'GET',
    path: '/api/studio/kbs/:id/drain/:runId',
    matches: (url) => m.drainRun.test(pathOf(url)),
    dryClassification: 'exempt-local',
    handler: handleKbDrainRun,
  },
  {
    method: 'POST',
    path: '/api/studio/kbs/:id/drain',
    matches: (url) => m.drain.test(pathOf(url)),
    dryClassification: 'exempt-local',
    handler: handleKbDrainStart,
  },
  {
    method: 'GET',
    path: '/api/studio/kbs/:id/drain',
    matches: (url) => m.drain.test(pathOf(url)),
    dryClassification: 'exempt-local',
    handler: handleKbDrainStatus,
  },
];
}
