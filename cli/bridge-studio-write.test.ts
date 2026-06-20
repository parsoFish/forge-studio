/**
 * Tests for the Studio bridge write routes (M2-2).
 *
 * Spins up a real bridge against a tmp forge-root fixture that includes:
 *   - skills/<slug>/SKILL.md  (studio frontmatter — used for agent PUT tests)
 *   - <project>/.forge/project.json  (full valid config; project is auto-discovered from disk)
 *
 * Covers:
 *   - PUT /api/studio/agents/:slug  — edit composition + purpose (merge, preserve)
 *   - PUT /api/studio/agents/:slug  — invalid body → 400 + findings, file UNCHANGED
 *   - PUT /api/studio/agents/:slug  — new slug → scaffolds SKILL.md
 *   - PUT /api/studio/agents/..%2F..%2Fetc → 400 path traversal, no write
 *   - PUT /api/studio/projects/:id  — edits M2 fields, preserves demo/quality_gate_cmd
 *   - PUT /api/studio/projects/unknown-id → 404
 *   - PUT /api/studio/projects/:id  with northStar > 140 chars → 400, file UNCHANGED
 *   - GET routes still work after adding write handler (passthrough unaffected)
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

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Full valid SKILL.md with studio frontmatter */
function makeAgentSkillMd(): string {
  return [
    '---',
    'name: Write Agent',
    'description: An agent for write-route tests.',
    'phase: developer',
    'surface: forge',
    'purpose: Write tests to validate the PUT routes.',
    'brainAccess: advisory',
    'interactivity: none',
    'composition:',
    '  skills:',
    '    - tdd-workflow',
    '  tools: []',
    '  mcps: []',
    '  hooks:',
    '    - event-log',
    'runtime:',
    '  sdk: claude-code',
    '  strategy: fixed',
    '  model: claude-sonnet-4-5',
    'allowed-tools:',
    '  - Read',
    '  - Edit',
    'disallowed-tools: []',
    'budgets:',
    '  iterationCap: 3',
    '---',
    '',
    '# Write Agent',
    '',
    'Process body text for the write agent.',
  ].join('\n');
}

/** Full valid project.json that includes the required demo + quality_gate_cmd */
function makeProjectJson(extras: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      demo: { shape: 'harness', command: ['npm', 'test'] },
      quality_gate_cmd: ['npm', 'test'],
      northStar: 'Ship a great product.',
      instructions: 'Always write tests first.',
      demoProcess: [{ kind: 'verify', text: 'Run npm test' }],
      skills: ['tdd-workflow', 'coding-standards'],
      kb: 'forge-dev',
      ...extras,
    },
    null,
    2,
  );
}

/** PUT body for agent edits */
function makePutAgentBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Write Agent',
    purpose: 'Updated purpose for the write-route tests.',
    process: 'Updated process body.',
    interactivity: 'none',
    brainAccess: 'advisory',
    composition: {
      skills: ['tdd-workflow', 'coding-standards'],
      tools: ['Read'],
      mcps: [],
      hooks: ['event-log'],
    },
    runtime: {
      sdk: 'claude-code',
      strategy: 'fixed',
      model: 'claude-sonnet-4-5',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Global fixtures
// ---------------------------------------------------------------------------

let forgeRoot: string;
let projectDir: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-write-'));

  // ---- skills/write-agent/SKILL.md --
  mkdirSync(join(forgeRoot, 'skills', 'write-agent'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'),
    makeAgentSkillMd(),
  );

  // ---- project dir + .forge/project.json (auto-discovered from disk; B1) --
  projectDir = join(forgeRoot, 'projects', 'write-project');
  mkdirSync(join(projectDir, '.forge'), { recursive: true });
  writeFileSync(join(projectDir, '.forge', 'project.json'), makeProjectJson());
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });

  // ---- minimal _queue and _logs for bridge health --
  mkdirSync(join(forgeRoot, '_queue', 'done'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

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
// Helper: PUT request
// ---------------------------------------------------------------------------

async function putJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1', ...headers },
    body: JSON.stringify(body),
  });
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1', ...headers },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// PUT /api/studio/agents/:slug — edit existing agent
// ---------------------------------------------------------------------------

