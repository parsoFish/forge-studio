/**
 * route-entry.ts — the one shape every package's HTTP route table declares.
 *
 * M4 §4 step 2: each package's `/api/*` handlers leave the bridge monoliths
 * (`apps/forge/ui-bridge.ts` and its `bridge-studio*` siblings) and become a table in
 * `packages/<pkg>/routes.ts`. `apps/forge/routes.ts` is the host-owned
 * assembly — one `import` and one spread per package, the only line another
 * lane adds. The host dispatches the assembled table BEFORE its own remaining
 * switch, so a tabled route always wins over a legacy arm of the same shape.
 *
 * This type is the contract between six package lanes and one host, so its
 * two least obvious properties are stated here rather than discovered:
 *
 * ORDER IS PART OF THE CONTRACT. The if-chains this replaces are ordered, and
 * some of their arms genuinely overlap: `/api/studio/kbs/<id>/drain/cancel`
 * also matches the `drain/:runId` pattern with `runId === 'cancel'`, and
 * `bridge-studio-kbs.ts` carries the comment "Must be matched BEFORE
 * /api/studio/kbs/:id (resolve-node would be captured as a kb id)". A table
 * is therefore an ORDERED sequence, dispatched first-match-wins, and a
 * package that reorders its own entries changes behaviour. Reordering
 * dispatches a different handler and still returns 200 — no status assertion
 * catches it — so each package's route-table contract test pins its own
 * colliding pairs by asserting WHICH entry claims a colliding URL.
 *
 * `dryClassification` IS NOT DECORATION. `cli/dry-bridge.ts` classifies every
 * route so `FORGE_DRY_BRIDGE=1` can refuse or stub the ones that spawn, and
 * `apps/forge/dry-bridge-coverage.test.ts` counts them. An entry that loses its
 * classification in the carve is a route that SPAWNS under a dry bridge. The
 * field is non-optional for exactly that reason: the type will not let a lane
 * forget it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { StudioContext } from './http-envelope.ts';

/**
 * How `cli/dry-bridge.ts` treats this route when `FORGE_DRY_BRIDGE=1`.
 *
 * The vocabulary is the dry bridge's own, carried here unchanged so a carved
 * entry and its dry-table row cannot drift into two different words for the
 * same decision:
 *   · `refuse`       — the route spawns an agent; a dry bridge must not run it.
 *   · `stub-actions` — the route spawns via a helper; the dry bridge answers
 *                      with a stubbed action set instead of spawning.
 *   · `exempt-local` — local filesystem work only, no spawn and no remote
 *                      call; safe to run for real under a dry bridge.
 */
export type DryClassification = 'refuse' | 'stub-actions' | 'exempt-local';

/** The HTTP methods the bridge dispatches. */
export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * One route, owned by one package.
 *
 * `handler` keeps the bridge's established contract: it returns `true` when it
 * has answered the request (headers sent) and `false` when it has not, so the
 * host can fall through to its remaining switch. A handler that answers and
 * returns `false` sends the response twice; one that declines and returns
 * `true` produces a silent hang. Both are the kind of fail-open this campaign
 * names, and both are caught by driving the handler directly in a package
 * test rather than through a booted bridge.
 */
/**
 * The context a carved route handler receives, plus the one thing the envelope
 * deliberately does not provide.
 *
 * `http-envelope.ts` states its scope: "Body parsing, CSRF and the route
 * dispatch stay with the host: they are policy about a *request*, not the
 * shape of a *response*, and the host is the single place that policy is
 * applied." That is right, and it left `RouteEntry` unable to express a
 * MUTATING carved route: a handler needing a body had to import `readJson`
 * from `apps/forge/bridge-studio.ts`, re-adding the exact `package-to-legacy` row the
 * envelope move existed to remove. The knowledge lane did not meet this — both
 * its carved POSTs take everything from the URL — and the library lane, whose
 * routes are almost entirely writes, met it immediately.
 *
 * `readBody` resolves it WITHOUT widening the envelope's scope: the host still
 * owns the policy — it applies the CSRF check before dispatch and decides how
 * a body is read and bounded — and hands the RESULT down. The handler consumes
 * a value; it does not acquire a policy.
 *
 * T1 ruling 30 (M4). Additive: a table whose handlers ignore `readBody` is
 * unaffected, which is why `knowledgeRoutes` slots into the assembled table
 * unchanged — a handler accepting the narrower `StudioContext` is assignable
 * where one accepting `RouteContext` is expected.
 */
export type RouteContext = StudioContext & {
  /** Read and parse this request's body. Supplied by the host, which has
   *  already applied the CSRF and transport policy the envelope's scope note
   *  keeps there. Called at most once per request by convention; a handler
   *  that does not need a body never calls it. */
  readonly readBody: () => Promise<unknown>;
};

export type RouteEntry<Ctx = unknown> = {
  readonly method: RouteMethod;
  /**
   * The route's pattern in `:param` form — `/api/studio/kbs/:id/drain`.
   * This string is the entry's identity: it is what a contract test pins,
   * what a PR body cites, and what must also appear in `cli/dry-bridge.ts`'s
   * table so the two stay in step.
   */
  readonly path: string;
  /**
   * Does this entry claim `url` (path only, query already stripped)?
   *
   * A predicate rather than a derived matcher because the patterns being
   * carved are existing hand-written regexes with behaviour worth preserving
   * exactly; deriving a matcher from `path` would quietly re-specify them.
   */
  readonly matches: (url: string) => boolean;
  readonly dryClassification: DryClassification;
  readonly handler: (
    req: IncomingMessage,
    res: ServerResponse,
    ctx: Ctx,
    url: string,
    method: string,
  ) => Promise<boolean> | boolean;
};

/** A package's ordered route table. Order is first-match-wins; see above. */
export type RouteTable<Ctx = unknown> = readonly RouteEntry<Ctx>[];

/**
 * First-match-wins dispatch over an assembled table.
 *
 * Returns `true` iff an entry claimed the request AND answered it. An entry
 * that matches but returns `false` has declined, and dispatch continues to the
 * next entry — mirroring the if-chains, where a non-answering arm falls
 * through to the next `if`.
 */
export async function dispatchRoute<Ctx>(
  table: RouteTable<Ctx>,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Ctx,
  url: string,
  method: string,
): Promise<boolean> {
  for (const entry of table) {
    if (entry.method !== method) continue;
    if (!entry.matches(url)) continue;
    if (await entry.handler(req, res, ctx, url, method)) return true;
  }
  return false;
}
