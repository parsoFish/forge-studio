import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadBrainIndex } from './brain-index.ts';

function scaffoldBrain(): string {
  const root = mkdtempSync(join(tmpdir(), 'brain-index-test-'));
  mkdirSync(join(root, 'brain', 'forge'), { recursive: true });
  mkdirSync(join(root, 'brain', 'projects', 'sample'), { recursive: true });

  writeFileSync(join(root, 'brain', 'INDEX.md'), '# Brain\n\ntop-level navigation.');
  writeFileSync(join(root, 'brain', 'forge', 'patterns.md'), '# Patterns\n\n- pattern A\n- pattern B');
  writeFileSync(join(root, 'brain', 'forge', 'antipatterns.md'), '# Antipatterns\n');
  writeFileSync(join(root, 'brain', 'forge', 'decisions.md'), '# Decisions\n');
  writeFileSync(join(root, 'brain', 'forge', 'operations.md'), '# Operations\n');
  writeFileSync(join(root, 'brain', 'forge', 'reference.md'), '# Reference\n');

  writeFileSync(join(root, 'brain', 'projects', 'sample', 'profile.md'), '# Sample profile\n\nhard constraints.');
  writeFileSync(join(root, 'brain', 'projects', 'sample', 'patterns.md'), '# Sample patterns\n');

  return root;
}

test('loadBrainIndex: includes all forge category indexes', () => {
  const root = scaffoldBrain();
  const output = loadBrainIndex({ cwd: root });

  for (const rel of [
    'brain/INDEX.md',
    'brain/forge/patterns.md',
    'brain/forge/antipatterns.md',
    'brain/forge/decisions.md',
    'brain/forge/operations.md',
    'brain/forge/reference.md',
  ]) {
    assert.ok(output.includes(`<!-- BRAIN INDEX: ${rel} -->`), `marker for ${rel}`);
  }
  assert.ok(output.includes('top-level navigation.'));
  assert.ok(output.includes('pattern A'));
});

test('loadBrainIndex: scope adds project profile + project category indexes when present', () => {
  const root = scaffoldBrain();
  const output = loadBrainIndex({ cwd: root, scope: 'sample' });

  assert.ok(output.includes('<!-- BRAIN INDEX: brain/projects/sample/profile.md -->'));
  assert.ok(output.includes('<!-- BRAIN INDEX: brain/projects/sample/patterns.md -->'));
  assert.ok(output.includes('hard constraints.'));
});

test('loadBrainIndex: missing project category files are silently skipped', () => {
  const root = scaffoldBrain();
  const output = loadBrainIndex({ cwd: root, scope: 'sample' });

  // antipatterns.md and decisions.md don't exist for `sample` — skipped.
  assert.ok(!output.includes('brain/projects/sample/antipatterns.md'));
  assert.ok(!output.includes('brain/projects/sample/decisions.md'));
});

test('loadBrainIndex: missing forge category emits a (missing) marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'brain-empty-'));
  // Don't scaffold — let the loader hit missing files.
  const output = loadBrainIndex({ cwd: root });
  assert.ok(output.includes('(missing)'));
});

test('loadBrainIndex: output is deterministic across invocations (cache-friendly)', () => {
  const root = scaffoldBrain();
  const a = loadBrainIndex({ cwd: root });
  const b = loadBrainIndex({ cwd: root });
  assert.equal(a, b);
});

test('loadBrainIndex: nonexistent scope adds nothing', () => {
  const root = scaffoldBrain();
  const baseline = loadBrainIndex({ cwd: root });
  const scoped = loadBrainIndex({ cwd: root, scope: 'does-not-exist' });
  assert.equal(scoped, baseline);
});
