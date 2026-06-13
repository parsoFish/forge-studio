/**
 * Tests for bridge-studio-kbs.ts routes (M5 review fixes):
 *   - POST /api/studio/kbs/:id/guidance — 8 KiB text cap (#2)
 *   - GET  /api/studio/kbs/resolve-node/:nodeId — node→KB resolver (#3)
 *
 * Uses a real bridge against a minimal tmp forge-root with two KB stubs.
 * The guidance tests use an existing KB ('cycles').
 * The resolve-node tests need actual kb-graph data; the fixture writes
 * a minimal themes/ file with a [[wiki-link]] to create a real node.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const CYCLES_KB_YAML = `id: cycles\nname: Cycles Brain\nscope: flow\ndesc: Cross-cycle patterns.\n`;
const FORGE_DEV_KB_YAML = `id: forge-dev\nname: Forge Dev Brain\nscope: agent-integration\ndesc: Forge engineering decisions.\n`;

// Minimal theme file whose title becomes the theme node id.
// kb-graph derives node ids from the filename slug (without .md extension).
// We write a theme file 'test-theme.md' so the node id will be 'test-theme'.
const TEST_THEME_MD = `# Test Theme\n\nThis is a test theme node.\n`;

// ---------------------------------------------------------------------------
// Bridge lifecycle
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-kbs-'));

  // Minimal _queue + _logs required by startBridge / listRuns
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  // KB: cycles (used for guidance tests)
  mkdirSync(join(forgeRoot, 'brain', 'cycles', 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'cycles', '_raw'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'cycles', 'kb.yaml'), CYCLES_KB_YAML);
  // Write a theme node so resolve-node can find it
  writeFileSync(join(forgeRoot, 'brain', 'cycles', 'themes', 'test-theme.md'), TEST_THEME_MD);

  // KB: forge-dev
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

async function get(path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Fix #2: Guidance text length cap (8 KiB)
// ---------------------------------------------------------------------------

test('POST /api/studio/kbs/:id/guidance: normal text → 200', async () => {
  const { status, json } = await post('/api/studio/kbs/cycles/guidance', {
    text: 'Short guidance note.',
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true);
});

test('POST /api/studio/kbs/:id/guidance: oversized text → 400 guidance text too large', async () => {
  // 9 KiB of text — over the 8 KiB cap
  const oversized = 'x'.repeat(9 * 1024);
  const { status, json } = await post('/api/studio/kbs/cycles/guidance', {
    text: oversized,
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
  assert.ok((json['error'] as string).includes('guidance text too large'));
});

test('POST /api/studio/kbs/:id/guidance: exactly 8192 bytes → 200 (at-cap is allowed)', async () => {
  // Exactly 8 KiB (8192 bytes) — should pass (> not >=)
  const atCap = 'a'.repeat(8192);
  const { status, json } = await post('/api/studio/kbs/cycles/guidance', {
    text: atCap,
  });
  assert.equal(status, 200, JSON.stringify(json));
});

test('POST /api/studio/kbs/:id/guidance: 8193 bytes → 400', async () => {
  const overCap = 'a'.repeat(8193);
  const { status, json } = await post('/api/studio/kbs/cycles/guidance', {
    text: overCap,
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok((json['error'] as string).includes('guidance text too large'));
});

// ---------------------------------------------------------------------------
// Fix #3: GET /api/studio/kbs/resolve-node/:nodeId
// ---------------------------------------------------------------------------

test('GET /api/studio/kbs/resolve-node/:nodeId: finds node in cycles KB', async () => {
  // 'test-theme' was written to cycles/themes/test-theme.md
  const { status, json } = await get('/api/studio/kbs/resolve-node/test-theme');
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['kbId'], 'cycles', `expected 'cycles', got: ${JSON.stringify(json)}`);
});

test('GET /api/studio/kbs/resolve-node/:nodeId: unknown node → 404', async () => {
  const { status, json } = await get('/api/studio/kbs/resolve-node/nonexistent-node-xyz');
  assert.equal(status, 404, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
});

test('GET /api/studio/kbs/resolve-node/:nodeId: invalid node id → 400', async () => {
  // Leading dot is invalid per NODE_ID_RE
  const { status, json } = await get('/api/studio/kbs/resolve-node/.hidden');
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
});