test('PUT /api/studio/agents/write-agent edits composition + purpose, preserves phase and allowedTools', async () => {
  const res = await putJson(`${bridgeUrl}/api/studio/agents/write-agent`, makePutAgentBody());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; slug: string; findings: unknown[] };
  assert.equal(body.ok, true);
  assert.equal(body.slug, 'write-agent');
  assert.ok(Array.isArray(body.findings));

  // Re-read SKILL.md and verify
  const skillMd = readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8');

  // Updated fields are present
  assert.ok(skillMd.includes('Updated purpose for the write-route tests.'), 'purpose updated');
  assert.ok(skillMd.includes('Updated process body.'), 'process body updated');
  assert.ok(skillMd.includes('coding-standards'), 'new skill in composition');

  // Preserved fields are still there
  assert.ok(skillMd.includes('phase: developer'), 'phase preserved');
  assert.ok(skillMd.includes('- Read'), 'allowedTools preserved');
  assert.ok(skillMd.includes('iterationCap: 3'), 'budget preserved');
});

test('PUT /api/studio/agents/write-agent preserves allowedTools even when not in body', async () => {
  // Reset file to known state
  writeFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), makeAgentSkillMd());

  const res = await putJson(`${bridgeUrl}/api/studio/agents/write-agent`, makePutAgentBody());
  assert.equal(res.status, 200);

  const skillMd = readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8');
  // The original SKILL.md had allowed-tools: [Read, Edit] — they must survive the PUT
  assert.ok(skillMd.includes('- Read'), 'Read tool preserved');
  assert.ok(skillMd.includes('- Edit'), 'Edit tool preserved');
});

// ---------------------------------------------------------------------------
// PUT /api/studio/agents/:slug — invalid body → 400, file UNCHANGED
// ---------------------------------------------------------------------------

test('PUT /api/studio/agents/write-agent with empty purpose → 400 + findings, SKILL.md unchanged', async () => {
  writeFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), makeAgentSkillMd());
  const originalContent = readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8');

  const res = await putJson(`${bridgeUrl}/api/studio/agents/write-agent`, makePutAgentBody({ purpose: '' }));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; findings: Array<{ level: string; check: string }> };
  assert.equal(body.error, 'validation failed');
  assert.ok(Array.isArray(body.findings));
  const purposeFinding = body.findings.find((f) => f.check === 'readiness/purpose');
  assert.ok(purposeFinding, 'should have a readiness/purpose finding');
  assert.equal(purposeFinding!.level, 'error');

  // File must be unchanged
  const afterContent = readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8');
  assert.equal(afterContent, originalContent, 'SKILL.md must be unchanged after 400');
});

test('PUT /api/studio/agents/write-agent with invalid runtime (fixed, no model) → 400, file UNCHANGED', async () => {
  writeFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), makeAgentSkillMd());
  const originalContent = readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8');

  const res = await putJson(
    `${bridgeUrl}/api/studio/agents/write-agent`,
    makePutAgentBody({ runtime: { sdk: 'claude-code', strategy: 'fixed', model: '' } }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; findings: unknown[] };
  assert.equal(body.error, 'validation failed');

  const afterContent = readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8');
  assert.equal(afterContent, originalContent, 'SKILL.md must be unchanged after 400');
});

// ---------------------------------------------------------------------------
// PUT /api/studio/agents/:slug — new slug → scaffolds SKILL.md
// ---------------------------------------------------------------------------

