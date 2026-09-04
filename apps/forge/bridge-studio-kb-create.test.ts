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
import { loadKbDescriptor } from '@forge/knowledge/studio/kb-descriptor.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const CYCLES_KB_YAML = `id: cycles\nname: Cycles Brain\nbinding: { kind: flow, ref: forge-develop }\ndesc: Cross-cycle patterns.\n`;
const FORGE_DEV_KB_YAML = `id: forge-dev\nname: Forge Dev Brain\nbinding: { kind: unique }\ndesc: Forge engineering decisions.\n`;

/** Minimal valid SKILL.md whose composition.guards declares a single band —
 *  just enough for isStudioAgent + loadAgentDefinition + resolveBandGuard. */
function bandSkillMd(slug: string, band: string): string {
  return `---
name: ${slug}
description: A test ${band} agent.
library: true
purpose: Does ${band} things.
brainAccess: none
interactivity: none
composition:
  skills: []
  tools: []
  mcps: []
  guards: [${band}]
runtime:
  sdk: claude-agent-sdk
  strategy: fixed
  model: claude-sonnet-4-6
budgets: {}
allowed-tools: []
disallowed-tools: []
---
## Process

This agent does ${band} things.
`;
}

/** Minimal forge-develop flow.yaml whose two agent-bearing nodes declare
 *  demo-band + review-band — so listFlowBandIds derives a REAL, non-empty band
 *  vocabulary { demo-band, review-band } (F2: the fail-CLOSED helper returns []
 *  for a flow with no derivable vocabulary, so an EMPTY forge-develop dir would
 *  now reject every band scope). */
const FORGE_DEVELOP_FLOW_YAML = `id: forge-develop
name: Forge Develop
version: 1
goal: Test develop flow.
project: null
kb: null
costCeilingUsd: 10
origin: seed
disposable: true
nodes:
  - { id: demo, agent: demo-agent }
  - { id: adversarial-review, agent: adversarial-review }
edges: []
triggers: []
`;

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
  // (R1-01) have something real to resolve against. forge-develop is now a REAL
  // flow (flow.yaml + demo-band/review-band skills) so listFlowBandIds derives a
  // non-empty { demo-band, review-band } vocabulary — required after F2 made the
  // helper fail CLOSED (an empty flow dir yields [] and rejects every band).
  const developFlowDir = join(forgeRoot, 'studio', 'flows', 'forge-develop');
  mkdirSync(developFlowDir, { recursive: true });
  writeFileSync(join(developFlowDir, 'flow.yaml'), FORGE_DEVELOP_FLOW_YAML);
  for (const [slug, band] of [['demo-agent', 'demo-band'], ['adversarial-review', 'review-band']] as const) {
    const skillDir = join(forgeRoot, 'skills', slug);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), bandSkillMd(slug, band));
  }
  // A flow registered by DIRECTORY NAME ONLY (no flow.yaml) — the fail-CLOSED
  // shape the F2 pin drives: any band scope on it must be rejected.
  mkdirSync(join(forgeRoot, 'studio', 'flows', 'empty-flow'), { recursive: true });
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

test('POST /api/studio/kbs: empty desc is accepted — the form marks it optional (W7-B2, knowledge-22)', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'empty-desc-brain',
    name: 'Empty Desc Brain',
    binding: { kind: 'project', ref: 'demo-project' },
    desc: '',
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true);
  assert.equal(json['id'], 'empty-desc-brain');
  // knowledge-23: the create response names the seeding session AND its
  // anchor project so the form can land the operator on it.
  assert.equal(typeof json['sessionId'], 'string');
  assert.equal(json['project'], 'demo-project');
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

// ---------------------------------------------------------------------------
// R1-06 WI-1 group B (1)/(2): binding.band — a KB bound to a flow may scope
// its grant to one of that flow's bands (T1 ruling: the band-role map is
// ONLY review-band -> reviewer). Today `KbBinding` has no `band` field at
// all — the create route only reads `binding.kind`/`binding.ref` (see
// packages/knowledge/bridge-studio-kbs.ts ~516-551) and `serializeKbDescriptor` only ever
// writes `{ kind, ref }` (orchestrator/studio/kb-descriptor.ts ~116-127) — so
// any `binding.band` sent in the POST body is silently dropped before the
// kb.yaml is ever written.
// ---------------------------------------------------------------------------

