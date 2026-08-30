/**
 * `routeReady` — the deriver behind `data-page-ready`.
 *
 * Closes `forge-8vfn.5.7` at the root of the class rather than at its two
 * instances: the contract (`docs/forge-ui-dom-and-harness.md`) says a route
 * carries `data-page-ready` "once its first fetch settles", and `/library`
 * already reads that as "all five having settled, success or error". Both
 * `/projects/new` and `/architect/new` shipped a LITERAL `true` beside a fetch
 * state that disagreed with it — the `declared-data-fails-open` shape. There is
 * now one function to derive it from, and no field holding a second opinion.
 */
import { test, expect } from 'vitest';

import { routeReady } from './route-readiness';

test('a route is NOT ready while its own first fetch is still in flight', () => {
  expect(routeReady('loading')).toBe(false);
});

test('SETTLED IS NOT SUCCEEDED — an honest failure settles the route', () => {
  expect(routeReady('ok')).toBe(true);
  expect(routeReady('error')).toBe(true);
});

test('a route with several first fetches waits for the LAST one', () => {
  expect(routeReady('ok', 'loading')).toBe(false);
  expect(routeReady('loading', 'error')).toBe(false);
  expect(routeReady('ok', 'error')).toBe(true);
});

test('a route that fetches nothing is ready — the /projects/new onboarding half, before the create door was folded in', () => {
  expect(routeReady()).toBe(true);
});
