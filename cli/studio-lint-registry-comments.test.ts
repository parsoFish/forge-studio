/**
 * W8-B5 WI-2(b) — closing the comment-loss CLASS (exit row E4, community-28),
 * driven through the REAL `forge studio lint` entry point.
 *
 * `serializeCommunityRegistry` now preserves the file's LEADING comment block,
 * which covers the 22 header lines that carry registry.yaml's actual curation
 * rationale. It provably cannot preserve a comment written INSIDE the `items:`
 * block — js-yaml has no comment round-trip and the serializer dumps a freshly
 * built object.
 *
 * Fixing only the leading block would ship this campaign's single most-repeated
 * defect: a fix carrying its own instance of the bug it closed. So the residual
 * is made UNWRITABLE instead of merely rare — `forge studio lint` errors on it,
 * naming the line. You cannot lose what the linter refuses to accept.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runStudioLint } from './studio-lint.ts';

function buildBaseRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-lint-registry-comments-'));
  mkdirSync(join(root, 'skills'), { recursive: true });
  mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
  writeFileSync(
    join(root, 'studio', 'catalog.yaml'),
    `sdks:
  - { id: claude-agent-sdk, name: Claude Agent SDK, available: true }
models:
  - { id: claude-sonnet-4-6, name: Sonnet 4.6, sdk: claude-agent-sdk, tier: standard }
tools: []
mcps: []
guards: []
`,
    'utf8',
  );
  const forgeDir = join(root, 'projects', 'my-project', '.forge');
  mkdirSync(forgeDir, { recursive: true });
  writeFileSync(join(forgeDir, 'project.json'), JSON.stringify({ name: 'my-project' }), 'utf8');
  return root;
}

function writeRegistry(root: string, body: string): void {
  const dir = join(root, 'studio', 'community');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'registry.yaml'), body, 'utf8');
}

const CLEAN = `# header rationale — this block IS preserved by the serializer
meta:
  schemaVersion: 2
  lastRefresh: null
sources:
  "github:o/r":
    stars: 10
    starsDisplay: "10"
    upstreamUpdatedAt: null
    fetchedAt: null
    fetchedBy: seed
items:
  - id: a
    kind: skill
    name: A
    category: testing
    sourceUrl: "https://github.com/o/r"
    provenance: "o/r"
    signals:
      attributedTo: "o/r"
`;

function commentFindings(root: string) {
  return runStudioLint(root).findings.filter(
    (f) => f.object === 'studio:community-registry' && f.check === 'community-registry/lossy-comment',
  );
}

test('forge studio lint: a clean registry (header comments only) produces NO lossy-comment finding', () => {
  const root = buildBaseRoot();
  try {
    writeRegistry(root, CLEAN);
    assert.deepEqual(commentFindings(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: a FULL-LINE comment inside items: is an ERROR naming its line number', () => {
  const root = buildBaseRoot();
  try {
    const lines = CLEAN.split('\n');
    const at = lines.findIndex((l) => l.startsWith('items:'));
    lines.splice(at + 2, 0, '    # this rationale would be destroyed by the next write');
    writeRegistry(root, lines.join('\n'));
    const hits = commentFindings(root);
    assert.equal(hits.length, 1, `expected 1 lossy-comment error, got ${JSON.stringify(hits)}`);
    assert.equal(hits[0].level, 'error');
    assert.match(hits[0].message, new RegExp(`\\b${at + 3}\\b`), `must name line ${at + 3}: ${hits[0].message}`);
    assert.match(hits[0].message, /items:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: a TRAILING inline comment inside items: is an ERROR too', () => {
  const root = buildBaseRoot();
  try {
    writeRegistry(root, CLEAN.replace('    category: testing', '    category: testing # curated by hand'));
    const hits = commentFindings(root);
    assert.equal(hits.length, 1, `expected 1 lossy-comment error, got ${JSON.stringify(hits)}`);
    assert.equal(hits[0].level, 'error');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: EVERY lossy comment is reported, not just the first (a one-line report trains a one-line fix)', () => {
  const root = buildBaseRoot();
  try {
    const lines = CLEAN.split('\n');
    const at = lines.findIndex((l) => l.startsWith('items:'));
    lines.splice(at + 1, 0, '  # one', '  # two');
    writeRegistry(root, lines.join('\n'));
    assert.equal(commentFindings(root).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: a "#" inside a quoted sourceUrl is NOT reported (kills: a naive substring scan)', () => {
  const root = buildBaseRoot();
  try {
    writeRegistry(root, CLEAN.replace('"https://github.com/o/r"', '"https://github.com/o/r#readme"'));
    assert.deepEqual(commentFindings(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("forge studio lint: forge's OWN shipped registry.yaml carries no lossy comment (the gate is live on the real file)", () => {
  const hits = runStudioLint(process.cwd()).findings.filter(
    (f) => f.object === 'studio:community-registry' && f.check === 'community-registry/lossy-comment',
  );
  assert.deepEqual(hits, [], `studio/community/registry.yaml carries comments a write would destroy: ${JSON.stringify(hits)}`);
});
