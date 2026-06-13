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
 *   POST /api/studio/kbs           — bad scope → 400
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

const CYCLES_KB_YAML = `id: cycles\nname: Cycles Brain\nscope: flow\ndesc: Cross-cycle patterns.\n`;
const FORGE_DEV_KB_YAML = `id: forge-dev\nname: Forge Dev Brain\nscope: agent-integration\ndesc: Forge engineering decisions.\n`;

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
    scope: 'project',
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
    scope: 'flow',
    desc: 'Testing round-trip.',
  });

  const kbYamlPath = join(forgeRoot, 'brain', 'roundtrip-brain', 'kb.yaml');
  assert.ok(existsSync(kbYamlPath), 'kb.yaml exists');

  const descriptor = loadKbDescriptor(kbYamlPath);
  assert.equal(descriptor.id, 'roundtrip-brain');
  assert.equal(descriptor.name, 'Round Trip Brain');
  assert.equal(descriptor.scope, 'flow');
  assert.equal(descriptor.desc, 'Testing round-trip.');
});

test('POST /api/studio/kbs: duplicate id → 409', async () => {
  // First creation should succeed
  await post('/api/studio/kbs', {
    id: 'duplicate-brain',
    name: 'Duplicate Brain',
    scope: 'project',
    desc: 'First.',
  });

  // Second creation of same id → 409
  const { status, json } = await post('/api/studio/kbs', {
    id: 'duplicate-brain',
    name: 'Duplicate Brain 2',
    scope: 'project',
    desc: 'Second.',
  });
  assert.equal(status, 409, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
  assert.ok((json['error'] as string).includes('already exists'));
});

test('POST /api/studio/kbs: bad scope → 400', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'bad-scope-brain',
    name: 'Bad Scope Brain',
    scope: 'invalid-scope',
    desc: 'Testing bad scope.',
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
  assert.ok((json['error'] as string).toLowerCase().includes('scope'));
});

test('POST /api/studio/kbs: path traversal id → 400', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: '../evil',
    name: 'Evil Brain',
    scope: 'project',
    desc: 'Traversal attempt.',
  });
  assert.equal(status, 400, JSON.stringify(json));
});

test('POST /api/studio/kbs: empty name → 400', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'empty-name-brain',
    name: '',
    scope: 'project',
    desc: 'Testing empty name.',
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
});

test('POST /api/studio/kbs: empty desc → 400', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'empty-desc-brain',
    name: 'Empty Desc Brain',
    scope: 'project',
    desc: '',
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
});

test('POST /api/studio/kbs: missing CSRF → 403', async () => {
  const { status } = await post(
    '/api/studio/kbs',
    { id: 'no-csrf-brain', name: 'No CSRF Brain', scope: 'project', desc: 'No CSRF.' },
    true, // nocsrf=true
  );
  assert.equal(status, 403);
});

test('POST /api/studio/kbs: kb.yaml content has correct fields', async () => {
  await post('/api/studio/kbs', {
    id: 'content-check-brain',
    name: 'Content Check Brain',
    scope: 'agent-integration',
    desc: 'Checking yaml content.',
  });

  const kbYamlPath = join(forgeRoot, 'brain', 'content-check-brain', 'kb.yaml');
  const content = readFileSync(kbYamlPath, 'utf8');
  assert.ok(content.includes('id: content-check-brain'));
  assert.ok(content.includes('name: Content Check Brain'));
  assert.ok(content.includes('scope: agent-integration'));
  assert.ok(content.includes('desc: Checking yaml content.'));
});
