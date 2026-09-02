/**
 * routes-table.test.ts — the contract for `packages/projects/routes.ts`.
 *
 * M4 §4 step 2 (projects routes carve, assembly pass). Modelled on
 * `packages/knowledge/tests/contract/routes-table.test.ts`: it asserts on the
 * TABLE ITSELF (`projectsRoutes(deps)`'s return value), never by booting a
 * server — a wrong dispatch order still returns 200 from the wrong handler,
 * which no status-code assertion anywhere else would catch, so every
 * assertion here pins the table's shape directly.
 *
 * WHAT EACH TEST PINS, AND WHY (the five things the task brief named):
 *
 *  1. WHICH ENTRY CLAIMS `POST /api/studio/projects/create` — the ordering
 *     pin. The generic `:id` pattern (`^/api/studio/projects/([^/]+)$`)
 *     genuinely matches the literal `create` as an id, and nothing in
 *     `RESERVED_OBJECT_IDS` reserves that string — so `create`'s row MUST
 *     precede the `:id` rows or a project literally id'd `create` becomes
 *     permanently un-updatable via POST, still a 200. Written so swapping the
 *     two rows in the table's array literal makes this test fail.
 *  2. EVERY METHOD `handleProjectPut` ANSWERS. The original handler's own
 *     gate is `if (!(projectMatch && method !== 'DELETE')) return false;` —
 *     PUT and POST both reach it, DELETE never does. `RouteEntry.method` is
 *     singular, so the table carries TWO rows sharing one handler reference;
 *     this test proves both exist and that DELETE matches neither.
 *  3. THE SINGLE `fix-agent` ROW, its `stub-actions` classification, AND WHY
 *     no split exists — pinned as a single-row COUNT (so a later reader
 *     cannot read "one row" as an oversight rather than a decision) plus the
 *     classification value, with the reason (T1 rulings 27/29: the route's
 *     real discriminator is server/body state — the preflight report's
 *     clause-resolution tier — which a `matches: (url) => boolean` predicate
 *     structurally cannot read) recorded in the assertion message itself.
 *  4. THE RAW-URL GOTCHA. Every row's `matches` predicate must accept its own
 *     path with a query string appended (`?x=1`) — handlers receive the RAW
 *     url, query string intact, and a `matches` that broke on a query string
 *     would silently 404 every request the browser sends with one.
 *  5. THE FULL ROUTE INVENTORY — a sorted `METHOD path` list, so a route
 *     silently added, dropped, or renamed fails here first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { projectsRoutes, type ProjectsRouteDeps } from '../../routes.ts';

/**
 * Every dependency `projectsRoutes` needs, stubbed. None of these stubs is
 * ever exercised by this file — every assertion below drives `matches` and
 * reads table metadata (`method`, `path`, `dryClassification`), never
 * `handler` — so each stub only needs to satisfy the type, not behave.
 */
const deps: ProjectsRouteDeps = {
  seedBrain: () => ({ projectId: 'stub', brainDir: '/stub', files: [] }),
  checkBrainSeedContainment: () => {},
  readArtifactRoot: () => '.',
  isContainedProjectRepoPath: () => true,
  spawnPreflightFix: () => {},
  projectKbBindings: () => new Map(),
  listStarterAgents: () => [],
  loadStarterFlow: () => null,
  agentCapabilityDescriptor: () => ({}),
};

const table = projectsRoutes(deps);

const key = (m: string, p: string) => `${m} ${p}`;

// ---------------------------------------------------------------------------
// 1. Ordering pin — POST /api/studio/projects/create vs the :id rows.
// ---------------------------------------------------------------------------

test('routes-table: POST /api/studio/projects/create is claimed by the create row, not the generic :id row behind it', () => {
  const url = '/api/studio/projects/create';
  const claimant = table.find((r) => r.method === 'POST' && r.matches(url));
  assert.ok(claimant, 'no POST row claims /api/studio/projects/create — the route is unreachable');
  assert.equal(
    claimant.path,
    '/api/studio/projects/create',
    `POST ${url} must be claimed by "/api/studio/projects/create", not "${claimant.path}". The generic ` +
      `:id pattern (^/api/studio/projects/([^/]+)$) also matches "create" as an id, and RESERVED_OBJECT_IDS ` +
      `does not reserve that string — the create row must be ordered BEFORE the :id rows in the table's array ` +
      `literal, or this assertion fails the moment the two are swapped.`,
  );
});

