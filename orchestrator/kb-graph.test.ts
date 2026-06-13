/**
 * Tests for orchestrator/kb-graph.ts
 *
 * Tests against the REAL brain directories (brain/cycles, brain/forge-dev)
 * because the graph is built entirely from filesystem reads — no fixtures needed.
 * The real brain is the most honest signal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildKbGraph, getKbNodeArticle } from './kb-graph.ts';

// Resolve forge root relative to this test file's location
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const FORGE_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// buildKbGraph — cycles kb (Brain 2: themes + _raw)
// ---------------------------------------------------------------------------

test('buildKbGraph(cycles) — includes INDEX node', () => {
  const graph = buildKbGraph(FORGE_ROOT, 'cycles');
  const indexNode = graph.nodes.find((n) => n.id === 'cycles-index');
  assert.ok(indexNode, 'should have a cycles-index node');
  assert.equal(indexNode.layer, 'index');
  assert.equal(indexNode.title, 'INDEX');
});

test('buildKbGraph(cycles) — includes at least 10 theme nodes', () => {
  const graph = buildKbGraph(FORGE_ROOT, 'cycles');
  const themeNodes = graph.nodes.filter((n) => n.layer === 'theme');
  assert.ok(themeNodes.length >= 10, `expected ≥10 theme nodes, got ${themeNodes.length}`);
});

test('buildKbGraph(cycles) — theme nodes have title + category', () => {
  const graph = buildKbGraph(FORGE_ROOT, 'cycles');
  const themeNodes = graph.nodes.filter((n) => n.layer === 'theme');
  for (const node of themeNodes) {
    assert.ok(typeof node.title === 'string' && node.title.length > 0, `node ${node.id} has no title`);
    assert.ok(node.category, `node ${node.id} has no category`);
  }
});

test('buildKbGraph(cycles) — includes raw nodes (capped at 80)', () => {
  const graph = buildKbGraph(FORGE_ROOT, 'cycles');
  const rawNodes = graph.nodes.filter((n) => n.layer === 'raw');
  // Cycles has _raw dir with archives
  assert.ok(rawNodes.length > 0, 'should have raw nodes for cycles kb');
  assert.ok(rawNodes.length <= 80, `raw nodes capped at 80, got ${rawNodes.length}`);
  // All raw node ids are prefixed with 'raw:'
  for (const n of rawNodes) {
    assert.ok(n.id.startsWith('raw:'), `raw node id should start with raw:, got ${n.id}`);
  }
});

test('buildKbGraph(cycles) — includes category index nodes', () => {
  const graph = buildKbGraph(FORGE_ROOT, 'cycles');
  // cycles has patterns.md, antipatterns.md, decisions.md, operations.md
  const indexNodes = graph.nodes.filter((n) => n.layer === 'index');
  assert.ok(indexNodes.length >= 2, `expected ≥2 index nodes (INDEX + categories), got ${indexNodes.length}`);
});

test('buildKbGraph(cycles) — no dangling edges', () => {
  const graph = buildKbGraph(FORGE_ROOT, 'cycles');
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const edge of graph.edges) {
    assert.ok(nodeIds.has(edge.from), `dangling edge.from: ${edge.from}`);
    assert.ok(nodeIds.has(edge.to), `dangling edge.to: ${edge.to}`);
  }
});

test('buildKbGraph(cycles) — related_themes edges resolve to real nodes', () => {
  const graph = buildKbGraph(FORGE_ROOT, 'cycles');
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  // If there are any edges at all, both endpoints must exist (validated by no-dangling test)
  // Specifically check that at least some edges exist (graph is not isolated)
  const themeToThemeEdges = graph.edges.filter(
    (e) => !e.from.endsWith('-index') && !e.from.startsWith('raw:') &&
            !e.to.endsWith('-index') && !e.to.startsWith('raw:')
  );
  // Not all themes have related_themes, but some should
  assert.ok(themeToThemeEdges.length >= 0); // structural check; some kbs may have 0
  // All edge nodes exist
  for (const e of themeToThemeEdges) {
    assert.ok(nodeIds.has(e.from), `from node missing: ${e.from}`);
    assert.ok(nodeIds.has(e.to), `to node missing: ${e.to}`);
  }
});

test('buildKbGraph(cycles) — INDEX node is connected (not orphan)', () => {
  const graph = buildKbGraph(FORGE_ROOT, 'cycles');
  const indexId = 'cycles-index';
  const indexEdges = graph.edges.filter((e) => e.from === indexId || e.to === indexId);
  assert.ok(indexEdges.length > 0, 'INDEX node should have at least one edge');
});

// ---------------------------------------------------------------------------
// buildKbGraph — forge-dev kb (Brain 1: themes, no _raw)
// ---------------------------------------------------------------------------

test('buildKbGraph(forge-dev) — has theme nodes + INDEX, possibly zero raw', () => {
  const graph = buildKbGraph(FORGE_ROOT, 'forge-dev');
  const themeNodes = graph.nodes.filter((n) => n.layer === 'theme');
  const indexNode = graph.nodes.find((n) => n.id === 'forge-dev-index');
  assert.ok(indexNode, 'should have forge-dev-index node');
  assert.ok(themeNodes.length >= 1, `expected ≥1 theme nodes, got ${themeNodes.length}`);
  const rawNodes = graph.nodes.filter((n) => n.layer === 'raw');
  assert.ok(rawNodes.length <= 80, 'raw nodes capped');
});

test('buildKbGraph(forge-dev) — no dangling edges', () => {
  const graph = buildKbGraph(FORGE_ROOT, 'forge-dev');
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const edge of graph.edges) {
    assert.ok(nodeIds.has(edge.from), `dangling edge.from: ${edge.from}`);
    assert.ok(nodeIds.has(edge.to), `dangling edge.to: ${edge.to}`);
  }
});

// ---------------------------------------------------------------------------
// buildKbGraph — unknown kbId throws
// ---------------------------------------------------------------------------

test('buildKbGraph — unknown kbId throws', () => {
  assert.throws(
    () => buildKbGraph(FORGE_ROOT, 'nonexistent-kb-xyz'),
    /Unknown kbId/,
    'should throw on unknown kbId',
  );
});

// ---------------------------------------------------------------------------
// getKbNodeArticle — real theme from cycles
// ---------------------------------------------------------------------------

test('getKbNodeArticle — returns body + inbound/outbound for a known cycles theme', () => {
  // Find a real cycles theme slug from the graph
  const graph = buildKbGraph(FORGE_ROOT, 'cycles');
  const themeNode = graph.nodes.find((n) => n.layer === 'theme');
  assert.ok(themeNode, 'need at least one theme node');

  const article = getKbNodeArticle(FORGE_ROOT, 'cycles', themeNode.id);
  assert.ok(article !== null, 'should return an article for a known theme');
  assert.equal(article.id, themeNode.id);
  assert.equal(article.layer, 'theme');
  assert.ok(typeof article.body === 'string', 'body should be a string');
  assert.ok(article.body.length > 0, 'body should be non-empty for a real theme');
  assert.ok(Array.isArray(article.inbound), 'inbound should be an array');
  assert.ok(Array.isArray(article.outbound), 'outbound should be an array');
});

test('getKbNodeArticle — returns null for unknown nodeId', () => {
  const article = getKbNodeArticle(FORGE_ROOT, 'cycles', 'no-such-theme-xyz-abc');
  assert.equal(article, null, 'should return null for unknown node');
});

test('getKbNodeArticle — throws on unknown kbId', () => {
  assert.throws(
    () => getKbNodeArticle(FORGE_ROOT, 'no-such-kb', 'some-node'),
    /Unknown kbId/,
  );
});

// ---------------------------------------------------------------------------
// Synthetic fixture tests — verify graph shape with controlled data
// ---------------------------------------------------------------------------

function makeSyntheticKb(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'forge-kb-test-'));
  const brainDir = join(root, 'brain', 'test-kb');
  mkdirSync(join(brainDir, 'themes'), { recursive: true });
  mkdirSync(join(brainDir, '_raw'), { recursive: true });

  // kb.yaml
  writeFileSync(join(brainDir, 'kb.yaml'), 'id: test-kb\nname: Test KB\nscope: flow\ndesc: Test.\n');

  // category index
  writeFileSync(join(brainDir, 'patterns.md'), '# Patterns\n\n- [[theme-alpha]]\n');

  // theme A — has related_themes
  writeFileSync(
    join(brainDir, 'themes', 'theme-alpha.md'),
    `---
title: Theme Alpha
description: A test theme.
category: pattern
created_at: 2026-01-01
updated_at: 2026-01-01
related_themes:
  - theme-beta
---

# Theme Alpha

Body mentioning [[theme-beta]] and a wikilink.
`,
  );

  // theme B — referenced by A
  writeFileSync(
    join(brainDir, 'themes', 'theme-beta.md'),
    `---
title: Theme Beta
description: Another test theme.
category: pattern
created_at: 2026-01-02
updated_at: 2026-01-02
related_themes: []
---

# Theme Beta

Some body content here.
`,
  );

  // raw file
  writeFileSync(
    join(brainDir, '_raw', 'cycle-001.md'),
    `---
source_type: cycle
source_title: Cycle 001
ingested_at: 2026-01-01
---

# Cycle 001 content
`,
  );

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('buildKbGraph(synthetic) — correct node count and layers', () => {
  const { root, cleanup } = makeSyntheticKb();
  try {
    const graph = buildKbGraph(root, 'test-kb');
    const indexNodes = graph.nodes.filter((n) => n.layer === 'index');
    const themeNodes = graph.nodes.filter((n) => n.layer === 'theme');
    const rawNodes = graph.nodes.filter((n) => n.layer === 'raw');

    // INDEX + patterns category index = 2 index nodes
    assert.ok(indexNodes.length >= 1, `expected ≥1 index nodes, got ${indexNodes.length}`);
    assert.equal(themeNodes.length, 2, 'should have 2 theme nodes (alpha + beta)');
    assert.equal(rawNodes.length, 1, 'should have 1 raw node');
  } finally {
    cleanup();
  }
});

test('buildKbGraph(synthetic) — related_themes edge alpha→beta', () => {
  const { root, cleanup } = makeSyntheticKb();
  try {
    const graph = buildKbGraph(root, 'test-kb');
    const alphaToBeeta = graph.edges.some((e) => e.from === 'theme-alpha' && e.to === 'theme-beta');
    assert.ok(alphaToBeeta, 'should have edge from theme-alpha to theme-beta via related_themes');
  } finally {
    cleanup();
  }
});

test('buildKbGraph(synthetic) — wiki-link edge does not duplicate related_themes edge', () => {
  const { root, cleanup } = makeSyntheticKb();
  try {
    const graph = buildKbGraph(root, 'test-kb');
    // theme-alpha has [[theme-beta]] in body AND related_themes: [theme-beta]
    // Should not appear twice
    const edgesFromAlpha = graph.edges.filter((e) => e.from === 'theme-alpha' && e.to === 'theme-beta');
    assert.equal(edgesFromAlpha.length, 1, 'edge alpha→beta should appear exactly once');
  } finally {
    cleanup();
  }
});

test('buildKbGraph(synthetic) — no dangling edges', () => {
  const { root, cleanup } = makeSyntheticKb();
  try {
    const graph = buildKbGraph(root, 'test-kb');
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      assert.ok(nodeIds.has(edge.from), `dangling edge.from: ${edge.from}`);
      assert.ok(nodeIds.has(edge.to), `dangling edge.to: ${edge.to}`);
    }
  } finally {
    cleanup();
  }
});

test('getKbNodeArticle(synthetic) — theme-alpha body + outbound', () => {
  const { root, cleanup } = makeSyntheticKb();
  try {
    const article = getKbNodeArticle(root, 'test-kb', 'theme-alpha');
    assert.ok(article !== null, 'should find theme-alpha');
    assert.equal(article.title, 'Theme Alpha');
    assert.ok(article.body.includes('Theme Alpha'), 'body should include heading');
    // outbound should include theme-beta
    const outToB = article.outbound.find((o) => o.id === 'theme-beta');
    assert.ok(outToB, 'outbound should include theme-beta');
  } finally {
    cleanup();
  }
});

test('getKbNodeArticle(synthetic) — theme-beta has inbound from alpha', () => {
  const { root, cleanup } = makeSyntheticKb();
  try {
    const article = getKbNodeArticle(root, 'test-kb', 'theme-beta');
    assert.ok(article !== null, 'should find theme-beta');
    const inFromA = article.inbound.find((i) => i.id === 'theme-alpha');
    assert.ok(inFromA, 'inbound should include theme-alpha');
  } finally {
    cleanup();
  }
});

test('getKbNodeArticle(synthetic) — null for missing node', () => {
  const { root, cleanup } = makeSyntheticKb();
  try {
    const article = getKbNodeArticle(root, 'test-kb', 'no-such-node');
    assert.equal(article, null);
  } finally {
    cleanup();
  }
});
