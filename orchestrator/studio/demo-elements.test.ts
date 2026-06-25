/**
 * Tests for the forge demo-element library loader (skill-creating skills under
 * studio/demo-elements/<id>.md).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { listDemoElements, loadDemoElement } from './registry.ts';
import { DEMO_STEP_KINDS } from './types.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');

test('listDemoElements loads the seeded forge library with valid phases', () => {
  const els = listDemoElements(FORGE_ROOT);
  assert.ok(els.length >= 4, `expected the seeded library, got ${els.length}`);
  const byId = Object.fromEntries(els.map((e) => [e.id, e]));
  // The representative starter set exists.
  for (const id of ['cli-capture', 'test-evidence', 'code-diff']) {
    assert.ok(byId[id], `element ${id} present`);
  }
  assert.equal(byId['cli-capture'].phase, 'capture');
  assert.equal(byId['test-evidence'].phase, 'verify');
  assert.equal(byId['code-diff'].phase, 'present');
  // Every element declares a valid phase + a non-empty body (the generator prompt).
  for (const e of els) {
    assert.ok(DEMO_STEP_KINDS.includes(e.phase), `${e.id} phase valid`);
    assert.ok(e.body.length > 0, `${e.id} has a generator body`);
    assert.ok(e.name.length > 0 && e.description.length > 0);
  }
});

test('loadDemoElement parses frontmatter + body; throws on missing required field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-el-'));
  const elDir = join(dir, 'studio', 'demo-elements');
  mkdirSync(elDir, { recursive: true });
  writeFileSync(
    join(elDir, 'metric-delta.md'),
    '---\nid: metric-delta\nname: Metric delta\nphase: verify\ndescription: Before/after of a scalar metric.\nconfigHint: The metric command.\n---\n\n# gen body\n',
  );
  const el = loadDemoElement(join(elDir, 'metric-delta.md'));
  assert.equal(el.id, 'metric-delta');
  assert.equal(el.phase, 'verify');
  assert.match(el.body, /gen body/);
  // Missing `phase` → throws (lint surfaces it).
  writeFileSync(join(elDir, 'bad.md'), '---\nid: bad\nname: Bad\ndescription: x\n---\nbody');
  assert.throws(() => loadDemoElement(join(elDir, 'bad.md')), /phase/);
  rmSync(dir, { recursive: true, force: true });
});