test('PUT /api/studio/agents/new-agent scaffolds skills/new-agent/SKILL.md when absent', async () => {
  const res = await putJson(
    `${bridgeUrl}/api/studio/agents/new-agent`,
    makePutAgentBody({ name: 'New Agent', purpose: 'Scaffolded by PUT.' }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; slug: string };
  assert.equal(body.ok, true);
  assert.equal(body.slug, 'new-agent');

  const skillMd = readFileSync(join(forgeRoot, 'skills', 'new-agent', 'SKILL.md'), 'utf8');
  assert.ok(skillMd.includes('Scaffolded by PUT.'), 'purpose written');
  assert.ok(skillMd.includes('name: New Agent'), 'name written');
});

// ---------------------------------------------------------------------------
// PUT /api/studio/agents — path traversal guard
// ---------------------------------------------------------------------------

test('PUT /api/studio/agents/..%2F..%2Fetc → 400, no write outside skills/', async () => {
  const res = await putJson(`${bridgeUrl}/api/studio/agents/..%2F..%2Fetc`, makePutAgentBody());
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === 'string');
  // The error must be about slug validation (SLUG_RE check fires before fs path construction)
  assert.ok(
    body.error.includes('invalid slug') || body.error.includes('traversal'),
    `expected traversal/slug error, got: ${body.error}`,
  );
});

test('PUT /api/studio/agents/UPPERCASE → 400 (slug must be lowercase)', async () => {
  const res = await putJson(`${bridgeUrl}/api/studio/agents/UPPERCASE`, makePutAgentBody());
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.includes('invalid slug'), `expected slug error, got: ${body.error}`);
});

// ---------------------------------------------------------------------------
// PUT /api/studio/projects/:id — edits M2 fields, preserves required fields
// ---------------------------------------------------------------------------

test('PUT /api/studio/projects/write-project edits northStar + demoProcess, preserves demo + quality_gate_cmd', async () => {
  // Reset to known state
  writeFileSync(join(projectDir, '.forge', 'project.json'), makeProjectJson());

  const res = await putJson(`${bridgeUrl}/api/studio/projects/write-project`, {
    northStar: 'New north star.',
    demoProcess: [
      { kind: 'capture', text: 'Capture screenshot' },
      { kind: 'verify', text: 'Run acceptance tests' },
    ],
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; id: string };
  assert.equal(body.ok, true);
  assert.equal(body.id, 'write-project');

  const written = JSON.parse(readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(written['northStar'], 'New north star.');
  assert.deepEqual(written['demoProcess'], [
    { kind: 'capture', text: 'Capture screenshot' },
    { kind: 'verify', text: 'Run acceptance tests' },
  ]);

  // Preserved fields
  assert.deepEqual(written['demo'], { shape: 'harness', command: ['npm', 'test'] }, 'demo preserved');
  assert.deepEqual(written['quality_gate_cmd'], ['npm', 'test'], 'quality_gate_cmd preserved');
  assert.equal(written['instructions'], 'Always write tests first.', 'instructions preserved');
  assert.deepEqual(written['skills'], ['tdd-workflow', 'coding-standards'], 'skills preserved');
});

test('PUT /api/studio/projects/write-project updates skills field', async () => {
  writeFileSync(join(projectDir, '.forge', 'project.json'), makeProjectJson());

  const res = await putJson(`${bridgeUrl}/api/studio/projects/write-project`, {
    skills: ['tdd-workflow', 'backend-patterns', 'coding-standards'],
  });
  assert.equal(res.status, 200);

  const written = JSON.parse(readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual(written['skills'], ['tdd-workflow', 'backend-patterns', 'coding-standards']);
});

// ---------------------------------------------------------------------------
// PUT /api/studio/projects/:id — unknown id → 404
// ---------------------------------------------------------------------------

test('PUT /api/studio/projects/unknown-project → 404', async () => {
  const res = await putJson(`${bridgeUrl}/api/studio/projects/unknown-project`, {
    northStar: 'Whatever.',
  });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'unknown project');
});

// ---------------------------------------------------------------------------
// PUT /api/studio/projects/:id — northStar > 140 chars → 400, file UNCHANGED
// ---------------------------------------------------------------------------

test('PUT /api/studio/projects/write-project with northStar 141 chars → 400, file UNCHANGED', async () => {
  writeFileSync(join(projectDir, '.forge', 'project.json'), makeProjectJson());
  const originalContent = readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8');

  const tooLong = 'x'.repeat(141);
  const res = await putJson(`${bridgeUrl}/api/studio/projects/write-project`, {
    northStar: tooLong,
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.includes('140'), `expected 140-char error, got: ${body.error}`);

  // File must be unchanged
  const afterContent = readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8');
  assert.equal(afterContent, originalContent, 'project.json must be unchanged after 400');
});

// ---------------------------------------------------------------------------
// PUT /api/studio/projects — invalid id guard
// ---------------------------------------------------------------------------

test('PUT /api/studio/projects/INVALID → 400 (id must be slug)', async () => {
  const res = await putJson(`${bridgeUrl}/api/studio/projects/INVALID`, { northStar: 'x' });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.includes('invalid project id'), `expected invalid id error, got: ${body.error}`);
});

// ---------------------------------------------------------------------------
// GET routes still work (passthrough unaffected)
// ---------------------------------------------------------------------------

test('GET /api/studio/agents still works alongside write routes', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/agents`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { agents: Array<{ slug: string }> };
  assert.ok(Array.isArray(body.agents));
});

test('GET /api/health returns the bridge JSON identity (service/pid/startedAt)', async () => {
  const res = await fetch(`${bridgeUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.ok(
    (res.headers.get('content-type') ?? '').includes('application/json'),
    'health must be JSON so a second studio can read the identity',
  );
  const body = (await res.json()) as { service: string; pid: number; startedAt: string };
  assert.equal(body.service, 'forge-bridge');
  assert.equal(body.pid, process.pid, 'identity pid is the process serving the bridge');
  assert.equal(typeof body.startedAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(body.startedAt)), 'startedAt is an ISO timestamp');
});

test('OPTIONS preflight returns PUT in access-control-allow-methods', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/agents/write-agent`, {
    method: 'OPTIONS',
    headers: { 'access-control-request-method': 'PUT' },
  });
  assert.equal(res.status, 204);
  const methods = res.headers.get('access-control-allow-methods') ?? '';
  assert.ok(methods.includes('PUT'), `PUT must be in CORS methods, got: ${methods}`);
});

// ---------------------------------------------------------------------------
// CSRF header enforcement
// ---------------------------------------------------------------------------

test('PUT without x-forge-csrf header → 403', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/agents/write-agent`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(makePutAgentBody()),
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.includes('CSRF'), `expected CSRF error, got: ${body.error}`);
});

