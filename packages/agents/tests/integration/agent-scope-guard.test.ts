/**
 * Tests for the shared agent scope guard — specifically the three blind spots
 * the 2026-07-24 adversarial review confirmed against the porcelain path-set
 * approach: untracked-dir collapse, gitignored .forge/ trees, and overwrites
 * of pre-existing .forge files. Plus guard-integrity fail-loud on git error.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { takeScopeSnapshot, scopeViolations, type ScopeSnapshot } from '../../phases/agent-scope-guard.ts';

function makeRepo(opts: { ignoreForge?: boolean } = {}): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'scope-guard-'));
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 'T']);
  writeFileSync(join(root, 'src.ts'), 'export const v = 1;\n');
  if (opts.ignoreForge) writeFileSync(join(root, '.gitignore'), '.forge/\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function okSnap(s: ScopeSnapshot): Extract<ScopeSnapshot, { ok: true }> {
  assert.ok(s.ok, 'snapshot must succeed');
  return s;
}

test('untracked-dir collapse: a NEW file nested under an untracked dir is individually visible (-uall)', () => {
  const { root, cleanup } = makeRepo();
  try {
    mkdirSync(join(root, 'demo', 'INIT-x'), { recursive: true });
    writeFileSync(join(root, 'demo', 'INIT-x', 'demo.json'), '{}');
    const before = okSnap(takeScopeSnapshot(root));
    writeFileSync(join(root, 'demo', 'INIT-x', 'evil.txt'), 'x');
    const after = okSnap(takeScopeSnapshot(root));
    const violations = scopeViolations(before, after, (p) => p === 'demo/INIT-x/demo.json');
    assert.deepEqual(violations, ['demo/INIT-x/evil.txt']);
  } finally {
    cleanup();
  }
});

test('gitignored .forge/: a new file under an ignored .forge tree is caught by the walk layer', () => {
  const { root, cleanup } = makeRepo({ ignoreForge: true });
  try {
    mkdirSync(join(root, '.forge', 'review-input'), { recursive: true });
    writeFileSync(join(root, '.forge', 'review-input', 'diff.patch'), 'diff');
    const before = okSnap(takeScopeSnapshot(root));
    writeFileSync(join(root, '.forge', 'project.json'), '{"corrupted":true}');
    const after = okSnap(takeScopeSnapshot(root));
    const violations = scopeViolations(before, after, (p) => p === '.forge/review-findings.json');
    assert.deepEqual(violations, ['.forge/project.json']);
  } finally {
    cleanup();
  }
});

test('overwrite of a pre-existing .forge file is caught via the size:mtime stamp', () => {
  const { root, cleanup } = makeRepo({ ignoreForge: true });
  try {
    mkdirSync(join(root, '.forge'), { recursive: true });
    writeFileSync(join(root, '.forge', 'last-gate-failure.md'), 'original');
    utimesSync(join(root, '.forge', 'last-gate-failure.md'), new Date(0), new Date(0));
    const before = okSnap(takeScopeSnapshot(root));
    writeFileSync(join(root, '.forge', 'last-gate-failure.md'), 'tampered!');
    const after = okSnap(takeScopeSnapshot(root));
    const violations = scopeViolations(before, after, () => false);
    assert.deepEqual(violations, ['.forge/last-gate-failure.md']);
  } finally {
    cleanup();
  }
});

test('allowed writes produce no violations; unchanged dirt is never blamed', () => {
  const { root, cleanup } = makeRepo();
  try {
    writeFileSync(join(root, 'pre-existing-untracked.txt'), 'dirt');
    const before = okSnap(takeScopeSnapshot(root));
    mkdirSync(join(root, '.forge'), { recursive: true });
    writeFileSync(join(root, '.forge', 'review-findings.json'), '{}');
    const after = okSnap(takeScopeSnapshot(root));
    const violations = scopeViolations(before, after, (p) => p === '.forge/review-findings.json');
    assert.deepEqual(violations, []);
  } finally {
    cleanup();
  }
});

test('guard integrity: a non-repo dir fails LOUD (ok:false), never an empty clean snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scope-guard-norepo-'));
  try {
    const snap = takeScopeSnapshot(dir);
    assert.equal(snap.ok, false);
    assert.ok((snap as { error: string }).error.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
