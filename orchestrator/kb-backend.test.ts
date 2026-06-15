/**
 * Contract test for the KbBackend seam (ADR-027 §4, ADR-031).
 *
 * Asserts what every KbBackend must satisfy and that the default
 * FilesystemKbBackend delegates correctly to kb-graph.ts. A second backend
 * (ZepKbBackend, M8-C) must pass an equivalent suite before registration —
 * this is the KB analogue of the RuntimeAdapter conformance suite (ADR-029).
 *
 * Tests run against the REAL `cycles` brain (filesystem reads, no fixtures).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { getKbBackend, FilesystemKbBackend, type KbBackend } from './kb-backend.ts';
import { buildKbGraph } from './kb-graph.ts';
import { ZepKbBackend } from './kb-backends/zep.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORGE_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Contract §1: getKbBackend resolves a backend bound to the kbId
// ---------------------------------------------------------------------------

test('getKbBackend(cycles) returns a backend bound to kbId=cycles', () => {
  const backend = getKbBackend(FORGE_ROOT, 'cycles');
  assert.equal(backend.kbId, 'cycles');
  assert.ok(backend instanceof FilesystemKbBackend, 'default backend is filesystem');
});

test('getKbBackend throws on an unknown kbId (same contract as kb-graph)', () => {
  assert.throws(() => getKbBackend(FORGE_ROOT, 'no-such-kb'), /Unknown kbId/);
});

// ---------------------------------------------------------------------------
// Contract §2: buildGraph delegates 1:1 to kb-graph (zero behaviour change)
// ---------------------------------------------------------------------------

test('FilesystemKbBackend.buildGraph() equals buildKbGraph() (pure delegation)', () => {
  const backend = getKbBackend(FORGE_ROOT, 'cycles');
  const viaBackend = backend.buildGraph();
  const direct = buildKbGraph(FORGE_ROOT, 'cycles');
  assert.equal(viaBackend.nodes.length, direct.nodes.length);
  assert.equal(viaBackend.edges.length, direct.edges.length);
  assert.ok(viaBackend.nodes.some((n) => n.id === 'cycles-index'), 'has the INDEX node');
});

// ---------------------------------------------------------------------------
// Contract §3: getNodeArticle returns an article for a known node, null otherwise
// ---------------------------------------------------------------------------

test('getNodeArticle returns an article for a real node and null for a missing one', () => {
  const backend = getKbBackend(FORGE_ROOT, 'cycles');
  const article = backend.getNodeArticle('cycles-index');
  assert.ok(article, 'cycles-index article should resolve');
  assert.equal(article.id, 'cycles-index');
  assert.equal(backend.getNodeArticle('definitely-not-a-node'), null);
});

// ---------------------------------------------------------------------------
// Contract §4: listPendingGuidance returns an array
// ---------------------------------------------------------------------------

test('listPendingGuidance returns an array', () => {
  const backend = getKbBackend(FORGE_ROOT, 'cycles');
  assert.ok(Array.isArray(backend.listPendingGuidance()));
});

// ---------------------------------------------------------------------------
// Contract §5: search returns title hits (the FS backend's honest floor)
// ---------------------------------------------------------------------------

test('search() returns ranked title hits and is empty for a blank query', () => {
  const backend: KbBackend = getKbBackend(FORGE_ROOT, 'cycles');
  assert.deepEqual(backend.search('   '), [], 'blank query → no hits');

  const hits = backend.search('index', 5);
  assert.ok(hits.length >= 1, 'expected at least one title hit for "index"');
  assert.ok(hits.length <= 5, 'respects the limit');
  for (const h of hits) {
    assert.ok(h.title.toLowerCase().includes('index'), `hit "${h.title}" must match the query`);
    assert.equal(typeof h.score, 'number');
  }
});

// ---------------------------------------------------------------------------
// Contract §6: ZepKbBackend (M8-C) satisfies the same contract with an injected
// fake graph client — the admission gate (no dep/creds needed). The (graphId, {})
// node/edge call shape was verified live against Zep Cloud (2026-06-15).
// ---------------------------------------------------------------------------

function fakeZepClient() {
  const nodes = [
    { uuid: 'n1', name: 'Worktrees', createdAt: '2026-01-01', summary: 'parallel work isolation' },
    { uuid: 'n2', name: 'Merge gate', createdAt: '2026-01-01' },
  ];
  const edges = [
    { sourceNodeUuid: 'n1', targetNodeUuid: 'n2', fact: 'worktrees feed the merge gate', createdAt: '2026-01-01', score: 0.9 },
  ];
  return {
    async search() {
      return { edges, nodes: [] };
    },
    node: {
      async get(uuid: string) {
        return nodes.find((n) => n.uuid === uuid);
      },
      async getByGraphId() {
        return nodes;
      },
    },
    edge: {
      async getByGraphId() {
        return edges;
      },
    },
  };
}

test('ZepKbBackend satisfies the KbBackend contract (fake client): prime → buildGraph/getNodeArticle/search', async () => {
  const backend = new ZepKbBackend({ kbId: 'cycles', forgeRoot: FORGE_ROOT, client: fakeZepClient() as never });
  assert.equal(backend.kbId, 'cycles');

  // cold before prime
  assert.deepEqual(backend.buildGraph(), { nodes: [], edges: [] });

  await backend.prime();
  const graph = backend.buildGraph();
  assert.equal(graph.nodes.length, 2, 'two nodes after prime');
  assert.equal(graph.edges.length, 1, 'one edge after prime');

  const article = backend.getNodeArticle('n1');
  assert.ok(article, 'n1 resolves');
  assert.ok(article.outbound.some((o) => o.id === 'n2'), 'n1 → n2 outbound edge');
  assert.equal(backend.getNodeArticle('missing'), null);

  // search is empty until primeSearch warms the query, then returns the fact
  assert.deepEqual(backend.search('worktrees'), []);
  await backend.primeSearch('worktrees');
  const hits = backend.search('worktrees');
  assert.ok(hits.length >= 1, 'primed search returns a hit');
  assert.equal(hits[0].title, 'worktrees feed the merge gate');
});

test('ZepKbBackend with no client is cold-safe (empty graph, no throw)', async () => {
  const backend = new ZepKbBackend({ kbId: 'cycles', forgeRoot: FORGE_ROOT });
  await backend.prime();
  assert.deepEqual(backend.buildGraph(), { nodes: [], edges: [] });
  assert.deepEqual(backend.search('anything'), []);
  assert.ok(Array.isArray(backend.listPendingGuidance()));
});