test('routes-table: the create row genuinely precedes both :id rows in array order (not merely first-claimed)', () => {
  const createIndex = table.findIndex((r) => r.method === 'POST' && r.path === '/api/studio/projects/create');
  const idIndexes = table
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.path === '/api/studio/projects/:id')
    .map(({ i }) => i);
  assert.ok(createIndex >= 0, 'no table row has path "/api/studio/projects/create"');
  assert.ok(idIndexes.length > 0, 'no table row has path "/api/studio/projects/:id"');
  for (const idIndex of idIndexes) {
    assert.ok(
      createIndex < idIndex,
      `"/api/studio/projects/create" (index ${createIndex}) must precede "/api/studio/projects/:id" ` +
        `(index ${idIndex}) in the table's array — first-match-wins dispatch means array order IS claim order.`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. handleProjectPut answers PUT and POST; DELETE matches neither.
// ---------------------------------------------------------------------------

test('routes-table: /api/studio/projects/:id has exactly a PUT row and a POST row, sharing one handler', () => {
  const rows = table.filter((r) => r.path === '/api/studio/projects/:id');
  const methods = rows.map((r) => r.method).sort();
  assert.deepEqual(
    methods,
    ['POST', 'PUT'],
    `expected exactly one PUT row and one POST row for /api/studio/projects/:id (RouteEntry.method is ` +
      `singular, and the original handler's gate "if (!(projectMatch && method !== 'DELETE')) return false;" ` +
      `answers both PUT and POST) — got methods: ${methods.join(', ') || '(none)'}`,
  );
  assert.equal(
    rows[0]!.handler,
    rows[1]!.handler,
    'the PUT and POST rows for /api/studio/projects/:id must reference the exact same handler function ' +
      '(handleProjectPut) — two different functions here would mean the carve diverged from the original.',
  );
});

test('routes-table: DELETE /api/studio/projects/:id matches no row — a DELETE must fall through unhandled (404)', () => {
  const url = '/api/studio/projects/some-project';
  const claimant = table.find((r) => r.method === 'DELETE' && r.matches(url));
  assert.equal(
    claimant,
    undefined,
    'a DELETE row exists for /api/studio/projects/:id — projects deliberately have no delete surface here ' +
      '(W7-B4); dispatchRoute filters on entry.method before matches ever runs, so registering a DELETE row ' +
      'would route a delete request into logic that was never meant to answer it.',
  );
});

// ---------------------------------------------------------------------------
// 3. fix-agent: exactly one row, valued stub-actions, reason pinned.
// ---------------------------------------------------------------------------

test('routes-table: POST .../preflight/fix-agent is ONE row valued stub-actions — no split exists because the discriminator is server/body state (T1 rulings 27/29), not something a url matcher can read', () => {
  const rows = table.filter((r) => r.path === '/api/studio/projects/:id/preflight/fix-agent');
  assert.equal(
    rows.length,
    1,
    `expected exactly ONE table row for POST /api/studio/projects/:id/preflight/fix-agent — the route's real ` +
      `discriminator (which resolution tier a clause falls into: auto | agent | user) comes from running the ` +
      `preflight REPORT inside the handler, never from anything a \`matches: (url) => boolean\` predicate can ` +
      `read; a \`matches\` that computed it would run preflight twice per request. Got ${rows.length} rows.`,
  );
  assert.equal(rows[0]!.method, 'POST');
  assert.equal(
    rows[0]!.dryClassification,
    'stub-actions',
    'the fix-agent row must be classified stub-actions (dry-bridge.ts:172): the user-tier spawn branch is ' +
      'suppressed with a marker under FORGE_DRY_BRIDGE=1, while the auto/agent-tier branches never spawn at all.',
  );
});

// ---------------------------------------------------------------------------
// 4. The raw-url gotcha — every matches() accepts its own path plus a query
//    string, since handlers receive the RAW url with the query intact.
// ---------------------------------------------------------------------------

/** One concrete, matcher-satisfying URL per table path (":id"/":runId"
 *  substituted with a real-looking segment) — used only to prove `matches`
 *  tolerates a trailing query string, never to drive a handler. */
function sampleUrlFor(path: string): string {
  return path
    .replace(':runId', 'run-abc123')
    .replace(':id', 'demo-project');
}

test('routes-table: every matches() predicate accepts its own path with a query string appended (?x=1) — handlers receive the raw url, query intact', () => {
  const offenders: string[] = [];
  for (const row of table) {
    const bare = sampleUrlFor(row.path);
    const withQuery = `${bare}?x=1`;
    if (!row.matches(bare)) {
      offenders.push(`${row.method} ${row.path}: matches() rejected its OWN bare sample url "${bare}" — fixture bug, not a query-string finding`);
      continue;
    }
    if (!row.matches(withQuery)) {
      offenders.push(`${row.method} ${row.path}: matches() rejected "${withQuery}" — it must strip the query (pathOnly) before testing, since dispatch hands it the RAW url`);
    }
  }
  assert.deepEqual(offenders, [], `matches() query-string gotcha found:\n${offenders.join('\n')}`);
});

// ---------------------------------------------------------------------------
// 5. Full route inventory — sorted METHOD path list.
// ---------------------------------------------------------------------------

const EXPECTED_INVENTORY: readonly string[] = [
  'GET /api/studio/projects',
  'GET /api/studio/projects/:id/contract-stages',
  'GET /api/studio/projects/:id/preflight',
  'GET /api/studio/projects/:id/preflight/fix-agent/:runId',
  'GET /api/studio/projects/:id/repo-status',
  'GET /api/studio/projects/starters',
  'GET /api/studio/starters',
  'POST /api/studio/projects',
  'POST /api/studio/projects/:id',
  'POST /api/studio/projects/:id/preflight/fix-agent',
  'POST /api/studio/projects/:id/preflight/fix-auto',
  'POST /api/studio/projects/:id/save-repo',
  'POST /api/studio/projects/create',
  'PUT /api/studio/projects/:id',
].slice().sort();

test('routes-table: the full route inventory matches exactly — a route silently added, dropped, or renamed fails here', () => {
  const got = table.map((r) => key(r.method, r.path)).sort();
  assert.deepEqual(
    got,
    EXPECTED_INVENTORY,
    `route inventory drift.\n` +
      `  missing (in EXPECTED_INVENTORY, not in the table): ${EXPECTED_INVENTORY.filter((w) => !got.includes(w)).join(', ') || 'none'}\n` +
      `  extra   (in the table, not in EXPECTED_INVENTORY):  ${got.filter((g) => !EXPECTED_INVENTORY.includes(g)).join(', ') || 'none'}`,
  );
});

test('routes-table: no two entries share a method+path — a duplicate silently shadows whichever loses the iteration', () => {
  const seen = new Map<string, number>();
  for (const r of table) seen.set(key(r.method, r.path), (seen.get(key(r.method, r.path)) ?? 0) + 1);
  // /api/studio/projects/:id legitimately has TWO entries (PUT + POST) — that
  // is a duplicate PATH, not a duplicate METHOD+PATH key, so it is excluded
  // here and covered by its own dedicated pair of tests above.
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(dupes, [], `duplicate table entries: ${dupes.join(', ')}`);
});

test('routes-table: every entry carries a dryClassification and a callable handler', () => {
  const missingClassification = table.filter((r) => !r.dryClassification).map((r) => key(r.method, r.path));
  assert.deepEqual(missingClassification, [], `entries with no dryClassification: ${missingClassification.join(', ')}`);
  const missingHandler = table.filter((r) => typeof r.handler !== 'function').map((r) => key(r.method, r.path));
  assert.deepEqual(missingHandler, [], `entries with no callable handler: ${missingHandler.join(', ')}`);
});
