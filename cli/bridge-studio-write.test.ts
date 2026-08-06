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
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';

import { startBridge } from './ui-bridge.ts';

// Real repo SKILL.md, located relative to THIS test file (not a hardcoded
// absolute path) — the golden file for the byte-faithful round-trip ATs.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REAL_DEV_RALPH_PATH = join(REPO_ROOT, 'skills', 'developer-ralph', 'SKILL.md');

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
    // R2-01-F5: must be a valid SURFACE_KINDS value — 'forge' was a bogus
    // placeholder that now trips the surface/enum lint check (validateAgent
    // also guards the bridge PUT save path).
    'surface: unattended',
    'purpose: Write tests to validate the PUT routes.',
    'brainAccess: advisory',
    'interactivity: none',
    'composition:',
    '  skills:',
    '    - tdd-workflow',
    '  tools: []',
    '  mcps: []',
    '  guards:',
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

/** Full valid project.json that includes the required testProcess.local.cmd */
function makeProjectJson(extras: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      testProcess: { local: { cmd: ['npm', 'test'] } },
      northStar: 'Ship a great product.',
      instructions: 'Always write tests first.',
      demoProcess: [
        { kind: 'capture', text: 'Capture before state.' },
        { kind: 'verify', text: 'Run npm test' },
      ],
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
      guards: ['event-log'],
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
  assert.ok(/^library:/m.test(skillMd), 'authored agent carries an explicit library flag (R3-01-F2)');
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

// ---------------------------------------------------------------------------
// POST /api/studio/projects — R4-02-F3: a fresh onboard binds the project KB
// ---------------------------------------------------------------------------

test('POST /api/studio/projects (R4-02-F3): fresh onboard binds project.json.kb to the seeded KB', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/projects`, {
    name: 'F3 Onboard Proj',
    qualityGateCmd: 'tsc --noEmit',
    northStar: 'ship the thing',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; id: string };
  assert.equal(body.ok, true);
  const id = body.id; // 'f3-onboard-proj'

  // project.json now carries the kb binding (was omitted → unbound before F3).
  const cfg = JSON.parse(
    readFileSync(join(forgeRoot, 'projects', id, '.forge', 'project.json'), 'utf8'),
  ) as { kb?: string };
  assert.equal(cfg.kb, id, 'project.json.kb bound to the project id');

  // The seeded central KB exists and its binding ref matches the bound id.
  const kbYaml = readFileSync(join(forgeRoot, 'brain', 'projects', id, 'kb.yaml'), 'utf8');
  assert.match(kbYaml, new RegExp(`ref:\\s*${id}`), 'seeded kb.yaml binds to the same id');
});

// ---------------------------------------------------------------------------
// POST /api/studio/projects/create — R4-03: greenfield scaffold from a template
// ---------------------------------------------------------------------------

test('POST /api/studio/projects/create: missing fields → 400', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/projects/create`, { name: 'x' });
  assert.equal(res.status, 400);
});

