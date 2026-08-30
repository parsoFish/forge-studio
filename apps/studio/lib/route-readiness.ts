/**
 * `data-page-ready`, derived — never declared beside the fetch and hoped to
 * agree. `forge-8vfn.5.7`; the rule and the two routes that broke it are in
 * `docs/forge-ui-dom-and-harness.md`'s DOM-as-metrics section.
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