test('RED (R1-06): POST /api/studio/kbs preserves binding.band in the written kb.yaml', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'band-scoped-brain',
    name: 'Band Scoped Brain',
    binding: { kind: 'flow', ref: 'forge-develop', band: 'review-band' },
    desc: 'Testing a band-scoped flow binding.',
  });
  assert.equal(status, 200, JSON.stringify(json));

  const kbYamlPath = join(forgeRoot, 'brain', 'band-scoped-brain', 'kb.yaml');
  assert.ok(existsSync(kbYamlPath), 'kb.yaml must exist — create must have succeeded');
  const content = readFileSync(kbYamlPath, 'utf8');
  assert.match(
    content,
    /band:\s*review-band/,
    `binding.band must round-trip into the written kb.yaml — it is dropped before serialization today. Got:\n${content}`,
  );

  // Confirm via the real loader too, not just raw yaml text — the descriptor
  // object itself must expose .band once loaded back off disk.
  const descriptor = loadKbDescriptor(kbYamlPath);
  assert.equal(
    (descriptor.binding as { band?: string }).band,
    'review-band',
    'loadKbDescriptor must parse binding.band back off the written kb.yaml',
  );
});

test('RED (R1-06): POST /api/studio/kbs rejects an unknown binding.band naming the real band vocabulary', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'bad-band-brain',
    name: 'Bad Band Brain',
    binding: { kind: 'flow', ref: 'forge-develop', band: 'no-such-band' },
    desc: 'Testing an unknown band id.',
  });
  assert.equal(
    status,
    400,
    `expected 400 for an unknown binding.band, got ${status} — today the route ignores binding.band entirely and creates the KB anyway: ${JSON.stringify(json)}`,
  );
  assert.ok(typeof json['error'] === 'string', `expected a 400 with an error string, got: ${JSON.stringify(json)}`);
  const errMsg = json['error'] as string;
  assert.match(errMsg, /band/i, 'error must mention band');
  // Must name a real band id (the flow's real band vocabulary), not just
  // reject silently — "review-band" is a real BAND_GUARD_IDS member and one
  // forge-develop's own nodes (adversarial-review) actually declares.
  assert.match(errMsg, /review-band/, `error must name the real band vocabulary — got: ${errMsg}`);

  // And the KB must NOT have been created with the bogus band silently ignored.
  assert.equal(
    existsSync(join(forgeRoot, 'brain', 'bad-band-brain')),
    false,
    'a rejected binding.band must not leave a half-written kb dir behind',
  );
});

// F2 (fail-open-validator): a flow registered by directory name only (no
// flow.yaml) has NO real band vocabulary, so listFlowBandIds fails CLOSED with
// [] — attaching ANY band scope (even the otherwise-real review-band) to such a
// flow must be rejected. Before F2, the fail-OPEN fallback returned the full
// platform vocab, so review-band was accepted and a reviewer brain-read grant
// got written onto a flow that has no review band at all.
test('F2: POST /api/studio/kbs binding.band=review-band on a registered-but-empty flow → 400 (no phantom KB)', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'empty-flow-band-brain',
    name: 'Empty Flow Band Brain',
    binding: { kind: 'flow', ref: 'empty-flow', band: 'review-band' },
    desc: 'Attaching review-band to a flow that has no derivable bands.',
  });
  assert.equal(
    status,
    400,
    `expected 400 — an empty flow dir has no real band vocabulary, so review-band must be rejected (fail CLOSED). Got: ${JSON.stringify(json)}`,
  );
  assert.ok(typeof json['error'] === 'string');
  assert.match(json['error'] as string, /band/i, 'error must mention band');

  // Fail-closed must not leave a half-written KB behind.
  assert.equal(
    existsSync(join(forgeRoot, 'brain', 'empty-flow-band-brain')),
    false,
    'a rejected band scope must not create the KB dir',
  );
});

