/**
 * routes-table.test.ts — the contract for `packages/knowledge/routes.ts`.
 *
 * M4 §4 step 2 turns two monolithic prefix-dispatch handlers
 * (`handleStudioKbRoutes`, `bridge-studio-kbs.ts:1141`, 11 routes;
 * `handleStudioKbDrainRoutes`, `bridge-studio-kb-drain.ts:1473`, 6 routes)
 * into ONE declarative table that `apps/forge/routes.ts` assembles and the
 * host dispatches before its own switch.
 *
 * WHICH WRONG IMPLEMENTATION EACH TEST KILLS — an if-chain rewritten as a
 * table has exactly three ways to go quietly wrong, and every assertion here
 * exists for one of them:
 *
 *  1. A ROUTE IS DROPPED. The if-chain's arms are only visible by reading
 *     6,600 lines of host plus 3,700 lines of handler; a table makes it
 *     trivial to lose one, and a lost route 404s where it used to work with
 *     nothing red. `everyRouteIsTabled` pins the exact 17.
 *  2. ORDER IS LOST. The chain is ORDER-SENSITIVE and says so at
 *     `bridge-studio-kbs.ts:1177` ("Must be matched BEFORE
 *     /api/studio/kbs/:id (resolve-node would be captured as a kb id)").
 *     `/api/studio/kbs/<id>/drain/cancel` also matches the `drain/:runId`
 *     pattern with `runId === 'cancel'`. A table iterated in the wrong order
 *     dispatches the wrong handler and STILL RETURNS 200 — the worst shape
 *     there is. `orderSensitivePairs` pins each collision by dispatching the
 *     colliding URL and asserting WHICH entry claims it.
 *  3. A ROUTE LOSES ITS DRY CLASSIFICATION. `cli/dry-bridge.ts` classifies
 *     every mutating route so `FORGE_DRY_BRIDGE=1` can refuse or stub it;
 *     `dry-bridge-coverage.test.ts` counts the tabled routes. A carved route
 *     whose `dryClassification` is dropped becomes a route that SPAWNS under
 *     a dry bridge. `everyEntryCarriesADryClassification` pins that.
 *
 * This file is added to `_1.0/gate-manifests/M4-knowledge.txt` while it is
 * RED, never after it goes green.
 */
import { refusingSessionStatusIo } from '../test-fixtures/session-status-io.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { knowledgeRoutes } from '../../routes.ts';

/**
 * `knowledgeRoutes` is a factory (M4-knowledge s5): `listFlowIds` is the
 * Flow-kind loader in the legacy registry, which a rank-2 package may not
 * import, so the host supplies it. These stubs are deliberately NOT the real
 * loaders — a table test asserts on the table's shape, and a dispatch test on
 * a handler's response; neither should depend on what flows exist on disk.
 */
const routes = knowledgeRoutes({
  sessionStatusIo: refusingSessionStatusIo,
  listFlowIds: () => ['forge-develop'],
  listFlowBandIds: () => ['review-band', 'demo-band'],
  // M4 ruling 86: the real fix turn is injected by the assembly, so route
  // tests declare one. It THROWS: no assertion in this file expects a fix turn
  // to be dispatched, and a stub that returned a plausible result would let a
  // future change dispatch one here unnoticed.
  runFixTurn: async () => {
    throw new Error('unexpected brain-fix dispatch in this test');
  },
});

/** The 17 routes the two handlers dispatch at the pin (161c5abb), in the
 *  order their if-chains match them. Derived by reading every `url.match(…)`
 *  / `url === …` arm in both files, not from prose:
 *    bridge-studio-kbs.ts     :1156 :1178 :1214 :1266 :1337 :1553 :1625
 *                              :1753 :1783 :1809 :1842
 *    bridge-studio-kb-drain.ts:1490 :1544 :1565 :1582 :1607 :1676          */
