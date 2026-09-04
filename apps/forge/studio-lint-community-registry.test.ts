/**
 * REAL-ENTRY-POINT acceptance tests for the community-registry validation
 * section (W6-CR-1: studio/community/registry.yaml, superseding
 * catalog.yaml's former `community-skills:` section) — driven through the
 * ACTUAL `forge studio lint` entry point (`runStudioLint`,
 * `apps/forge/studio-lint.ts`), mirroring `apps/forge/studio-lint-community.test.ts`'s own
 * stated reason for testing at this level rather than calling
 * `validateCommunityRegistry` directly (that direct-call coverage lives in
 * `orchestrator/studio/validate.test.ts`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runStudioLint } from './studio-lint.ts';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'studio-lint-community-registry-'));
}

function seedValidProject(root: string, id = 'my-project'): void {
  const forgeDir = join(root, 'projects', id, '.forge');
  mkdirSync(forgeDir, { recursive: true });
  writeFileSync(join(forgeDir, 'project.json'), JSON.stringify({ name: id }), 'utf8');
}

/** A base root with everything runStudioLint needs to lint clean EXCEPT
 *  studio/community/registry.yaml, which the caller writes afterwards. */
function buildBaseRoot(): string {
  const root = tmpRoot();
  mkdirSync(join(root, 'skills'), { recursive: true }); // runStudioLint errors if skills/ is missing entirely
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
  seedValidProject(root);
  return root;
}

function writeRegistry(root: string, body: string): void {
  const dir = join(root, 'studio', 'community');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'registry.yaml'), body, 'utf8');
}

test('forge studio lint: NO studio/community/registry.yaml at all IS a lint error (seed-present, mirrors catalog.yaml) — reviewer fix: this content was previously mandatory inside catalog.yaml', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    const result = runStudioLint(root);
    const hits = result.findings.filter(
      (f) => f.level === 'error' && f.object === 'studio:community-registry' && f.check === 'seed-present',
    );
    assert.equal(
      hits.length,
      1,
      `expected exactly 1 seed-present error for a missing registry.yaml, got: ${JSON.stringify(result.findings)}`,
    );
    assert.match(hits[0].message, /registry\.yaml/);
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: a well-formed studio/community/registry.yaml → zero community-registry findings', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    writeRegistry(
      root,
      `meta:
  schemaVersion: 2
  lastRefresh: null
sources: {}
items:
  - id: clean-skill
    kind: skill
    name: Clean Skill
    category: testing
    sourceUrl: "https://example.com/clean-skill"
    provenance: "Test Author"
    signals: { attributedTo: "Test Author" }
`,
    );
    const result = runStudioLint(root);
    assert.equal(
      result.findings.filter((f) => f.object === 'community-registry' || f.object === 'studio:community-registry').length,
      0,
      `expected zero community-registry findings on a clean fixture — got: ${JSON.stringify(result.findings.filter((f) => /community-registry/.test(f.object)))}`,
    );
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: a MALFORMED studio/community/registry.yaml surfaces a real load finding from runStudioLint, the ACTUAL entry point', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    writeRegistry(root, 'items: [unclosed\n  bad: [[[ yaml');
    const result = runStudioLint(root);
    const hits = result.findings.filter((f) => f.level === 'error' && f.object === 'studio:community-registry' && f.check === 'load');
    assert.equal(hits.length, 1, `expected exactly 1 load-error finding for the malformed registry.yaml, got: ${JSON.stringify(result.findings)}`);
    assert.match(hits[0].message, /registry\.yaml/);
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: a duplicate (kind, id) pair in registry.yaml surfaces a real unique-ids finding from runStudioLint', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    writeRegistry(
      root,
      `meta:
  schemaVersion: 2
  lastRefresh: null
sources: {}
items:
  - id: dup-skill
    kind: skill
    name: Dup One
    category: testing
    sourceUrl: "https://example.com/dup-skill"
    provenance: "Test Author"
    signals: { attributedTo: "Test Author" }
  - id: dup-skill
    kind: skill
    name: Dup Two
    category: testing
    sourceUrl: "https://example.com/dup-skill-2"
    provenance: "Test Author"
    signals: { attributedTo: "Test Author" }
`,
    );
    const result = runStudioLint(root);
    const hits = result.findings.filter((f) => f.level === 'error' && f.check === 'unique-ids' && /dup-skill/.test(f.message));
    assert.equal(hits.length, 1, `expected exactly 1 duplicate-id finding naming "dup-skill", got: ${JSON.stringify(result.findings)}`);
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: an invalid tier in registry.yaml surfaces a real community-registry/tier finding from runStudioLint', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    writeRegistry(
      root,
      `meta:
  schemaVersion: 2
  lastRefresh: null
sources: {}
items:
  - id: bad-tier-skill
    kind: skill
    name: Bad Tier
    category: testing
    sourceUrl: "https://example.com/bad-tier-skill"
    provenance: "Test Author"
    tier: turbo
    signals: { attributedTo: "Test Author" }
`,
    );
    const result = runStudioLint(root);
    const hits = result.findings.filter((f) => f.level === 'error' && f.check === 'community-registry/tier' && /bad-tier-skill/.test(f.message));
    assert.equal(hits.length, 1, `expected exactly 1 community-registry/tier finding, got: ${JSON.stringify(result.findings)}`);
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});
