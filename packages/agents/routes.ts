/**
 * routes.ts — `@forge/agents`' HTTP routes, as a table.
 *
 * M4 §4 step 2 / exit row 2. These handlers used to be inline `if` arms inside
 * `apps/forge/ui-bridge.ts`'s `handleHttp`, interleaved with two dozen other route
 * families. What moved is the dispatch; `apps/forge/routes.ts` assembles this
 * table with every other package's.
 *
 * ORDER IS THE CONTRACT, NOT A DETAIL. `dispatchRoute` is first-match-wins and
 * these patterns genuinely overlap — four colliding pairs, all pinned by
 * `tests/contract/routes-table.test.ts`:
 *   · `runs/recent` before `runs/:runId` — otherwise the detail route claims
 *     the literal `recent` as a run id and answers 200 with a 404-shaped body.
 *   · `runs/:runId/cancel` before `runs/:runId` — otherwise the detail route
 *     claims a run id of `<id>/cancel`.
 *   · both `runs/*` routes before either `:slug/*` route — `runs` would
 *     otherwise be matched as an agent slug.
 *   · `:slug/history` vs `:slug/run` — disjoint suffixes, so they cannot
 *     collide today; pinned anyway, because the thing that makes them safe is
 *     a property of the two strings, not of the table.
 * Getting any of these wrong dispatches the WRONG handler and still returns
 * 200, which no status-code assertion catches. That is why the order is pinned
 * by asserting which entry claims each colliding URL, not by reading the list.
 *
 * CSRF IS INHERITED BY DISPATCH ORDER, NOT RE-IMPLEMENTED. `apps/forge/ui-bridge.ts`'s
 * `handleHttp` applies the `x-forge-csrf` gate to every non-GET request BEFORE
 * it calls `dispatchRoute`. Neither mutating route below does its own check —
 * so a future change that moved the table's dispatch ABOVE that gate would
 * silently drop CSRF on both of them. The contract test asserts the ordering in
 * the host source; a comment cannot.
 *
 * `dryClassification` — three of the five are carried from `cli/dry-bridge.ts`
 * VERBATIM (`POST /api/agents/:id/run` `stub-actions` at :165,
 * `POST /api/agents/runs/:runId/cancel` `exempt-local` at :306). The two GETs
 * have NO row in that table and never did — it is a mutating-route manifest —
 * so they are `exempt-local` here BY CONSTRUCTION: each reads on-disk state and
 * nothing else. If either grows a spawn, this value becomes wrong and the route
 * owes a real `dry-bridge.ts` row.
 */
import { pathOnly, type RouteContext, type RouteTable } from '@forge/kernel';

import {
  handleAgentRunsRecent, handleAgentRunCancel, handleAgentRunDetail,
  type AgentRunsDeps,
} from './bridge-agents-runs.ts';
import {
  handleAgentHistory, handleAgentRunStart,
  type AgentSlugRouteDeps,
} from './bridge-agents-slug.ts';
import {
  handleStudioAgentsList, handleStudioAgentWrite,
  type AgentStudioRouteDeps,
} from './bridge-agents-studio.ts';

/**
 * Everything above this package's rank, plus the bridge instance state, bound
 * once at `apps/forge/routes.ts`. Declared as the union of the two handler
 * modules' own deps so no third list can drift from them.
 */
export type AgentsRouteDeps = AgentRunsDeps & AgentSlugRouteDeps & AgentStudioRouteDeps;

/** Matching strips the query; handlers get the RAW url and normalise for
 *  themselves, so an arm that needs the query string still has it. */
const pathOf = pathOnly;

const AGENT_SLUG_PATH = /^\/api\/studio\/agents\/([^/]+)$/;

export function agentsRoutes(deps: AgentsRouteDeps): RouteTable<RouteContext> {
  const studioAgentWrite = handleStudioAgentWrite(deps);
  return [
    {
      method: 'GET',
      path: '/api/studio/agents',
      dryClassification: 'exempt-local',
      matches: (url) => pathOf(url) === '/api/studio/agents',
      handler: handleStudioAgentsList(),
    },
    // PUT and DELETE share ONE handler: in the host they were a single
    // `if (agentMatch)` block whose first thirty lines are slug validation and
    // the `resolveGuardedPath` containment check. Two entries because
    // `dispatchRoute` filters on method; one function because duplicating a
    // containment guard to split a route is a security-invariant breach
    // (COMMON §15.47), not a smaller diff.
    {
      method: 'PUT',
      path: '/api/studio/agents/:slug',
      dryClassification: 'exempt-local',
      matches: (url) => AGENT_SLUG_PATH.test(pathOf(url)),
      handler: studioAgentWrite,
    },
    {
      method: 'DELETE',
      path: '/api/studio/agents/:slug',
      dryClassification: 'exempt-local',
      matches: (url) => AGENT_SLUG_PATH.test(pathOf(url)),
      handler: studioAgentWrite,
    },
    {
      method: 'GET',
      path: '/api/agents/runs/recent',
      dryClassification: 'exempt-local',
      matches: (url) => pathOf(url) === '/api/agents/runs/recent',
      handler: handleAgentRunsRecent(deps),
    },
    {
      method: 'POST',
      path: '/api/agents/runs/:runId/cancel',
      dryClassification: 'exempt-local',
      matches: (url) => pathOf(url).startsWith('/api/agents/runs/') && pathOf(url).endsWith('/cancel'),
      handler: handleAgentRunCancel(deps),
    },
    {
      method: 'GET',
      path: '/api/agents/runs/:runId',
      dryClassification: 'exempt-local',
      matches: (url) => pathOf(url).startsWith('/api/agents/runs/'),
      handler: handleAgentRunDetail(deps),
    },
    {
      method: 'GET',
      path: '/api/agents/:slug/history',
      dryClassification: 'exempt-local',
      matches: (url) => pathOf(url).startsWith('/api/agents/') && pathOf(url).endsWith('/history'),
      handler: handleAgentHistory(deps),
    },
    {
      method: 'POST',
      path: '/api/agents/:slug/run',
      dryClassification: 'stub-actions',
      matches: (url) => pathOf(url).startsWith('/api/agents/') && pathOf(url).endsWith('/run'),
      handler: handleAgentRunStart(deps),
    },
  ];
}