const PINNED: ReadonlyArray<readonly [string, string]> = [
  ['GET', '/api/studio/kbs'],
  ['GET', '/api/studio/kbs/resolve-node/:nodeId'],
  ['GET', '/api/studio/kbs/:id/nodes/:nodeId'],
  ['GET', '/api/studio/kbs/:id'],
  ['POST', '/api/studio/kbs'],
  ['DELETE', '/api/studio/kbs/:id'],
  ['POST', '/api/studio/kbs/:id/guidance'],
  ['GET', '/api/studio/kbs/:id/fix-agent/:runId'],
  ['GET', '/api/studio/kbs/:id/consolidate/active'],
  ['GET', '/api/studio/kbs/:id/ingest-activity'],
  ['POST', '/api/studio/kbs/:id/maintenance'],
  ['POST', '/api/studio/kbs/:id/drain/cancel'],
  ['GET', '/api/studio/kbs/:id/active-job'],
  ['GET', '/api/studio/kbs/:id/runs'],
  ['GET', '/api/studio/kbs/:id/drain/:runId'],
  ['POST', '/api/studio/kbs/:id/drain'],
  ['GET', '/api/studio/kbs/:id/drain'],
];

/**
 * CARVED — now all seventeen. The seam landed in two PRs, deliberately: the
 * mechanism plus `bridge-studio-kb-drain.ts`'s 6 routes first (they carry the
 * sharpest ordering collision, `drain/cancel` vs `drain/:runId`, so they
 * proved the table end-to-end), then `bridge-studio-kbs.ts`'s 11 in the PR
 * that split that 2,068-line file five ways under the 800-line cap —
 * extracting 11 arms from a file that is simultaneously being broken up is
 * one rewrite, not two.
 *
 * This list GREW to equal PINNED, which is the point: the table must equal
 * CARVED exactly, and CARVED must be a subset of the 17 the if-chains
 * dispatched at the pin. A route that leaves the if-chain without arriving in
 * the table fails both. Now that the two sets are equal, a future route that
 * is added to one and not the other still fails — the assertions are not
 * weakened by having converged.
 */
const CARVED: ReadonlySet<string> = new Set([
  'GET /api/studio/kbs',
  'GET /api/studio/kbs/resolve-node/:nodeId',
  'GET /api/studio/kbs/:id/nodes/:nodeId',
  'GET /api/studio/kbs/:id',
  'POST /api/studio/kbs',
  'DELETE /api/studio/kbs/:id',
  'POST /api/studio/kbs/:id/guidance',
  'GET /api/studio/kbs/:id/fix-agent/:runId',
  'GET /api/studio/kbs/:id/consolidate/active',
  'GET /api/studio/kbs/:id/ingest-activity',
  'POST /api/studio/kbs/:id/maintenance',
  'POST /api/studio/kbs/:id/drain/cancel',
  'GET /api/studio/kbs/:id/active-job',
  'GET /api/studio/kbs/:id/runs',
  'GET /api/studio/kbs/:id/drain/:runId',
  'POST /api/studio/kbs/:id/drain',
  'GET /api/studio/kbs/:id/drain',
]);

const key = (m: string, p: string) => `${m} ${p}`;

test('routes-table: the table holds exactly the routes carved so far — no route silently dropped, none invented', () => {
  const got = routes.map((r) => key(r.method, r.path)).sort();
  const want = [...CARVED].sort();
  assert.deepEqual(got, want,
    `the carved table must dispatch exactly what left the if-chains.\n` +
    `  missing (route would 404 where it used to work): ${want.filter((w) => !got.includes(w)).join(', ') || 'none'}\n` +
    `  extra   (route the host never served):           ${got.filter((g) => !want.includes(g)).join(', ') || 'none'}`);
});

test('routes-table: every carved route is one the if-chains actually dispatched at the pin — the table cannot invent a route the host never served', () => {
  const pinned = new Set(PINNED.map(([m, p]) => key(m, p)));
  const invented = [...CARVED].filter((c) => !pinned.has(c));
  assert.deepEqual(invented, [], `carved routes with no pre-carve counterpart: ${invented.join(', ')}`);
});

