/**
 * W7-B4 — Library authoring: the write half of the skills / hooks / templates
 * libraries plus the agent- and flow-builder lifecycle gaps. Pinned RED at
 * branch base (immutable-gates): every route below either does not exist yet
 * (404/405 passthrough) or exhibits the filed defect (silent overwrite, lost
 * kickoff, unsaveable starter canvas).
 *
 * Findings pinned here:
 *   library-05  skills PUT (edit/rename) + DELETE (guarded by usedBy)
 *   library-08  hooks PUT + DELETE (guarded by carriedBy) + revoke-approval
 *   library-17  templates POST/PUT/DELETE (planning + demo-output only)
 *   agents-28   create:true ⇒ 409 on an existing slug (silent overwrite closed)
 *   agents-18   a NEW agent gets a synthesised `phase:` (dispatchable)
 *   agents-09   agents DELETE (guarded by flow refs + session-kind refs)
 *   flows-13    create:true ⇒ 409 on an existing flow id
 *   flows-12    PUT carries kickoff through the merge; a NO-OP save leaves the
 *               seed file byte-identical (comments survive)
 *   flows-09    saving the starter canvas materialises the referenced starter
 *               agents so the save VALIDATES
 *   flows-11    flows DELETE (seed ⇒ 403, active run ⇒ 423, authored ⇒ 200)
 *
 * Style: real bridge (startBridge) + fetch, mirroring
 * cli/bridge-studio-skills.test.ts exactly.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import yaml from 'js-yaml';

import { startBridge } from './ui-bridge.ts';

// ---------------------------------------------------------------------------
// Fixture root
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

const REAL_ROOT = process.cwd();

function writeHookFixture(id: string, opts: { script?: string; on?: string } = {}): void {
  const dir = join(forgeRoot, 'studio', 'hooks', id, 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.sh'), opts.script ?? '#!/bin/bash\necho ok\n', 'utf8');
  writeFileSync(
    join(forgeRoot, 'studio', 'hooks', id, 'hook.yaml'),
    yaml.dump({
      name: id,
      description: `hook ${id}`,
      on: opts.on ?? 'SessionEnd',
      script: 'scripts/run.sh',
      permissions: { env: [], read: [], network: false },
    }),
    'utf8',
  );
}

function writeSkillFixture(id: string, opts: { name?: string } = {}): void {
  const dir = join(forgeRoot, 'skills', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    matter.stringify(`\n# ${id}\n\nBody of ${id}.\n`, {
      name: opts.name ?? id,
      description: `skill ${id}`,
      library: true,
    }),
    'utf8',
  );
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-authoring-'));

  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'hooks'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'artifact-templates'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'demo-elements'), { recursive: true });

  // Real catalog (models/guards vocabularies) + real starter agents/flow —
  // flows-09's acceptance is against the SHIPPED starter set, not a mock.
  cpSync(join(REAL_ROOT, 'studio', 'catalog.yaml'), join(forgeRoot, 'studio', 'catalog.yaml'));
  cpSync(join(REAL_ROOT, 'studio', 'starters'), join(forgeRoot, 'studio', 'starters'), { recursive: true });

  // ---- skills fixtures ----
  writeSkillFixture('editable-skill');
  writeSkillFixture('unused-skill');
  writeSkillFixture('bound-skill');

  // An agent that binds `bound-skill` (blocks its DELETE) — a studio agent
  // with a runtime block, like the real roster carries.
  mkdirSync(join(forgeRoot, 'skills', 'binder-agent'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'skills', 'binder-agent', 'SKILL.md'),
    matter.stringify('\n# Binder\n\nProcess.\n', {
      name: 'Binder Agent',
      description: 'binds bound-skill',
      purpose: 'test fixture',
      composition: { skills: ['bound-skill'], tools: [], mcps: [], guards: ['event-log'] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
      brainAccess: 'none',
      interactivity: 'autonomous',
    }),
    'utf8',
  );

  // ---- hooks fixtures ----
  writeHookFixture('editable-hook');
  writeHookFixture('approved-hook');
  writeHookFixture('unbound-hook');
  writeHookFixture('carried-hook');

  // An agent carrying `carried-hook` (blocks its DELETE).
  mkdirSync(join(forgeRoot, 'skills', 'hook-carrier'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'skills', 'hook-carrier', 'SKILL.md'),
    matter.stringify('\n# Carrier\n\nProcess.\n', {
      name: 'Hook Carrier',
      description: 'carries carried-hook',
      purpose: 'test fixture',
      composition: { skills: [], tools: [], mcps: [], guards: ['event-log'], hooks: ['carried-hook'] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
      brainAccess: 'none',
      interactivity: 'autonomous',
    }),
    'utf8',
  );

  // ---- flow fixtures ----
  // A seed flow WITH kickoff + comments — the flows-12 round-trip ground.
  mkdirSync(join(forgeRoot, 'studio', 'flows', 'seeded-flow'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'flows', 'seeded-flow', 'flow.yaml'),
    [
      '# Top-of-file comment that a save must not destroy.',
      'id: seeded-flow',
      'name: Seeded Flow',
      'version: 3',
      'goal: Prove kickoff and comments survive a builder save.',
      'project: null',
      'kb: null',
      'costCeilingUsd: 2',
      'origin: seed',
      'nodes:',
      '  # node comment',
      '  - { id: work, agent: binder-agent }',
      'edges: []',
      'triggers: []',
      'kickoff:',
      '  kind: idea',
      '',
    ].join('\n'),
    'utf8',
  );

  // An authored (origin: studio) flow — deletable.
  mkdirSync(join(forgeRoot, 'studio', 'flows', 'authored-flow'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'flows', 'authored-flow', 'flow.yaml'),
    yaml.dump({
      id: 'authored-flow',
      name: 'Authored Flow',
      version: 1,
      goal: 'deletable',
      project: null,
      kb: null,
      costCeilingUsd: 2,
      origin: 'studio',
      nodes: [{ id: 'work', agent: 'binder-agent' }],
      edges: [],
      triggers: [],
    }),
    'utf8',
  );

  // A flow that references `flow-used-agent` (blocks that agent's DELETE).
  writeSkillFixtureAgent('flow-used-agent');
  mkdirSync(join(forgeRoot, 'studio', 'flows', 'referencing-flow'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'flows', 'referencing-flow', 'flow.yaml'),
    yaml.dump({
      id: 'referencing-flow',
      name: 'Referencing Flow',
      version: 1,
      goal: 'references flow-used-agent',
      project: null,
      kb: null,
      costCeilingUsd: 2,
      origin: 'studio',
      nodes: [{ id: 'work', agent: 'flow-used-agent' }],
      edges: [],
      triggers: [],
    }),
    'utf8',
  );

  // Agents for delete tests.
  writeSkillFixtureAgent('unused-agent');
  writeSkillFixtureAgent('kind-bound-agent');
  writeSkillFixtureAgent('existing-agent');

  // A session-kind descriptor referencing kind-bound-agent (blocks DELETE).
  writeFileSync(
    join(forgeRoot, 'studio', 'session-kinds.yaml'),
    [
      'kinds:',
      '  - id: test-kind',
      '    title: Test Kind',
      '    agent: kind-bound-agent',
      '',
    ].join('\n'),
    'utf8',
  );

  // ---- template fixtures ----
  writeFileSync(
    join(forgeRoot, 'studio', 'artifact-templates', 'editable-tpl.md'),
    matter.stringify('\nTemplate body.\n', { id: 'editable-tpl', name: 'Editable', kind: 'doc' }),
    'utf8',
  );
  writeFileSync(
    join(forgeRoot, 'studio', 'artifact-templates', 'used-tpl.md'),
    matter.stringify('\nUsed template body.\n', { id: 'used-tpl', name: 'Used', kind: 'doc' }),
    'utf8',
  );
  // A flow whose edge carries artifact `used-tpl` → usedBy non-empty.
  mkdirSync(join(forgeRoot, 'studio', 'flows', 'tpl-user'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'flows', 'tpl-user', 'flow.yaml'),
    yaml.dump({
      id: 'tpl-user',
      name: 'Template User',
      version: 1,
      goal: 'uses used-tpl',
      project: null,
      kb: null,
      costCeilingUsd: 2,
      origin: 'studio',
      nodes: [{ id: 'a', agent: 'binder-agent' }, { id: 'b', agent: 'binder-agent' }],
      edges: [{ from: 'a', to: 'b', artifact: 'used-tpl' }],
      triggers: [],
    }),
    'utf8',
  );

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

function writeSkillFixtureAgent(slug: string): void {
  mkdirSync(join(forgeRoot, 'skills', slug), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'skills', slug, 'SKILL.md'),
    matter.stringify(`\n# ${slug}\n\nProcess.\n`, {
      name: slug,
      description: `agent ${slug}`,
      purpose: 'test fixture',
      composition: { skills: [], tools: [], mcps: [], guards: ['event-log'] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
      brainAccess: 'none',
      interactivity: 'autonomous',
    }),
    'utf8',
  );
}

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// HTTP helpers — every state-changing request carries the CSRF header.
// ---------------------------------------------------------------------------

const CSRF = { 'x-forge-csrf': '1', 'content-type': 'application/json' };

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${bridgeUrl}${path}`, {
    method,
    headers: CSRF,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function getJson(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// ===========================================================================
// SKILLS — PUT (edit/rename) + DELETE (library-05)
// ===========================================================================

test('PUT /api/studio/skills/:id updates description + body, preserves name', async () => {
  const res = await send('PUT', '/api/studio/skills/editable-skill', {
    description: 'updated description',
    body: '# Edited\n\nNew body.',
  });
  assert.equal(res.status, 200);
  const raw = readFileSync(join(forgeRoot, 'skills', 'editable-skill', 'SKILL.md'), 'utf8');
  const { data, content } = matter(raw);
  assert.equal(data['description'], 'updated description');
  assert.equal(data['name'], 'editable-skill'); // untouched
  assert.match(content, /New body\./);
});

test('PUT /api/studio/skills/:id renames (display name), id unchanged', async () => {
  const res = await send('PUT', '/api/studio/skills/editable-skill', { name: 'Renamed Skill' });
  assert.equal(res.status, 200);
  const { data } = matter(readFileSync(join(forgeRoot, 'skills', 'editable-skill', 'SKILL.md'), 'utf8'));
  assert.equal(data['name'], 'Renamed Skill');
  // id (directory) unchanged
  assert.ok(existsSync(join(forgeRoot, 'skills', 'editable-skill')));
});

test('PUT /api/studio/skills/:id — unknown id 404, traversal 400, studio agent 404', async () => {
  assert.equal((await send('PUT', '/api/studio/skills/no-such-skill', { name: 'x' })).status, 404);
  assert.equal((await send('PUT', '/api/studio/skills/..%2Fescape', { name: 'x' })).status, 400);
  // binder-agent has a runtime block — a studio AGENT, not a library skill.
  assert.equal((await send('PUT', '/api/studio/skills/binder-agent', { name: 'x' })).status, 404);
});

test('DELETE /api/studio/skills/:id removes an unused skill', async () => {
  const res = await send('DELETE', '/api/studio/skills/unused-skill');
  assert.equal(res.status, 200);
  assert.equal(existsSync(join(forgeRoot, 'skills', 'unused-skill')), false);
});

test('DELETE /api/studio/skills/:id refuses (409) a skill bound by an agent, names it', async () => {
  const res = await send('DELETE', '/api/studio/skills/bound-skill');
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /binder-agent/);
  assert.ok(existsSync(join(forgeRoot, 'skills', 'bound-skill', 'SKILL.md')));
});

test('DELETE /api/studio/skills/:id — unknown 404', async () => {
  assert.equal((await send('DELETE', '/api/studio/skills/no-such-skill')).status, 404);
});

// ===========================================================================
// HOOKS — PUT + DELETE + revoke-approval (library-08)
// ===========================================================================

test('PUT /api/studio/hooks/:id updates the yaml fields', async () => {
  const res = await send('PUT', '/api/studio/hooks/editable-hook', {
    description: 'edited description',
    on: 'PreToolUse',
    matcher: 'Bash',
  });
  assert.equal(res.status, 200);
  const doc = yaml.load(
    readFileSync(join(forgeRoot, 'studio', 'hooks', 'editable-hook', 'hook.yaml'), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(doc['description'], 'edited description');
  assert.equal(doc['on'], 'PreToolUse');
  assert.equal(doc['matcher'], 'Bash');
});

test('PUT /api/studio/hooks/:id — editing the script of an APPROVED hook honestly drops it back to needs-review', async () => {
  // approve first (clean script → approvable)
  const approve = await send('POST', '/api/studio/hooks/approved-hook/approve');
  assert.equal(approve.status, 200);
  let detail = await getJson('/api/studio/hooks/approved-hook');
  assert.equal(detail.body['trust'], 'approved');

  const res = await send('PUT', '/api/studio/hooks/approved-hook', {
    scriptBody: '#!/bin/bash\necho changed\n',
  });
  assert.equal(res.status, 200);
  detail = await getJson('/api/studio/hooks/approved-hook');
  assert.equal(detail.body['trust'], 'needs-review'); // hashes no longer match
});

test('PUT /api/studio/hooks/:id — invalid `on` 400, binding key 400, unknown 404', async () => {
  assert.equal((await send('PUT', '/api/studio/hooks/editable-hook', { on: 'NotAnEvent' })).status, 400);
  assert.equal((await send('PUT', '/api/studio/hooks/editable-hook', { agent: 'x' })).status, 400);
  assert.equal((await send('PUT', '/api/studio/hooks/no-such-hook', { description: 'x' })).status, 404);
});

test('POST /api/studio/hooks/:id/revoke-approval revokes and records', async () => {
  // approved-hook was re-scripted above → approve it again for a clean base
  const approve = await send('POST', '/api/studio/hooks/approved-hook/approve');
  assert.equal(approve.status, 200);

  // library-09: the detail route now carries the approval RECORD the page
  // renders (badge + approvedAt), not just the trust token.
  const approved = await getJson('/api/studio/hooks/approved-hook');
  const record = approved.body['approval'] as Record<string, unknown> | undefined;
  assert.ok(record && typeof record['approvedAt'] === 'string', 'detail carries approval.approvedAt');
  assert.equal(record['overridden'], false);

  const res = await send('POST', '/api/studio/hooks/approved-hook/revoke-approval');
  assert.equal(res.status, 200);

  const detail = await getJson('/api/studio/hooks/approved-hook');
  assert.equal(detail.body['trust'], 'needs-review');

  // The revocation is RECORDED (audit trail), not silently erased.
  const ledgerRaw = readFileSync(join(forgeRoot, 'studio', 'hook-approvals.yaml'), 'utf8');
  const ledger = yaml.load(ledgerRaw) as Record<string, unknown>;
  const revoked = ledger['revoked'] as Array<Record<string, unknown>> | undefined;
  assert.ok(Array.isArray(revoked) && revoked.some((r) => r['id'] === 'approved-hook'), 'revoked entry recorded');
});

test('POST /api/studio/hooks/:id/revoke-approval — nothing to revoke ⇒ 409', async () => {
  const res = await send('POST', '/api/studio/hooks/unbound-hook/revoke-approval');
  assert.equal(res.status, 409);
});

test('DELETE /api/studio/hooks/:id removes an unbound hook', async () => {
  const res = await send('DELETE', '/api/studio/hooks/unbound-hook');
  assert.equal(res.status, 200);
  assert.equal(existsSync(join(forgeRoot, 'studio', 'hooks', 'unbound-hook')), false);
});

test('DELETE /api/studio/hooks/:id refuses (409) a hook carried by an agent, names it', async () => {
  const res = await send('DELETE', '/api/studio/hooks/carried-hook');
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /hook-carrier/);
  assert.ok(existsSync(join(forgeRoot, 'studio', 'hooks', 'carried-hook', 'hook.yaml')));
});

test('DELETE /api/studio/hooks/:id — unknown 404', async () => {
  assert.equal((await send('DELETE', '/api/studio/hooks/no-such-hook')).status, 404);
});

// ===========================================================================
// TEMPLATES — POST / PUT / DELETE (library-17)
// ===========================================================================

const VALID_PLANNING = matter.stringify('\nA fresh planning template.\n', {
  id: 'fresh-tpl',
  name: 'Fresh Template',
  kind: 'doc',
});

test('POST /api/studio/templates creates a planning template', async () => {
  const res = await send('POST', '/api/studio/templates', {
    category: 'planning',
    id: 'fresh-tpl',
    content: VALID_PLANNING,
  });
  assert.equal(res.status, 200);
  assert.ok(existsSync(join(forgeRoot, 'studio', 'artifact-templates', 'fresh-tpl.md')));
  const detail = await getJson('/api/studio/templates/fresh-tpl');
  assert.equal(detail.status, 200);
  assert.equal(detail.body['category'], 'planning');
});

test('POST /api/studio/templates creates a demo-output template', async () => {
  const content = matter.stringify('\nHow to capture.\n', {
    id: 'fresh-demo',
    name: 'Fresh Demo Element',
    phase: 'narrative',
    description: 'a demo element',
  });
  const res = await send('POST', '/api/studio/templates', {
    category: 'demo-output',
    id: 'fresh-demo',
    content,
  });
  assert.equal(res.status, 200);
  assert.ok(existsSync(join(forgeRoot, 'studio', 'demo-elements', 'fresh-demo.md')));
});

test('POST /api/studio/templates — duplicate 409, bad category 400, id mismatch 400, malformed 400, reserved 400', async () => {
  assert.equal(
    (await send('POST', '/api/studio/templates', { category: 'planning', id: 'fresh-tpl', content: VALID_PLANNING })).status,
    409,
  );
  assert.equal(
    (await send('POST', '/api/studio/templates', { category: 'project-scaffold', id: 'x', content: 'x' })).status,
    400,
  );
  const mismatched = matter.stringify('\nBody.\n', { id: 'other-id', name: 'X', kind: 'doc' });
  assert.equal(
    (await send('POST', '/api/studio/templates', { category: 'planning', id: 'mismatch-tpl', content: mismatched })).status,
    400,
  );
  assert.equal(existsSync(join(forgeRoot, 'studio', 'artifact-templates', 'mismatch-tpl.md')), false);
  assert.equal(
    (await send('POST', '/api/studio/templates', { category: 'planning', id: 'broken-tpl', content: 'no frontmatter at all' })).status,
    400,
  );
  assert.equal(existsSync(join(forgeRoot, 'studio', 'artifact-templates', 'broken-tpl.md')), false);
  const reserved = matter.stringify('\nBody.\n', { id: 'new', name: 'X', kind: 'doc' });
  assert.equal(
    (await send('POST', '/api/studio/templates', { category: 'planning', id: 'new', content: reserved })).status,
    400,
  );
});

test('POST /api/studio/templates duplicates an existing template (duplicateOf)', async () => {
  const res = await send('POST', '/api/studio/templates', {
    category: 'planning',
    id: 'editable-tpl-copy',
    duplicateOf: 'editable-tpl',
  });
  assert.equal(res.status, 200);
  const { data, content } = matter(
    readFileSync(join(forgeRoot, 'studio', 'artifact-templates', 'editable-tpl-copy.md'), 'utf8'),
  );
  assert.equal(data['id'], 'editable-tpl-copy'); // id rewritten
  assert.match(content, /Template body\./); // body carried over
});

test('PUT /api/studio/templates/:id updates content; invalid content 400 leaves the file untouched', async () => {
  const updated = matter.stringify('\nUpdated body.\n', { id: 'editable-tpl', name: 'Editable v2', kind: 'doc' });
  const ok = await send('PUT', '/api/studio/templates/editable-tpl', { content: updated });
  assert.equal(ok.status, 200);
  const onDisk = readFileSync(join(forgeRoot, 'studio', 'artifact-templates', 'editable-tpl.md'), 'utf8');
  assert.match(onDisk, /Updated body\./);

  const bad = await send('PUT', '/api/studio/templates/editable-tpl', { content: 'garbage' });
  assert.equal(bad.status, 400);
  assert.equal(readFileSync(join(forgeRoot, 'studio', 'artifact-templates', 'editable-tpl.md'), 'utf8'), onDisk);
});

test('PUT /api/studio/templates/:id — unknown 404; scaffold read-only 400', async () => {
  assert.equal((await send('PUT', '/api/studio/templates/no-such-tpl', { content: 'x' })).status, 404);
  // typescript-cli is a real project scaffold (copied from the repo starters)
  const res = await send('PUT', '/api/studio/templates/typescript-cli', { content: 'x' });
  assert.equal(res.status, 400);
});

test('DELETE /api/studio/templates/:id — used template 409 naming the user; unused deletes', async () => {
  const used = await send('DELETE', '/api/studio/templates/used-tpl');
  assert.equal(used.status, 409);
  const body = (await used.json()) as { error?: string };
  assert.match(body.error ?? '', /tpl-user/);
  assert.ok(existsSync(join(forgeRoot, 'studio', 'artifact-templates', 'used-tpl.md')));

  const fresh = await send('DELETE', '/api/studio/templates/fresh-tpl');
  assert.equal(fresh.status, 200);
  assert.equal(existsSync(join(forgeRoot, 'studio', 'artifact-templates', 'fresh-tpl.md')), false);
});

test('DELETE /api/studio/templates/:id — unknown 404; scaffold 400', async () => {
  assert.equal((await send('DELETE', '/api/studio/templates/no-such-tpl')).status, 404);
  assert.equal((await send('DELETE', '/api/studio/templates/typescript-cli')).status, 400);
});

// ===========================================================================
// AGENTS — create-collision 409 + phase synthesis + DELETE
// ===========================================================================

const NEW_AGENT_BODY = {
  name: 'Brand New',
  purpose: 'created via the builder',
  process: 'Do the work.',
  interactivity: 'autonomous',
  brainAccess: 'none',
  composition: { skills: [], tools: [], mcps: [], guards: ['event-log'], hooks: [] },
  runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
};

test('PUT /api/studio/agents/:slug with create:true mints a NEW agent WITH a synthesised phase (agents-18)', async () => {
  const res = await send('PUT', '/api/studio/agents/brand-new', { ...NEW_AGENT_BODY, create: true });
  assert.equal(res.status, 200);
  const { data } = matter(readFileSync(join(forgeRoot, 'skills', 'brand-new', 'SKILL.md'), 'utf8'));
  assert.equal(data['phase'], 'brand-new'); // dispatchable — deriveAgentSpec no longer refuses it
});

test('PUT /api/studio/agents/:slug with create:true on an EXISTING slug ⇒ 409, file untouched (agents-28)', async () => {
  const before = readFileSync(join(forgeRoot, 'skills', 'existing-agent', 'SKILL.md'), 'utf8');
  const res = await send('PUT', '/api/studio/agents/existing-agent', { ...NEW_AGENT_BODY, create: true });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /existing-agent/);
  assert.equal(readFileSync(join(forgeRoot, 'skills', 'existing-agent', 'SKILL.md'), 'utf8'), before);
});

test('PUT /api/studio/agents/:slug WITHOUT create still updates, and does NOT synthesise a phase for an existing agent', async () => {
  const res = await send('PUT', '/api/studio/agents/existing-agent', { ...NEW_AGENT_BODY, name: 'Updated Name' });
  assert.equal(res.status, 200);
  const { data } = matter(readFileSync(join(forgeRoot, 'skills', 'existing-agent', 'SKILL.md'), 'utf8'));
  assert.equal(data['name'], 'Updated Name');
  assert.equal(data['phase'], undefined); // phase only ever synthesised at CREATE
});

test('DELETE /api/studio/agents/:slug removes an unused agent', async () => {
  const res = await send('DELETE', '/api/studio/agents/unused-agent');
  assert.equal(res.status, 200);
  assert.equal(existsSync(join(forgeRoot, 'skills', 'unused-agent')), false);
});

test('DELETE /api/studio/agents/:slug — flow-referenced 409 naming the flow', async () => {
  const res = await send('DELETE', '/api/studio/agents/flow-used-agent');
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /referencing-flow/);
  assert.ok(existsSync(join(forgeRoot, 'skills', 'flow-used-agent', 'SKILL.md')));
});

test('DELETE /api/studio/agents/:slug — session-kind-referenced 409', async () => {
  const res = await send('DELETE', '/api/studio/agents/kind-bound-agent');
  assert.equal(res.status, 409);
  assert.ok(existsSync(join(forgeRoot, 'skills', 'kind-bound-agent', 'SKILL.md')));
});

test('DELETE /api/studio/agents/:slug — unknown 404, traversal 400', async () => {
  assert.equal((await send('DELETE', '/api/studio/agents/no-such-agent')).status, 404);
  assert.equal((await send('DELETE', '/api/studio/agents/..%2Fescape')).status, 400);
});

// ===========================================================================
// FLOWS — create-collision + kickoff/comment preservation + starter save + DELETE
// ===========================================================================

test('PUT /api/studio/flows/:id with create:true on an EXISTING id ⇒ 409 (flows-13)', async () => {
  const res = await send('PUT', '/api/studio/flows/authored-flow', {
    create: true,
    name: 'Impostor',
    nodes: [{ id: 'work', agent: 'binder-agent' }],
    edges: [],
  });
  assert.equal(res.status, 409);
});

test('saving the STARTER canvas as a new flow materialises the starter agents and validates (flows-09)', async () => {
  // The starter agents are NOT in skills/ yet — precondition of the defect.
  assert.equal(existsSync(join(forgeRoot, 'skills', 'plan')), false);

  const starter = await getJson('/api/studio/starters');
  const flow = starter.body['flow'] as Record<string, unknown>;
  assert.ok(flow, 'starter flow present');

  const res = await send('PUT', '/api/studio/flows/my-first-flow', {
    create: true,
    name: 'My First Flow',
    goal: flow['goal'],
    nodes: flow['nodes'],
    edges: flow['edges'],
    triggers: [],
  });
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(res.status, 200, JSON.stringify(body));
  // The referenced starter agents got materialised into the real roster.
  for (const slug of ['plan', 'dev', 'review']) {
    assert.ok(existsSync(join(forgeRoot, 'skills', slug, 'SKILL.md')), `skills/${slug} materialised`);
  }
  assert.ok(existsSync(join(forgeRoot, 'studio', 'flows', 'my-first-flow', 'flow.yaml')));
});

test('a NO-OP builder save leaves the seed file byte-identical — kickoff + comments survive (flows-12)', async () => {
  const before = readFileSync(join(forgeRoot, 'studio', 'flows', 'seeded-flow', 'flow.yaml'), 'utf8');
  const { body: getBody } = await getJson('/api/studio/flows/seeded-flow');
  const flow = getBody['flow'] as Record<string, unknown>;

  // Exactly what the BUILD tab sends: header fields + canvas nodes/edges.
  const res = await send('PUT', '/api/studio/flows/seeded-flow', {
    name: flow['name'],
    goal: flow['goal'],
    project: flow['project'] ?? undefined,
    kb: flow['kb'] ?? undefined,
    triggers: flow['triggers'],
    nodes: flow['nodes'],
    edges: flow['edges'],
  });
  assert.equal(res.status, 200);
  const after = readFileSync(join(forgeRoot, 'studio', 'flows', 'seeded-flow', 'flow.yaml'), 'utf8');
  assert.equal(after, before, 'no-op save must not rewrite the file (comments + kickoff intact)');
});

test('a REAL edit preserves the kickoff declaration through the merge (flows-12)', async () => {
  const res = await send('PUT', '/api/studio/flows/seeded-flow', {
    goal: 'A genuinely changed goal.',
    nodes: [{ id: 'work', agent: 'binder-agent' }],
    edges: [],
  });
  assert.equal(res.status, 200);
  const after = readFileSync(join(forgeRoot, 'studio', 'flows', 'seeded-flow', 'flow.yaml'), 'utf8');
  assert.match(after, /kickoff:/, 'kickoff survives a real save');
  assert.match(after, /kind: idea/);
  assert.match(after, /A genuinely changed goal\./);
});

test('flow save failure carries per-node findings in the response body (flows-10 server half)', async () => {
  const res = await send('PUT', '/api/studio/flows/bad-flow', {
    create: true,
    name: 'Bad Flow',
    nodes: [{ id: 'x', agent: 'agent-that-does-not-exist' }],
    edges: [],
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { findings?: unknown[] };
  assert.ok(Array.isArray(body.findings) && body.findings.length > 0, '400 carries findings');
});

test('DELETE /api/studio/flows/:id — seed 403, authored 200, unknown 404', async () => {
  assert.equal((await send('DELETE', '/api/studio/flows/seeded-flow')).status, 403);
  assert.ok(existsSync(join(forgeRoot, 'studio', 'flows', 'seeded-flow', 'flow.yaml')));

  const res = await send('DELETE', '/api/studio/flows/authored-flow');
  assert.equal(res.status, 200);
  assert.equal(existsSync(join(forgeRoot, 'studio', 'flows', 'authored-flow')), false);

  assert.equal((await send('DELETE', '/api/studio/flows/no-such-flow')).status, 404);
});

test('DELETE /api/studio/flows/:id — an active run locks deletion (423)', async () => {
  // Plant an in-flight manifest claiming tpl-user (flowId stamped via flow_id).
  writeFileSync(
    join(forgeRoot, '_queue', 'in-flight', 'INIT-B4-DEL-LOCK.md'),
    ['---', 'initiative_id: INIT-B4-DEL-LOCK', 'project: demo', 'flow_id: tpl-user', '---', '', '# lock', ''].join('\n'),
    'utf8',
  );
  const res = await send('DELETE', '/api/studio/flows/tpl-user');
  assert.equal(res.status, 423);
  rmSync(join(forgeRoot, '_queue', 'in-flight', 'INIT-B4-DEL-LOCK.md'), { force: true });
});
