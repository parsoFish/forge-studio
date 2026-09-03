/**
 * The agents route table's contract: ORDER, and the two things order alone
 * cannot express.
 *
 * `dispatchRoute` is first-match-wins, and these patterns genuinely overlap.
 * Getting the order wrong dispatches the WRONG handler and still returns 200 —
 * no status-code assertion anywhere catches that — so each colliding URL is
 * pinned to the entry that must claim it, by asking the table itself rather
 * than by reading the list.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { FORGE_ROOT } from '@forge/kernel';
import { agentsRoutes, type AgentsRouteDeps } from '../../routes.ts';

/** Inert deps: this file asks the table WHICH entry claims a URL, never runs one. */
const deps = new Proxy({}, { get: () => () => undefined }) as unknown as AgentsRouteDeps;
const table = agentsRoutes(deps);

/** The first entry that would claim `url` for `method` — dispatchRoute's own rule. */
function claimedBy(method: string, url: string): string | null {
  for (const e of table) {
    if (e.method !== method) continue;
    if (e.matches(url)) return e.path;
  }
  return null;
}

test('contract: the table carries exactly the eight carved routes, each family in the order its if-chain matched them', () => {
  assert.deepEqual(table.map((e) => `${e.method} ${e.path}`), [
    'GET /api/studio/agents',
    'PUT /api/studio/agents/:slug',
    'DELETE /api/studio/agents/:slug',
    'GET /api/agents/runs/recent',
    'POST /api/agents/runs/:runId/cancel',
    'GET /api/agents/runs/:runId',
    'GET /api/agents/:slug/history',
    'POST /api/agents/:slug/run',
  ]);
});

test('contract: the two families are PREFIX-DISJOINT — which is what makes the order BETWEEN them not load-bearing', () => {
  // Within a family the order is a real contract (the four collisions below).
  // Across families it is not, and this is the assertion that earns that claim
  // rather than assuming it: no `/api/studio/agents*` URL is claimed by an
  // `/api/agents/*` entry, and no `/api/agents/*` URL by a studio entry.
  const studio = (p: string) => p.startsWith('/api/studio/agents');
  for (const url of ['/api/studio/agents', '/api/studio/agents/demo-agent']) {
    for (const m of ['GET', 'PUT', 'DELETE', 'POST']) {
      const claimed = claimedBy(m, url);
      assert.ok(claimed === null || studio(claimed), `${m} ${url} was claimed by ${claimed}`);
    }
  }
  for (const url of ['/api/agents/runs/recent', '/api/agents/runs/_agent-1', '/api/agents/x/history', '/api/agents/x/run']) {
    for (const m of ['GET', 'POST']) {
      const claimed = claimedBy(m, url);
      assert.ok(claimed === null || !studio(claimed), `${m} ${url} was claimed by ${claimed}`);
    }
  }
});

test('contract: COLLISION 1 — `runs/recent` is claimed by the recent route, never by the run-detail route', () => {
  assert.equal(claimedBy('GET', '/api/agents/runs/recent'), '/api/agents/runs/recent');
  assert.equal(claimedBy('GET', '/api/agents/runs/recent?limit=5&kind=flow'), '/api/agents/runs/recent',
    'the query string must not change which entry claims the path (each handler calls pathOnly itself)');
});

test('contract: COLLISION 2 — `runs/<id>/cancel` is claimed by the cancel route, never by run-detail', () => {
  assert.equal(claimedBy('POST', '/api/agents/runs/_agent-x-123/cancel'), '/api/agents/runs/:runId/cancel');
  // …and the detail route WOULD have claimed it, which is what makes the order load-bearing.
  assert.equal(claimedBy('GET', '/api/agents/runs/_agent-x-123/cancel'), '/api/agents/runs/:runId',
    'a GET on the cancel URL falls to run-detail — proving the two are separated by METHOD as well as order');
});

