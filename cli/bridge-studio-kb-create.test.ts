/**
 * Tests for POST /api/studio/kbs (KB create, M5-4).
 *
 * Spins up a real bridge against a tmp forge-root fixture with a minimal
 * brain/ dir (cycles + forge-dev kb.yaml stubs).
 *
 * Covers:
 *   POST /api/studio/kbs           — creates brain/<id>/ + kb.yaml + themes/ + _raw/
 *   POST /api/studio/kbs           — loadKbDescriptor can round-trip the written kb.yaml
 *   POST /api/studio/kbs           — duplicate id → 409
 *   POST /api/studio/kbs           — missing binding → 400
 *   POST /api/studio/kbs           — bad binding.kind → 400
 *   POST /api/studio/kbs           — flow/project binding missing ref → 400
 *   POST /api/studio/kbs           — dangling binding.ref (flow/project) → 400
 *   POST /api/studio/kbs           — traversal id → 400
 *   POST /api/studio/kbs           — empty name → 400
 *   POST /api/studio/kbs           — empty desc → 400
 *   POST /api/studio/kbs           — missing CSRF → 403
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { loadKbDescriptor } from '../orchestrator/studio/registry.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const CYCLES_KB_YAML = `id: cycles\nname: Cycles Brain\nbinding: { kind: flow, ref: forge-develop }\ndesc: Cross-cycle patterns.\n`;
const FORGE_DEV_KB_YAML = `id: forge-dev\nname: Forge Dev Brain\nbinding: { kind: unique }\ndesc: Forge engineering decisions.\n`;

// ---------------------------------------------------------------------------
// Bridge lifecycle
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-kb-create-'));

  // Minimal _queue dirs required by startBridge / listRuns
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  // Minimal brain structure with two existing KBs
  mkdirSync(join(forgeRoot, 'brain', 'cycles', 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'cycles', '_raw'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'cycles', 'kb.yaml'), CYCLES_KB_YAML);

  mkdirSync(join(forgeRoot, 'brain', 'forge-dev', 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'forge-dev', '_raw'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'forge-dev', 'kb.yaml'), FORGE_DEV_KB_YAML);

  // A registered flow + a discovered project, so binding.ref existence checks
  // (R1-01) have something real to resolve against.
  mkdirSync(join(forgeRoot, 'studio', 'flows', 'forge-develop'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', 'demo-project'), { recursive: true });

  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeServer = result.close;
});

after(async () => {
  await closeServer?.();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function post(
  path: string,
  body?: Record<string, unknown>,
  nocsrf = false,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!nocsrf) headers['x-forge-csrf'] = '1';
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('POST /api/studio/kbs: creates brain/<id>/ + kb.yaml + themes/ + _raw/', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'my-project-brain',
    name: 'My Project Brain',
    binding: { kind: 'project', ref: 'demo-project' },
    desc: 'Brain for my project.',
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true);
  assert.equal(json['id'], 'my-project-brain');

  // Verify filesystem scaffold
  const kbDir = join(forgeRoot, 'brain', 'my-project-brain');
  assert.ok(existsSync(kbDir), 'kb dir created');
  assert.ok(existsSync(join(kbDir, 'themes')), 'themes/ created');
  assert.ok(existsSync(join(kbDir, '_raw')), '_raw/ created');
  assert.ok(existsSync(join(kbDir, 'kb.yaml')), 'kb.yaml created');
});

test('POST /api/studio/kbs: loadKbDescriptor can round-trip the written kb.yaml', async () => {
  await post('/api/studio/kbs', {
    id: 'roundtrip-brain',
    name: 'Round Trip Brain',
    binding: { kind: 'flow', ref: 'forge-develop' },
    desc: 'Testing round-trip.',
  });

  const kbYamlPath = join(forgeRoot, 'brain', 'roundtrip-brain', 'kb.yaml');
  assert.ok(existsSync(kbYamlPath), 'kb.yaml exists');

  const descriptor = loadKbDescriptor(kbYamlPath);
  assert.equal(descriptor.id, 'roundtrip-brain');
  assert.equal(descriptor.name, 'Round Trip Brain');
  assert.deepEqual(descriptor.binding, { kind: 'flow', ref: 'forge-develop' });
  assert.equal(descriptor.desc, 'Testing round-trip.');
});

test('POST /api/studio/kbs: duplicate id → 409', async () => {
  // First creation should succeed
  await post('/api/studio/kbs', {
    id: 'duplicate-brain',
    name: 'Duplicate Brain',
    binding: { kind: 'project', ref: 'demo-project' },
    desc: 'First.',
  });

  // Second creation of same id → 409
  const { status, json } = await post('/api/studio/kbs', {
    id: 'duplicate-brain',
    name: 'Duplicate Brain 2',
    binding: { kind: 'project', ref: 'demo-project' },
    desc: 'Second.',
  });
  assert.equal(status, 409, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
  assert.ok((json['error'] as string).includes('already exists'));
});

test('POST /api/studio/kbs: missing binding → 400', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'no-binding-brain',
    name: 'No Binding Brain',
    desc: 'Testing missing binding.',
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
  assert.ok((json['error'] as string).toLowerCase().includes('binding'));
});

test('POST /api/studio/kbs: bad binding.kind → 400', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'bad-binding-brain',
    name: 'Bad Binding Brain',
    binding: { kind: 'invalid-kind' },
    desc: 'Testing bad binding kind.',
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
  assert.ok((json['error'] as string).toLowerCase().includes('binding.kind'));
});

test('POST /api/studio/kbs: flow binding missing ref → 400', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'flow-no-ref-brain',
    name: 'Flow No Ref Brain',
    binding: { kind: 'flow' },
    desc: 'Testing flow binding without a ref.',
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
  assert.ok((json['error'] as string).toLowerCase().includes('ref'));
});

test('POST /api/studio/kbs: dangling flow binding.ref → 400', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'dangling-flow-brain',
    name: 'Dangling Flow Brain',
    binding: { kind: 'flow', ref: 'no-such-flow' },
    desc: 'Testing a dangling flow ref.',
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
  assert.ok((json['error'] as string).includes('no-such-flow'));
});

test('POST /api/studio/kbs: dangling project binding.ref → 400', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'dangling-project-brain',
    name: 'Dangling Project Brain',
    binding: { kind: 'project', ref: 'no-such-project' },
    desc: 'Testing a dangling project ref.',
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
  assert.ok((json['error'] as string).includes('no-such-project'));
});

test('POST /api/studio/kbs: binding.kind=unique needs no ref', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'unique-kind-brain',
    name: 'Unique Kind Brain',
    binding: { kind: 'unique' },
    desc: 'Testing a unique binding.',
  });
  assert.equal(status, 200, JSON.stringify(json));

  const kbYamlPath = join(forgeRoot, 'brain', 'unique-kind-brain', 'kb.yaml');
  const descriptor = loadKbDescriptor(kbYamlPath);
  assert.deepEqual(descriptor.binding, { kind: 'unique' });
});

test('POST /api/studio/kbs: path traversal id → 400', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: '../evil',
    name: 'Evil Brain',
    binding: { kind: 'project', ref: 'demo-project' },
    desc: 'Traversal attempt.',
  });
  assert.equal(status, 400, JSON.stringify(json));
});

test('POST /api/studio/kbs: empty name → 400', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'empty-name-brain',
    name: '',
    binding: { kind: 'project', ref: 'demo-project' },
    desc: 'Testing empty name.',
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
});

test('POST /api/studio/kbs: empty desc → 400', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'empty-desc-brain',
    name: 'Empty Desc Brain',
    binding: { kind: 'project', ref: 'demo-project' },
    desc: '',
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
});

test('POST /api/studio/kbs: missing CSRF → 403', async () => {
  const { status } = await post(
    '/api/studio/kbs',
    {
      id: 'no-csrf-brain',
      name: 'No CSRF Brain',
      binding: { kind: 'project', ref: 'demo-project' },
      desc: 'No CSRF.',
    },
    true, // nocsrf=true
  );
  assert.equal(status, 403);
});

test('POST /api/studio/kbs: kb.yaml content has correct fields', async () => {
  await post('/api/studio/kbs', {
    id: 'content-check-brain',
    name: 'Content Check Brain',
    binding: { kind: 'unique' },
    desc: 'Checking yaml content.',
  });

  const kbYamlPath = join(forgeRoot, 'brain', 'content-check-brain', 'kb.yaml');
  const content = readFileSync(kbYamlPath, 'utf8');
  assert.ok(content.includes('id: content-check-brain'));
  assert.ok(content.includes('name: Content Check Brain'));
  assert.ok(content.includes('kind: unique'));
  assert.ok(content.includes('desc: Checking yaml content.'));
});

// ---------------------------------------------------------------------------
// Fix #1: YAML injection — name with embedded newline must not inject extra keys
// ---------------------------------------------------------------------------

test('POST /api/studio/kbs: newline in name does not inject extra YAML keys', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'injection-brain',
    name: 'foo\nbinding: evil',
    binding: { kind: 'project', ref: 'demo-project' },
    desc: 'Normal desc.',
  });
  assert.equal(status, 200, JSON.stringify(json));

  const kbYamlPath = join(forgeRoot, 'brain', 'injection-brain', 'kb.yaml');
  // Round-trip via loadKbDescriptor — must parse to the literal name, no injected binding
  const descriptor = loadKbDescriptor(kbYamlPath);
  assert.equal(descriptor.name, 'foo\nbinding: evil', 'name round-trips to literal value');
  assert.deepEqual(descriptor.binding, { kind: 'project', ref: 'demo-project' }, 'binding is not overwritten by injection');
  assert.equal(descriptor.id, 'injection-brain');
  assert.equal(descriptor.desc, 'Normal desc.');
});

test('POST /api/studio/kbs: YAML-special desc value round-trips correctly', async () => {
  const specialDesc = 'Brain: "a:b" > c & d [test]';
  const { status, json } = await post('/api/studio/kbs', {
    id: 'special-desc-brain',
    name: 'Special Desc Brain',
    binding: { kind: 'flow', ref: 'forge-develop' },
    desc: specialDesc,
  });
  assert.equal(status, 200, JSON.stringify(json));

  const kbYamlPath = join(forgeRoot, 'brain', 'special-desc-brain', 'kb.yaml');
  const descriptor = loadKbDescriptor(kbYamlPath);
  assert.equal(descriptor.desc, specialDesc, 'YAML-special desc round-trips correctly');
});

// ---------------------------------------------------------------------------
// DELETE /api/studio/kbs/:id (R1-5)
// ---------------------------------------------------------------------------

async function del(path: string, nocsrf = false): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (!nocsrf) headers['x-forge-csrf'] = '1';
  const res = await fetch(`${bridgeUrl}${path}`, { method: 'DELETE', headers });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

test('DELETE /api/studio/kbs/:id removes the brain dir', async () => {
  await post('/api/studio/kbs', {
    id: 'doomed-brain',
    name: 'Doomed',
    binding: { kind: 'project', ref: 'demo-project' },
    desc: 'to be deleted',
  });
  assert.equal(existsSync(join(forgeRoot, 'brain', 'doomed-brain')), true);
  const { status, json } = await del('/api/studio/kbs/doomed-brain');
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(existsSync(join(forgeRoot, 'brain', 'doomed-brain')), false, 'brain dir removed');
});

test('DELETE a forge-owned core brain (cycles) → 403 (guarded)', async () => {
  const { status } = await del('/api/studio/kbs/cycles');
  assert.equal(status, 403);
  assert.equal(existsSync(join(forgeRoot, 'brain', 'cycles')), true, 'cycles brain preserved');
});

test('DELETE an unknown kb → 404', async () => {
  const { status } = await del('/api/studio/kbs/no-such-brain');
  assert.equal(status, 404);
});

test('CORS preflight (OPTIONS) advertises DELETE — else the browser blocks the delete', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/kbs/anything`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('access-control-allow-methods') ?? '', /DELETE/);
});

test('DELETE without CSRF header → 403', async () => {
  await post('/api/studio/kbs', {
    id: 'csrf-brain',
    name: 'CSRF',
    binding: { kind: 'project', ref: 'demo-project' },
    desc: 'x',
  });
  const { status } = await del('/api/studio/kbs/csrf-brain', true);
  assert.equal(status, 403);
  assert.equal(existsSync(join(forgeRoot, 'brain', 'csrf-brain')), true, 'not deleted without CSRF');
});
