/**
 * `data-page-ready`, derived — never declared beside the fetch and hoped to agree.
 *
 * `docs/forge-ui-dom-and-harness.md`: every route root carries
 * `data-page-ready` "once its first fetch settles". `/library` already reads
 * that correctly — it "gates on all five having settled, success or error".
 *
 * Two routes shipped a LITERAL `true` instead (`/projects/new` over its curated
 * app-type fetch, `/architect/new` and `/sessions/architect/new` over the agent
 * roster), so the sentinel said ready while `data-roster-state` on the very
 * next element said `loading` — `forge-8vfn.5.7`, the `declared-data-fails-open`
 * class reaching the DOM. The cure is structural: there is ONE deriver, its
 * input is the fetch state itself, and no field stores a second opinion.
 */

/** The lifecycle of one fetch a route waits on. `error` is a SETTLED state. */
export type FetchState = 'loading' | 'ok' | 'error';

/**
 * Has every fetch this route waits on settled?
 *
 * SETTLED IS NOT SUCCEEDED: a route whose read failed HAS settled — into an
 * honest failure it reports through `data-fetch-status="error"` — and must say
 * `data-page-ready="true"`, or automation waits forever on a page that is never
 * coming.
 */
export function routeReady(...states: readonly FetchState[]): boolean {
  return states.every((state) => state !== 'loading');
}