test('contract: COLLISION 3 — a real run id is claimed by run-detail, and `runs` is never read as an agent slug', () => {
  assert.equal(claimedBy('GET', '/api/agents/runs/_agent-demo-1'), '/api/agents/runs/:runId');
  assert.equal(claimedBy('GET', '/api/agents/runs/_agent-demo-1/history'), '/api/agents/runs/:runId',
    'both `runs/*` entries precede both `:slug/*` entries, so a history-suffixed run id stays a run');
});

test('contract: COLLISION 4 — `:slug/history` and `:slug/run` are disjoint suffixes, pinned anyway', () => {
  assert.equal(claimedBy('GET', '/api/agents/demo-agent/history'), '/api/agents/:slug/history');
  assert.equal(claimedBy('POST', '/api/agents/demo-agent/run'), '/api/agents/:slug/run');
  assert.equal(claimedBy('GET', '/api/agents/demo-agent/run'), null, 'the run route is POST-only');
});

test('contract: PUT and DELETE /api/studio/agents/:slug share ONE handler — the containment guard is not duplicated to split a route', () => {
  const put = table.find((e) => e.method === 'PUT' && e.path === '/api/studio/agents/:slug');
  const del = table.find((e) => e.method === 'DELETE' && e.path === '/api/studio/agents/:slug');
  assert.ok(put && del, 'both entries must exist');
  assert.equal(put.handler, del.handler,
    'they must be the SAME function reference. In the host these were one `if (agentMatch)` block whose first thirty ' +
    'lines are slug validation and the resolveGuardedPath containment check; two independent handlers would mean two ' +
    'copies of that guard, which is a security-invariant breach (COMMON §15.47), not a smaller diff.');
});

test('contract: the roster list and the per-slug writes do not collide', () => {
  assert.equal(claimedBy('GET', '/api/studio/agents'), '/api/studio/agents');
  assert.equal(claimedBy('PUT', '/api/studio/agents/demo-agent'), '/api/studio/agents/:slug');
  assert.equal(claimedBy('DELETE', '/api/studio/agents/demo-agent'), '/api/studio/agents/:slug');
  assert.equal(claimedBy('PUT', '/api/studio/agents'), null,
    'the write matcher requires a slug segment, so the bare roster path is never claimed by it');
  assert.equal(claimedBy('GET', '/api/studio/agents/demo-agent'), null,
    'there is no GET on a single agent — the roster serves the list and nothing claims the per-slug GET');
});

test('contract: every entry carries a dry classification — a carved route that lost one would SPAWN under FORGE_DRY_BRIDGE=1', () => {
  for (const e of table) {
    assert.ok(e.dryClassification, `${e.method} ${e.path} carries no dryClassification`);
  }
});

/**
 * T1's condition on this carve, and the reason it is a test rather than a
 * comment: the `x-forge-csrf` gate lives ONCE in `handleHttp`, and the carved
 * table inherits it by being dispatched AFTER it. Nothing in the two mutating
 * handlers checks CSRF for itself. So a future edit that moved `dispatchRoute`
 * above that gate would silently drop CSRF on `POST /api/agents/:slug/run` and
 * `POST /api/agents/runs/:runId/cancel` — with every test still green.
 */
test('contract (HOST ORDERING): the carved table is dispatched AFTER handleHttp applies the CSRF gate', () => {
  const host = readFileSync(join(FORGE_ROOT, 'cli', 'ui-bridge.ts'), 'utf8');
  const csrfAt = host.indexOf('missing or invalid CSRF header');
  const dispatchAt = host.indexOf('dispatchRoute(ctx.routeTable');
  assert.ok(csrfAt > 0, 'the CSRF refusal must still exist in cli/ui-bridge.ts');
  assert.ok(dispatchAt > 0, 'the route-table dispatch must still exist in cli/ui-bridge.ts');
  assert.ok(
    csrfAt < dispatchAt,
    'cli/ui-bridge.ts dispatches the carved route table BEFORE its CSRF gate — every mutating carved route is ' +
    'now reachable without the header. The gate is applied once in handleHttp and the table inherits it by ' +
    'ORDER; there is no per-handler check to fall back on.',
  );
});
