/**
 * SEAM F1 (operator ruling, item 81) — "a second discovery root:
 * package-owned flows [and skills]". A factory ships as a package:
 * `packages/<pkg>/flows/<id>/flow.yaml` and `packages/<pkg>/skills/<slug>/
 * SKILL.md`, discovered by the platform with NO registration code — LISTED
 * (roster), READABLE (detail/capability routes) and LINTED (studio-lint.ts
 * §1, see `apps/forge/tests/unit/studio-lint.test.ts` for the lint-side
 * doors) exactly like a `studio/flows/`- or `skills/`-owned one. Drives
 * the REAL bridge (`startBridge`), mirroring the fixture idiom of
 * `apps/forge/tests/integration/bridge-studio-flows.test.ts` and
 * `apps/forge/tests/contract/bridge-studio-sibling-containment.test.ts`.
 *
 * Fixture: `studio/flows/a/flow.yaml` (studio-owned) +
 * `packages/demo-pkg/flows/b/flow.yaml` (package-owned) +
 * `packages/demo-pkg/skills/x/SKILL.md` (package-owned agent) +
 * a symlinked `packages/evil/flows` pointing outside the fixture root.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;
let symlinksUnavailable = false;

/** Minimal valid flow.yaml (satisfies loadFlowDefinition's required fields). */
function makeFlowYaml(id: string): string {
  return [
    `id: ${id}`,
    `name: ${id}`,
    'version: 1',
    'goal: g',
    'project: null',
    'kb: null',
    'costCeilingUsd: 2',
    'origin: studio',
    'accepts: [code]',
    'nodes:',
    '  - id: n',
    '    gate: human',
    'edges: []',
    'triggers: []',
  ].join('\n');
}