test('PUT with x-forge-csrf header → succeeds (200)', async () => {
  // Reset to known state
  writeFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), makeAgentSkillMd());
  const res = await putJson(`${bridgeUrl}/api/studio/agents/write-agent`, makePutAgentBody());
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------------------
// OPTIONS preflight — foreign origin must not be echoed
// ---------------------------------------------------------------------------

test('OPTIONS from a foreign origin → origin not echoed', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/agents/write-agent`, {
    method: 'OPTIONS',
    headers: {
      'origin': 'https://evil.example.com',
      'access-control-request-method': 'PUT',
    },
  });
  assert.equal(res.status, 204);
  const origin = res.headers.get('access-control-allow-origin') ?? '';
  assert.ok(
    origin !== 'https://evil.example.com',
    `foreign origin must not be echoed, got: ${origin}`,
  );
});

// ---------------------------------------------------------------------------
// Unknown project id (not discoverable on disk) → 404
//
// B1: project paths come from the disk scan, which only returns dirs under the
// projects root — an attacker can no longer point a registry entry outside the
// repo, so an id with no matching dir is simply unknown.
// ---------------------------------------------------------------------------

test('PUT /api/studio/projects/:id for an undiscovered project → 404', async () => {
  const res = await putJson(`${bridgeUrl}/api/studio/projects/no-such-project`, {
    northStar: 'Nope.',
  });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.ok(
    body.error.includes('unknown project'),
    `expected unknown-project error, got: ${body.error}`,
  );
});

// ---------------------------------------------------------------------------
// POST /api/studio/projects (onboard) — B1 disk discovery + B3 C4 scaffolding
// ---------------------------------------------------------------------------

test('POST /api/studio/projects scaffolds project.json + C4 artifacts + git, reports preflight', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/projects`, {
    name: 'Onboard Me',
    qualityGateCmd: 'npm test',
    northStar: 'Prove onboarding scaffolds the contract.',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok: boolean; id: string; ready: boolean; scaffolded: string[]; failingClauses: Array<{ id: string }>;
  };
  assert.equal(body.ok, true);
  assert.equal(body.id, 'onboard-me');

  // .forge/project.json written with the hard contract fields.
  const projDir = join(forgeRoot, 'projects', 'onboard-me');
  const cfgPath = join(projDir, '.forge', 'project.json');
  assert.ok(existsSync(cfgPath), 'project.json must be scaffolded');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
  assert.ok(Array.isArray(cfg.quality_gate_cmd), 'C1 quality_gate_cmd present');
  assert.ok(cfg.demo && typeof cfg.demo === 'object', 'DEMO block present');

  // B3: the C4 artifacts + a git repo were scaffolded (idempotent stubs).
  assert.ok(existsSync(join(projDir, 'roadmap.md')), 'roadmap.md scaffolded (C4)');
  assert.ok(existsSync(join(projDir, 'brain', 'profile.md')), 'brain/profile.md scaffolded (C4)');
  assert.ok(existsSync(join(projDir, '.git')), 'git repo initialised');
  assert.ok(body.scaffolded.includes('roadmap.md'), 'scaffolded list reports roadmap.md');
  assert.ok(Array.isArray(body.failingClauses), 'failingClauses is an array');

  // The project is now auto-discovered (B1) — GET lists it.
  const list = await (await fetch(`${bridgeUrl}/api/studio/projects`)).json() as { projects: Array<{ id: string }> };
  assert.ok(list.projects.some((p) => p.id === 'onboard-me'), 'onboarded project is discovered');

  rmSync(projDir, { recursive: true, force: true });
});

