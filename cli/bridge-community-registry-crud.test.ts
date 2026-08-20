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

function seedRegistry(items: Array<Record<string, unknown>> = []): void {
  writeFileSync(registryPath(), yaml.dump({ meta: { schemaVersion: 1, lastRefresh: null }, items }), 'utf8');
}

function readRegistryDoc(): { meta: { schemaVersion: number; lastRefresh: string | null }; items: Array<Record<string, unknown>> } {
  return yaml.load(readFileSync(registryPath(), 'utf8')) as never;
}

const SEED_ROW = {
  id: 'seed-item',
  kind: 'skill',
  name: 'Seed Item',
  desc: 'seeded',
  category: 'testing',
  sourceUrl: 'https://example.com/seed',
  provenance: 'Seeder',
  signals: { stars: null, starsDisplay: null, attributedTo: null },
  upstreamUpdatedAt: null,
  fetchedAt: '2026-08-01T00:00:00.000Z',
  fetchedBy: 'community-refresh/older-session',
};

const NEW_ITEM_BODY = {
  id: 'new-item',
  kind: 'skill',
  name: 'New Item',
  desc: 'added by the operator',
  category: 'testing',
  sourceUrl: 'https://example.com/new-item',
  provenance: 'Operator Pick',
  signals: { starsDisplay: '1.2k', attributedTo: 'Operator Pick', stars: 1200 },
};

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-community-crud-'));
  for (const state of ['pending', 'in-flight', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'community'), { recursive: true });
  seedRegistry([SEED_ROW]);

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

test('CRUD-1: POST adds a row — fetchedAt/fetchedBy AND the fetch facts (stars/starsDisplay/upstreamUpdatedAt) are server-owned, regardless of body claims', async () => {
  seedRegistry([SEED_ROW]);
  const res = await post({ item: { ...NEW_ITEM_BODY, upstreamUpdatedAt: '2026-07-01', fetchedAt: '2026-01-01T00:00:00Z', fetchedBy: 'liar' } });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const doc = readRegistryDoc();
  const row = doc.items.find((i) => i.id === 'new-item');
  assert.ok(row, 'the new row must be in the written registry');
  assert.equal(row!.fetchedAt, null, 'an operator add is hand-curated — never a fabricated verification stamp');
  assert.equal(row!.fetchedBy, 'operator');
  assert.equal(row!.name, 'New Item');
  // W7-B3 review F5 (declared-data-fails-open): the body claimed stars:1200 /
  // starsDisplay:'1.2k' / upstreamUpdatedAt — all fabricated-signal vectors
  // (stars drives the "Stars" sort). The server IGNORES them on create.
  const signals = row!.signals as Record<string, unknown>;
  assert.equal(signals.stars, null, 'a hand-entered star count is a fabricated signal — server-owned, starts null');
  assert.equal(signals.starsDisplay, null, 'starsDisplay summarizes stars — it must not survive without it');
  assert.equal(signals.attributedTo, 'Operator Pick', 'the attribution note IS operator text — kept');
  assert.equal(row!.upstreamUpdatedAt, null, 'nothing was fetched — no upstream fact to record');
  // The untouched seed row survives byte-equivalent (same parsed value).
  assert.ok(doc.items.some((i) => i.id === 'seed-item' && i.fetchedAt === '2026-08-01T00:00:00.000Z'));
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

test('CRUD-5: PUT edits an existing row in place (fetched stamps reset to hand-curated)', async () => {
  seedRegistry([SEED_ROW]);
  const res = await put('seed-item', { item: { ...SEED_ROW, name: 'Seed Item (renamed)', signals: { stars: null, starsDisplay: null, attributedTo: null } } });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const doc = readRegistryDoc();
  assert.equal(doc.items.length, 1);
  assert.equal(doc.items[0].name, 'Seed Item (renamed)');
  assert.equal(doc.items[0].fetchedAt, null, 'a hand edit is no longer the agent-verified row — the stamp resets honestly');
  assert.equal(doc.items[0].fetchedBy, 'operator');
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
test('CRUD-11: PUT carries the existing row\'s stars/starsDisplay/upstreamUpdatedAt forward — body spoofs ignored, attribution note editable', async () => {
  const agentRow = {
    ...SEED_ROW,
    signals: { stars: 4200, starsDisplay: '4.2k', attributedTo: null },
    upstreamUpdatedAt: '2026-08-01',
    fetchedAt: '2026-08-02T00:00:00.000Z',
    fetchedBy: 'community-refresh/2026-08-02T00-00-00-fx',
  };
  seedRegistry([agentRow]);
  const res = await put('seed-item', {
    item: {
      ...SEED_ROW,
      desc: 'typo fixed',
      signals: { stars: 999999, starsDisplay: 'one MILLION', attributedTo: 'curator note' },
      upstreamUpdatedAt: '1999-01-01',
    },
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const row = readRegistryDoc().items.find((i) => i.id === 'seed-item')!;
  assert.equal(row.desc, 'typo fixed', 'the edit itself lands');
  const signals = row.signals as Record<string, unknown>;
  assert.equal(signals.stars, 4200, 'the agent-fetched star count survives the edit — never wiped, never spoofed');
  assert.equal(signals.starsDisplay, '4.2k', 'the display string stays consistent with the number it summarizes');
  assert.equal(signals.attributedTo, 'curator note', 'the attribution note IS operator text — editable');
  assert.equal(row.upstreamUpdatedAt, '2026-08-01', 'the fetched upstream fact survives; the body\'s 1999 claim is ignored');
  assert.equal(row.fetchedAt, null, 'the honesty reset still applies — the CONTENT is now hand-curated');
  assert.equal(row.fetchedBy, 'operator');
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
