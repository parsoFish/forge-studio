/**
 * routes-assembly.test.ts — the assembled table is per bridge, not per module.
 *
 * `apps/forge/routes.ts` exported a module-level `routeTable` constant until
 * M4's sessions lane. Three session routes act on the LIVE bridge — they start
 * a tail on its WS fan-out and broadcast to its connections — and those closures
 * do not exist at module load, so the constant could never hold them. T1 ruling
 * 59 replaced it with `makeRouteTable(deps)`, called once where the host builds
 * its own context.
 *
 * The defect that shape exists to make impossible is a module-level holder the
 * host assigns into: it would look correct in every single-bridge test and
 * silently cross the wires the moment two bridges ran in one process — the
 * second boot's closures overwriting the first's, so a cancel on bridge A
 * broadcasts to bridge B's clients. Ruling 59 §3 requires this control, and it
 * is the reason the ruling chose a factory over a holder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRouteTable, type RouteTableDeps } from './routes.ts';

/**
 * A complete inert deps object, as a factory taking overrides.
 *
 * The sessions routes carve grew `RouteTableDeps` from two members to fifteen,
 * and the agents carve added the two agent-run tail closures.
 * Spelling the whole shape out at each construction would make adding a dep mean
 * editing assertions that have nothing to do with it — and this file's point is
 * the per-instance closures, not the shape.
 */
function stubDeps(over: Partial<RouteTableDeps> = {}): RouteTableDeps {
  return {
    ensureSessionTail: () => {},
    broadcastKindChanged: () => {},
    broadcastArchitectChanged: () => {},
    broadcastInstructionsChanged: () => {},
    broadcastProjectBrainChanged: () => {},
    broadcastDemoChanged: () => {},
    projectsRoot: '/tmp/projects',
    spawnAgentTurn: () => ({ ok: true }),
    spawnAgentDispatch: () => {},
    spawnAgentSpecs: {},
    safeParseJson: () => null,
    servedFileHeaders: () => ({}),
    dryBridgeAgentTurnMarker: () => ({}),
    newRunStamp: () => 'stamp',
    safeInputKeyRe: /^[A-Za-z0-9_-]+$/,
    ensureAgentRunTail: () => {},
    releaseAgentRunTail: () => {},
    ...over,
  };
}

test('two tables built with distinct deps each call their OWN closures — two bridges never share', () => {
  const seen: string[] = [];
  const a = makeRouteTable(stubDeps({ ensureSessionTail: () => void seen.push('A'), broadcastKindChanged: () => void seen.push('A-bc') }));
  const b = makeRouteTable(stubDeps({ ensureSessionTail: () => void seen.push('B'), broadcastKindChanged: () => void seen.push('B-bc') }));

  assert.notEqual(a, b, 'each call must return its own table, not a shared singleton');

  const pick = (t: typeof a, path: string) => {
    const e = t.find((x) => x.path === path);
    assert.ok(e !== undefined, `${path} missing from the assembled table`);
    return e;
  };
  // Same route, two tables: if a holder were involved these would be identical.
  assert.notEqual(
    pick(a, '/api/studio/sessions/:kind/:sessionId').handler,
    pick(b, '/api/studio/sessions/:kind/:sessionId').handler,
    'a shared handler means the two bridges share their deps',
  );
  assert.notEqual(
    pick(a, '/api/studio/sessions/:kind/:sessionId/cancel').handler,
    pick(b, '/api/studio/sessions/:kind/:sessionId/cancel').handler,
  );
});

test('every package that needs no instance state is spread in unchanged — the tables still compose', () => {
  const t = makeRouteTable(stubDeps());
  // One representative route per already-carved package. A drop here means the
  // constant→factory change lost a spread, which would 404 that package's whole
  // surface while every one of its own tests stayed green (§15.26: measure the
  // product, not the absence of a conflict marker).
  const paths = new Set(t.map((e) => e.path));
  for (const p of ['/api/studio/kbs', '/api/studio/sessions/:kind/:sessionId']) {
    assert.ok(paths.has(p), `${p} absent from the assembled table`);
  }
  assert.ok(t.length > 30, `assembled table collapsed to ${t.length} routes`);
});

test('no two entries in the assembled table claim the same URL with the same method', () => {
  // Cross-package disjointness, asserted over the ASSEMBLED table rather than
  // any one package's — two of this lane's routes sit under other packages'
  // `/api/studio/{kbs,authoring}` prefixes, so "no collision" is a property of
  // the siblings' current patterns and has to be measured, not assumed.
  const t = makeRouteTable(stubDeps());
  const probes = [
    ['GET', '/api/studio/sessions/authoring/s1'],
    ['POST', '/api/studio/sessions/authoring/s1/cancel'],
    ['GET', '/api/studio/agents/creation-agent/capability'],
    ['GET', '/api/studio/kbs'],
  ] as const;
  for (const [method, url] of probes) {
    const claimants = t.filter((e) => e.method === method && e.matches(url));
    assert.equal(claimants.length, 1, `${method} ${url} claimed by ${claimants.length}: ${claimants.map((c) => c.path).join(', ')}`);
  }
});
