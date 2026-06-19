/**
 * Contract test for the KbBackend seam (ADR-027 §4).
 *
 * Asserts what every KbBackend must satisfy and that the default
 * FilesystemKbBackend delegates correctly to kb-graph.ts. A future second
 * backend must pass an equivalent suite before registration — this is the KB
 * analogue of the RuntimeAdapter conformance suite (ADR-029).
 *
 * Tests run against the REAL `cycles` brain (filesystem reads, no fixtures).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { getKbBackend, FilesystemKbBackend, type KbBackend } from './kb-backend.ts';
import { buildKbGraph } from './kb-graph.ts';

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
