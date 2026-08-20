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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('CRUD-1: POST adds a row — stamped fetchedAt:null / fetchedBy:operator regardless of body claims', async () => {
  seedRegistry([SEED_ROW]);
  const res = await post({ item: { ...NEW_ITEM_BODY, fetchedAt: '2026-01-01T00:00:00Z', fetchedBy: 'liar' } });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const doc = readRegistryDoc();
  const row = doc.items.find((i) => i.id === 'new-item');
  assert.ok(row, 'the new row must be in the written registry');
  assert.equal(row!.fetchedAt, null, 'an operator add is hand-curated — never a fabricated verification stamp');
  assert.equal(row!.fetchedBy, 'operator');
  assert.equal(row!.name, 'New Item');
  assert.equal((row!.signals as Record<string, unknown>).stars, 1200);
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
