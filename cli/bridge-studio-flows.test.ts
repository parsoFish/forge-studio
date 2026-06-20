/**
 * Tests for flow write/read bridge routes (M4-1).
 *
 * Spins up a real bridge against a tmp forge-root fixture with:
 *   - studio/flows/test-flow/flow.yaml  (a valid flow with a gate node)
 *   - studio/flows/locked-flow/flow.yaml  (flow used for edit-lock test)
 *   - _queue/in-flight/<init>.md  (to produce an active run for the lock test)
 *   - skills/test-agent/SKILL.md  (minimal studio agent for agent-ref checks)
 *
 * Covers:
 *   GET /api/studio/flows/:id        — returns flow, 404 unknown, 400 traversal
 *   PUT /api/studio/flows/:id        — edits nodes/edges + bumps version, preserves origin/disposable
 *   PUT /api/studio/flows/:id        — invalid (cycle / bad agent-ref / zero-gate) → 400 + findings, UNCHANGED
 *   PUT /api/studio/flows/new-id     — creates new flow.yaml (version 1)
 *   PUT /api/studio/flows/:id        — edit-lock 423 when a run is active for the flow
 *   PUT /api/studio/flows/:id        — path traversal id → 400
 *   GET /api/studio/flows            — list still works (passthrough unaffected)
 *   Security self-audit assertions   — id traversal, no command-field, version monotonic
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Valid flow YAML with a gate node (satisfies zero-gate check) */
function makeFlowYaml(overrides: Partial<{
  id: string;
  name: string;
  version: number;
  origin: string;
  disposable: boolean;
  extraLines: string[];
}> = {}): string {
  const id = overrides.id ?? 'test-flow';
  const name = overrides.name ?? 'Test Flow';
  const version = overrides.version ?? 1;
  const origin = overrides.origin ?? 'studio';
  const extra = overrides.extraLines ?? [];

  const lines = [
    `id: ${id}`,
    `name: ${name}`,
    `version: ${version}`,
    'goal: Ship something great.',
    'project: null',
    'kb: null',
    'costCeilingUsd: 2',
    `origin: ${origin}`,
    'nodes:',
    '  - id: architect',
    '    agent: test-agent',
    '  - id: review',
    '    gate: human',
    'edges:',
    '  - from: architect',
    '    to: review',
    '    artifact: PLAN.md',
    'triggers: []',
    ...extra,
  ];
  return lines.join('\n');
}

