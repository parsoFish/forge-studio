/**
 * Acceptance tests for packages/library/bridge-studio-templates.ts (R3-06).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./bridge-studio-templates.ts` import is the
 * expected red). Mirrors packages/library/tests/integration/bridge-studio-skills.test.ts's idiom: a real
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

import { startBridge } from '../../../../apps/forge/ui-bridge.ts';
import { dispatchRoute } from '@forge/kernel'; import { libraryRoutes } from '../../routes.ts';
import { fixtureAgentFacts } from '../test-fixtures/agent-fixture.ts'; import { fixtureFlowSource } from '../test-fixtures/flow-fixture.ts'; import { inertAuthoringSession } from '../test-fixtures/authoring-session-fixture.ts';

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

  const scaffoldDir = join(forgeRoot, 'studio', 'starters', 'projects', 'cli');
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

  const scaffold = body.templates.find((t) => t.id === 'cli');
  assert.ok(scaffold, 'the fixture project-scaffold template must appear');
  assert.equal(scaffold!.category, 'project-scaffold');
});

// ---------------------------------------------------------------------------
// OOTB-provenance (bead forge-8vfn.8.3.7, M7-C item 76). Every fixture seeded
// in `before()` above carries no `origin:` frontmatter key at all — the exact
// shape every shipped template carries today (studio/artifact-templates/*.md,
// studio/demo-elements/*.md, studio/starters/projects/<id>/) — and
// project-scaffold has no create route at all (SCAFFOLD_READONLY), so it is
// OOTB by construction, never a per-item guess.
// ---------------------------------------------------------------------------

test('AT-46: a shipped template (planning), a shipped template (demo-output) and a scaffold (no create route) all read origin:"ootb" on the list route', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/templates`);
  const body = (await res.json()) as { templates: Array<Record<string, unknown>> };
  const plan = body.templates.find((t) => t['id'] === 'plan');
  const narrative = body.templates.find((t) => t['id'] === 'narrative');
  const scaffold = body.templates.find((t) => t['id'] === 'cli');
  assert.equal(plan!['origin'], 'ootb', `planning fixture with no origin: key must read ootb, got ${JSON.stringify(plan!['origin'])}`);
  assert.equal(narrative!['origin'], 'ootb', `demo-output fixture with no origin: key must read ootb, got ${JSON.stringify(narrative!['origin'])}`);
  assert.equal(scaffold!['origin'], 'ootb', `a project-scaffold entry (no create route) must always read ootb, got ${JSON.stringify(scaffold!['origin'])}`);
});

test('AT-47: a shipped template reads origin:"ootb" on the detail route too', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/templates/plan`);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body['origin'], 'ootb');
});

test('AT-48: POST /api/studio/templates stamps origin:"operator" server-side, ignoring any client-supplied origin, read back on list + detail', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/templates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({
      category: 'planning',
      id: 'created-origin-template',
      content: '---\nid: created-origin-template\nname: Created Origin Template\nkind: file\norigin: ootb\n---\n\nBody.\n',
    }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);

  const listRes = await fetch(`${bridgeUrl}/api/studio/templates`);
  const listBody = (await listRes.json()) as { templates: Array<Record<string, unknown>> };
  const entry = listBody.templates.find((t) => t['id'] === 'created-origin-template');
  assert.ok(entry, 'the created template must appear in the list');
  assert.equal(entry!['origin'], 'operator', `a route-created template must read origin:"operator" (never the client-claimed "ootb"), got ${JSON.stringify(entry!['origin'])}`);

  const detailRes = await fetch(`${bridgeUrl}/api/studio/templates/created-origin-template`);
  const detailBody = (await detailRes.json()) as Record<string, unknown>;
  assert.equal(detailBody['origin'], 'operator');
});

test('AT-49: duplicateOf also stamps origin:"operator" on the new copy, independent of the source template\'s own origin', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/templates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ category: 'planning', id: 'duplicated-origin-template', duplicateOf: 'plan' }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);

  const detailRes = await fetch(`${bridgeUrl}/api/studio/templates/duplicated-origin-template`);
  const detailBody = (await detailRes.json()) as Record<string, unknown>;
  assert.equal(detailBody['origin'], 'operator', `a duplicate must read origin:"operator" even though its source ("plan") is ootb, got ${JSON.stringify(detailBody['origin'])}`);
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

test('the library route table declines a non-matching URL (passthrough contract)', async () => {
  const mockRes = {
    writeHead: () => { throw new Error('must not write a response for a non-matching URL'); },
    end: () => { throw new Error('must not end a response for a non-matching URL'); },
  } as unknown as import('node:http').ServerResponse;
  const mockReq = {} as import('node:http').IncomingMessage;
  const ctx = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };

  const handled = await dispatchRoute(libraryRoutes({ agentFacts: fixtureAgentFacts(ctx.forgeRoot), isSdkAvailable: () => false, flowSource: fixtureFlowSource, authoringSession: inertAuthoringSession }), mockReq, mockRes, { ...ctx, readBody: async () => ({}) }, '/api/studio/nonexistent', 'GET');
  assert.equal(handled, false, 'a non-matching studio-templates URL must return false');
});