test('POST /api/studio/projects rejects a duplicate id (already discovered) → 409', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/projects`, {
    name: 'write-project', // collides with the fixture project dir
    qualityGateCmd: 'npm test',
    northStar: 'dup',
  });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.includes('already exists'), `expected duplicate error, got: ${body.error}`);
});

// ---------------------------------------------------------------------------
// Body size cap
// ---------------------------------------------------------------------------

test('PUT with oversized body → rejected (not 200)', async () => {
  // Generate a body > 1 MiB
  const bigString = 'x'.repeat(1.2 * 1024 * 1024);
  // The bridge destroys the socket when the cap is hit; Node's undici may
  // surface this as a thrown TypeError ('fetch failed') OR as a 4xx/5xx
  // response depending on how far into the request the server has read.
  // Either outcome is acceptable — we just must not get a 200.
  try {
    const res = await fetch(`${bridgeUrl}/api/studio/agents/write-agent`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify({ ...makePutAgentBody(), purpose: bigString }),
    });
    assert.ok(res.status !== 200, `expected non-200 for oversized body, got ${res.status}`);
  } catch (err) {
    // fetch failed because the server destroyed the connection — that's the correct behaviour
    assert.ok(String(err).includes('fetch failed') || String(err).includes('ECONNRESET'),
      `expected connection error for oversized body, got: ${String(err)}`);
  }
});

// ---------------------------------------------------------------------------
// Composition entry with bad char → validateAgent error finding
// ---------------------------------------------------------------------------

test('PUT with composition entry containing bad char → 400 validation error', async () => {
  writeFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), makeAgentSkillMd());
  const body = makePutAgentBody({
    composition: {
      skills: ['tdd-workflow', 'bad skill!'],
      tools: [],
      mcps: [],
      hooks: ['event-log'],
    },
  });
  const res = await putJson(`${bridgeUrl}/api/studio/agents/write-agent`, body);
  assert.equal(res.status, 400);
  const respBody = (await res.json()) as { error: string; findings?: Array<{ check: string }> };
  assert.equal(respBody.error, 'validation failed');
  assert.ok(Array.isArray(respBody.findings));
  const compFinding = respBody.findings!.find((f) => f.check.startsWith('composition/'));
  assert.ok(compFinding, `expected a composition/* finding, got: ${JSON.stringify(respBody.findings)}`);
});
