/**
 * session-kind-registry.test.ts — review finding 1's registry reader.
 *
 * The parity test pins this module to the REAL `studio/session-kinds.yaml`,
 * the same way `ground-hash.test.ts` pins `METHOD_C_CMD` to the launcher's
 * literal pipeline: a fence that reads its own invented copy of a product
 * fact is not reading the product.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRegisteredSessionKindIds } from './session-kind-registry.mjs';

const ROOT = join(import.meta.dirname, '..', '..');

test('loadRegisteredSessionKindIds: reads the REAL studio/session-kinds.yaml, not an invented list', () => {
  const ids = loadRegisteredSessionKindIds(ROOT);
  // Every id `studio/session-kinds.yaml` declares today (`grep '^- id:'`).
  for (const id of ['architect', 'instructions', 'project-brain', 'demo', 'onboarding', 'authoring', 'kb-cleanup']) {
    assert.ok(ids.has(id), `expected the real registry to declare ${id}`);
  }
  // And nothing this module invented — a made-up kind is not in the real file.
  assert.equal(ids.has('snapshots'), false);
});

function withRegistry(yamlText) {
  const dir = mkdtempSync(join(tmpdir(), 'session-kind-registry-'));
  mkdirSync(join(dir, 'studio'), { recursive: true });
  writeFileSync(join(dir, 'studio', 'session-kinds.yaml'), yamlText);
  return dir;
}

test('loadRegisteredSessionKindIds: a missing registry file throws, naming the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-kind-registry-missing-'));
  assert.throws(() => loadRegisteredSessionKindIds(dir), /session-kinds\.yaml.*cannot read/s);
  rmSync(dir, { recursive: true, force: true });
});

test('loadRegisteredSessionKindIds: unparseable YAML throws rather than returning an empty registry silently', () => {
  const dir = withRegistry('- id: architect\n  bad indent\n\tmixed: tabs\n');
  assert.throws(() => loadRegisteredSessionKindIds(dir), /unparseable YAML/);
  rmSync(dir, { recursive: true, force: true });
});

test('loadRegisteredSessionKindIds: a non-sequence root throws, naming what it got instead', () => {
  const dir = withRegistry('architect:\n  id: architect\n');
  assert.throws(() => loadRegisteredSessionKindIds(dir), /top-level YAML sequence/);
  rmSync(dir, { recursive: true, force: true });
});

test('loadRegisteredSessionKindIds: an entry with no id is skipped leniently, mirroring loadSessionKinds\' AT-16 leniency', () => {
  const dir = withRegistry('- title: no id here\n- id: instructions\n  title: fine\n');
  const ids = loadRegisteredSessionKindIds(dir);
  assert.deepEqual([...ids], ['instructions']);
  rmSync(dir, { recursive: true, force: true });
});
