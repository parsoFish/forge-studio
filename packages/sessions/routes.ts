/**
 * routes.ts — this package's `/api/*` routes, as an ordered table.
 *
 * M4 §4 step 2. The table is a FACTORY rather than a constant because three of
 * these routes act on the LIVE BRIDGE — they start a tail on its WS fan-out and
 * broadcast to its connections — and those are per-instance values that do not
 * exist at module load. T1 ruling 59 settles the shape: `apps/forge/routes.ts`
 * exports `makeRouteTable(deps)` and the host calls it once, when it builds its
 * own context. Nothing about `RouteContext` or `dispatchRoute` changes, so no
 * other package's table or contract test moves.
 *
 * The alternative — widening the shared `RouteContext` with these hooks, the way
 * ruling 30 added `readBody` — was rejected deliberately. `readBody` is request
 * policy every route may need; `ensureSessionTail` is one package's vocabulary,
 * and the seam exists to keep that out of the context every package receives.
 *
 * ORDER is part of the contract: `dispatchRoute` is first-match-wins, and
 * `tests/contract/routes-table.test.ts` pins which entry claims each colliding
 * URL rather than merely asserting both exist.
 */
import type { RouteContext, RouteTable } from '@forge/kernel';
import { pathOnly } from '@forge/kernel';
import { handleStudioSessionsRoutes } from './bridge-studio-sessions.ts';
import { handleSessionCancelRoute } from './bridge-studio-session-cancel.ts';
import { handleStudioAgentCapabilityRoute } from './bridge-studio-agent-capability.ts';

/**
 * The bridge-instance state these routes need, declared HERE (ruling 59 §2) so
 * sessions vocabulary never enters `@forge/kernel` or another package. The host
 * supplies the real closures at assembly; the composition of every package's
 * deps type is `apps/forge/routes.ts`'s parameter.
 */
export type SessionsRouteDeps = {
  /** Idempotently start live-tailing a session kind's event log on this
   *  bridge's WS fan-out. A host effect: there is nothing to derive it from. */
  readonly ensureSessionTail: (kind: string, sessionId: string) => void;
  /** Broadcast the per-kind `*-list-changed` WS message after a mutation, so an
   *  open bespoke panel refetches without waiting for its poll. A kind with no
   *  such message in the bridge's vocabulary honestly no-ops. */
  readonly broadcastKindChanged: (kind: string) => void;
};

/** Matching strips the query; handlers receive the RAW url and normalise for
 *  themselves, so an arm that later needs the query string still has it. */
const pathOf = pathOnly;

/**
 * Route literals live here (ruling 59 §6) so `dry-bridge-coverage`'s pairing
 * keeps working, and the matchers are the regexes of the arms they replace —
 * copied, not re-derived, because re-specifying a hand-written matcher during a
 * move is how a carve changes behaviour while every test stays green.
 */
const SESSION_READ_RE = /^\/api\/studio\/sessions\/([^/]+)\/([^/]+)$/;
const SESSION_CANCEL_RE = /^\/api\/studio\/sessions\/([^/]+)\/([^/]+)\/cancel$/;
const AGENT_CAPABILITY_RE = /^\/api\/studio\/agents\/([^/]+)\/capability$/;

export function sessionsRoutes(deps: SessionsRouteDeps): RouteTable<RouteContext> {
  return [
    {
      method: 'GET',
      path: '/api/studio/sessions/:kind/:sessionId',
      matches: (url) => SESSION_READ_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: (req, res, ctx, url, method) =>
        handleStudioSessionsRoutes(
          req,
          res,
          { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot, ensureSessionTail: deps.ensureSessionTail },
          url,
          method,
        ),
    },
    {
      // MUST precede any three-segment matcher for this URL family. The
      // affordance route's regex is a bare `([^/]+)/([^/]+)/([^/]+)` and would
      // swallow the literal `cancel` as an affordance id, answering 409 with a
      // 200-shaped body — the wrong handler returning a plausible answer, which
      // is the carve defect that leaves nothing red. That route is still a host
      // arm, and the table is dispatched BEFORE the host's chain, so ordering
      // holds today; the contract test pins it against the ASSEMBLED table so it
      // keeps holding when the affordance route joins this one.
      method: 'POST',
      path: '/api/studio/sessions/:kind/:sessionId/cancel',
      matches: (url) => SESSION_CANCEL_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: (req, res, ctx, url, method) =>
        handleSessionCancelRoute(
          req,
          res,
          { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot, broadcastKindChanged: deps.broadcastKindChanged },
          url,
          method,
        ),
    },
    {
      method: 'GET',
      path: '/api/studio/agents/:slug/capability',
      matches: (url) => AGENT_CAPABILITY_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: (req, res, ctx, url, method) =>
        handleStudioAgentCapabilityRoute(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method),
    },
  ];
}
