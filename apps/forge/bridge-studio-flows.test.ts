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
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  linkSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { loadFlowDefinition } from '@forge/flows/studio/flow-registry.ts';

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

/**
 * Minimal valid SKILL.md whose `composition.guards` declares a single band —
 * just enough for `loadAgentDefinition` + `resolveBandGuard`
 * (orchestrator/agent-bands.ts) to resolve a real band id off a real,
 * loadable agent def. Same shape as bridge-studio-kb-create.test.ts's
 * `bandSkillMd` fixture helper (R1-01's `listFlowBandIds` ground truth),
 * duplicated here per this repo's convention of self-contained test fixtures
 * (no shared cli/test fixture module exists).
 */
function bandSkillMd(slug: string, band: string): string {
  return [
    '---',
    `name: ${slug}`,
    `description: A test ${band} agent.`,
    'library: true',
    `purpose: Does ${band} things.`,
    'brainAccess: none',
    'interactivity: none',
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    `  guards: [${band}]`,
    'runtime:',
    '  sdk: claude-agent-sdk',
    '  strategy: fixed',
    '  model: claude-sonnet-4-6',
    'budgets: {}',
    'allowed-tools: []',
    'disallowed-tools: []',
    '---',
    '',
    `This agent does ${band} things.`,
  ].join('\n');
}

/**
 * A `forge-develop`-shaped flow.yaml whose two agent-bearing nodes declare
 * `demo-band` + `review-band` — mirrors the REAL shipped `studio/flows/
 * forge-develop/flow.yaml`'s derived band vocabulary (confirmed live via
 * `listFlowBandIds(repoRoot, 'forge-develop')` -> `['demo-band',
 * 'review-band']`, packages/flows/flow-band-vocab.ts), so the `bands` field this test
 * pins on `GET /api/studio/flows` is checked against a REAL, non-fabricated
 * band vocabulary shape, not an arbitrary made-up one.
 */
function makeForgeDevelopFlowYaml(): string {
  return [
    'id: forge-develop',
    'name: Forge Develop',
    'version: 1',
    'goal: Test develop flow.',
    'project: null',
    'kb: null',
    'costCeilingUsd: 10',
    'origin: seed',
    'disposable: true',
    'nodes:',
    '  - id: demo',
    '    agent: demo-agent',
    '  - id: adversarial-review',
    '    agent: adversarial-review',
    'edges: []',
    'triggers: []',
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

  // ---- studio/flows/forge-develop/flow.yaml + its band-guard skills -------
  // (R1-06 WI-2 group A) — a REAL, non-empty derivable band vocabulary
  // {demo-band, review-band} for the GET /api/studio/flows `bands:` field pin.
  mkdirSync(join(forgeRoot, 'studio', 'flows', 'forge-develop'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'flows', 'forge-develop', 'flow.yaml'),
    makeForgeDevelopFlowYaml(),
  );
  for (const [slug, band] of [['demo-agent', 'demo-band'], ['adversarial-review', 'review-band']] as const) {
    const skillDir = join(forgeRoot, 'skills', slug);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), bandSkillMd(slug, band));
  }

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

// ---------------------------------------------------------------------------
// PUT /api/studio/flows/:id — symlink/hardlink containment escapes
// (2026-08-05 adversarial-review round 4, finding A). The guard at
// apps/forge/bridge-studio-writes.ts (~L911-913) is a LEXICAL
// `resolve(flowsBase, id, 'flow.yaml').startsWith(flowsBase + sep)` check on
// an UNRESOLVED path — worse than the agents PUT route's pre-round-2 bug,
// because this route has NO dirent-type gate anywhere in its path (no
// `readdir`/`isDirectory()` filter of any kind), so nothing accidentally
// saves it the way discoverProjects()'s directory filter does for projects.
// All four shapes below were reproduced live through the real route.
// ---------------------------------------------------------------------------