test('routes-table: no two entries share a method+path — a duplicate silently shadows whichever loses the iteration', () => {
  const seen = new Map<string, number>();
  for (const r of routes) seen.set(key(r.method, r.path), (seen.get(key(r.method, r.path)) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(dupes, [], `duplicate table entries: ${dupes.join(', ')}`);
});

test('routes-table: every entry carries a dryClassification — a carved route that loses it is a route that SPAWNS under FORGE_DRY_BRIDGE=1', () => {
  const missing = routes.filter((r) => !r.dryClassification).map((r) => key(r.method, r.path));
  assert.deepEqual(missing, [], `entries with no dryClassification: ${missing.join(', ')}`);
});

/**
 * The ONE classification in this table that is a judgement rather than a copy.
 *
 * `POST …/maintenance` carries five ops behind one URL, discriminated by a
 * BODY field. T1 ruling 29 scoped the two-row split to MATCHER-VISIBLE
 * discriminators (path · method · query) and left this route ONE row, valued
 * `stub-actions` — the manifest's own word (`cli/dry-bridge.ts:44`) for a
 * route that proceeds with its local bookkeeping and skips the real-acting
 * steps.
 *
 * Asserting the string alone would be worth nothing: it is a claim ABOUT the
 * handler, and a claim about a handler that the handler cannot falsify is the
 * declared-data-fails-open shape this campaign exists to kill. The claim's
 * POSITIVE CONTROL lives in `tests/integration/routes-dispatch.test.ts`
 * ('dry-bridge positive control'), which drives the real handler under
 * `FORGE_DRY_BRIDGE=1` and proves BOTH directions: `op=fix-agent` refused 409,
 * `op=lint` not refused. This assertion pins the string; that one pins the
 * behaviour the string describes. Neither is sufficient alone.
 */
test('routes-table: the maintenance route is ONE row valued stub-actions — five ops behind one URL, discriminated by a body field a url matcher cannot read (ruling 29)', () => {
  const rows = routes.filter((r) => r.path === '/api/studio/kbs/:id/maintenance');
  assert.equal(rows.length, 1,
    `the maintenance route must be ONE table entry, not one per op: \`RouteEntry.matches\` is ` +
    `(url) => boolean and \`op\` arrives in the request body, which is a consumable stream. ` +
    `Got ${rows.length} rows: ${rows.map((r) => key(r.method, r.path)).join(', ')}`);
  assert.equal(rows[0].dryClassification, 'stub-actions',
    `the maintenance row must be classified stub-actions, not refuse: under FORGE_DRY_BRIDGE=1 the ` +
    `handler refuses only \`op=fix-agent\` (the one op that spawns) and lets lint | fix-auto | index ` +
    `proceed, with consolidate's agent turn suppressed through the same seam. \`refuse\` would cost ` +
    `harness runs three ops they have today; \`exempt-local\` would mis-describe the spawn case.`);
});

test('routes-table: cli/dry-bridge.ts KEEPS its two op-scoped maintenance rows — it classifies, it does not dispatch, so the finer grain is not the table\'s to flatten', () => {
  const manifest = readFileSync(new URL('../../../../apps/forge/dry-bridge.ts', import.meta.url), 'utf8');
  for (const row of ['/api/studio/kbs/:id/maintenance (op=fix-agent)',
                     '/api/studio/kbs/:id/maintenance (op=lint|fix-auto|index)']) {
    assert.ok(manifest.includes(row),
      `cli/dry-bridge.ts lost its \`${row}\` row. Ruling 29 (ii): the ONE table row and the TWO ` +
      `manifest rows are not in tension — the manifest classifies per op, the table dispatches per ` +
      `URL, and \`dry-bridge-coverage.test.ts\` pairs the one to both. Flattening the manifest to ` +
      `match the table would throw away the finer classification for nothing.`);
  }
});

test('routes-table: every entry has a callable handler — a table of metadata with a missing handler 500s at request time, not at load time', () => {
  const bad = routes.filter((r) => typeof r.handler !== 'function').map((r) => key(r.method, r.path));
  assert.deepEqual(bad, [], `entries with no callable handler: ${bad.join(', ')}`);
});

/**
 * ORDER SENSITIVITY — the assertions that matter most.
 *
 * Each pair is [colliding URL, method, the path that MUST claim it]. Both
 * arms genuinely match the URL; only order (or a method guard) decides. A
 * table that reorders them returns 200 from the WRONG handler, which no
 * status-code assertion anywhere else would catch.
 */
const COLLISIONS: ReadonlyArray<readonly [string, string, string]> = [
  // `drain/cancel` also matches `drain/:runId` with runId === 'cancel'.
  ['/api/studio/kbs/story-s6/drain/cancel', 'POST', '/api/studio/kbs/:id/drain/cancel'],
  // `resolve-node/:nodeId` sits under the `kbs/` prefix the `:id` arms own;
  // bridge-studio-kbs.ts:1177 records the hazard in the source itself.
  ['/api/studio/kbs/resolve-node/some-node', 'GET', '/api/studio/kbs/resolve-node/:nodeId'],
  // THE COLLISION NOTHING PINNED UNTIL PR 4b. `isReservedId` blocks only
  // 'new', so a KB can legally be created with the id `resolve-node`. Its own
  // node article URL — `/api/studio/kbs/resolve-node/nodes/<x>` — then matches
  // BOTH the `resolve-node/:nodeId` arm (whose tail is `(.+)`, so it swallows
  // `nodes/<x>` slash and all) AND the `:id/nodes/:nodeId` arm. `resolve-node`
  // wins, exactly as it did in the if-chain, and answers 400 because its
  // `NODE_ID_RE` rejects the `/`. So the STATUS is defensible and the CLAIMANT
  // is wrong-by-design — which is why an assertion is the only thing that can
  // hold it: the pre-existing entry below covers only the 2-segment shape, and
  // a table reordered to put `:id/nodes/:nodeId` first would turn this 400
  // into a 200 from a different handler with nothing red.
  ['/api/studio/kbs/resolve-node/nodes/some-node', 'GET', '/api/studio/kbs/resolve-node/:nodeId'],
  // `consolidate/active` must not be read as a node/run tail.
  ['/api/studio/kbs/cycles/consolidate/active', 'GET', '/api/studio/kbs/:id/consolidate/active'],
  // the bare `:id` arms must still claim a plain id.
  ['/api/studio/kbs/cycles', 'GET', '/api/studio/kbs/:id'],
  ['/api/studio/kbs/cycles', 'DELETE', '/api/studio/kbs/:id'],
  // `drain` bare vs `drain/:runId`.
  ['/api/studio/kbs/cycles/drain', 'GET', '/api/studio/kbs/:id/drain'],
  ['/api/studio/kbs/mtc/drain/mtc-drain-abc', 'GET', '/api/studio/kbs/:id/drain/:runId'],
];

test('routes-table: order is load-bearing — each colliding URL is claimed by the entry the if-chain claimed it with, not by a later arm that also matches', () => {
  for (const [url, method, expected] of COLLISIONS) {
    if (!CARVED.has(key(method, expected))) continue; // not carved yet — still the if-chain's
    const claimant = routes.find((r) => r.method === method && r.matches(url));
    assert.ok(claimant, `no table entry claims ${method} ${url} — the route is unreachable`);
    assert.equal(claimant.path, expected,
      `${method} ${url} must be claimed by "${expected}", not "${claimant.path}". ` +
      `Both patterns match this URL; the if-chain's order decided, and the table must preserve it. ` +
      `Dispatching the wrong handler here returns 200 from the wrong code path — no status assertion catches it.`);
  }
});