/** Minimal studio-agent SKILL.md (satisfies isStudioAgent + validateAgentDocument). */
function makeAgentSkillMd(name: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: Package-owned agent "${name}" for the SEAM F1 test.`,
    'phase: architect',
    'purpose: Run tests.',
    'brainAccess: none',
    'interactivity: none',
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    '  guards: [event-log]',
    'runtime:',
    '  sdk: claude-code',
    '  strategy: fixed',
    '  model: claude-sonnet-4-5',
    'allowed-tools: []',
    'disallowed-tools: []',
    'budgets: {}',
    '---',
    '',
    'Test agent process body.',
  ].join('\n');
}

function manifestBody(id: string, flowId: string): string {
  return [
    '---',
    `initiative_id: ${id}`,
    'project: demo-project',
    `project_repo_path: ${join(forgeRoot, 'projects', 'demo-project')}`,
    `created_at: '2026-09-19T13:33:48.787Z'`,
    'iteration_budget: 3',
    'cost_budget_usd: 2',
    'class: code',
    'phase: pending',
    'origin: architect',
    `flow_id: ${flowId}`,
    'specs:',
    '  - .forge/work-items/WI-1.md',
    '---',
    '',
    '## Summary',
    '',
    'Probe manifest.',
    '',
  ].join('\n');
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-seam-f1-'));

  for (const state of ['in-flight', 'done', 'failed', 'pending', 'ready-for-review']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', 'demo-project'), { recursive: true });

  // studio/flows/a — studio-owned.
  mkdirSync(join(forgeRoot, 'studio', 'flows', 'a'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'flows', 'a', 'flow.yaml'), makeFlowYaml('a'), 'utf8');
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });

  // packages/demo-pkg/flows/b — package-owned.
  mkdirSync(join(forgeRoot, 'packages', 'demo-pkg', 'flows', 'b'), { recursive: true });
  writeFileSync(join(forgeRoot, 'packages', 'demo-pkg', 'flows', 'b', 'flow.yaml'), makeFlowYaml('b'), 'utf8');

  // packages/demo-pkg/skills/x — package-owned agent.
  mkdirSync(join(forgeRoot, 'packages', 'demo-pkg', 'skills', 'x'), { recursive: true });
  writeFileSync(join(forgeRoot, 'packages', 'demo-pkg', 'skills', 'x', 'SKILL.md'), makeAgentSkillMd('x'), 'utf8');

  // A symlinked packages/evil/flows pointing outside the fixture root — must
  // NOT be discovered (containment).
  const outside = mkdtempSync(join(tmpdir(), 'bridge-seam-f1-outside-'));
  mkdirSync(join(outside, 'flows', 'evil-flow'), { recursive: true });
  writeFileSync(join(outside, 'flows', 'evil-flow', 'flow.yaml'), makeFlowYaml('evil-flow'), 'utf8');
  mkdirSync(join(forgeRoot, 'packages', 'evil'), { recursive: true });
  try {
    symlinkSync(join(outside, 'flows'), join(forgeRoot, 'packages', 'evil', 'flows'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  // The queued initiative the run-door test enqueues onto flow "b".
  writeFileSync(join(forgeRoot, '_queue', 'pending', 'INIT-2026-09-19-seam-f1.md'), manifestBody('INIT-2026-09-19-seam-f1', 'b'));

  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('GET /api/studio/flows: lists both the studio-owned flow "a" and the package-owned flow "b"', async () => {
  const res = await fetch(`${url}/api/studio/flows`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { flows: Array<{ id: string }> };
  const ids = body.flows.map((f) => f.id).sort();
  assert.ok(ids.includes('a'), `expected "a" in ${JSON.stringify(ids)}`);
  assert.ok(ids.includes('b'), `expected "b" in ${JSON.stringify(ids)}`);
});

test('GET /api/studio/flows/b: the package-owned flow resolves through the single-flow route', async () => {
  const res = await fetch(`${url}/api/studio/flows/b`);
  const body = (await res.json()) as { flow: { id: string } };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.flow.id, 'b');
});

test('POST /api/flows/b/run: the run door finds the package-owned flow and enqueues the run', async () => {
  const res = await fetch(`${url}/api/flows/b/run`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ initiativeId: 'INIT-2026-09-19-seam-f1' }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  assert.notEqual(body.error, 'flow not found', `run door must not 404 the package-owned flow: ${JSON.stringify(body)}`);
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.status, 'enqueued');
});

test('a symlinked packages/evil/flows is NOT discovered', async (t) => {
  if (symlinksUnavailable) { t.skip('symlinks unavailable on this filesystem'); return; }
  const res = await fetch(`${url}/api/studio/flows`);
  const body = (await res.json()) as { flows: Array<{ id: string }> };
  const ids = body.flows.map((f) => f.id);
  assert.ok(!ids.includes('evil-flow'), `symlinked package flow must not be discovered: ${JSON.stringify(ids)}`);

  const runRes = await fetch(`${url}/api/flows/evil-flow/run`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ initiativeId: 'INIT-2026-09-19-seam-f1' }),
  });
  assert.equal(runRes.status, 404, 'the symlinked flow must not be runnable either');
});

test('GET /api/studio/agents: the package-owned skill "x" appears in the agent roster', async () => {
  const res = await fetch(`${url}/api/studio/agents`);
  const body = (await res.json()) as { agents: Array<{ slug: string }> };
  assert.equal(res.status, 200, JSON.stringify(body));
  const slugs = body.agents.map((a) => a.slug);
  assert.ok(slugs.includes('x'), `expected "x" in the roster: ${JSON.stringify(slugs)}`);
});

test('GET /api/studio/agents/x/capability: the package-owned skill\'s detail/read route returns its SKILL.md', async () => {
  const res = await fetch(`${url}/api/studio/agents/x/capability`);
  const body = (await res.json()) as { slug?: string; capability?: unknown; error?: string };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.slug, 'x');
  assert.ok(body.capability, `expected a real capability derived from the read SKILL.md: ${JSON.stringify(body)}`);
});

test('PUT /api/studio/agents/x: a save to a package-owned skill slug is refused (read-only), naming the package', async () => {
  const res = await fetch(`${url}/api/studio/agents/x`, {
    method: 'PUT',
    headers: CSRF,
    body: JSON.stringify({}),
  });
  const body = (await res.json()) as { error?: string };
  assert.equal(res.status, 409, JSON.stringify(body));
  assert.match(body.error ?? '', /package-owned skill "x" is read-only — it ships with packages\/demo-pkg/);
});

test('DELETE /api/studio/agents/x: a delete of a package-owned skill slug is refused (read-only), same as the save', async () => {
  const res = await fetch(`${url}/api/studio/agents/x`, { method: 'DELETE', headers: CSRF });
  const body = (await res.json()) as { error?: string };
  assert.equal(res.status, 409, JSON.stringify(body));
  assert.match(body.error ?? '', /package-owned skill "x" is read-only/);
});

test('PUT /api/studio/flows/b: a save to a package-owned flow id is refused (read-only)', async () => {
  const res = await fetch(`${url}/api/studio/flows/b`, {
    method: 'PUT',
    headers: CSRF,
    body: JSON.stringify({ name: 'b', goal: 'hijacked', nodes: [{ id: 'n', gate: 'human' }], edges: [], triggers: [] }),
  });
  const body = (await res.json()) as { error?: string };
  assert.equal(res.status, 409, JSON.stringify(body));
  assert.match(body.error ?? '', /package-owned flow "b" is read-only — it ships with packages\/demo-pkg/);
});

test('DELETE /api/studio/flows/b: a delete of a package-owned flow id is refused (read-only), same as the save', async () => {
  const res = await fetch(`${url}/api/studio/flows/b`, { method: 'DELETE', headers: CSRF });
  const body = (await res.json()) as { error?: string };
  assert.equal(res.status, 409, JSON.stringify(body));
  assert.match(body.error ?? '', /package-owned flow "b" is read-only/);
});

test('POST /api/flows/dup/run: a flow id real under two roots is a named, non-swallowed error — never 404 "not found"', async () => {
  // Isolated fixture (its own bridge): a duplicate anywhere in the tree
  // makes GET /api/studio/flows itself throw (loud, by design), so this
  // must not share the suite's main fixture/bridge.
  const dupRoot = mkdtempSync(join(tmpdir(), 'bridge-seam-f1-dup-'));
  let dupClose: (() => Promise<void>) | undefined;
  try {
    for (const state of ['in-flight', 'done', 'failed', 'pending', 'ready-for-review']) {
      mkdirSync(join(dupRoot, '_queue', state), { recursive: true });
    }
    mkdirSync(join(dupRoot, '_logs'), { recursive: true });
    mkdirSync(join(dupRoot, 'studio', 'flows', 'dup'), { recursive: true });
    writeFileSync(join(dupRoot, 'studio', 'flows', 'dup', 'flow.yaml'), makeFlowYaml('dup'), 'utf8');
    mkdirSync(join(dupRoot, 'packages', 'demo-pkg', 'flows', 'dup'), { recursive: true });
    writeFileSync(join(dupRoot, 'packages', 'demo-pkg', 'flows', 'dup', 'flow.yaml'), makeFlowYaml('dup'), 'utf8');

    const dup = await startBridge({ forgeRoot: dupRoot, port: 0 });
    dupClose = dup.close;

    const res = await fetch(`${dup.url}/api/flows/dup/run`, {
      method: 'POST',
      headers: CSRF,
      body: JSON.stringify({ initiativeId: 'INIT-2026-09-19-does-not-matter' }),
    });
    const body = (await res.json()) as { error?: string; flowId?: string };
    // Never a 404 "not found" — a duplicate is a checkout defect, not an
    // absent flow — and never swallowed into a generic/empty response.
    assert.notEqual(res.status, 404, `must not read as "not found": ${JSON.stringify(body)}`);
    assert.notEqual(body.error, 'flow not found', `must not read as "not found": ${JSON.stringify(body)}`);
    assert.ok(body.error, `must carry a named error, got: ${JSON.stringify(body)}`);
    assert.match(body.error, /dup/, `the error must name the flow id: ${JSON.stringify(body)}`);
    assert.match(body.error, /more than one discovery root/, `the error must name the defect class: ${JSON.stringify(body)}`);
  } finally {
    if (dupClose) await dupClose();
    rmSync(dupRoot, { recursive: true, force: true });
  }
});

test('deleting packages/demo-pkg removes flow "b" and skill "x" — and nothing else', async () => {
  rmSync(join(forgeRoot, 'packages', 'demo-pkg'), { recursive: true, force: true });

  const flowsRes = await fetch(`${url}/api/studio/flows`);
  const flowsBody = (await flowsRes.json()) as { flows: Array<{ id: string }> };
  const flowIds = flowsBody.flows.map((f) => f.id);
  assert.ok(!flowIds.includes('b'), `"b" must be gone after deleting its package: ${JSON.stringify(flowIds)}`);
  assert.ok(flowIds.includes('a'), 'studio-owned "a" is untouched');

  const agentsRes = await fetch(`${url}/api/studio/agents`);
  const agentsBody = (await agentsRes.json()) as { agents: Array<{ slug: string }> };
  const slugs = agentsBody.agents.map((a) => a.slug);
  assert.ok(!slugs.includes('x'), `"x" must be gone after deleting its package: ${JSON.stringify(slugs)}`);
});