test('BLOCKER: PUT rejects a symlinked studio/flows/<id> DIRECTORY escaping the forge root — nothing is created outside', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-flows-outside-'));
  const outsideEntriesBefore = readdirSync(outsideDir).sort();

  const linkPath = join(forgeRoot, 'studio', 'flows', 'escape-flow');
  try {
    symlinkSync(outsideDir, linkPath, 'dir');
  } catch {
    rmSync(outsideDir, { recursive: true, force: true });
    return;
  }

  try {
    const res = await putJson(`${bridgeUrl}/api/studio/flows/escape-flow`, {
      goal: 'Attacker-controlled flow.yaml write outside the repo.',
      nodes: [{ id: 'n', gate: 'human' }],
      edges: [],
      triggers: [],
    });
    assert.notEqual(
      res.status,
      200,
      'a PUT through a symlinked studio/flows/<id> directory escaping the forge root must be REJECTED (verified live: today it returns 200 and creates flow.yaml outside the repo)',
    );
    const outsideEntriesAfter = readdirSync(outsideDir).sort();
    assert.deepEqual(
      outsideEntriesAfter,
      outsideEntriesBefore,
      'nothing may be created inside the out-of-tree directory the symlink points at',
    );
  } finally {
    // Remove the SYMLINK itself, not just its target — leaving a dangling
    // symlink under studio/flows/ pollutes every later test in this file
    // that lists/scans the flows directory.
    rmSync(linkPath, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('PUT rejects a symlinked studio/flows/<id> DIRECTORY whose target already has a flow.yaml — that file stays byte-unchanged', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-flows-outside-existing-'));
  const outsideFile = join(outsideDir, 'flow.yaml');
  const outsideOriginal = makeFlowYaml({ id: 'outside-secret', version: 1 });
  writeFileSync(outsideFile, outsideOriginal, 'utf8');

  const linkPath = join(forgeRoot, 'studio', 'flows', 'escape-flow-existing');
  try {
    symlinkSync(outsideDir, linkPath, 'dir');
  } catch {
    rmSync(outsideDir, { recursive: true, force: true });
    return;
  }

  try {
    // Unlike the skills POST route, this PUT route has no existsSync-then-409
    // dedup step — `existing` is loaded and the merged result is ALWAYS
    // written, so a pre-existing outside flow.yaml gets genuinely overwritten,
    // not accidentally protected by a side-effect check.
    const res = await putJson(`${bridgeUrl}/api/studio/flows/escape-flow-existing`, {
      goal: 'Attacker-controlled overwrite of an existing outside flow.yaml.',
      nodes: [{ id: 'n', gate: 'human' }],
      edges: [],
      triggers: [],
    });
    assert.notEqual(
      res.status,
      200,
      'a PUT overwriting a pre-existing out-of-tree flow.yaml through a symlinked directory must be REJECTED',
    );
    const outsideAfter = readFileSync(outsideFile, 'utf8');
    assert.equal(outsideAfter, outsideOriginal, 'the pre-existing out-of-tree flow.yaml must be byte-unchanged');
  } finally {
    rmSync(linkPath, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('PUT rejects a flow id whose directory is a symlink to a DIFFERENT real flow\'s directory — the other flow\'s file stays byte-unchanged, and the real flow still edits correctly afterwards', async () => {
  resetTestFlow();
  const realFlowPath = join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml');
  const originalContent = readFileSync(realFlowPath, 'utf8');

  const linkPath = join(forgeRoot, 'studio', 'flows', 'alias-of-real');
  try {
    symlinkSync(join(forgeRoot, 'studio', 'flows', 'test-flow'), linkPath, 'dir');
  } catch {
    return;
  }

  try {
    const res = await putJson(`${bridgeUrl}/api/studio/flows/alias-of-real`, {
      goal: 'ATTACKER-CONTROLLED cross-flow overwrite via alias-of-real.',
      nodes: [{ id: 'n', gate: 'human' }],
      edges: [],
      triggers: [],
    });
    assert.notEqual(
      res.status,
      200,
      'a PUT to a flow id whose OWN directory is a symlink to a DIFFERENT real flow directory must be REJECTED — containment-under-studio/flows/ alone is not the same guarantee as "this id\'s own directory" (verified live: today it 200s reporting success for alias-of-real while test-flow\'s real file — read back as id: alias-of-real — is the one actually overwritten)',
    );
    const afterContent = readFileSync(realFlowPath, 'utf8');
    assert.equal(
      afterContent,
      originalContent,
      'test-flow\'s real flow.yaml must be byte-unchanged after a rejected PUT to alias-of-real',
    );

    // Bar D: the requested (real) object must still behave correctly
    // afterwards — a guard that broke test-flow itself while rejecting
    // alias-of-real would also fail this test.
    const stillWorks = await putJson(`${bridgeUrl}/api/studio/flows/test-flow`, {
      goal: 'A legitimate edit to the real flow after the rejected alias attempt.',
      nodes: [{ id: 'architect', agent: 'test-agent' }, { id: 'review', gate: 'human' }],
      edges: [{ from: 'architect', to: 'review', artifact: 'PLAN.md' }],
      triggers: [],
    });
    const stillWorksText = await stillWorks.text();
    assert.equal(stillWorks.status, 200, stillWorksText);
  } finally {
    // Remove the alias symlink AND restore test-flow's real file
    // unconditionally — an assertion failure above must never leave
    // test-flow corrupted (today's live bug literally overwrites it with
    // `id: alias-of-real`) for every later test in this file that depends
    // on test-flow's identity, e.g. the flows-list test below.
    rmSync(linkPath, { force: true });
    writeFileSync(realFlowPath, originalContent, 'utf8');
  }
});

test('BLOCKER: PUT rejects a HARDLINKED flow.yaml pointing outside the forge root — the outside file stays byte-unchanged', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-flows-outside-hardlink-'));
  const outsideFile = join(outsideDir, 'secret-flow.yaml');
  const outsideOriginal = makeFlowYaml({ id: 'hardlink-secret', version: 1 });
  writeFileSync(outsideFile, outsideOriginal, 'utf8');

  const hlinkFlowDir = join(forgeRoot, 'studio', 'flows', 'hlink-flow');
  mkdirSync(hlinkFlowDir, { recursive: true });
  const linkPath = join(hlinkFlowDir, 'flow.yaml');
  try {
    linkSync(outsideFile, linkPath);
  } catch {
    // Cross-filesystem hardlinks (EXDEV) can be unavailable — skip rather
    // than false-failing the suite for an environment limitation.
    rmSync(outsideDir, { recursive: true, force: true });
    return;
  }

  try {
    const res = await putJson(`${bridgeUrl}/api/studio/flows/hlink-flow`, {
      goal: 'ATTACKER-CONTROLLED overwrite via hardlink.',
      nodes: [{ id: 'n', gate: 'human' }],
      edges: [],
      triggers: [],
    });
    assert.notEqual(
      res.status,
      200,
      'a PUT through a hardlinked flow.yaml must be REJECTED — realpath cannot resolve a hardlink away (verified live: today it returns 200 and the outside file is overwritten)',
    );
    const outsideAfter = readFileSync(outsideFile, 'utf8');
    assert.equal(outsideAfter, outsideOriginal, 'the out-of-tree file (same inode as the hardlink) must be byte-unchanged');
  } finally {
    rmSync(hlinkFlowDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
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
// ACCEPTANCE TEST (T3, R1-06 WI-2 group A) — GET /api/studio/flows rows must
// carry a `bands: string[]` field derived from EACH flow's real band
// vocabulary (packages/flows/flow-band-vocab.ts's `listFlowBandIds`, landed R1-06 WI-1),
// so `/knowledge/new`'s per-flow band picker (apps/studio/app/knowledge/new/
// page.tsx) has something real to source its options from over the wire.
//
// RED today: `loadAllFlows` (apps/forge/bridge-studio.ts ~:361) builds each row from
// `loadFlowDefinition` alone and the `GET /api/studio/flows` handler
// (~:679) passes those rows straight through with no per-flow band
// derivation at all — no `bands` key is ever attached, so every row's
// `.bands` is `undefined`, not `[]` for a bandless flow and not
// `['demo-band','review-band']` for the forge-develop fixture below.
// ---------------------------------------------------------------------------

test('(RED) GET /api/studio/flows: forge-develop row carries bands: ["demo-band","review-band"] — its REAL derived band vocabulary', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/flows`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { flows: Array<{ id: string; bands?: string[] }> };
  const develop = body.flows.find((f) => f.id === 'forge-develop');
  assert.ok(develop, 'forge-develop must appear in the flows list');
  assert.deepEqual(
    [...(develop!.bands ?? [])].sort(),
    ['demo-band', 'review-band'],
    `expected forge-develop's bands to be derived from its real demo-band/review-band ` +
      `guard nodes (listFlowBandIds) — got ${JSON.stringify(develop!.bands)}`,
  );
});

test('(RED) GET /api/studio/flows: a flow with NO band-guard nodes carries bands: [] (present, not absent/undefined)', async () => {
  resetTestFlow(); // test-flow's only agent node (test-agent) has no band guard
  const res = await fetch(`${bridgeUrl}/api/studio/flows`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { flows: Array<{ id: string; bands?: string[] }> };
  const plain = body.flows.find((f) => f.id === 'test-flow');
  assert.ok(plain, 'test-flow must appear in the flows list');
  assert.deepEqual(
    plain!.bands,
    [],
    `expected test-flow (no band-guard nodes) to carry an EMPTY bands array, not undefined/absent — got ${JSON.stringify(plain!.bands)}`,
  );
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

// ---------------------------------------------------------------------------
// ACCEPTANCE TESTS (T3, R2-08-F1, round-3 addendum) — the WRITE-path
// asymmetry an adversarial reviewer found: `checkFlowTriggers`'s
// `trigger-projects` check (orchestrator/studio/validate-triggers.ts) is
// gated behind `opts?.projectIds` (`if (trigger.projects !== undefined &&
// opts?.projectIds)`), but the real `PUT /api/studio/flows/:id` handler
// (apps/forge/bridge-studio-writes.ts, ~line 1299) calls `validateFlow(merged,
// agentsMap, { flowIds, flowProjectOf })` — NO `projectIds`. The sibling
// `trigger-agent-complete` check twelve lines above is unconditional, so this
// is a real asymmetry, not a shared limitation.
//
// Consequence: `triggers[].projects` reaches this route with ZERO shape or
// membership validation — a bare string, a non-string array entry, or an
// unknown project id all serialise to flow.yaml verbatim with a 200 and no
// findings. The NEXT `loadFlowDefinition` call on that file throws (this same
// T3 agent's own round-1 parse-level pin: a non-list/non-string-entry
// `projects:` fails loud at load) — and every production consumer
// (finalize-merged.ts's `on: merged` reflect dispatch among them) try/catches
// flow-load failures and drops the WHOLE flow silently. A single bad Studio
// save can silently stop reflection for that flow.
//
// validate.test.ts's existing trigger-projects tests call `validateFlow`
// directly with a hand-built `opts.projectIds` — they would look identical
// whether this real route passed `projectIds` or not. These tests close that
// gap by driving the REAL PUT route.
// ---------------------------------------------------------------------------

/** A minimal valid flow.yaml body for PUT-creating a fresh flow, with one
 *  `on: flow-complete` trigger whose `projects:` this test controls. */
function makeScopedTriggerBody(projects: unknown): Record<string, unknown> {
  return {
    goal: 'Round-3 addendum: PUT-route projects: shape/membership validation.',
    nodes: [{ id: 'architect', agent: 'test-agent' }, { id: 'review', gate: 'human' }],
    edges: [{ from: 'architect', to: 'review', artifact: 'PLAN.md' }],
    triggers: [
      { on: 'flow-complete', target: { kind: 'agent', ref: 'test-agent' }, projects },
    ],
  };
}

test('(RED) [round-3 addendum] PUT with a VALID projects: array saves successfully and round-trips (positive control)', async () => {
  mkdirSync(join(forgeRoot, 'projects', 'gitpulse'), { recursive: true });
  const id = 'scoped-projects-valid';

  const res = await putJson(`${bridgeUrl}/api/studio/flows/${id}`, makeScopedTriggerBody(['gitpulse']));
  // Read the body ONCE, unconditionally, before any assertion — a Response
  // body can only be consumed once, and an assertion's message argument is
  // evaluated eagerly (even when the assertion passes), so a `res.text()`/
  // `res.json()` call inline in a message throws "Body has already been
  // read" the moment anything downstream also reads it.
  const bodyText = await res.text();
  assert.equal(res.status, 200, `expected a valid projects: array to save — got ${res.status}: ${bodyText}`);

  const flow = loadFlowDefinition(join(forgeRoot, 'studio', 'flows', id, 'flow.yaml'));
  assert.deepEqual(
    (flow.triggers[0] as unknown as { projects?: string[] }).projects,
    ['gitpulse'],
    'expected the valid projects: array to round-trip through the saved flow.yaml',
  );
});

test('(RED) [round-3 addendum] PUT with triggers[].projects as a bare STRING (not an array) is refused, and the on-disk flow.yaml is unaffected', async () => {
  mkdirSync(join(forgeRoot, 'projects', 'gitpulse'), { recursive: true });
  const id = 'scoped-projects-bad-string';

  // Establish a valid flow first (also proves the "still loads afterwards"
  // claim below isn't vacuous — there is a real prior version to protect).
  const createRes = await putJson(`${bridgeUrl}/api/studio/flows/${id}`, makeScopedTriggerBody(['gitpulse']));
  assert.equal(createRes.status, 200, 'setup: expected the initial valid flow to save');
  const flowPath = join(forgeRoot, 'studio', 'flows', id, 'flow.yaml');
  const originalYaml = readFileSync(flowPath, 'utf8');

  const res = await putJson(`${bridgeUrl}/api/studio/flows/${id}`, makeScopedTriggerBody('gitpulse'));
  const bodyText = await res.text();

  assert.equal(
    res.status,
    400,
    `expected a bare-string projects: to be REFUSED with a validation finding — got ${res.status}: ${bodyText}`,
  );

  // Assert the ARTIFACT, not just the status code: byte-unchanged, still loads.
  const afterYaml = readFileSync(flowPath, 'utf8');
  assert.equal(afterYaml, originalYaml, 'flow.yaml must be byte-unchanged after a refused save');
  assert.doesNotThrow(() => loadFlowDefinition(flowPath), 'the flow must still load after a refused save');
});

test('(RED) [round-3 addendum] PUT with a non-string entry inside triggers[].projects is refused, and the on-disk flow.yaml is unaffected', async () => {
  mkdirSync(join(forgeRoot, 'projects', 'gitpulse'), { recursive: true });
  const id = 'scoped-projects-bad-entry';

  const createRes = await putJson(`${bridgeUrl}/api/studio/flows/${id}`, makeScopedTriggerBody(['gitpulse']));
  assert.equal(createRes.status, 200, 'setup: expected the initial valid flow to save');
  const flowPath = join(forgeRoot, 'studio', 'flows', id, 'flow.yaml');
  const originalYaml = readFileSync(flowPath, 'utf8');

  const res = await putJson(`${bridgeUrl}/api/studio/flows/${id}`, makeScopedTriggerBody(['gitpulse', 42]));
  const bodyText = await res.text();

  assert.equal(
    res.status,
    400,
    `expected a non-string projects: entry to be REFUSED with a validation finding — got ${res.status}: ${bodyText}`,
  );

  const afterYaml = readFileSync(flowPath, 'utf8');
  assert.equal(afterYaml, originalYaml, 'flow.yaml must be byte-unchanged after a refused save');
  assert.doesNotThrow(() => loadFlowDefinition(flowPath), 'the flow must still load after a refused save');
});

test('(RED) [round-3 addendum] PUT with an UNKNOWN project id in triggers[].projects is refused (trigger-projects), and the on-disk flow.yaml is unaffected', async () => {
  mkdirSync(join(forgeRoot, 'projects', 'gitpulse'), { recursive: true });
  const id = 'scoped-projects-bad-membership';

  const createRes = await putJson(`${bridgeUrl}/api/studio/flows/${id}`, makeScopedTriggerBody(['gitpulse']));
  assert.equal(createRes.status, 200, 'setup: expected the initial valid flow to save');
  const flowPath = join(forgeRoot, 'studio', 'flows', id, 'flow.yaml');
  const originalYaml = readFileSync(flowPath, 'utf8');

  const res = await putJson(`${bridgeUrl}/api/studio/flows/${id}`, makeScopedTriggerBody(['ghost-project']));
  // Read the body ONCE — the earlier bug here (Body has already been read)
  // meant this test could never pass: `res.text()` was called unconditionally
  // inside the assert message, THEN `res.json()` below tried to read the
  // already-consumed body and always threw, regardless of what production did.
  const bodyText = await res.text();

  assert.equal(
    res.status,
    400,
    `expected an unknown project id to be REFUSED (trigger-projects) — got ${res.status}: ${bodyText}. This is the real PUT route never threading discoverProjects()'s projectIds into validateFlow.`,
  );
  const body = JSON.parse(bodyText) as { findings?: Array<{ check: string }> };
  assert.ok(
    body.findings?.some((f) => f.check === 'trigger-projects'),
    `expected a trigger-projects finding — got ${JSON.stringify(body.findings)}`,
  );

  const afterYaml = readFileSync(flowPath, 'utf8');
  assert.equal(afterYaml, originalYaml, 'flow.yaml must be byte-unchanged after a refused save');
  assert.doesNotThrow(() => loadFlowDefinition(flowPath), 'the flow must still load after a refused save');
});
