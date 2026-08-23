/**
 * W7-B3 (community-23) — registry CRUD through the real bridge:
 *
 *   POST   /api/studio/community/registry/items       {item}  → add
 *   PUT    /api/studio/community/registry/items/:id   {item}  → edit
 *   DELETE /api/studio/community/registry/items/:id           → remove
 *
 * The registry (studio/community/registry.yaml) was a hand-curated file
 * whose ONLY writer was an agent commit path that had never executed —
 * Studio itself had no add/edit/remove at all. These routes give the
 * operator direct curation, with the SAME structural validation the loader
 * enforces (the written file is re-parsed through loadCommunityRegistry
 * before it replaces the real one — temp-then-rename, never a half-write).
 *
 * Honesty stamps: an operator-written row is hand-curated — the server
 * forces `fetchedAt: null` / `fetchedBy: 'operator'` regardless of what the
 * body claims (never a fabricated verification timestamp; the freshness
 * badge reads such a row as never-verified, which is the truth).
 *
 * Harness mirrors cli/ui-bridge-community-refresh-start.test.ts: one real
 * bridge on a temp forge root.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { startBridge } from './ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

function registryPath(): string {
  return join(forgeRoot, 'studio', 'community', 'registry.yaml');
}

function seedRegistry(items: Array<Record<string, unknown>> = [], sources: Record<string, unknown> = {}): void {
  writeFileSync(registryPath(), yaml.dump({ meta: { schemaVersion: 2, lastRefresh: null }, sources, items }), 'utf8');
}

function readRegistryDoc(): {
  meta: { schemaVersion: number; lastRefresh: string | null };
  sources: Record<string, Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
} {
  return yaml.load(readFileSync(registryPath(), 'utf8')) as never;
}

// W8-B5 schema v2 — an item carries curation only; the repo facts it used to
// hold live in the top-level `sources` map, keyed by its sourceUrl.
const SEED_ROW = {
  id: 'seed-item',
  kind: 'skill',
  name: 'Seed Item',
  desc: 'seeded',
  category: 'testing',
  sourceUrl: 'https://github.com/seeder/seed',
  provenance: 'Seeder',
  signals: { attributedTo: null },
};

const SEED_SOURCES = {
  'github:seeder/seed': {
    stars: 4200,
    starsDisplay: '4.2k',
    upstreamUpdatedAt: '2026-08-01',
    fetchedAt: '2026-08-01T00:00:00.000Z',
    fetchedBy: 'api:github',
  },
};

const NEW_ITEM_BODY = {
  id: 'new-item',
  kind: 'skill',
  name: 'New Item',
  desc: 'added by the operator',
  category: 'testing',
  sourceUrl: 'https://github.com/operator/new-item',
  provenance: 'Operator Pick',
  // /community's add form still posts these two as explicit nulls; a null
  // carries no information and is accepted-and-dropped. A REAL value is 400.
  signals: { starsDisplay: null, attributedTo: 'Operator Pick', stars: null },
};

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-community-crud-'));
  for (const state of ['pending', 'in-flight', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'community'), { recursive: true });
  seedRegistry([SEED_ROW], SEED_SOURCES);

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

function post(body: unknown): Promise<Response> {
  return fetch(`${url}/api/studio/community/registry/items`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
}
function put(id: string, body: unknown): Promise<Response> {
  return fetch(`${url}/api/studio/community/registry/items/${encodeURIComponent(id)}`, { method: 'PUT', headers: CSRF, body: JSON.stringify(body) });
}
function del(id: string): Promise<Response> {
  return fetch(`${url}/api/studio/community/registry/items/${encodeURIComponent(id)}`, { method: 'DELETE', headers: CSRF });
}

test('CRUD-1: POST adds a row carrying CURATION ONLY — the repo facts have no per-item field to land in, and the shared sources map is untouched', async () => {
  seedRegistry([SEED_ROW], SEED_SOURCES);
  const res = await post({ item: NEW_ITEM_BODY });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const doc = readRegistryDoc();
  const row = doc.items.find((i) => i.id === 'new-item');
  assert.ok(row, 'the new row must be in the written registry');
  assert.equal(row!.name, 'New Item');
  // W8-B5 (E5) — the structural cure: the written row has NO key that could
  // hold a mis-scoped repo fact. W7-B3 review F5 had to FORCE these null
  // server-side; now there is nothing to force.
  for (const gone of ['fetchedAt', 'fetchedBy', 'upstreamUpdatedAt']) {
    assert.ok(!(gone in row!), `an item must have no "${gone}" key at all`);
  }
  const signals = row!.signals as Record<string, unknown>;
  assert.deepEqual(Object.keys(signals), ['attributedTo'], 'signals carries curation only');
  assert.equal(signals.attributedTo, 'Operator Pick', 'the attribution note IS operator text — kept');
  // The operator's curation edit must never disturb another row's repo facts.
  assert.deepEqual(doc.sources, SEED_SOURCES, 'a CRUD add must carry the sources map forward untouched');
});

test('CRUD-1b: a POST body claiming a REAL repo fact is REFUSED (400) naming sources — never silently ignored', async () => {
  seedRegistry([SEED_ROW], SEED_SOURCES);
  for (const spoof of [
    { signals: { attributedTo: 'x', stars: 1200 } },
    { signals: { attributedTo: 'x', starsDisplay: '1.2k' } },
    { upstreamUpdatedAt: '2026-07-01' },
    { fetchedAt: '2026-01-01T00:00:00Z' },
    { fetchedBy: 'liar' },
  ]) {
    const res = await post({ item: { ...NEW_ITEM_BODY, id: 'spoofed', ...spoof } });
    const body = (await res.json()) as { error?: string };
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(spoof)}, got ${res.status}`);
    assert.match(body.error ?? '', /sources/, 'the refusal must say where the fact belongs');
  }
  assert.ok(!readRegistryDoc().items.some((i) => i.id === 'spoofed'), 'a refused POST writes nothing');
});

test('CRUD-2: POST with an already-present id → 409, registry unchanged', async () => {
  seedRegistry([SEED_ROW]);
  const before = readFileSync(registryPath(), 'utf8');
  const res = await post({ item: { ...NEW_ITEM_BODY, id: 'seed-item' } });
  assert.equal(res.status, 409);
  assert.equal(readFileSync(registryPath(), 'utf8'), before, 'a refused add must leave the file byte-identical');
});

test('CRUD-3: POST with a missing required field → 400 naming it, registry unchanged', async () => {
  seedRegistry([SEED_ROW]);
  const before = readFileSync(registryPath(), 'utf8');
  const { sourceUrl: _dropped, ...withoutSource } = NEW_ITEM_BODY;
  const res = await post({ item: withoutSource });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /sourceUrl/);
  assert.equal(readFileSync(registryPath(), 'utf8'), before);
});

test('CRUD-4: POST with an out-of-vocabulary kind → 400', async () => {
  seedRegistry([SEED_ROW]);
  const res = await post({ item: { ...NEW_ITEM_BODY, kind: 'plugin' } });
  assert.equal(res.status, 400);
});

test('CRUD-5: PUT edits an existing row in place; the written row carries no fetch stamp to go stale', async () => {
  seedRegistry([SEED_ROW], SEED_SOURCES);
  const res = await put('seed-item', { item: { ...SEED_ROW, name: 'Seed Item (renamed)', signals: { stars: null, starsDisplay: null, attributedTo: null } } });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const doc = readRegistryDoc();
  assert.equal(doc.items.length, 1);
  assert.equal(doc.items[0].name, 'Seed Item (renamed)');
  for (const gone of ['fetchedAt', 'fetchedBy', 'upstreamUpdatedAt']) {
    assert.ok(!(gone in doc.items[0]), `an item must have no "${gone}" key at all`);
  }
});

test('CRUD-6: PUT on an unknown id → 404; body id disagreeing with the URL id → 400', async () => {
  seedRegistry([SEED_ROW]);
  const missing = await put('ghost-item', { item: { ...NEW_ITEM_BODY, id: 'ghost-item' } });
  assert.equal(missing.status, 404);
  const mismatched = await put('seed-item', { item: { ...NEW_ITEM_BODY, id: 'different-id' } });
  assert.equal(mismatched.status, 400);
});

test('CRUD-7: DELETE removes the row; a second DELETE → 404', async () => {
  seedRegistry([SEED_ROW]);
  const res = await del('seed-item');
  assert.equal(res.status, 200);
  assert.equal(readRegistryDoc().items.length, 0);
  const again = await del('seed-item');
  assert.equal(again.status, 404);
});

test('CRUD-8: a traversal-shaped id → 400 before any file work', async () => {
  seedRegistry([SEED_ROW]);
  const before = readFileSync(registryPath(), 'utf8');
  const res = await del('..%2F..%2Fetc');
  assert.equal(res.status, 400);
  assert.equal(readFileSync(registryPath(), 'utf8'), before);
});

test('CRUD-9: the written file still parses through the structural loader (round-trip via GET /api/studio/community)', async () => {
  seedRegistry([SEED_ROW]);
  await post({ item: NEW_ITEM_BODY });
  const res = await fetch(`${url}/api/studio/community`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: Array<{ id: string }> };
  assert.ok(body.items.some((i) => i.id === 'new-item'), 'the added row must surface on the live index read');
});

// W7-B3 review F1 (CONFIRMED by live probe): the community index projects
// ONLY kind:'skill' registry rows — a hand-added hook/mcp/tool row would
// write fine and then be invisible and un-curatable (the form's post-submit
// redirect to /community/hook/<id> 404s, and edit/remove live on that page).
test('CRUD-10: POST with kind "hook" (a real registry kind the index never surfaces) → 400 naming the skill-only rule; file byte-identical', async () => {
  seedRegistry([SEED_ROW]);
  const before = readFileSync(registryPath(), 'utf8');
  const res = await post({ item: { ...NEW_ITEM_BODY, kind: 'hook' } });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /skill/, 'the 400 must explain the skill-only rule, not just reject');
  assert.equal(readFileSync(registryPath(), 'utf8'), before, 'a refused kind must write nothing');
});

// W7-B3 review F4: an operator EDIT must not wipe agent-fetched facts — and
// review F5: nor may the body fabricate them. stars/starsDisplay/
// upstreamUpdatedAt come from the EXISTING row on PUT; only fetchedAt/
// fetchedBy reset (the content is now hand-curated).
test('CRUD-11: an operator EDIT cannot disturb the shared source row — the fetched facts survive because the item never held them', async () => {
  seedRegistry([SEED_ROW], SEED_SOURCES);
  const res = await put('seed-item', {
    item: { ...SEED_ROW, desc: 'typo fixed', signals: { attributedTo: 'curator note' } },
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const doc = readRegistryDoc();
  const row = doc.items.find((i) => i.id === 'seed-item')!;
  assert.equal(row.desc, 'typo fixed', 'the edit itself lands');
  assert.deepEqual(row.signals, { attributedTo: 'curator note' }, 'the attribution note IS operator text — editable');
  // W7-B3 review F4 had to carry the agent-fetched facts forward by hand on
  // every edit; v2 removes the opportunity to drop them. The source row is
  // shared with every other item on that repo, so a per-item edit that could
  // touch it would be the mis-scoping schema v2 exists to prevent.
  assert.deepEqual(doc.sources, SEED_SOURCES, 'the shared repo facts are byte-identical after an item edit');
});

// W7-B3 review F3 (guard-symmetry): admitting DELETE into
// handleStudioWriteRoutes for the registry route must NOT let a DELETE fall
// into the pre-existing method-less write arms (agents/:slug, projects/:id,
// flows/:slug all dispatch on URL alone and would treat it as their PUT).
test('CRUD-12: DELETE on a write route with NO delete handler falls through to 404 — never executes that route\'s PUT/write handler', async () => {
  // W7-B3 wrote this pin against /api/studio/agents/:slug, back when the
  // community registry item was the only DELETE arm in the module. W7-B4 gave
  // agents and flows REAL delete handlers, so that URL no longer tests
  // fall-through — it tests those handlers. Retargeted at a route that still
  // has no DELETE arm (projects/:id explicitly excludes it), which is what the
  // guard-symmetry invariant was always about: a DELETE must never drop into a
  // PUT handler and act.
  const res = await fetch(`${url}/api/studio/projects/some-project`, { method: 'DELETE', headers: CSRF });
  assert.equal(res.status, 404, `a DELETE on a route with no delete arm must fall through (got ${res.status})`);
  assert.equal(existsSync(join(forgeRoot, 'projects', 'some-project')), false, 'and must write nothing');
});

test('CRUD-12b: the routes that DO implement DELETE are admitted by the top gate (the scoping list must grow with them)', async () => {
  // The companion to CRUD-12. The top-of-function DELETE gate is an explicit
  // allowlist of routes; merging W7-B4 into a main that only knew the registry
  // item silently disabled BOTH new delete routes (clean auto-merge, green
  // types, 404 forever). This pin fails if that list is ever narrowed again:
  // an admitted-but-unknown target answers the HANDLER's 404/400, never the
  // bare fall-through 404 with no body.
  for (const target of ['/api/studio/agents/no-such-agent', '/api/studio/flows/no-such-flow']) {
    const res = await fetch(`${url}${target}`, { method: 'DELETE', headers: CSRF });
    assert.ok(res.status === 404 || res.status === 400, `${target} answered ${res.status}`);
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    assert.ok(body?.error, `${target} must answer its handler's JSON error, proving the route ran`);
  }
});

// ---------------------------------------------------------------------------
// W8-B5 (exit row E4, community-28) — the curation header survives a REAL
// CRUD round trip through the live bridge routes.
//
// This is the defect at its actual scene: one "Add item" click used to destroy
// all 24 comment lines in studio/community/registry.yaml, because the shared
// serializer is a bare `yaml.dump` of a freshly built object. The fix lives in
// that ONE serializer, so this route inherits it rather than carrying its own
// copy — which is why the assertion is made HERE, at a writer, and not only at
// the serializer's unit test.
// ---------------------------------------------------------------------------

const CURATION_HEADER = [
  '# Community registry — hand-curated.',
  '#',
  '# Every line of this header is rationale a future operator needs, and none',
  '# of it exists anywhere else.',
].join('\n');

function seedRegistryWithHeader(items: Array<Record<string, unknown>>, sources: Record<string, unknown>): void {
  const body = yaml.dump({ meta: { schemaVersion: 2, lastRefresh: null }, sources, items });
  writeFileSync(registryPath(), `${CURATION_HEADER}\n${body}`, 'utf8');
}

test('CRUD-E4: POST → PUT → DELETE each preserve the registry\'s leading comment block verbatim', async () => {
  seedRegistryWithHeader([SEED_ROW], SEED_SOURCES);

  const add = await post({ item: NEW_ITEM_BODY });
  assert.equal(add.status, 200, await add.text());
  assert.ok(
    readFileSync(registryPath(), 'utf8').startsWith(`${CURATION_HEADER}\n`),
    'the ADD path destroyed the curation header',
  );

  const edit = await put('seed-item', { item: { ...SEED_ROW, desc: 'edited' } });
  assert.equal(edit.status, 200, await edit.text());
  assert.ok(
    readFileSync(registryPath(), 'utf8').startsWith(`${CURATION_HEADER}\n`),
    'the EDIT path destroyed the curation header',
  );

  const remove = await del('new-item');
  assert.equal(remove.status, 200, await remove.text());
  const finalText = readFileSync(registryPath(), 'utf8');
  assert.ok(finalText.startsWith(`${CURATION_HEADER}\n`), 'the DELETE path destroyed the curation header');
  assert.equal(
    (finalText.match(/# Community registry — hand-curated\./g) ?? []).length,
    1,
    'three writes must not accumulate three copies of the header',
  );
  // …and the file still round-trips through the ONE loader.
  const doc = readRegistryDoc();
  assert.equal(doc.meta.schemaVersion, 2);
  assert.ok(doc.items.some((i) => i.id === 'seed-item' && i.desc === 'edited'));
});
