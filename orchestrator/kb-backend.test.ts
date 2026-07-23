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
import { loadKbDescriptor, resolveKbProcesses } from './studio/registry.ts';

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
// KB-contract conformance (R1-01-F5): any backend + any binding kind must
// satisfy the four-process obligation set AND the KbBackend interface.
// Parameterized over the three real migrated descriptors — one per binding kind.
// ---------------------------------------------------------------------------

const CONFORMANCE_CASES = [
  { kind: 'unique', id: 'forge-dev', kbYaml: resolve(FORGE_ROOT, 'brain', 'forge-dev', 'kb.yaml') },
  { kind: 'flow', id: 'cycles', kbYaml: resolve(FORGE_ROOT, 'brain', 'cycles', 'kb.yaml') },
  { kind: 'project', id: 'mdtoc', kbYaml: resolve(FORGE_ROOT, 'brain', 'projects', 'mdtoc', 'kb.yaml') },
] as const;

for (const c of CONFORMANCE_CASES) {
  test(`KB-contract conformance: ${c.id} (binding.kind=${c.kind}) resolves the four-process obligation set`, () => {
    const kb = loadKbDescriptor(c.kbYaml);
    assert.equal(kb.binding.kind, c.kind, `${c.id} declares binding.kind=${c.kind}`);

    const procs = resolveKbProcesses(kb);
    for (const key of ['lint', 'ingest', 'consolidate'] as const) {
      const impl = procs[key];
      const hasBuiltin = 'builtin' in impl && typeof impl.builtin === 'string' && impl.builtin.length > 0;
      const hasCmd = 'cmd' in impl && typeof impl.cmd === 'string' && impl.cmd.length > 0;
      assert.ok(hasBuiltin !== hasCmd, `${c.id}.processes.${key} resolves to exactly one of {builtin}|{cmd}`);
    }
    assert.ok(['navigation-index', 'search'].includes(procs.usage.readSurface), 'usage.readSurface is a valid surface');
    assert.ok(procs.usage.readers.length > 0, 'usage.readers is non-empty');

    // deriveKbUsageDefaults: a project (Brain-3) KB additionally grants advisory
    // dev-loop/reviewer reads; flow/unique KBs grant planner+reflector only.
    if (c.kind === 'project') {
      assert.ok(
        procs.usage.readers.includes('dev-loop') && procs.usage.readers.includes('reviewer'),
        'project KB grants advisory dev-loop/reviewer reads',
      );
    } else {
      assert.ok(
        !procs.usage.readers.includes('dev-loop') && !procs.usage.readers.includes('reviewer'),
        `${c.kind} KB grants planner/reflector reads only`,
      );
    }
  });

  test(`KB-contract conformance: FilesystemKbBackend satisfies the interface for ${c.id}`, () => {
    const backend = getKbBackend(FORGE_ROOT, c.id);
    assert.equal(backend.kbId, c.id);
    assert.ok(backend instanceof FilesystemKbBackend);
    const graph = backend.buildGraph();
    assert.ok(Array.isArray(graph.nodes) && Array.isArray(graph.edges), 'buildGraph returns a graph');
    assert.ok(Array.isArray(backend.listPendingGuidance()), 'listPendingGuidance returns an array');
    assert.ok(Array.isArray(backend.search('index', 3)), 'search returns an array');
  });
}
