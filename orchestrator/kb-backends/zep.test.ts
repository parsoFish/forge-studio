/**
 * Contract test for ZepKbBackend (M8-C, ADR-027 §4 / ADR-029-style admission).
 *
 * Mirrors orchestrator/kb-backend.test.ts: the same five-part KbBackend contract,
 * proven for the Zep backend against a FAKE in-memory Zep graph client injected
 * via the constructor seam. Runs WITHOUT the `@getzep/zep-cloud` dep and WITHOUT
 * any live creds — the dep+creds gate is asserted to be CLOSED in this env, and
 * the search/graph/article behaviour is proven against the fake.
 *
 * What is NOT covered here (no dep, no creds): the real `createZepGraphClient`
 * dynamic-import path and a live `graph.search` round-trip. See the module's
 * liveGap note.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  ZepKbBackend,
  isZepAvailable,
  ZEP_API_KEY_ENV,
  type ZepGraphClient,
  type ZepGraphSearchQuery,
  type ZepGraphSearchResults,
  type ZepEntityNode,
  type ZepEntityEdge,
} from './zep.ts';
import type { KbBackend } from '../kb-backend.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
// orchestrator/kb-backends → forge root is two levels up.
const FORGE_ROOT = resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Fake in-memory Zep graph client (the construction seam)
// ---------------------------------------------------------------------------

const FAKE_NODES: ZepEntityNode[] = [
  { uuid: 'n-index', name: 'INDEX', summary: 'Root entity for the cycles graph.', createdAt: '2026-01-01T00:00:00Z' },
  { uuid: 'n-merge', name: 'merge-gate ordering', summary: 'Dependent WIs wait for prerequisite merge.', createdAt: '2026-02-01T00:00:00Z' },
  { uuid: 'n-resume', name: 'resume from unifier', summary: 'A unifier-only failure resumes, never discards per-WI work.', createdAt: '2026-03-01T00:00:00Z' },
];

const FAKE_EDGES: ZepEntityEdge[] = [
  { uuid: 'e1', name: 'relates_to', fact: 'merge-gate ordering depends on INDEX conventions', sourceNodeUuid: 'n-merge', targetNodeUuid: 'n-index', createdAt: '2026-02-02T00:00:00Z', score: 0.91 },
  { uuid: 'e2', name: 'relates_to', fact: 'resume from unifier preserves dev-loop work across the merge gate', sourceNodeUuid: 'n-resume', targetNodeUuid: 'n-merge', createdAt: '2026-03-02T00:00:00Z', score: 0.82 },
];

function makeFakeZepClient(): ZepGraphClient {
  return {
    async search(req: ZepGraphSearchQuery): Promise<ZepGraphSearchResults> {
      const q = req.query.toLowerCase();
      // Naive semantic stand-in: match facts containing any query token.
      const tokens = q.split(/\s+/).filter(Boolean);
      const edges = FAKE_EDGES.filter((e) =>
        tokens.some((t) => (e.fact ?? '').toLowerCase().includes(t)),
      );
      return { edges };
    },
    node: {
      async get(uuid: string): Promise<ZepEntityNode> {
        const n = FAKE_NODES.find((x) => x.uuid === uuid);
        if (!n) throw new Error(`fake: no node ${uuid}`);
        return n;
      },
      async getByGraphId(): Promise<ZepEntityNode[]> {
        return FAKE_NODES.slice();
      },
    },
    edge: {
      async getByGraphId(): Promise<ZepEntityEdge[]> {
        return FAKE_EDGES.slice();
      },
    },
  };
}

function makeBackend(): ZepKbBackend {
  return new ZepKbBackend({ kbId: 'cycles', forgeRoot: FORGE_ROOT, client: makeFakeZepClient() });
}

// ---------------------------------------------------------------------------
// Gate §0: dep+creds gate is CLOSED in this env (no dep, no creds)
// ---------------------------------------------------------------------------

test('isZepAvailable is false without creds (env gate closed)', async () => {
  const noKey = { ...process.env };
  delete noKey[ZEP_API_KEY_ENV];
  assert.equal(await isZepAvailable(noKey), false, 'no API key → unavailable');
});

test('isZepAvailable is false even with a key when the dep is absent', async () => {
  // Key present but @getzep/zep-cloud is NOT installed in this env → import
  // fails → still unavailable. Proves BOTH conditions are required.
  const withKey = { ...process.env, [ZEP_API_KEY_ENV]: 'test-key-not-real' };
  assert.equal(await isZepAvailable(withKey), false, 'dep absent → unavailable');
});

// ---------------------------------------------------------------------------
// Contract §1: backend is bound to its kbId and validates construction
// ---------------------------------------------------------------------------

test('ZepKbBackend is bound to its kbId and is a KbBackend', () => {
  const backend: KbBackend = makeBackend();
  assert.equal(backend.kbId, 'cycles');
});

test('constructor fails fast on missing kbId / forgeRoot', () => {
  assert.throws(() => new ZepKbBackend({ kbId: '', forgeRoot: FORGE_ROOT }), /kbId is required/);
  assert.throws(() => new ZepKbBackend({ kbId: 'cycles', forgeRoot: '' }), /forgeRoot is required/);
});

// ---------------------------------------------------------------------------
// Contract §2: buildGraph reflects the primed Zep graph (cold before prime)
// ---------------------------------------------------------------------------

test('buildGraph is empty before prime() (documented cold state)', () => {
  const backend = makeBackend();
  const g = backend.buildGraph();
  assert.deepEqual(g.nodes, []);
  assert.deepEqual(g.edges, []);
});

test('buildGraph maps Zep nodes/edges → KbGraph after prime()', async () => {
  const backend = makeBackend();
  await backend.prime();
  const g = backend.buildGraph();
  assert.equal(g.nodes.length, FAKE_NODES.length, 'all fake nodes present');
  assert.ok(g.nodes.some((n) => n.id === 'n-index' && n.title === 'INDEX'), 'INDEX node mapped');
  assert.equal(g.edges.length, FAKE_EDGES.length, 'edges with both endpoints kept');
  for (const n of g.nodes) assert.equal(n.layer, 'theme', 'Zep entities map to the theme layer');
  // Defensive copy: mutating the returned graph must not affect the snapshot.
  g.nodes.pop();
  assert.equal(backend.buildGraph().nodes.length, FAKE_NODES.length, 'snapshot is not mutated');
});

// ---------------------------------------------------------------------------
// Contract §3: getNodeArticle returns an article for a known node, null otherwise
// ---------------------------------------------------------------------------

test('getNodeArticle returns an article for a real node and null for a missing one', async () => {
  const backend = makeBackend();
  await backend.prime();
  const article = backend.getNodeArticle('n-merge');
  assert.ok(article, 'n-merge article should resolve');
  assert.equal(article.id, 'n-merge');
  assert.equal(article.title, 'merge-gate ordering');
  assert.equal(article.body, 'Dependent WIs wait for prerequisite merge.', 'body from node summary');
  // n-merge: e1 (merge→index) is outbound; e2 (resume→merge) is inbound.
  assert.ok(article.outbound.some((o) => o.id === 'n-index'), 'outbound edge resolved with title');
  assert.ok(article.inbound.some((i) => i.id === 'n-resume'), 'inbound edge resolved with title');
  assert.equal(backend.getNodeArticle('definitely-not-a-node'), null);
});

test('getNodeArticle is null before prime() (no snapshot yet)', () => {
  const backend = makeBackend();
  assert.equal(backend.getNodeArticle('n-merge'), null);
});

// ---------------------------------------------------------------------------
// Contract §4: listPendingGuidance returns an array (delegated to filesystem)
// ---------------------------------------------------------------------------

test('listPendingGuidance returns an array (filesystem-delegated)', () => {
  const backend = makeBackend();
  assert.ok(Array.isArray(backend.listPendingGuidance()));
});

test('deleteGuidanceFile path-guards via the composed FS backend', () => {
  const backend = makeBackend();
  // The FS backend rejects paths outside _guidance/ — proves real delegation.
  assert.throws(() => backend.deleteGuidanceFile('/etc/passwd'), /path traversal/);
});

// ---------------------------------------------------------------------------
// Contract §5: search returns semantic hits via Zep (primeSearch → sync read)
// ---------------------------------------------------------------------------

test('search() is empty for a blank query', () => {
  const backend = makeBackend();
  assert.deepEqual(backend.search('   '), [], 'blank query → no hits');
});

test('search() returns [] before primeSearch (sync interface over async store)', () => {
  const backend = makeBackend();
  assert.deepEqual(backend.search('merge'), [], 'no primed result yet → empty');
});

test('primeSearch warms the cache; search() then returns ranked Zep hits', async () => {
  const backend = makeBackend();
  await backend.prime();
  const live = await backend.primeSearch('merge', 5);
  assert.ok(live.length >= 1, 'live semantic search returns a hit');

  const hits = backend.search('merge', 5);
  assert.ok(hits.length >= 1, 'cached hit served synchronously');
  assert.ok(hits.length <= 5, 'respects the limit');
  for (const h of hits) {
    assert.equal(typeof h.score, 'number', 'score is numeric (Zep relevance)');
    assert.equal(typeof h.id, 'string');
    assert.equal(typeof h.title, 'string');
    assert.ok(h.title.length > 0);
  }
  // The fact-edge "merge-gate ordering depends on INDEX conventions" projects
  // onto its source node n-merge.
  assert.ok(hits.some((h) => h.id === 'n-merge'), 'fact-edge projected onto source node');
});
