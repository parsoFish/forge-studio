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
 * CARVED SO FAR: the six `bridge-studio-kb-drain.ts` routes. The eleven
 * `bridge-studio-kbs.ts` routes follow in the PR that splits that 2,068-line
 * file under the 800-line cap — extracting eleven arms from a file that is
 * simultaneously being broken up is one rewrite, not two. Until then
 * `cli/ui-bridge.ts` keeps its single `handleStudioKbRoutes` delegation, and
 * the contract test's `CARVED` set records exactly which routes have made the
 * trip so that "carved" and "lost" can never be confused.
 *
 * `dryClassification` — two provenances, stated separately because they are
 * NOT the same kind of claim:
 *   · The two POSTs are carried from `cli/dry-bridge.ts` VERBATIM:
 *     `:233` `POST /api/studio/kbs/:id/drain` and `:235`
 *     `POST /api/studio/kbs/:id/drain/cancel`, both `exempt-local` there.
 *   · The four GETs are NOT in that table and never were — it is a
 *     mutating-route table (70 `POST` rows against 2 `GET`). They are
 *     `exempt-local` here by CONSTRUCTION, not by lookup: each reads on-disk
 *     drain state and nothing else — no spawn, no remote call, no write — so
 *     running them for real under a dry bridge is safe. If one ever grows a
 *     spawn, this value becomes wrong and the route must gain a real
 *     `dry-bridge.ts` row.
 * The field is non-optional in `RouteEntry` because a carved route that lost
 * its classification would be a route that SPAWNS under `FORGE_DRY_BRIDGE=1`;
 * the contract test asserts every entry carries one.
 */
import { pathOnly, type RouteTable, type StudioContext } from '@forge/kernel';

import {
  handleKbDrainCancel,
  handleKbActiveJob,
  handleKbRuns,
  handleKbDrainRun,
  handleKbDrainStart,
  handleKbDrainStatus,
} from './kb-drain-routes.ts';

/**
 * The context these handlers receive. `StudioContext` moved to `@forge/kernel`
 * with the rest of the HTTP envelope (T1 ruling on PARK 2), so this is now a
 * re-export rather than the structural duplicate it had to be while the type
 * still lived in `cli/bridge-studio.ts`.
 */
export type KnowledgeRouteContext = StudioContext;

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
  drainCancel: new RegExp(`^${KB}/([^/]+)/drain/cancel$`),
  activeJob: new RegExp(`^${KB}/([^/]+)/active-job$`),
  runs: new RegExp(`^${KB}/([^/]+)/runs$`),
  drainRun: new RegExp(`^${KB}/([^/]+)/drain/([^/]+)$`),
  drain: new RegExp(`^${KB}/([^/]+)/drain$`),
} as const;

/**
 * Ordered, first-match-wins. The order below is the order
 * `handleStudioKbDrainRoutes` matched these arms in at `161c5abb`
 * (`bridge-studio-kb-drain.ts` :1490 :1544 :1565 :1582 :1607 :1676).
 */
export const knowledgeRoutes: RouteTable<KnowledgeRouteContext> = [
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