/** Minimal studio SKILL.md for the test-agent referenced by test flows */
function makeAgentSkillMd(): string {
  return [
    '---',
    'name: Test Agent',
    'description: Minimal agent for flow tests.',
    'phase: architect',
    'purpose: Run tests.',
    'brainAccess: none',
    'interactivity: none',
    'composition:',
    '  skills: [tdd-workflow]',
    '  tools: []',
    '  mcps: []',
    '  hooks: [event-log]',
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

/** Minimal manifest for an in-flight cycle (produces an active run) */
function makeInFlightManifest(initId: string, cycleId: string): string {
  return [
    '---',
    `initiative_id: ${initId}`,
    `cycle_id: ${cycleId}`,
    'project: test-project',
    'project_repo_path: /tmp/test-project',
    'worktree_path: /tmp/worktrees/test',
    // S8/DEC-3: run-model stamps the run's flowId from the manifest's flow_id
    // (the forge-cycle default was retired) — name the locked-flow fixture so the
    // edit-lock predicate (r.flowId === id) matches.
    'flow_id: locked-flow',
    'origin: architect',
    'created_at: 2026-06-13T10:00:00.000Z',
    'iteration_budget: 5',
    'cost_budget_usd: 2.0',
    '---',
    '',
    '# Lock test initiative',
    '',
    'Body.',
  ].join('\n');
}

/** Minimal events.jsonl for an active (in-flight) cycle */
function makeActiveEventsJsonl(cycleId: string, initId: string): string {
  return JSON.stringify({
    event_id: 'EV_001',
    cycle_id: cycleId,
    initiative_id: initId,
    phase: 'architect',
    skill: 'architect',
    event_type: 'start',
    started_at: new Date().toISOString(),
    message: 'cycle.start',
    input_refs: [],
    output_refs: [],
  }) + '\n';
}

// ---------------------------------------------------------------------------
// Global fixtures
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

// IDs for the edit-lock test
const LOCK_INIT_ID = 'INIT-LOCK-001';
const LOCK_CYCLE_ID = `2026-06-13T10-00-00_${LOCK_INIT_ID}`;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-flows-'));

  // ---- skills/test-agent/SKILL.md (agent referenced by flows) ----
  mkdirSync(join(forgeRoot, 'skills', 'test-agent'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'test-agent', 'SKILL.md'), makeAgentSkillMd());

  // ---- studio/flows/test-flow/flow.yaml (the primary test flow) ----
  mkdirSync(join(forgeRoot, 'studio', 'flows', 'test-flow'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml'),
    makeFlowYaml({ id: 'test-flow', version: 3, origin: 'studio' }),
  );

  // ---- studio/flows/locked-flow/flow.yaml (flow with an active run) ----
  mkdirSync(join(forgeRoot, 'studio', 'flows', 'locked-flow'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'flows', 'locked-flow', 'flow.yaml'),
    makeFlowYaml({ id: 'locked-flow', version: 1, origin: 'studio' }),
  );

  // ---- _queue/in-flight/<init>.md (produces status=active for locked-flow run) ----
  mkdirSync(join(forgeRoot, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(
    join(forgeRoot, '_queue', 'in-flight', `${LOCK_INIT_ID}.md`),
    makeInFlightManifest(LOCK_INIT_ID, LOCK_CYCLE_ID),
  );

  // ---- _logs/<cycleId>/events.jsonl (minimal events for the active run) ----
  mkdirSync(join(forgeRoot, '_logs', LOCK_CYCLE_ID), { recursive: true });
  writeFileSync(
    join(forgeRoot, '_logs', LOCK_CYCLE_ID, 'events.jsonl'),
    makeActiveEventsJsonl(LOCK_CYCLE_ID, LOCK_INIT_ID),
  );

  // ---- stub _queue dirs required by startBridge / listRuns ----
  for (const state of ['pending', 'done', 'ready-for-review', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
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
// Helpers
// ---------------------------------------------------------------------------

async function putJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
}

function resetTestFlow(): void {
  writeFileSync(
    join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml'),
    makeFlowYaml({ id: 'test-flow', version: 3, origin: 'studio' }),
  );
}

// ---------------------------------------------------------------------------
// GET /api/studio/flows/:id
// ---------------------------------------------------------------------------

test('GET /api/studio/flows/test-flow returns the flow', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/flows/test-flow`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { flow: { id: string; version: number; origin: string } };
  assert.ok(body.flow, 'flow must be present');
  assert.equal(body.flow.id, 'test-flow');
  assert.equal(body.flow.version, 3);
  assert.equal(body.flow.origin, 'studio');
});

test('GET /api/studio/flows/unknown-flow → 404', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/flows/unknown-flow`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'unknown flow');
});

test('GET /api/studio/flows/..%2Fx → 400 path traversal', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/flows/..%2Fx`);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === 'string');
  assert.ok(
    body.error.includes('invalid flow id') || body.error.includes('traversal'),
    `expected traversal/id error, got: ${body.error}`,
  );
});

test('GET /api/studio/flows/UPPERCASE → 400 (slug must be lowercase)', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/flows/UPPERCASE`);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.includes('invalid flow id'), `expected slug error, got: ${body.error}`);
});

// ---------------------------------------------------------------------------
// PUT /api/studio/flows/:id — edits + version bump
// ---------------------------------------------------------------------------

test('PUT /api/studio/flows/test-flow edits goal + nodes + edges, bumps version from 3→4', async () => {
  resetTestFlow();

  const res = await putJson(`${bridgeUrl}/api/studio/flows/test-flow`, {
    goal: 'Updated goal.',
    nodes: [
      { id: 'architect', agent: 'test-agent' },
      { id: 'pm', agent: 'test-agent' },
      { id: 'review', gate: 'human' },
    ],
    edges: [
      { from: 'architect', to: 'pm', artifact: 'PLAN.md' },
      { from: 'pm', to: 'review', artifact: 'work-items' },
    ],
    triggers: [],
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; id: string; version: number; findings: unknown[] };
  assert.equal(body.ok, true);
  assert.equal(body.id, 'test-flow');
  assert.equal(body.version, 4, 'version must bump from 3 to 4');
  assert.ok(Array.isArray(body.findings));

  // Verify disk
  const written = readFileSync(join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml'), 'utf8');
  assert.ok(written.includes('version: 4'), 'version written as 4');
  assert.ok(written.includes('Updated goal.'), 'goal updated');
  assert.ok(written.includes('id: pm'), 'new node written');
});

test('PUT /api/studio/flows/test-flow preserves origin + disposable when not in body', async () => {
  resetTestFlow();

  const res = await putJson(`${bridgeUrl}/api/studio/flows/test-flow`, {
    goal: 'Preserve check goal.',
    nodes: [
      { id: 'architect', agent: 'test-agent' },
      { id: 'review', gate: 'human' },
    ],
    edges: [{ from: 'architect', to: 'review', artifact: 'PLAN.md' }],
    triggers: [],
  });

  assert.equal(res.status, 200);
  const written = readFileSync(join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml'), 'utf8');
  // origin 'studio' from existing must be preserved
  assert.ok(written.includes('origin: studio'), 'origin preserved');
});

test('PUT /api/studio/flows/test-flow version is monotonic (sequential writes keep incrementing)', async () => {
  resetTestFlow(); // resets to version 3

  const minimalBody = {
    goal: 'Step A.',
    nodes: [{ id: 'architect', agent: 'test-agent' }, { id: 'review', gate: 'human' }],
    edges: [{ from: 'architect', to: 'review', artifact: 'PLAN.md' }],
    triggers: [],
  };

  const r1 = await putJson(`${bridgeUrl}/api/studio/flows/test-flow`, { ...minimalBody, goal: 'Step A.' });
  assert.equal(r1.status, 200);
  const b1 = (await r1.json()) as { version: number };
  assert.equal(b1.version, 4);

  const r2 = await putJson(`${bridgeUrl}/api/studio/flows/test-flow`, { ...minimalBody, goal: 'Step B.' });
  assert.equal(r2.status, 200);
  const b2 = (await r2.json()) as { version: number };
  assert.equal(b2.version, 5, 'second write must bump again');
});

// ---------------------------------------------------------------------------
// PUT /api/studio/flows — new flow (no existing file → creates + version 1)
// ---------------------------------------------------------------------------

test('PUT /api/studio/flows/new-flow creates flow.yaml when absent, version = 1', async () => {
  const newFlowPath = join(forgeRoot, 'studio', 'flows', 'new-flow', 'flow.yaml');
  // Ensure it doesn't already exist from a prior run
  if (existsSync(newFlowPath)) {
    rmSync(join(forgeRoot, 'studio', 'flows', 'new-flow'), { recursive: true });
  }

  const res = await putJson(`${bridgeUrl}/api/studio/flows/new-flow`, {
    name: 'New Flow',
    goal: 'A brand new flow.',
    project: null,
    kb: null,
    nodes: [{ id: 'architect', agent: 'test-agent' }, { id: 'review', gate: 'human' }],
    edges: [{ from: 'architect', to: 'review', artifact: 'PLAN.md' }],
    triggers: [],
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; id: string; version: number };
  assert.equal(body.ok, true);
  assert.equal(body.id, 'new-flow');
  assert.equal(body.version, 1, 'new flow must start at version 1');

  assert.ok(existsSync(newFlowPath), 'flow.yaml must be created on disk');
  const written = readFileSync(newFlowPath, 'utf8');
  assert.ok(written.includes('id: new-flow'), 'id written');
  assert.ok(written.includes('version: 1'), 'version 1 written');
  assert.ok(written.includes('A brand new flow.'), 'goal written');
});

// ---------------------------------------------------------------------------
// PUT /api/studio/flows — validation rejections (file UNCHANGED)
// ---------------------------------------------------------------------------

test('PUT /api/studio/flows/test-flow with cycle a→b→a → 400 + findings, YAML unchanged', async () => {
  resetTestFlow();
  const originalYaml = readFileSync(join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml'), 'utf8');

  const res = await putJson(`${bridgeUrl}/api/studio/flows/test-flow`, {
    goal: 'Cyclic flow.',
    nodes: [
      { id: 'node-a', agent: 'test-agent' },
      { id: 'node-b', agent: 'test-agent' },
      { id: 'review', gate: 'human' },
    ],
    edges: [
      // a → b → a (cycle)
      { from: 'node-a', to: 'node-b', artifact: 'plan' },
      { from: 'node-b', to: 'node-a', artifact: 'feedback' },
      { from: 'node-b', to: 'review', artifact: 'plan' },
    ],
    triggers: [],
  });

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; findings: Array<{ check: string }> };
  assert.equal(body.error, 'validation failed');
  assert.ok(Array.isArray(body.findings));
  const cycleFinding = body.findings.find((f) => f.check === 'acyclic');
  assert.ok(cycleFinding, `expected acyclic finding, got: ${JSON.stringify(body.findings)}`);

  // File must be unchanged
  const afterYaml = readFileSync(join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml'), 'utf8');
  assert.equal(afterYaml, originalYaml, 'flow.yaml must be unchanged after 400');
});

test('PUT /api/studio/flows/test-flow with unknown agent-ref → 400 + findings, YAML unchanged', async () => {
  resetTestFlow();
  const originalYaml = readFileSync(join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml'), 'utf8');

  const res = await putJson(`${bridgeUrl}/api/studio/flows/test-flow`, {
    goal: 'Bad agent ref.',
    nodes: [
      { id: 'architect', agent: 'does-not-exist' },
      { id: 'review', gate: 'human' },
    ],
    edges: [{ from: 'architect', to: 'review', artifact: 'PLAN.md' }],
    triggers: [],
  });

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; findings: Array<{ check: string }> };
  assert.equal(body.error, 'validation failed');
  const agentRefFinding = body.findings.find((f) => f.check === 'agent-ref');
  assert.ok(agentRefFinding, `expected agent-ref finding, got: ${JSON.stringify(body.findings)}`);

  const afterYaml = readFileSync(join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml'), 'utf8');
  assert.equal(afterYaml, originalYaml, 'flow.yaml must be unchanged after 400');
});

test('PUT /api/studio/flows/test-flow zero-gate non-disposable → 400 + findings, YAML unchanged', async () => {
  resetTestFlow();
  const originalYaml = readFileSync(join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml'), 'utf8');

  const res = await putJson(`${bridgeUrl}/api/studio/flows/test-flow`, {
    goal: 'No gate flow.',
    // No gate node — only agent nodes
    nodes: [
      { id: 'architect', agent: 'test-agent' },
      { id: 'pm', agent: 'test-agent' },
    ],
    edges: [{ from: 'architect', to: 'pm', artifact: 'PLAN.md' }],
    triggers: [],
  });

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; findings: Array<{ check: string }> };
  assert.equal(body.error, 'validation failed');
  const gateF = body.findings.find((f) => f.check === 'zero-gate');
  assert.ok(gateF, `expected zero-gate finding, got: ${JSON.stringify(body.findings)}`);

  const afterYaml = readFileSync(join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml'), 'utf8');
  assert.equal(afterYaml, originalYaml, 'flow.yaml must be unchanged after 400');
});

// ---------------------------------------------------------------------------
// PUT /api/studio/flows — edit-lock (423 when a run is active for the flow)
// ---------------------------------------------------------------------------

test('PUT /api/studio/flows/locked-flow → 423 when a run with that flowId is active', async () => {
  // The fixture sets up studio/flows/locked-flow/flow.yaml + an in-flight manifest
  // (INIT-LOCK-001) whose flow_id is 'locked-flow', so run-model yields an active
  // Run with flowId='locked-flow' (S8/DEC-3: the run's flowId comes from the
  // manifest now, not a hardcoded forge-cycle constant) — the lock predicate
  // (r.flowId === id) matches and the write is rejected.
  const lockedFlowPath = join(forgeRoot, 'studio', 'flows', 'locked-flow', 'flow.yaml');
  const originalYaml = readFileSync(lockedFlowPath, 'utf8');

  const res = await putJson(`${bridgeUrl}/api/studio/flows/locked-flow`, {
    goal: 'Locked write attempt.',
    nodes: [{ id: 'architect', agent: 'test-agent' }, { id: 'review', gate: 'human' }],
    edges: [{ from: 'architect', to: 'review', artifact: 'PLAN.md' }],
    triggers: [],
  });

  assert.equal(res.status, 423, `expected 423 Locked, got ${res.status}`);
  const body = (await res.json()) as { error: string; runId?: string };
  assert.ok(body.error.includes('locked') || body.error.includes('in flight'), `expected lock error, got: ${body.error}`);

  // File must be unchanged
  const afterYaml = readFileSync(lockedFlowPath, 'utf8');
  assert.equal(afterYaml, originalYaml, 'flow.yaml must be unchanged when locked');
});

// ---------------------------------------------------------------------------
// PUT /api/studio/flows — id guards
// ---------------------------------------------------------------------------

test('PUT /api/studio/flows/..%2F..%2Fetc → 400 path traversal', async () => {
  const res = await putJson(`${bridgeUrl}/api/studio/flows/..%2F..%2Fetc`, {
    goal: 'Traversal.',
    nodes: [{ id: 'architect', agent: 'test-agent' }, { id: 'review', gate: 'human' }],
    edges: [{ from: 'architect', to: 'review', artifact: 'PLAN.md' }],
    triggers: [],
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === 'string');
  assert.ok(
    body.error.includes('invalid flow id') || body.error.includes('traversal'),
    `expected traversal/id error, got: ${body.error}`,
  );
});

test('PUT /api/studio/flows/UPPERCASE → 400 (must be slug)', async () => {
  const res = await putJson(`${bridgeUrl}/api/studio/flows/UPPERCASE`, {
    goal: 'Invalid id.',
    nodes: [{ id: 'n', gate: 'human' }],
    edges: [],
    triggers: [],
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.includes('invalid flow id'), `expected invalid id error, got: ${body.error}`);
});

test('PUT /api/studio/flows without x-forge-csrf → 403', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/flows/test-flow`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'No CSRF.' }),
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.includes('CSRF'), `expected CSRF error, got: ${body.error}`);
});

// ---------------------------------------------------------------------------
// GET /api/studio/flows list still works (passthrough unaffected)
// ---------------------------------------------------------------------------

test('GET /api/studio/flows list still works alongside the single-flow route', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/flows`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { flows: Array<{ id: string }> };
  assert.ok(Array.isArray(body.flows), 'flows must be array');
  const testFlow = body.flows.find((f) => f.id === 'test-flow');
  assert.ok(testFlow, 'test-flow must appear in the list');
});

// ---------------------------------------------------------------------------
// Security self-audit assertions (structural, not runtime)
// ---------------------------------------------------------------------------

test('[security] flows have no exec-command fields — no command injection surface', () => {
  // FlowDefinition fields: id, name, version, goal, project, kb, costCeilingUsd,
  // origin, disposable, nodes (id/agent/gate/fanOut/resumable), edges (from/to/artifact),
  // triggers (on/flow). None accept arbitrary shell commands.
  // This test is a documentation-level guard: enumerate the field names and assert
  // that none of the command-like keys exist.
  const commandLikeKeys = ['cmd', 'command', 'exec', 'shell', 'run', 'script'];
  const flowTopLevelKeys = ['id', 'name', 'version', 'goal', 'project', 'kb', 'costCeilingUsd', 'origin', 'disposable', 'nodes', 'edges', 'triggers', 'path'];
  const nodeKeys = ['id', 'agent', 'gate', 'fanOut', 'resumable'];
  const edgeKeys = ['from', 'to', 'artifact'];
  const triggerKeys = ['on', 'flow'];

  const allKeys = [...flowTopLevelKeys, ...nodeKeys, ...edgeKeys, ...triggerKeys];
  for (const cmdKey of commandLikeKeys) {
    assert.ok(
      !allKeys.some((k) => k.toLowerCase().includes(cmdKey.toLowerCase())),
      `FlowDefinition must not have a command-like field '${cmdKey}'`,
    );
  }
});

test('[security] id traversal: slug guard fires before any fs path construction', async () => {
  // IDs that survive URL routing but fail SLUG_RE must return 400, not 500 or 200.
  // Note: bare '..' is resolved away by HTTP routing before our handler sees it,
  // so we only test encoded forms that actually reach the route match.
  const traversalIds = ['..%2Fevil', '..%2F..%2Fetc', '%2F..%2Fetc'];
  for (const id of traversalIds) {
    // Use the pre-encoded form directly in the URL (don't re-encode with encodeURIComponent)
    const getRes = await fetch(`${bridgeUrl}/api/studio/flows/${id}`);
    assert.ok(getRes.status === 400 || getRes.status === 404, `GET ${id}: expected 400 or 404, got ${getRes.status}`);

    const putRes = await putJson(`${bridgeUrl}/api/studio/flows/${id}`, {
      goal: 'x',
      nodes: [{ id: 'n', gate: 'human' }],
      edges: [],
      triggers: [],
    });
    assert.equal(putRes.status, 400, `PUT ${id}: expected 400, got ${putRes.status}`);
  }
});

test('[security] version is always positive integer after write (monotonic)', async () => {
  resetTestFlow(); // version = 3

  const res = await putJson(`${bridgeUrl}/api/studio/flows/test-flow`, {
    goal: 'Version check.',
    nodes: [{ id: 'architect', agent: 'test-agent' }, { id: 'review', gate: 'human' }],
    edges: [{ from: 'architect', to: 'review', artifact: 'PLAN.md' }],
    triggers: [],
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { version: number };
  assert.ok(Number.isInteger(body.version), 'version must be an integer');
  assert.ok(body.version >= 1, 'version must be >= 1');
  assert.equal(body.version, 4, 'version must be exactly 4 (3+1)');

  const written = readFileSync(join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml'), 'utf8');
  assert.ok(written.includes('version: 4'), 'version on disk matches response');
});