// ---------------------------------------------------------------------------
// R1-06 WI-2 group B (1): agent-seeded creation hand-off (R1-06-F2).
// On a successful create, the route must hand off to the project-brain
// ("brain-creation") session shell for seeding, mirroring the ESTABLISHED
// `POST /api/project-brain/start` contract (apps/forge/ui-bridge.ts:3797-3826):
// `{ ok: true, sessionId }`, plus a REAL session dir + status.json (phase
// 'briefing') at <projectsRoot>/<project>/_project-brain/<sessionId> — the
// exact anchor the generic session-shell route
// (GET /api/studio/sessions/project-brain/:sessionId?project=<p>,
// packages/sessions/bridge-studio-sessions.ts) resolves against. Today the create route
// (packages/knowledge/bridge-studio-kbs.ts ~476-611) only ever returns { ok: true, id } —
// no session is started at all, so this is RED on both the wire contract and
// the on-disk side effect.
// ---------------------------------------------------------------------------

test('RED (R1-06 WI-2 group B, F2): POST /api/studio/kbs create hands off a project-brain session for seeding', async () => {
  const { status, json } = await post('/api/studio/kbs', {
    id: 'handoff-brain',
    name: 'Handoff Brain',
    binding: { kind: 'project', ref: 'demo-project' },
    desc: 'Testing the agent-seeded creation hand-off.',
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true);
  assert.equal(json['id'], 'handoff-brain');

  // The wire contract: a real hand-off sessionId, same field name as the
  // sibling POST /api/project-brain/start route.
  assert.equal(
    typeof json['sessionId'],
    'string',
    `create response must carry a hand-off "sessionId" (mirroring POST /api/project-brain/start's { ok, sessionId } contract) — today it only returns { ok, id }. Got: ${JSON.stringify(json)}`,
  );
  const sessionId = json['sessionId'] as string;
  assert.ok(sessionId.length > 0, 'sessionId must be non-empty');

  // The hand-off must be REAL, not a fabricated id on the wire: a project-brain
  // session dir + status.json must actually exist on disk, in the 'briefing'
  // phase, exactly like a session started via POST /api/project-brain/start —
  // the shell the UI's /sessions/project-brain/:sessionId page reads through
  // packages/sessions/bridge-studio-sessions.ts.
  const statusPath = join(forgeRoot, 'projects', 'demo-project', '_project-brain', sessionId, 'status.json');
  assert.ok(existsSync(statusPath), `hand-off session status.json must exist at ${statusPath} — no project-brain session is started by create today`);
  const statusJson = JSON.parse(readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
  assert.equal(statusJson['phase'], 'briefing', 'hand-off session must start in the briefing phase, like /api/project-brain/start');
  assert.equal(statusJson['project'], 'demo-project', 'hand-off session is anchored under the bound project');
});

// ---------------------------------------------------------------------------
// R1-06 WI-2 group B (3): bootstrapKb / POST /api/studio/kbs/:id/bootstrap
// REMOVAL (T1 ruling Q3) — dead code + a competing seed path now that create
// hands off to the real project-brain agent flow (F2, pin above). RED today
// means the route STILL responds (has not been removed yet).
// ---------------------------------------------------------------------------

test('RED (R1-06 WI-2 group B, T1 Q3): POST /api/studio/kbs/:id/bootstrap is REMOVED — no route responds', async () => {
  // Precondition: the target kb genuinely exists on disk BEFORE probing the
  // removed route, so a 404 below can only mean "route gone", never "unknown
  // kb id" (the route's own pre-existing 404 branch for that case).
  await post('/api/studio/kbs', {
    id: 'bootstrap-removal-brain',
    name: 'Bootstrap Removal Brain',
    binding: { kind: 'unique' },
    desc: 'kb exists; the bootstrap route should not.',
  });
  assert.equal(
    existsSync(join(forgeRoot, 'brain', 'bootstrap-removal-brain', 'kb.yaml')),
    true,
    'precondition: the kb must exist on disk before probing the removed bootstrap route',
  );

  const res = await fetch(`${bridgeUrl}/api/studio/kbs/bootstrap-removal-brain/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ name: 'x', summary: 'y' }),
  });
  assert.equal(
    res.status,
    404,
    `expected 404 (route removed — falls through to the bridge's bare 404 fallback) — the bootstrap route still responds today with status ${res.status}`,
  );

  // The removed route must leave no seed side-effect behind either — a stale
  // handler that somehow still 404s but still wrote profile.md would be a
  // false "removed" green.
  assert.equal(
    existsSync(join(forgeRoot, 'brain', 'bootstrap-removal-brain', 'profile.md')),
    false,
    'no profile.md must be seeded by a removed bootstrap route',
  );
});
