/**
 * Acceptance tests for cli/bridge-studio-templates.ts (R3-06).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./bridge-studio-templates.ts` import is the
 * expected red). Mirrors cli/bridge-studio-skills.test.ts's idiom: a real
 * bridge (startBridge) + fetch, plus one direct handler-invocation test for
 * the "returns false when unhandled" passthrough contract.
 *
 * AT numbers continue the flat R3-06 sequence started in
 * orchestrator/studio/template-library.test.ts.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';

import { startBridge } from '../../cli/ui-bridge.ts';
import { handleStudioTemplatesRoutes } from './bridge-studio-templates.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-templates-'));

  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );

  const artifactDir = join(forgeRoot, 'studio', 'artifact-templates');
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    join(artifactDir, 'plan.md'),
    matter.stringify('\n# Plan contract\n', { id: 'plan', name: 'Plan', kind: 'file', producer: 'architect', consumer: 'project-manager' }),
  );

  const demoDir = join(forgeRoot, 'studio', 'demo-elements');
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(
    join(demoDir, 'narrative.md'),
    matter.stringify('\n# Narrative\n', { id: 'narrative', name: 'Narrative essence', phase: 'present', description: 'd' }),
  );

  const scaffoldDir = join(forgeRoot, 'studio', 'starters', 'projects', 'typescript-cli');
  mkdirSync(scaffoldDir, { recursive: true });
  writeFileSync(join(scaffoldDir, 'package.json'), JSON.stringify({ name: '{{NAME}}' }), 'utf8');

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// GET /api/studio/templates — AT-41
// ---------------------------------------------------------------------------

test('AT-41: GET /api/studio/templates returns { templates: [...] } with the library shape', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/templates`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    templates: Array<{ id: string; category: string; format: string; provenance: string; previewKind: string; usedBy: string[] }>;
  };
  assert.ok(Array.isArray(body.templates));
  assert.equal(body.templates.length, 3, `expected the 3 fixture-seeded templates, got: ${body.templates.map((t) => t.id).join(', ')}`);

  const plan = body.templates.find((t) => t.id === 'plan');
  assert.ok(plan, 'the fixture planning template must appear');
  assert.equal(plan!.category, 'planning');

  const narrative = body.templates.find((t) => t.id === 'narrative');
  assert.ok(narrative, 'the fixture demo-output template must appear');
  assert.equal(narrative!.category, 'demo-output');

  const scaffold = body.templates.find((t) => t.id === 'typescript-cli');
  assert.ok(scaffold, 'the fixture project-scaffold template must appear');
  assert.equal(scaffold!.category, 'project-scaffold');
});

// ---------------------------------------------------------------------------
// GET /api/studio/templates/:id — AT-42, AT-43, AT-44
// ---------------------------------------------------------------------------

test('AT-42: GET /api/studio/templates/<id> returns detail with a files package', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/templates/plan`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { id: string; files: Array<{ path: string; body: string }> };
  assert.equal(body.id, 'plan');
  assert.ok(Array.isArray(body.files));
  assert.ok(body.files.some((f) => f.path === 'plan.md'));
});

test('AT-43: GET /api/studio/templates/<unknown> returns 404 with an error message', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/templates/no-such-template-anywhere`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === 'string' && body.error.length > 0);
});

test('AT-44: GET /api/studio/templates/<traversal-or-malformed> returns 400, never a 200/500', async () => {
  const variants = ['..%2F..%2Fetc%2Fpasswd', '%2e%2e%2F%2e%2e%2Fetc%2Fpasswd', encodeURIComponent('not a valid slug!!')];
  for (const variant of variants) {
    const res = await fetch(`${bridgeUrl}/api/studio/templates/${variant}`);
    assert.equal(res.status, 400, `variant ${variant} must be rejected with 400`);
    const body = (await res.json()) as { error: string };
    assert.ok(typeof body.error === 'string');
  }
});

// ---------------------------------------------------------------------------
// Handler contract — direct invocation (mirrors bridge-studio-skills.test.ts):
// non-matching URL returns false (passthrough) — AT-45
// ---------------------------------------------------------------------------

test('AT-45: handleStudioTemplatesRoutes returns false for a non-matching URL (passthrough contract)', async () => {
  const mockRes = {
    writeHead: () => { throw new Error('must not write a response for a non-matching URL'); },
    end: () => { throw new Error('must not end a response for a non-matching URL'); },
  } as unknown as import('node:http').ServerResponse;
  const mockReq = {} as import('node:http').IncomingMessage;
  const ctx = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };

  const handled = await handleStudioTemplatesRoutes(mockReq, mockRes, ctx, '/api/studio/nonexistent', 'GET');
  assert.equal(handled, false, 'a non-matching studio-templates URL must return false');
});
