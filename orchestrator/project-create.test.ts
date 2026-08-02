/**
 * Tests for the greenfield project creation agent (R4-03).
 *
 * F2 AC: each curated template's scaffold passes the preflight HARD clauses
 * unmodified. F3 AC: create → contract-green, ready for the first architect run,
 * with no manual repo surgery. Fully isolated: a temp forge root with the real
 * templates copied in, so the brain seed + preflight don't touch the live repo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  scaffoldGreenfieldProject,
  validateCreationManifest,
  listProjectStarters,
  projectStartersDir,
  hasUnsubstitutedTokens,
  type CreationManifest,
} from './project-create.ts';

const REAL_ROOT = process.cwd();

/** A temp forge root with the real project starters copied in + a brain/projects dir. */
function isolatedForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pcreate-'));
  const startersDest = join(root, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(REAL_ROOT), startersDest, { recursive: true });
  mkdirSync(join(root, 'brain', 'projects'), { recursive: true });
  mkdirSync(join(root, 'projects'), { recursive: true });
  return root;
}

function manifest(over: Partial<CreationManifest> = {}): CreationManifest {
  return { name: 'My Tool', appType: 'typescript-cli', language: 'typescript', northStar: 'ship the thing', ...over };
}

test('F1 validateCreationManifest: missing/invalid fields throw; valid → typed', () => {
  assert.throws(() => validateCreationManifest({ name: 'x' }), /appType.*required/);
  assert.throws(() => validateCreationManifest({ name: 'x', appType: 'a', language: 'ts', northStar: 'y'.repeat(141) }), /≤140/);
  const m = validateCreationManifest({ name: ' My Tool ', appType: 'typescript-cli', language: 'typescript', northStar: 'go' });
  assert.equal(m.name, 'My Tool');
  assert.equal(m.appType, 'typescript-cli');
});

test('F2: the curated starter library lists ≥2 app types', () => {
  const types = listProjectStarters(REAL_ROOT);
  assert.ok(types.includes('typescript-cli') && types.includes('typescript-api'), `got ${types.join(', ')}`);
  assert.ok(types.length >= 2);
});

for (const appType of ['typescript-cli', 'typescript-api']) {
  test(`F2/F3: scaffolding "${appType}" reaches preflight HARD-green with no manual surgery`, () => {
    const forgeRoot = isolatedForgeRoot();
    try {
      const out = scaffoldGreenfieldProject({ manifest: manifest({ appType }), forgeRoot });
      assert.equal(
        out.hardGreen,
        true,
        `expected hard-green; failing: ${out.failingClauses.map((c) => `${c.clause}:${c.detail}`).join(' | ')}`,
      );
      assert.equal(out.id, 'my-tool');
      // Tokens fully substituted across every scaffolded file.
      for (const rel of out.filesWritten) {
        assert.equal(hasUnsubstitutedTokens(readFileSync(join(out.projectDir, rel), 'utf8')), false, `${rel} has unsubstituted tokens`);
      }
      // The name/northStar landed in the real files.
      assert.match(readFileSync(join(out.projectDir, 'package.json'), 'utf8'), /"name": "my-tool"/);
      assert.match(readFileSync(join(out.projectDir, 'AGENTS.md'), 'utf8'), /ship the thing/);
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });
}

test('F2/F3: a north star with a quote/backslash produces VALID JSON + stays hard-green', () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    const out = scaffoldGreenfieldProject({
      manifest: manifest({ name: 'TOC Tool', northStar: 'A "smart" TOC \\ injector' }),
      forgeRoot,
    });
    assert.equal(out.hardGreen, true, `quotes must not break the scaffold; failing: ${out.failingClauses.map((c) => c.clause).join(',')}`);
    // The scaffolded JSON files parse (would throw here otherwise).
    for (const rel of ['package.json', '.forge/project.json']) {
      const parsed = JSON.parse(readFileSync(join(out.projectDir, rel), 'utf8'));
      assert.ok(parsed, `${rel} is valid JSON`);
    }
    const cfg = JSON.parse(readFileSync(join(out.projectDir, '.forge', 'project.json'), 'utf8')) as { northStar: string };
    assert.equal(cfg.northStar, 'A "smart" TOC \\ injector', 'the value round-trips exactly through JSON');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('F2: a value containing a $-replacement pattern is inserted literally (no leftover token)', () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    const out = scaffoldGreenfieldProject({ manifest: manifest({ northStar: 'before $& and $$ after' }), forgeRoot });
    for (const rel of out.filesWritten) {
      assert.equal(hasUnsubstitutedTokens(readFileSync(join(out.projectDir, rel), 'utf8')), false, `${rel} fully substituted`);
    }
    assert.match(readFileSync(join(out.projectDir, 'README.md'), 'utf8'), /before \$& and \$\$ after/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('F1: a manifest field with a newline/control char is rejected', () => {
  assert.throws(() => validateCreationManifest({ name: 'x\ny', appType: 'typescript-cli', language: 'ts', northStar: 'z' }), /single line/);
});

test('F3: an unknown appType throws with the available list', () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    assert.throws(() => scaffoldGreenfieldProject({ manifest: manifest({ appType: 'cobol-mainframe' }), forgeRoot }), /unknown appType/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('F3: a duplicate project id is refused', () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot });
    assert.throws(() => scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }), /already exists/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('the shipped templates carry no stray files that would break substitution', () => {
  // Each app-type dir has the load-bearing files.
  for (const appType of ['typescript-cli', 'typescript-api']) {
    const entries = readdirSync(join(projectStartersDir(REAL_ROOT), appType));
    assert.ok(entries.includes('package.json') && entries.includes('AGENTS.md') && entries.includes('roadmap.md'));
  }
});