test('POST /api/studio/projects/create: unknown appType → 400', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/projects/create`, { name: 'x', appType: 'cobol', northStar: 'y' });
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /unknown appType/);
});

test('POST /api/studio/projects/create (R4-03): greenfield scaffold from a template → ready', async () => {
  // Give the test forge root the real curated templates.
  cpSync(join(process.cwd(), 'studio', 'starters', 'projects'), join(forgeRoot, 'studio', 'starters', 'projects'), { recursive: true });
  const res = await postJson(`${bridgeUrl}/api/studio/projects/create`, {
    name: 'Greenfield Demo',
    appType: 'typescript-cli',
    northStar: 'ship the greenfield thing',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; id: string; ready: boolean; failingClauses: unknown[] };
  assert.equal(body.ok, true);
  assert.equal(body.id, 'greenfield-demo');
  assert.equal(body.ready, true, `expected contract-green; failing: ${JSON.stringify(body.failingClauses)}`);
  // The scaffolded project is real + tokens substituted.
  const pkg = readFileSync(join(forgeRoot, 'projects', 'greenfield-demo', 'package.json'), 'utf8');
  assert.match(pkg, /"name": "greenfield-demo"/);
});

// ---------------------------------------------------------------------------
// SEC-03 round 3 (BLOCKER) — POST /api/studio/projects/create leaves a
// HALF-CREATED project behind when seedProjectBrain rejects. See
// orchestrator/project-create.test.ts's matching function-level test for the
// full mechanism writeup; this is the SAME defect driven through the REAL
// HTTP route, with the operator-visible consequence (GET /api/studio/projects
// still lists it) asserted via the real listing route.
// ---------------------------------------------------------------------------

test('(RED) [SEC-03 round 3] POST /api/studio/projects/create: after a seedProjectBrain rejection, the project directory does not exist and does not appear in GET /api/studio/projects', async () => {
  cpSync(join(process.cwd(), 'studio', 'starters', 'projects'), join(forgeRoot, 'studio', 'starters', 'projects'), { recursive: true });
  const id = 'halfcreated-http-blocker';
  const outside = mkdtempSync(join(tmpdir(), 'bridge-studio-write-halfcreated-outside-'));
  try {
    // Finding-A shape #1 (already fixed, correctly rejects): brain/projects/<id>
    // itself a symlinked directory pointing outside forgeRoot.
    mkdirSync(join(forgeRoot, 'brain', 'projects'), { recursive: true });
    symlinkSync(outside, join(forgeRoot, 'brain', 'projects', id), 'dir');

    const res = await postJson(`${bridgeUrl}/api/studio/projects/create`, {
      name: 'Halfcreated Http Blocker',
      appType: 'typescript-cli',
      northStar: 'ship the thing',
    });
    assert.notEqual(res.status, 200, `sanity: the containment rejection must not report success — got ${res.status}: ${await res.text()}`);

    const projectDir = join(forgeRoot, 'projects', id);
    assert.ok(
      !existsSync(projectDir),
      `copyTemplate already wrote a complete project directory before seedProjectBrain ran — the operator was told "not created" (status ${res.status}) but "${projectDir}" exists on disk`,
    );

    // Operator-visible consequence — driven through the REAL listing route.
    const listRes = await fetch(`${bridgeUrl}/api/studio/projects`);
    assert.equal(listRes.status, 200);
    const { projects } = (await listRes.json()) as { projects: Array<{ id: string }> };
    assert.ok(
      !projects.some((p) => p.id === id),
      `GET /api/studio/projects must NOT list a project the create API just reported as failed — found: ${JSON.stringify(projects.map((p) => p.id))}`,
    );

    // Property #3: the original containment property must not regress.
    assert.deepEqual(readdirSync(outside), [], 'nothing may be created at the symlink target outside forgeRoot');
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('positive control (passes before AND after the SEC-03 round-3 fix): a normal POST /api/studio/projects/create still succeeds and appears in GET /api/studio/projects', async () => {
  cpSync(join(process.cwd(), 'studio', 'starters', 'projects'), join(forgeRoot, 'studio', 'starters', 'projects'), { recursive: true });
  const res = await postJson(`${bridgeUrl}/api/studio/projects/create`, {
    name: 'Normal Http Greenfield',
    appType: 'typescript-cli',
    northStar: 'ship the thing',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected a normal greenfield create to succeed — got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; id: string };
  assert.equal(body.ok, true);
  assert.ok(existsSync(join(forgeRoot, 'projects', body.id, '.forge', 'project.json')));

  const listRes = await fetch(`${bridgeUrl}/api/studio/projects`);
  const { projects } = (await listRes.json()) as { projects: Array<{ id: string }> };
  assert.ok(projects.some((p) => p.id === body.id), `expected "${body.id}" in the listing — got ${JSON.stringify(projects.map((p) => p.id))}`);
});

// POST /api/studio/skills test coverage MOVED to cli/bridge-studio-skills.test.ts
// (R3-01-F3/F4, AT-55) — the route itself relocates there in WI-2.

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
// PUT /api/studio/agents — materials (R2-09 D1/D2)
// ---------------------------------------------------------------------------

test('PUT with materials persists it; the reloaded definition has it', async () => {
  writeFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), makeAgentSkillMd());
  const res = await putJson(
    `${bridgeUrl}/api/studio/agents/write-agent`,
    makePutAgentBody({ materials: ['images', 'documents'] }),
  );
  const okText = await res.text();
  assert.equal(res.status, 200, okText);
  const { data } = matter(readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8'));
  assert.deepEqual(data.materials, ['images', 'documents']);
});

test('PUT with an unknown material kind → 400 with a materials/enum finding, file byte-unchanged', async () => {
  writeFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), makeAgentSkillMd());
  const originalContent = readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8');

  const res = await putJson(
    `${bridgeUrl}/api/studio/agents/write-agent`,
    makePutAgentBody({ materials: ['holograms'] }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; findings: Array<{ level: string; check: string }> };
  const finding = body.findings.find((f) => f.check === 'materials/enum');
  assert.ok(finding, 'expected a materials/enum finding');
  assert.equal(finding!.level, 'error');

  const afterContent = readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8');
  assert.equal(afterContent, originalContent, 'SKILL.md must be byte-unchanged after a rejected PUT');
});

test('materials omitted from the PUT body for an agent that HAS materials on disk → preserved (inherit-when-omitted)', async () => {
  writeFileSync(
    join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'),
    makeAgentSkillMd().replace(
      'purpose: Write tests to validate the PUT routes.',
      'purpose: Write tests to validate the PUT routes.\nmaterials: [images]',
    ),
  );
  const res = await putJson(`${bridgeUrl}/api/studio/agents/write-agent`, makePutAgentBody());
  const okText = await res.text();
  assert.equal(res.status, 200, okText);
  const { data } = matter(readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8'));
  assert.deepEqual(data.materials, ['images'], 'omitting materials from the PUT body must preserve the on-disk value');
});

test('materials: [] explicitly in the PUT body clears it — distinguishable from omission', async () => {
  writeFileSync(
    join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'),
    makeAgentSkillMd().replace(
      'purpose: Write tests to validate the PUT routes.',
      'purpose: Write tests to validate the PUT routes.\nmaterials: [images]',
    ),
  );
  const res = await putJson(`${bridgeUrl}/api/studio/agents/write-agent`, makePutAgentBody({ materials: [] }));
  const okText = await res.text();
  assert.equal(res.status, 200, okText);
  const { data } = matter(readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8'));
  assert.deepEqual(data.materials, [], 'an explicit empty array must clear materials, not preserve the prior declared value');
});

// ---------------------------------------------------------------------------
// PUT /api/studio/agents — fanout preservation (D7 regression)
// ---------------------------------------------------------------------------

function makeFanoutAgentSkillMd(): string {
  return [
    '---',
    'name: Fanout Agent',
    'description: An agent for fanout-preservation regression tests.',
    'phase: developer',
    'surface: unattended',
    'purpose: Exercise the fanout-preservation regression (D7).',
    'brainAccess: advisory',
    'interactivity: none',
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    '  guards:',
    '    - event-log',
    'runtime:',
    '  sdk: claude-code',
    '  strategy: fixed',
    '  model: claude-sonnet-4-5',
    'fanout:',
    '  drivingArtifact: work-items',
    '  isolation: worktree',
    '  concurrencyCap: 1',
    '  perItemGate: item-declared',
    'allowed-tools:',
    '  - Read',
    'disallowed-tools: []',
    'budgets: {}',
    '---',
    '',
    '# Fanout Agent',
    '',
    'Process body text.',
  ].join('\n');
}

test('PUT changing only process preserves an existing fanout: block byte-for-byte (D7 regression)', async () => {
  mkdirSync(join(forgeRoot, 'skills', 'fanout-agent'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'fanout-agent', 'SKILL.md'), makeFanoutAgentSkillMd());

  const res = await putJson(`${bridgeUrl}/api/studio/agents/fanout-agent`, {
    name: 'Fanout Agent',
    purpose: 'Exercise the fanout-preservation regression (D7).',
    process: 'Updated process body only.',
    interactivity: 'none',
    brainAccess: 'advisory',
    composition: { skills: [], tools: [], mcps: [], guards: ['event-log'] },
    runtime: { sdk: 'claude-code', strategy: 'fixed', model: 'claude-sonnet-4-5' },
  });
  const okText = await res.text();
  assert.equal(res.status, 200, okText);

  const { data } = matter(readFileSync(join(forgeRoot, 'skills', 'fanout-agent', 'SKILL.md'), 'utf8'));
  assert.deepEqual(
    data.fanout,
    { drivingArtifact: 'work-items', isolation: 'worktree', concurrencyCap: 1, perItemGate: 'item-declared' },
    'a PUT that only changes process must not silently strip fanout (today\'s merged object literal omits it entirely)',
  );
});

// ---------------------------------------------------------------------------
// PUT /api/studio/agents — byte-faithful round-trip through the real route
// (golden file: skills/developer-ralph/SKILL.md, seeded into the tmp forgeRoot)
// ---------------------------------------------------------------------------

test('PUT with only process changed on the seeded real developer-ralph bytes → byte-exact frontmatter prefix, verbatim body', async () => {
  const originalRaw = readFileSync(REAL_DEV_RALPH_PATH, 'utf8');
  const seededDir = join(forgeRoot, 'skills', 'developer-ralph');
  mkdirSync(seededDir, { recursive: true });
  writeFileSync(join(seededDir, 'SKILL.md'), originalRaw, 'utf8');

  const { data, content } = matter(originalRaw);
  const bodyStart = originalRaw.length - content.length;
  const newProcess = 'Updated process only — byte-faithful round-trip probe.';

  const res = await putJson(`${bridgeUrl}/api/studio/agents/developer-ralph`, {
    name: data.name,
    purpose: data.purpose,
    process: newProcess,
    interactivity: data.interactivity,
    brainAccess: data.brainAccess,
    composition: data.composition,
    runtime: data.runtime,
  });
  const okText = await res.text();
  assert.equal(res.status, 200, okText);

  const after = readFileSync(join(seededDir, 'SKILL.md'), 'utf8');
  assert.equal(
    after.slice(0, bodyStart),
    originalRaw.slice(0, bodyStart),
    'the frontmatter block (comments, fanout, key order) must be byte-identical when nothing frontmatter-relevant changed',
  );
  assert.equal(after.slice(bodyStart), newProcess, 'the body region must be replaced verbatim, no leading-newline normalization');
});

test('a PUT that legitimately changes a frontmatter field still reloads with the new value and a byte-exact body', async () => {
  const originalRaw = readFileSync(REAL_DEV_RALPH_PATH, 'utf8');
  // Reuse the "developer-ralph" slug (not a differently-named copy): the
  // validateAgent rule restricting `loopStrategy: ralph` to the canonical
  // developer-ralph slug would otherwise reject any other agent carrying it
  // — re-seeding the same slug dir with fresh original bytes at the start of
  // each test keeps this test independent of the byte-faithful-round-trip
  // test above without tripping that unrelated rule.
  const seededDir = join(forgeRoot, 'skills', 'developer-ralph');
  mkdirSync(seededDir, { recursive: true });
  writeFileSync(join(seededDir, 'SKILL.md'), originalRaw, 'utf8');

  const { data, content: originalBody } = matter(originalRaw);
  const res = await putJson(`${bridgeUrl}/api/studio/agents/developer-ralph`, {
    name: data.name,
    purpose: 'A legitimately DIFFERENT purpose for this AT.',
    interactivity: data.interactivity,
    brainAccess: data.brainAccess,
    composition: data.composition,
    runtime: data.runtime,
  });
  const okText = await res.text();
  assert.equal(res.status, 200, okText);

  const after = readFileSync(join(seededDir, 'SKILL.md'), 'utf8');
  const { data: afterData, content: afterBody } = matter(after);
  assert.equal(afterData.purpose, 'A legitimately DIFFERENT purpose for this AT.');
  assert.equal(afterBody, originalBody, 'the body must stay byte-exact even through the full re-serialize path');
});

// ---------------------------------------------------------------------------
// PUT /api/studio/agents — symlink escape (2026-08-05 adversarial-review
// round 2, finding C/6, VERIFIED BLOCKER). `skillMdPath.startsWith(skillsDir
// + sep)` at cli/bridge-studio-writes.ts is a LEXICAL check on the
// CONSTRUCTED path string — it never resolves symlinks. A slug that passes
// SLUG_RE always constructs a path lexically inside skills/, so the guard
// can never fire regardless of what that path actually points at on disk.
// If `skills/<slug>/SKILL.md` is a symlink to a file OUTSIDE the forge root,
// `writeFileSync` follows it and overwrites the outside file — a genuine
// arbitrary-file-write primitive via the Studio agent editor.
// ---------------------------------------------------------------------------

test('BLOCKER: PUT rejects a symlinked SKILL.md FILE escaping the forge root — the outside file stays byte-unchanged (real dir, symlinked file)', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-write-outside-'));
  const outsideFile = join(outsideDir, 'secret.md');
  const outsideOriginal = makeAgentSkillMd().replace('Write Agent', 'Outside Secret Agent');
  writeFileSync(outsideFile, outsideOriginal, 'utf8');

  // The escape session DIRECTORY (skills/escape-put-agent/) is REAL — only
  // the SKILL.md FILE inside it is a symlink. This is the shape that defeats
  // a fix which only re-checks/canonicalises the DIRECTORY resolver: the
  // directory itself is legitimately inside the forge root.
  mkdirSync(join(forgeRoot, 'skills', 'escape-put-agent'), { recursive: true });
  const linkPath = join(forgeRoot, 'skills', 'escape-put-agent', 'SKILL.md');
  try {
    symlinkSync(outsideFile, linkPath);
  } catch {
    // Symlink creation can be unavailable in some sandboxes — skip rather
    // than false-failing the suite for an environment limitation.
    rmSync(outsideDir, { recursive: true, force: true });
    return;
  }

  try {
    const res = await putJson(
      `${bridgeUrl}/api/studio/agents/escape-put-agent`,
      makePutAgentBody({ name: 'Outside Secret Agent', purpose: 'ATTACKER-CONTROLLED purpose overwrite attempt.' }),
    );
    assert.notEqual(
      res.status,
      200,
      'a PUT through a symlinked SKILL.md file escaping the forge root must be REJECTED, not written (verified live BLOCKER: today it returns 200 and overwrites the target)',
    );
    const outsideAfter = readFileSync(outsideFile, 'utf8');
    assert.equal(outsideAfter, outsideOriginal, 'the out-of-tree file must be byte-unchanged');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('PUT rejects a symlinked skills/<slug> DIRECTORY escaping the forge root — the outside file stays byte-unchanged', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-write-outside-dir-'));
  const outsideSkillPath = join(outsideDir, 'SKILL.md');
  const outsideOriginal = makeAgentSkillMd().replace('Write Agent', 'Outside Dir Secret Agent');
  writeFileSync(outsideSkillPath, outsideOriginal, 'utf8');

  const linkPath = join(forgeRoot, 'skills', 'escape-put-dir-agent');
  try {
    symlinkSync(outsideDir, linkPath, 'dir');
  } catch {
    rmSync(outsideDir, { recursive: true, force: true });
    return;
  }

  try {
    const res = await putJson(
      `${bridgeUrl}/api/studio/agents/escape-put-dir-agent`,
      makePutAgentBody({ name: 'Outside Dir Secret Agent', purpose: 'ATTACKER-CONTROLLED purpose overwrite attempt.' }),
    );
    assert.notEqual(
      res.status,
      200,
      'a PUT through a symlinked skills/<slug> directory escaping the forge root must be REJECTED, not written',
    );
    const outsideAfter = readFileSync(outsideSkillPath, 'utf8');
    assert.equal(outsideAfter, outsideOriginal, 'the out-of-tree file must be byte-unchanged');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/studio/agents — HARDLINK escape defeats the round-2 realpath fix
// (2026-08-05 adversarial-review round 3, finding B/4-5, CLOSED not merely
// disclosed). `realpathSync` (cli/skill-md-path-guard.ts) only resolves
// SYMLINKS — a HARDLINKED `SKILL.md` is a genuine, non-symlink directory
// entry that is lexically AND really inside skills/<slug>/, sharing the same
// inode as the outside file it was linked from. `realpathSync` returns that
// same in-tree path unchanged (nothing to resolve), so the containment check
// passes — yet writing through it modifies the SAME inode the outside path
// also names. No race required; 100% deterministic. This is a DIFFERENT
// bug from the disclosed residual TOCTOU in the guard's docstring (that is a
// check-then-use timing window on a WRITE path that starts safe; this is a
// hardlink that is unsafe from the very first stat).
// ---------------------------------------------------------------------------

test('BLOCKER: PUT rejects a HARDLINKED SKILL.md pointing outside the forge root — the outside file stays byte-unchanged', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-write-outside-hardlink-'));
  const outsideFile = join(outsideDir, 'secret.md');
  const outsideOriginal = makeAgentSkillMd().replace('Write Agent', 'Hardlink Secret Agent');
  writeFileSync(outsideFile, outsideOriginal, 'utf8');

  mkdirSync(join(forgeRoot, 'skills', 'hlink-agent'), { recursive: true });
  const linkPath = join(forgeRoot, 'skills', 'hlink-agent', 'SKILL.md');
  try {
    linkSync(outsideFile, linkPath);
  } catch {
    // Hardlinks across filesystems (e.g. a tmp dir on a different mount)
    // fail with EXDEV — skip rather than false-failing the suite for an
    // environment limitation, mirroring the symlink-unavailable escapes.
    rmSync(outsideDir, { recursive: true, force: true });
    return;
  }

  try {
    const res = await putJson(
      `${bridgeUrl}/api/studio/agents/hlink-agent`,
      makePutAgentBody({ name: 'Hardlink Secret Agent', purpose: 'ATTACKER-CONTROLLED purpose overwrite attempt via hardlink.' }),
    );
    assert.notEqual(
      res.status,
      200,
      'a PUT through a hardlinked SKILL.md must be REJECTED — realpathSync cannot resolve a hardlink away, so containment-by-realpath alone is insufficient (verified live: today it returns 200 and the shared inode is overwritten)',
    );
    const outsideAfter = readFileSync(outsideFile, 'utf8');
    assert.equal(outsideAfter, outsideOriginal, 'the out-of-tree file (same inode as the hardlink) must be byte-unchanged');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('a normal, un-hardlinked agent still saves fine (the hardlink guard must not reject ordinary files)', async () => {
  writeFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), makeAgentSkillMd());
  const res = await putJson(`${bridgeUrl}/api/studio/agents/write-agent`, makePutAgentBody());
  const okText4 = await res.text();
  assert.equal(res.status, 200, okText4);
});

// ---------------------------------------------------------------------------
// PUT /api/studio/agents — same-root symlink silently overwrites a DIFFERENT
// agent (2026-08-05 adversarial-review round 3, finding C/6). Containment
// that only checks "the resolved real path is SOMEWHERE under skills/" is
// insufficient: slug `evil` symlinked to a REAL agent directory `legit`
// resolves genuinely inside skills/, so the guard reports ok:true — but
// `realPath` points at `legit/SKILL.md`, not `evil`'s own directory. A PUT
// to `evil` then reads/writes `legit`'s file while reporting success for
// `evil`. Containment must mean "this slug's OWN directory", not merely
// "somewhere under skills/".
// ---------------------------------------------------------------------------

test('PUT rejects a slug whose directory is a symlink to ANOTHER agent\'s directory — the other agent\'s SKILL.md stays byte-unchanged', async () => {
  const legitOriginal = makeAgentSkillMd().replace('Write Agent', 'Legit Agent').replace('write-agent', 'legit-agent');
  mkdirSync(join(forgeRoot, 'skills', 'legit-agent'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'legit-agent', 'SKILL.md'), legitOriginal, 'utf8');

  const linkPath = join(forgeRoot, 'skills', 'evil-agent');
  try {
    symlinkSync(join(forgeRoot, 'skills', 'legit-agent'), linkPath, 'dir');
  } catch {
    return;
  }

  const res = await putJson(
    `${bridgeUrl}/api/studio/agents/evil-agent`,
    makePutAgentBody({ name: 'Evil Agent', purpose: 'ATTACKER-CONTROLLED cross-agent overwrite via evil-agent.' }),
  );
  assert.notEqual(
    res.status,
    200,
    'a PUT to a slug whose OWN directory is a symlink to a DIFFERENT real agent directory must be REJECTED — "somewhere under skills/" is not the same containment guarantee as "this slug\'s own directory"',
  );
  const legitAfter = readFileSync(join(forgeRoot, 'skills', 'legit-agent', 'SKILL.md'), 'utf8');
  assert.equal(legitAfter, legitOriginal, "legit-agent's SKILL.md must be byte-unchanged after a rejected PUT to evil-agent");
});

// ---------------------------------------------------------------------------
// PUT /api/studio/agents — byte-preservation is defeated by composition.hooks
// (2026-08-05 adversarial-review round 2, finding C/7). Every prior fixture
// in this file (and the developer-ralph golden file) omits composition.hooks
// entirely, so the byte-faithful-round-trip and fanout-survives ATs above
// pass identically whether the D5 verbatim fast path actually engages or
// not. These two ATs use a fixture that HAS non-empty composition.hooks AND
// a frontmatter "#" comment block, so the fast path is genuinely exercised.
// ---------------------------------------------------------------------------

function makeHookedAgentSkillMd(): string {
  return [
    '---',
    'name: Hooked Agent',
    'description: An agent for byte-preservation + hooks tests.',
    // Explicit `library: true` (matching the real roster's convention, e.g.
    // developer-ralph) — WITHOUT it, `existing?.library ?? true` synthesises
    // a `library: true` key the original never had, which alone defeats the
    // deep-equal-against-original check and would confound this test with a
    // second, unrelated mismatch driver. This fixture isolates hooks as the
    // ONLY variable.
    'library: true',
    'phase: developer',
    'surface: unattended',
    'purpose: Exercise byte-preservation with composition.hooks present.',
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    '  guards:',
    '    - event-log',
    '  hooks:',
    '    - test-hook',
    'runtime:',
    '  sdk: claude-code',
    '  strategy: fixed',
    '  model: claude-sonnet-4-5',
    '# A frontmatter comment block that must survive byte-for-byte when the',
    '# verbatim fast path engages (D5) — this is the exact loss vector these',
    '# byte-preservation ATs exist to pin.',
    'brainAccess: advisory',
    'interactivity: none',
    'allowed-tools:',
    '  - Read',
    'disallowed-tools: []',
    'budgets: {}',
    '---',
    '',
    '# Hooked Agent',
    '',
    'Process body text.',
  ].join('\n');
}

/** Register a real library hook so composition.hooks: [test-hook] passes
 *  checkHookComposition (an unregistered hook id is an error-level finding
 *  that would 400 every PUT in this section for an unrelated reason). */
function seedTestHook(root: string): void {
  const hookDir = join(root, 'studio', 'hooks', 'test-hook');
  mkdirSync(hookDir, { recursive: true });
  writeFileSync(
    join(hookDir, 'hook.yaml'),
    [
      'id: test-hook',
      'name: test-hook',
      'description: A test hook for byte-preservation tests.',
      'on: SessionEnd',
      'script: scripts/run.sh',
      'permissions:',
      '  env: []',
      '  read: []',
      '  network: false',
    ].join('\n'),
  );
}

test('byte-preservation WITH hooks present: PUT changing only process while RESENDING the same hooks ⇒ frontmatter (comments, hooks, key order) byte-identical', async () => {
  seedTestHook(forgeRoot);
  const original = makeHookedAgentSkillMd();
  mkdirSync(join(forgeRoot, 'skills', 'hooked-agent'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'hooked-agent', 'SKILL.md'), original);

  const { data, content } = matter(original);
  const bodyStart = original.length - content.length;

  const res = await putJson(`${bridgeUrl}/api/studio/agents/hooked-agent`, {
    name: data.name,
    purpose: data.purpose,
    process: 'Updated process only — hooks byte-preservation probe.',
    interactivity: data.interactivity,
    brainAccess: data.brainAccess,
    composition: data.composition,
    runtime: data.runtime,
  });
  const okText = await res.text();
  assert.equal(res.status, 200, okText);

  const after = readFileSync(join(forgeRoot, 'skills', 'hooked-agent', 'SKILL.md'), 'utf8');
  assert.equal(
    after.slice(0, bodyStart),
    original.slice(0, bodyStart),
    'frontmatter (the # comment block, the hooks: list, key order) must be byte-identical when hooks are RESENT unchanged',
  );
  const { data: afterData } = matter(after);
  assert.deepEqual(afterData.composition.hooks, ['test-hook'], 'hooks must survive intact');
});

test('byte-preservation WITH hooks present: PUT that OMITS composition.hooks clears them — the DOCUMENTED R3-03 no-fallback carve-out, not a bug (regression lock, not a fix pin)', async () => {
  seedTestHook(forgeRoot);
  const original = makeHookedAgentSkillMd();
  mkdirSync(join(forgeRoot, 'skills', 'hooked-agent-2'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'hooked-agent-2', 'SKILL.md'), original);

  const { data } = matter(original);
  const comp = data.composition as { skills: string[]; tools: string[]; mcps: string[]; guards: string[] };
  const compositionWithoutHooks = { skills: comp.skills, tools: comp.tools, mcps: comp.mcps, guards: comp.guards };

  const res = await putJson(`${bridgeUrl}/api/studio/agents/hooked-agent-2`, {
    name: data.name,
    purpose: data.purpose,
    process: 'Updated process only.',
    interactivity: data.interactivity,
    brainAccess: data.brainAccess,
    composition: compositionWithoutHooks,
    runtime: data.runtime,
  });
  const okText2 = await res.text();
  assert.equal(res.status, 200, okText2);

  const after = readFileSync(join(forgeRoot, 'skills', 'hooked-agent-2', 'SKILL.md'), 'utf8');
  const { data: afterData } = matter(after);
  assert.deepEqual(
    afterData.composition.hooks,
    [],
    'omitting composition.hooks from the PUT body must clear it to [] — the DOCUMENTED R3-03 no-fallback carve-out (bridge-studio-writes.ts:383-395); this must never silently change to an inherit-when-omitted behaviour',
  );
});

// ---------------------------------------------------------------------------
// PUT /api/studio/agents — malformed materials silently no-ops (2026-08-05
// adversarial-review round 2, finding C/8). `Array.isArray(b['materials']) ?
// b['materials'] : existing?.materials` treats ANY non-array materials value
// as "not sent" and silently falls back to the existing on-disk value with a
// 200 OK — a malformed shape should be REJECTED (400), not swallowed.
// ---------------------------------------------------------------------------

async function assertMalformedMaterialsRejected(materialsValue: unknown, label: string): Promise<void> {
  writeFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), makeAgentSkillMd());
  const originalContent = readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8');

  const res = await putJson(`${bridgeUrl}/api/studio/agents/write-agent`, makePutAgentBody({ materials: materialsValue }));
  assert.equal(res.status, 400, `expected 400 for materials:${label}, got ${res.status} (a malformed shape must not silently no-op)`);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === 'string' && body.error.length > 0, `error must be surfaced for materials:${label}`);

  const afterContent = readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8');
  assert.equal(afterContent, originalContent, `SKILL.md must be byte-unchanged for a rejected materials:${label}`);
}

test('malformed materials in the PUT body (null) → 400 with a surfaced error, file byte-unchanged', async () => {
  await assertMalformedMaterialsRejected(null, 'null');
});

test('malformed materials in the PUT body ({}) → 400 with a surfaced error, file byte-unchanged', async () => {
  await assertMalformedMaterialsRejected({}, '{}');
});

test('malformed materials in the PUT body ("images", a bare string) → 400 with a surfaced error, file byte-unchanged', async () => {
  await assertMalformedMaterialsRejected('images', '"images"');
});

// Regression lock: the two legitimate inherit-when-omitted / explicit-clear
// paths (AT44/45, already covered above) must keep passing alongside the new
// malformed-shape rejection — an omitted materials field is NOT malformed.
test('materials omitted (not sent at all) still inherits from disk — NOT treated as malformed', async () => {
  writeFileSync(
    join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'),
    makeAgentSkillMd().replace(
      'purpose: Write tests to validate the PUT routes.',
      'purpose: Write tests to validate the PUT routes.\nmaterials: [audio]',
    ),
  );
  const res = await putJson(`${bridgeUrl}/api/studio/agents/write-agent`, makePutAgentBody());
  const okText3 = await res.text();
  assert.equal(res.status, 200, okText3);
  const { data } = matter(readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8'));
  assert.deepEqual(data.materials, ['audio']);
});

// ---------------------------------------------------------------------------
// PUT /api/studio/agents — materials length cap (2026-08-05 adversarial-
// review round 2, finding C/9). Nothing today bounds the size of the
// materials array; a 10k-entry array of unknown values would produce a
// 10k-entry findings response in the 400 body — a DoS-shaped payload, not a
// useful error. The fix must short-circuit to a single shape-level
// rejection before per-value enum checking runs.
// ---------------------------------------------------------------------------

test('a materials array far longer than the vocabulary (10k entries) → 400 shape error, not a 10k-entry findings response', async () => {
  writeFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), makeAgentSkillMd());
  const originalContent = readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8');

  const hugeMaterials = new Array(10000).fill('holograms');
  const res = await putJson(`${bridgeUrl}/api/studio/agents/write-agent`, makePutAgentBody({ materials: hugeMaterials }));
  assert.equal(res.status, 400, `expected 400 for an oversized materials array, got ${res.status}`);
  const body = (await res.json()) as { error: string; findings?: unknown[] };
  assert.ok(
    !Array.isArray(body.findings) || body.findings.length < 100,
    `expected a single shape-level rejection, not a findings-per-element explosion — got ${Array.isArray(body.findings) ? body.findings.length : 'n/a'} findings`,
  );

  const afterContent = readFileSync(join(forgeRoot, 'skills', 'write-agent', 'SKILL.md'), 'utf8');
  assert.equal(afterContent, originalContent, 'SKILL.md must be byte-unchanged for a rejected oversized materials array');
});

// ---------------------------------------------------------------------------
// PUT /api/studio/projects/:id — edits M2 fields, preserves required fields
// ---------------------------------------------------------------------------

test('PUT /api/studio/projects/write-project edits northStar + demoProcess, preserves testProcess', async () => {
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
  assert.deepEqual(written['testProcess'], { local: { cmd: ['npm', 'test'] } }, 'testProcess preserved');
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

// AGENTS.md single-source guard (Stage A): when an AGENTS.md exists, the editor
// save must NOT write a divergent `instructions` copy into project.json — the
// file is the single source. Other fields still save.
test('PUT /api/studio/projects/write-project does NOT overwrite instructions when an AGENTS.md exists', async () => {
  writeFileSync(join(projectDir, '.forge', 'project.json'), makeProjectJson());
  const agentsPath = join(projectDir, 'AGENTS.md');
  writeFileSync(agentsPath, '# AGENTS\n\nThe real single source of instructions.');
  try {
    const res = await putJson(`${bridgeUrl}/api/studio/projects/write-project`, {
      northStar: 'Edited north star.',
      instructions: 'DIVERGENT COPY THAT MUST BE DROPPED',
    });
    assert.equal(res.status, 200);
    const written = JSON.parse(readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8')) as Record<string, unknown>;
    // The unrelated field saved…
    assert.equal(written['northStar'], 'Edited north star.');
    // …but the instructions field was NOT overwritten with the divergent copy
    // (it keeps whatever was there; the AGENTS.md remains the source of truth).
    assert.notEqual(written['instructions'], 'DIVERGENT COPY THAT MUST BE DROPPED');
    assert.equal(written['instructions'], 'Always write tests first.');
  } finally {
    rmSync(agentsPath, { force: true });
  }
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
// PUT /api/studio/projects/:id — symlink/hardlink containment escapes
// (2026-08-05 adversarial-review round 4, finding B/5-6). Guard at
// cli/bridge-studio-writes.ts (~L797-798), root projects/<id>. A PURE
// slug-symlink (projects/<id> itself a symlink) is blocked ACCIDENTALLY —
// discoverProjects()'s `readdirSync(dir, {withFileTypes:true})` +
// `dirent.isDirectory()` filter reports false for a symlink dirent (it does
// not follow the link), so that id is never even discovered. That is kept
// below as a regression lock, NOT claimed as a containment pin — the two
// genuine, confirmed escapes use a REAL, genuinely-discovered project dir
// with a symlinked/hardlinked entry ONE LEVEL DEEPER, which the
// isDirectory() filter never sees.
// ---------------------------------------------------------------------------

test('regression lock (NOT a containment pin): a pure symlinked projects/<id> is never discovered — 404 by accident of discoverProjects()\'s isDirectory() filter', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-write-outside-pure-symlink-'));
  mkdirSync(join(outsideDir, '.forge'), { recursive: true });
  writeFileSync(join(outsideDir, '.forge', 'project.json'), makeProjectJson({ name: 'Outside Pure Symlink Project' }));

  const linkPath = join(forgeRoot, 'projects', 'pure-symlink-project');
  try {
    symlinkSync(outsideDir, linkPath, 'dir');
  } catch {
    rmSync(outsideDir, { recursive: true, force: true });
    return;
  }

  try {
    const res = await putJson(`${bridgeUrl}/api/studio/projects/pure-symlink-project`, {
      northStar: 'Should never reach the outside file — this id is never discovered at all.',
    });
    assert.equal(
      res.status,
      404,
      'a symlinked projects/<id> must not be discovered by discoverProjects() — expected accidental 404 (do not read this as a deliberate containment guarantee)',
    );
  } finally {
    rmSync(linkPath, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('BLOCKER: PUT rejects a genuine project whose .forge is a symlinked DIRECTORY escaping the forge root — the outside project.json stays byte-unchanged', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-write-outside-forge-'));
  const outsideProjectJson = join(outsideDir, 'project.json');
  const outsideOriginal = makeProjectJson({ name: 'Outside Secret Project (symlinked .forge)' });
  writeFileSync(outsideProjectJson, outsideOriginal, 'utf8');

  const projDir = join(forgeRoot, 'projects', 'symlink-forge-project');
  mkdirSync(projDir, { recursive: true });
  const forgeLinkPath = join(projDir, '.forge');
  try {
    symlinkSync(outsideDir, forgeLinkPath, 'dir');
  } catch {
    rmSync(outsideDir, { recursive: true, force: true });
    rmSync(projDir, { recursive: true, force: true });
    return;
  }

  try {
    // projects/symlink-forge-project IS a real, genuine directory — it
    // passes discoverProjects()'s isDirectory() filter and is discovered
    // normally. Only the NESTED .forge entry is a symlink, one level below
    // where that filter looks.
    const res = await putJson(`${bridgeUrl}/api/studio/projects/symlink-forge-project`, {
      northStar: 'ATTACKER-CONTROLLED overwrite via a symlinked .forge directory.',
    });
    assert.notEqual(
      res.status,
      200,
      'a PUT through a symlinked .forge directory escaping the forge root must be REJECTED (verified live: today it returns 200 and the outside project.json is replaced)',
    );
    const outsideAfter = readFileSync(outsideProjectJson, 'utf8');
    assert.equal(outsideAfter, outsideOriginal, 'the out-of-tree project.json must be byte-unchanged');
  } finally {
    rmSync(forgeLinkPath, { force: true });
    rmSync(projDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('BLOCKER: PUT rejects a genuine project whose .forge/project.json is HARDLINKED to an outside file — the outside file stays byte-unchanged', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-write-outside-projectjson-hardlink-'));
  const outsideFile = join(outsideDir, 'secret-project.json');
  const outsideOriginal = makeProjectJson({ name: 'Hardlink Secret Project' });
  writeFileSync(outsideFile, outsideOriginal, 'utf8');

  const projDir = join(forgeRoot, 'projects', 'hardlink-projectjson-project');
  const forgeDir = join(projDir, '.forge');
  mkdirSync(forgeDir, { recursive: true });
  const linkPath = join(forgeDir, 'project.json');
  try {
    linkSync(outsideFile, linkPath);
  } catch {
    // Cross-filesystem hardlinks (EXDEV) can be unavailable — skip rather
    // than false-failing the suite for an environment limitation.
    rmSync(outsideDir, { recursive: true, force: true });
    rmSync(projDir, { recursive: true, force: true });
    return;
  }

  try {
    // projects/hardlink-projectjson-project AND its .forge/ are both REAL,
    // genuine directories — only the project.json LEAF is a hardlink.
    const res = await putJson(`${bridgeUrl}/api/studio/projects/hardlink-projectjson-project`, {
      northStar: 'ATTACKER-CONTROLLED overwrite via a hardlinked project.json.',
    });
    assert.notEqual(
      res.status,
      200,
      'a PUT through a hardlinked project.json must be REJECTED — realpath cannot resolve a hardlink away (verified live: today it returns 200 and the outside file is overwritten)',
    );
    const outsideAfter = readFileSync(outsideFile, 'utf8');
    assert.equal(outsideAfter, outsideOriginal, 'the out-of-tree file (same inode as the hardlink) must be byte-unchanged');
  } finally {
    rmSync(projDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
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
    ok: boolean; id: string; ready: boolean; scaffolded: string[];
    brainSeed: Array<{ path: string; action: string }>; failingClauses: Array<{ id: string }>;
  };
  assert.equal(body.ok, true);
  assert.equal(body.id, 'onboard-me');

  // .forge/project.json written with the hard contract fields.
  const projDir = join(forgeRoot, 'projects', 'onboard-me');
  const cfgPath = join(projDir, '.forge', 'project.json');
  assert.ok(existsSync(cfgPath), 'project.json must be scaffolded');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
  const testProcess = cfg.testProcess as { local?: { cmd?: unknown } } | undefined;
  assert.ok(Array.isArray(testProcess?.local?.cmd), 'C1 testProcess.local.cmd present');
  assert.ok(Array.isArray(cfg.demoProcess), 'demoProcess present');

  // B3: the C4 artifacts + a git repo were scaffolded (idempotent stubs).
  assert.ok(existsSync(join(projDir, 'roadmap.md')), 'roadmap.md scaffolded (C4)');
  assert.ok(existsSync(join(projDir, 'brain', 'profile.md')), 'brain/profile.md scaffolded (C4)');
  assert.ok(existsSync(join(projDir, '.git')), 'git repo initialised');
  assert.ok(body.scaffolded.includes('roadmap.md'), 'scaffolded list reports roadmap.md');
  assert.ok(Array.isArray(body.failingClauses), 'failingClauses is an array');

  // Phase 5 §8: the CENTRAL Brain-3 stub was seeded alongside the local
  // C4 artifacts — kb.yaml + profile.md + themes/README.md, all reported
  // "created" (brand-new project, nothing pre-existing to skip).
  const centralBrainDir = join(forgeRoot, 'brain', 'projects', 'onboard-me');
  assert.ok(existsSync(join(centralBrainDir, 'kb.yaml')), 'central kb.yaml seeded');
  assert.ok(existsSync(join(centralBrainDir, 'profile.md')), 'central profile.md seeded');
  assert.ok(existsSync(join(centralBrainDir, 'themes', 'README.md')), 'central themes/README.md seeded');
  assert.equal(body.brainSeed.length, 3, 'brainSeed reports all 3 seeded files');
  assert.ok(body.brainSeed.every((f) => f.action === 'created'), 'every file reported as created');
  assert.ok(
    body.scaffolded.includes('brain/projects/onboard-me/kb.yaml'),
    'scaffolded list also reports the central kb.yaml',
  );
  // C4 requires exactly this central profile.md — seeding it means a
  // freshly onboarded project is no longer C4-blocked on the brain half.
  assert.ok(
    !body.failingClauses.some((c) => c.id === 'C4'),
    `C4 should be satisfied once the central brain is seeded, got: ${JSON.stringify(body.failingClauses)}`,
  );

  // The project is now auto-discovered (B1) — GET lists it.
  const list = await (await fetch(`${bridgeUrl}/api/studio/projects`)).json() as { projects: Array<{ id: string }> };
  assert.ok(list.projects.some((p) => p.id === 'onboard-me'), 'onboarded project is discovered');

  rmSync(projDir, { recursive: true, force: true });
  rmSync(centralBrainDir, { recursive: true, force: true });
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

test('POST /api/studio/projects never overwrites a pre-existing central brain (idempotent per-file)', async () => {
  // Simulate an operator (or a prior partial onboarding) who already hand-
  // authored a central profile.md before the project itself was created.
  const centralBrainDir = join(forgeRoot, 'brain', 'projects', 'pre-seeded');
  mkdirSync(centralBrainDir, { recursive: true });
  const handAuthoredProfile = '# pre-seeded — hand-authored, do not clobber\n';
  writeFileSync(join(centralBrainDir, 'profile.md'), handAuthoredProfile, 'utf8');

  const res = await postJson(`${bridgeUrl}/api/studio/projects`, {
    name: 'Pre Seeded',
    qualityGateCmd: 'npm test',
    northStar: 'Prove the brain seed is idempotent per file.',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { brainSeed: Array<{ path: string; action: string }> };

  // profile.md was skipped (untouched); the two siblings were still created.
  const byPath = new Map(body.brainSeed.map((f) => [f.path, f.action]));
  assert.equal(byPath.get('brain/projects/pre-seeded/profile.md'), 'skipped-existing');
  assert.equal(byPath.get('brain/projects/pre-seeded/kb.yaml'), 'created');
  assert.equal(byPath.get('brain/projects/pre-seeded/themes/README.md'), 'created');
  assert.equal(
    readFileSync(join(centralBrainDir, 'profile.md'), 'utf8'),
    handAuthoredProfile,
    'hand-authored profile.md content must survive untouched',
  );

  rmSync(join(forgeRoot, 'projects', 'pre-seeded'), { recursive: true, force: true });
  rmSync(centralBrainDir, { recursive: true, force: true });
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
      guards: ['event-log'],
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
