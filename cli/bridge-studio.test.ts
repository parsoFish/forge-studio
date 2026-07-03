/**
 * Tests for the Studio bridge routes (M1-2).
 *
 * Spins up a real bridge against a tmp forge-root fixture with:
 *   - a synthetic _queue/done/<init>.md manifest
 *   - a matching _logs/<cycleId>/events.jsonl (minimal synthetic events)
 *   - studio/ directory (flows, catalog) + projects/ dirs auto-discovered from disk
 *   - brain/ directory with kb.yaml files
 *   - skills/ directory with one stub studio SKILL.md
 *
 * All assertions check payload shape and HTTP status codes.
 * Non-studio URLs return false (bridge returns 404/falls through).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { handleStudioRoutes } from './bridge-studio.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const CYCLE_ID = '2026-05-30T22-45-07_INIT-TEST-001';
const INIT_ID = 'INIT-TEST-001';

/** Minimal manifest in YAML frontmatter format */
function makeManifest(options: { initId: string } = { initId: INIT_ID }): string {
  return [
    '---',
    `initiative_id: ${options.initId}`,
    'project: test-project',
    'project_repo_path: /tmp/test-project',
    'worktree_path: /tmp/worktrees/test',
    'origin: architect',
    'created_at: 2026-05-30T22:45:00.000Z',
    'iteration_budget: 5',
    'cost_budget_usd: 2.0',
    '---',
    '',
    '# Test initiative title',
    '',
    'Some body text.',
  ].join('\n');
}

/** Minimal EventLogEntry JSONL lines for a simple complete run */
function makeEventsJsonl(cycleId: string, initId: string): string {
  const baseEvent = {
    cycle_id: cycleId,
    initiative_id: initId,
    input_refs: [],
    output_refs: [],
  };

  const events = [
    {
      ...baseEvent,
      event_id: 'EV_001',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'start',
      started_at: '2026-05-30T22:45:07.000Z',
      message: 'cycle.start',
      metadata: { origin: 'architect' },
    },
    {
      ...baseEvent,
      event_id: 'EV_002',
      phase: 'architect',
      skill: 'architect',
      event_type: 'start',
      started_at: '2026-05-30T22:45:10.000Z',
    },
    {
      ...baseEvent,
      event_id: 'EV_003',
      phase: 'architect',
      skill: 'architect',
      event_type: 'tool_use',
      started_at: '2026-05-30T22:45:11.000Z',
      metadata: { tool_name: 'Read' },
      cost_usd: 0.001,
    },
    {
      ...baseEvent,
      event_id: 'EV_004',
      phase: 'architect',
      skill: 'architect',
      event_type: 'error',
      started_at: '2026-05-30T22:45:12.000Z',
      message: 'Transient error',
    },
    {
      ...baseEvent,
      event_id: 'EV_005',
      phase: 'architect',
      skill: 'architect',
      event_type: 'end',
      started_at: '2026-05-30T22:45:15.000Z',
    },
    {
      ...baseEvent,
      event_id: 'EV_006',
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'start',
      started_at: '2026-05-30T22:46:00.000Z',
    },
    {
      ...baseEvent,
      event_id: 'EV_007',
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'end',
      started_at: '2026-05-30T22:46:30.000Z',
    },
    {
      ...baseEvent,
      event_id: 'EV_008',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'end',
      started_at: '2026-05-30T23:00:00.000Z',
      message: 'cycle.end',
      metadata: { status: 'complete' },
    },
  ];

  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

/** Minimal studio SKILL.md with required frontmatter for listAgentDefinitions */
function makeSkillMd(): string {
  return [
    '---',
    'name: Test Agent',
    'description: A test agent for unit tests.',
    'phase: architect',
    'purpose: Testing purposes only.',
    'brainAccess: advisory',
    'interactivity: none',
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    '  hooks: []',
    'runtime:',
    '  sdk: claude-code',
    '  strategy: fixed',
    '  model: claude-sonnet-4-5',
    'allowed-tools: []',
    'disallowed-tools: []',
    'budgets: {}',
    '---',
    '',
    '# Test Agent',
    '',
    'Agent body text.',
  ].join('\n');
}

/** Minimal flow.yaml */
function makeFlowYaml(flowId = 'forge-cycle'): string {
  return [
    `id: ${flowId}`,
    `name: ${flowId}`,
    'version: 1',
    'goal: Test flow.',
    'project: null',
    'kb: null',
    'costCeilingUsd: 5',
    'origin: architect',
    'nodes:',
    '  - id: architect',
    '    agent: test-agent',
    '  - id: pm',
    '    agent: test-agent',
    '  - id: review',
    '    gate: human',
    'edges:',
    '  - from: architect',
    '    to: pm',
    '    artifact: PLAN.md',
    '  - from: pm',
    '    to: review',
    '    artifact: work-items',
    'triggers: []',
  ].join('\n');
}

/** Minimal catalog.yaml */
function makeCatalogYaml(): string {
  return [
    'sdks:',
    '  - id: claude-code',
    '    name: Claude Code',
    '    available: true',
    'models:',
    '  - id: claude-sonnet-4-5',
    '    name: Claude Sonnet 4.5',
    '    sdk: claude-code',
    '    tier: standard',
    'tools: []',
    'mcps: []',
    'hooks: []',
  ].join('\n');
}

/** project.json with all mergeable fields */
function makeProjectJson(): string {
  return JSON.stringify({
    northStar: 'Ship a great product.',
    kb: 'forge-dev',
    instructions: 'Always write tests first.',
    skills: ['tdd-workflow', 'coding-standards'],
  });
}

/** Minimal kb.yaml */
function makeKbYaml(id: string, name: string): string {
  return [
    `id: ${id}`,
    `name: ${name}`,
    'scope: agent-integration',
    `desc: Test KB ${name}.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Global fixtures
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  // Create tmp forge-root
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-'));

  // -- _queue/done/<init>.md --
  mkdirSync(join(forgeRoot, '_queue', 'done'), { recursive: true });
  writeFileSync(join(forgeRoot, '_queue', 'done', `${INIT_ID}.md`), makeManifest());

  // -- _logs/<cycleId>/events.jsonl --
  mkdirSync(join(forgeRoot, '_logs', CYCLE_ID), { recursive: true });
  writeFileSync(
    join(forgeRoot, '_logs', CYCLE_ID, 'events.jsonl'),
    makeEventsJsonl(CYCLE_ID, INIT_ID),
  );

  // -- skills/test-agent/SKILL.md --
  mkdirSync(join(forgeRoot, 'skills', 'test-agent'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'test-agent', 'SKILL.md'), makeSkillMd());

  // -- studio/flows/forge-cycle/flow.yaml --
  mkdirSync(join(forgeRoot, 'studio', 'flows', 'forge-cycle'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'flows', 'forge-cycle', 'flow.yaml'), makeFlowYaml());

  // -- studio/catalog.yaml --
  writeFileSync(join(forgeRoot, 'studio', 'catalog.yaml'), makeCatalogYaml());

  // Projects are auto-discovered from disk (B1) — no registry file to write.
  // -- projects/test-project/.forge/project.json (with instructions + skills) --
  mkdirSync(join(forgeRoot, 'projects', 'test-project', '.forge'), { recursive: true });
  writeFileSync(join(forgeRoot, 'projects', 'test-project', '.forge', 'project.json'), makeProjectJson());

  // -- projects/bare-project/ exists but has no .forge/project.json --
  mkdirSync(join(forgeRoot, 'projects', 'bare-project'), { recursive: true });

  // -- projects/agents-project/ has project.json AND an AGENTS.md — the AGENTS.md
  //    is the single source of instructions (Stage A), overriding project.json. --
  mkdirSync(join(forgeRoot, 'projects', 'agents-project', '.forge'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'projects', 'agents-project', '.forge', 'project.json'),
    JSON.stringify({
      quality_gate_cmd: ['npm', 'test'],
      instructions: 'stale json instructions',
      demoProcess: [
        { kind: 'verify', text: 'tests green', element: 'test-evidence' },
        { kind: 'present', text: 'just a note' },
      ],
    }),
  );
  writeFileSync(
    join(forgeRoot, 'projects', 'agents-project', 'AGENTS.md'),
    '# Real AGENTS\n\nBuild: npm run build',
  );

  // -- brain/forge-dev/kb.yaml + themes/ --
  mkdirSync(join(forgeRoot, 'brain', 'forge-dev', 'themes'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'forge-dev', 'kb.yaml'), makeKbYaml('forge-dev', 'Forge Engineering'));
  writeFileSync(join(forgeRoot, 'brain', 'forge-dev', 'themes', 'theme-1.md'), '# Theme 1\n');
  writeFileSync(join(forgeRoot, 'brain', 'forge-dev', 'themes', 'theme-2.md'), '# Theme 2\n');

  // -- brain/cycles/kb.yaml --
  mkdirSync(join(forgeRoot, 'brain', 'cycles', 'themes'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'cycles', 'kb.yaml'), makeKbYaml('cycles', 'Cycle Patterns'));

  // Start bridge
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
// /api/runs
// ---------------------------------------------------------------------------

test('GET /api/runs returns runs array with the seeded complete run', async () => {
  const res = await fetch(`${bridgeUrl}/api/runs`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { runs: Array<{ id: string; status: string }> };
  assert.ok(Array.isArray(body.runs), 'runs must be an array');
  const run = body.runs.find((r) => r.id === CYCLE_ID);
  assert.ok(run, 'seeded run must appear in the list');
  assert.equal(run!.status, 'complete');
});

test('GET /api/runs?flow=forge-cycle returns runs on the flow or with it in their lineage', async () => {
  const res = await fetch(`${bridgeUrl}/api/runs?flow=forge-cycle`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { runs: Array<{ flowId: string; flowLineage?: string[] }> };
  assert.ok(Array.isArray(body.runs));
  assert.ok(body.runs.length > 0, 'seeded run must match the flow filter');
  for (const r of body.runs) {
    assert.ok(
      r.flowId === 'forge-cycle' || (r.flowLineage ?? []).includes('forge-cycle'),
      `run must be on forge-cycle or carry it in lineage, got flowId=${r.flowId} lineage=${JSON.stringify(r.flowLineage)}`,
    );
  }
});

test('GET /api/runs?flow=nonexistent-flow returns empty array', async () => {
  const res = await fetch(`${bridgeUrl}/api/runs?flow=nonexistent-flow`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { runs: unknown[] };
  assert.deepEqual(body.runs, []);
});

test('GET /api/runs/planned lists pending develop-able initiatives (Stage C kickoff)', async () => {
  const id = 'INIT-2026-06-26-planned';
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });
  writeFileSync(join(forgeRoot, '_queue', 'pending', `${id}.md`), makeManifest({ initId: id }));
  try {
    const res = await fetch(`${bridgeUrl}/api/runs/planned`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      planned: Array<{ initiativeId: string; project: string | null; ready: boolean; blockedBy: string[] }>;
    };
    const row = body.planned.find((p) => p.initiativeId === id);
    assert.ok(row, 'planned initiative must appear');
    assert.equal(row!.project, 'test-project');
    assert.equal(row!.ready, true);
    assert.deepEqual(row!.blockedBy, []);
  } finally {
    rmSync(join(forgeRoot, '_queue', 'pending', `${id}.md`), { force: true });
  }
});

// ---------------------------------------------------------------------------
// /api/runs/<id>
// ---------------------------------------------------------------------------

test('GET /api/runs/<id> returns the seeded run', async () => {
  const res = await fetch(`${bridgeUrl}/api/runs/${encodeURIComponent(CYCLE_ID)}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { run: { id: string; status: string; initiative: string; costUsd: number } };
  assert.equal(body.run.id, CYCLE_ID);
  assert.equal(body.run.status, 'complete');
  assert.equal(body.run.initiative, 'Test initiative title');
  assert.ok(typeof body.run.costUsd === 'number');
});

test('GET /api/runs/<bad-id> returns 404 with error', async () => {
  const res = await fetch(`${bridgeUrl}/api/runs/nonexistent-run-id-xyz`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === 'string');
});

// ---------------------------------------------------------------------------
// /api/runs/<id>/phases/<node>/log
// ---------------------------------------------------------------------------

test('GET /api/runs/<id>/phases/architect/log returns lines array', async () => {
  const res = await fetch(
    `${bridgeUrl}/api/runs/${encodeURIComponent(CYCLE_ID)}/phases/architect/log`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { lines: Array<{ at: string; kind: string; text: string }> };
  assert.ok(Array.isArray(body.lines), 'lines must be an array');
  // Should have at least start + tool_use + error + end events for architect
  assert.ok(body.lines.length >= 1, 'should have at least one line');
  // Every line must have at/kind/text
  for (const line of body.lines) {
    assert.ok(typeof line.at === 'string', 'at must be string');
    assert.ok(['info', 'tool', 'cost', 'stderr', 'retry'].includes(line.kind), `unexpected kind: ${line.kind}`);
    assert.ok(typeof line.text === 'string', 'text must be string');
  }
});

test('GET /api/runs/<id>/phases/architect/log classifies tool_use as "tool" kind', async () => {
  const res = await fetch(
    `${bridgeUrl}/api/runs/${encodeURIComponent(CYCLE_ID)}/phases/architect/log`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { lines: Array<{ kind: string; text: string }> };
  const toolLine = body.lines.find((l) => l.kind === 'tool');
  assert.ok(toolLine, 'should have at least one tool line');
  assert.match(toolLine!.text, /Read/, 'tool text should include tool name');
});

test('GET /api/runs/<id>/phases/architect/log?stderr=1 filters to stderr lines only', async () => {
  const res = await fetch(
    `${bridgeUrl}/api/runs/${encodeURIComponent(CYCLE_ID)}/phases/architect/log?stderr=1`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { lines: Array<{ kind: string }> };
  assert.ok(Array.isArray(body.lines));
  // After filtering, every remaining line must be stderr
  for (const line of body.lines) {
    assert.equal(line.kind, 'stderr', `expected stderr, got ${line.kind}`);
  }
  // Fixture has 1 error event for architect — should have exactly 1 stderr line
  assert.equal(body.lines.length, 1, 'should have exactly 1 stderr line from the error event');
});

test('GET /api/runs/<bad-id>/phases/architect/log returns 404', async () => {
  const res = await fetch(`${bridgeUrl}/api/runs/nonexistent-id/phases/architect/log`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === 'string');
});

// ---------------------------------------------------------------------------
// /api/studio/agents
// ---------------------------------------------------------------------------

test('GET /api/studio/agents returns agents array', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/agents`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { agents: Array<{ slug: string; name: string }> };
  assert.ok(Array.isArray(body.agents), 'agents must be array');
  assert.ok(body.agents.length >= 1, 'at least 1 agent from fixture');
  const agent = body.agents.find((a) => a.slug === 'test-agent');
  assert.ok(agent, 'test-agent must appear');
  assert.equal(agent!.name, 'Test Agent');
});

// ---------------------------------------------------------------------------
// /api/studio/flows
// ---------------------------------------------------------------------------

test('GET /api/studio/flows returns flows array', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/flows`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { flows: Array<{ id: string; nodes: unknown[] }> };
  assert.ok(Array.isArray(body.flows), 'flows must be array');
  assert.ok(body.flows.length >= 1, 'at least 1 flow');
  const flow = body.flows.find((f) => f.id === 'forge-cycle');
  assert.ok(flow, 'forge-cycle flow must appear');
  assert.ok(Array.isArray(flow!.nodes), 'nodes must be array');
});

// ---------------------------------------------------------------------------
// /api/studio/projects
// ---------------------------------------------------------------------------

test('GET /api/studio/projects returns projects array', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/projects`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    projects: Array<{ id: string; path: string; instructions?: string; skills?: string[] }>;
  };
  assert.ok(Array.isArray(body.projects), 'projects must be array');
  const proj = body.projects.find((p) => p.id === 'test-project');
  assert.ok(proj, 'test-project must appear');
  assert.ok(typeof proj!.path === 'string');
  // instructions + skills should surface from project.json
  assert.equal(proj!.instructions, 'Always write tests first.');
  assert.deepEqual(proj!.skills, ['tdd-workflow', 'coding-standards']);
});

test('GET /api/studio/projects tolerates project without project.json', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/projects`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    projects: Array<{ id: string; instructions?: unknown; skills?: unknown }>;
  };
  const bare = body.projects.find((p) => p.id === 'bare-project');
  assert.ok(bare, 'bare-project must appear in list');
  assert.equal(bare!.instructions, undefined, 'instructions must be absent when no project.json');
  assert.equal(bare!.skills, undefined, 'skills must be absent when no project.json');
});

test('GET /api/studio/projects sources instructions from AGENTS.md (single source) over project.json', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/projects`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    projects: Array<{ id: string; instructions?: string; instructionsSource?: string }>;
  };
  const proj = body.projects.find((p) => p.id === 'agents-project');
  assert.ok(proj, 'agents-project must appear in list');
  assert.match(proj!.instructions ?? '', /Real AGENTS/, 'instructions come from AGENTS.md, not project.json');
  assert.doesNotMatch(proj!.instructions ?? '', /stale json/, 'the stale project.json instructions must be overridden');
  assert.equal(proj!.instructionsSource, 'AGENTS.md');
});

test('GET /api/studio/projects marks project.json instructions as the legacy source when no AGENTS.md', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/projects`);
  const body = (await res.json()) as { projects: Array<{ id: string; instructionsSource?: string }> };
  const proj = body.projects.find((p) => p.id === 'test-project');
  assert.equal(proj!.instructionsSource, 'project.json');
});

test('GET /api/studio/projects carries the demoProcess `element` binding (per-element composition)', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/projects`);
  const body = (await res.json()) as {
    projects: Array<{ id: string; demoProcess?: Array<{ kind: string; text: string; element?: string }> }>;
  };
  const proj = body.projects.find((p) => p.id === 'agents-project');
  assert.ok(proj?.demoProcess, 'demoProcess surfaced');
  assert.equal(proj!.demoProcess![0].element, 'test-evidence', 'element binding is carried through (not stripped)');
  assert.equal(proj!.demoProcess![1].element, undefined, 'a free-text step has no element');
});

// ---------------------------------------------------------------------------
// /api/studio/kbs
// ---------------------------------------------------------------------------

test('GET /api/studio/kbs returns kbs array with counts', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/kbs`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    kbs: Array<{ id: string; name: string; counts: { index: number; themes: number; raw: number } }>;
  };
  assert.ok(Array.isArray(body.kbs), 'kbs must be array');
  assert.ok(body.kbs.length >= 1, 'at least 1 kb');
  const forgeDev = body.kbs.find((k) => k.id === 'forge-dev');
  assert.ok(forgeDev, 'forge-dev kb must appear');
  assert.ok(typeof forgeDev!.counts === 'object', 'counts object must be present');
  assert.ok(typeof forgeDev!.counts.themes === 'number', 'themes count must be a number');
  // We seeded 2 theme files
  assert.equal(forgeDev!.counts.themes, 2, 'should count 2 seeded theme files');
});

// ---------------------------------------------------------------------------
// /api/studio/catalog
// ---------------------------------------------------------------------------

test('GET /api/studio/catalog returns catalog object with sdks + models', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/catalog`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    catalog: { sdks: Array<{ id: string }>; models: Array<{ id: string }> };
  };
  assert.ok(body.catalog, 'catalog key must be present');
  assert.ok(Array.isArray(body.catalog.sdks), 'sdks must be array');
  assert.ok(Array.isArray(body.catalog.models), 'models must be array');
  const sdk = body.catalog.sdks.find((s) => s.id === 'claude-code');
  assert.ok(sdk, 'claude-code sdk must appear');
});

// ---------------------------------------------------------------------------
// /api/studio/catalog — registry-driven availability (M6-4)
// ---------------------------------------------------------------------------

test('GET /api/studio/catalog reconciles sdk availability with the adapter registry', async () => {
  // Spin up a second bridge against a fresh tmp root with the real SDK ids
  // (claude / codex / gemini — matching studio/catalog.yaml in production).
  const registryRoot = mkdtempSync(join(tmpdir(), 'bridge-catalog-registry-'));
  try {
    mkdirSync(join(registryRoot, 'studio'), { recursive: true });
    writeFileSync(join(registryRoot, 'studio', 'catalog.yaml'), [
      'sdks:',
      // claude: yaml says available:true — registry should keep it true (registered + available)
      '  - { id: claude, name: Claude Agent SDK, available: true }',
      // codex: yaml says available:false — registry must keep it false (not registered)
      '  - { id: codex, name: OpenAI Codex, available: false }',
      // gemini: yaml says available:false — registry must keep it false (not registered)
      '  - { id: gemini, name: Gemini, available: false }',
      'models: []',
      'tools: []',
      'mcps: []',
      'hooks: []',
    ].join('\n'));

    const bridgeResult = await startBridge({ forgeRoot: registryRoot, port: 0 });
    try {
      const res = await fetch(`${bridgeResult.url}/api/studio/catalog`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        catalog: { sdks: Array<{ id: string; available: boolean }> };
      };
      const sdks = body.catalog.sdks;

      const claudeSdk = sdks.find((s) => s.id === 'claude');
      assert.ok(claudeSdk, 'claude sdk must appear');
      assert.equal(claudeSdk!.available, true, 'claude must be available (registered + available in registry)');

      const codexSdk = sdks.find((s) => s.id === 'codex');
      assert.ok(codexSdk, 'codex sdk must appear');
      assert.equal(codexSdk!.available, false, 'codex must be unavailable (not registered)');

      const geminiSdk = sdks.find((s) => s.id === 'gemini');
      assert.ok(geminiSdk, 'gemini sdk must appear');
      assert.equal(geminiSdk!.available, false, 'gemini must be unavailable (not registered)');
    } finally {
      await bridgeResult.close();
    }
  } finally {
    rmSync(registryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Non-studio URL → returns false (handler passes through)
// ---------------------------------------------------------------------------

test('non-studio URL (e.g. /api/health) returns false from handleStudioRoutes', async () => {
  // Test the handler function directly (not via the bridge) to verify the
  // boolean return contract.
  let statusWritten: number | null = null;

  // Minimal mock response object
  const mockRes = {
    writeHead: (status: number) => { statusWritten = status; },
    end: (_body: string) => { /* no-op */ },
  } as unknown as import('node:http').ServerResponse;

  const mockReq = {} as import('node:http').IncomingMessage;
  const ctx = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };

  const handled = await handleStudioRoutes(mockReq, mockRes, ctx, '/api/health', 'GET');
  assert.equal(handled, false, 'non-studio URL must return false');
  assert.equal(statusWritten, null, 'should not write any response');
});

test('non-GET method returns false from handleStudioRoutes', async () => {
  const mockRes = {} as import('node:http').ServerResponse;
  const mockReq = {} as import('node:http').IncomingMessage;
  const ctx = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };

  const handled = await handleStudioRoutes(mockReq, mockRes, ctx, '/api/runs', 'POST');
  assert.equal(handled, false, 'POST method must return false for studio routes');
});

test('/api/studio/nonexistent-endpoint returns false from handleStudioRoutes', async () => {
  const mockRes = {} as import('node:http').ServerResponse;
  const mockReq = {} as import('node:http').IncomingMessage;
  const ctx = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };

  const handled = await handleStudioRoutes(mockReq, mockRes, ctx, '/api/studio/nonexistent', 'GET');
  assert.equal(handled, false, 'unknown studio sub-route must return false');
});

// ---------------------------------------------------------------------------
// Fix 1: Path traversal guard
// ---------------------------------------------------------------------------

test('path traversal in run id returns 400 and does not read outside logsRoot', async () => {
  // ..%2F..%2Fetc%2Fpasswd decoded becomes ../../etc/passwd — would escape logsRoot
  const encodedTraversal = '..%2F..%2Fetc%2Fpasswd';
  const res = await fetch(
    `${bridgeUrl}/api/runs/${encodedTraversal}/phases/architect/log`,
  );
  assert.equal(res.status, 400, 'path traversal attempt must return 400');
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'invalid run id', 'error message must be "invalid run id"');
});

// ---------------------------------------------------------------------------
// Fix 2: classifyEvent ordering — failure_classification with recoverable=true
// ---------------------------------------------------------------------------

test('classifyEvent: failure_classification + recoverable=true → retry (not stderr)', async () => {
  // Seed an events.jsonl that has a failure_classification event with event_type=error + recoverable=true
  const retryInitId = 'INIT-RETRY-001';
  const retryCycleId = `2026-05-30T22-45-07_${retryInitId}`;

  mkdirSync(join(forgeRoot, '_queue', 'done'), { recursive: true });
  writeFileSync(
    join(forgeRoot, '_queue', 'done', `${retryInitId}.md`),
    makeManifest({ initId: retryInitId }),
  );
  mkdirSync(join(forgeRoot, '_logs', retryCycleId), { recursive: true });
  const retryEvent = JSON.stringify({
    cycle_id: retryCycleId,
    initiative_id: retryInitId,
    event_id: 'EV_RET_001',
    phase: 'architect',
    skill: 'architect',
    event_type: 'error',
    started_at: '2026-05-30T22:45:20.000Z',
    message: 'failure_classification',
    metadata: { recoverable: true, reason: 'transient' },
    input_refs: [],
    output_refs: [],
  });
  const nonRecoverableEvent = JSON.stringify({
    cycle_id: retryCycleId,
    initiative_id: retryInitId,
    event_id: 'EV_RET_002',
    phase: 'architect',
    skill: 'architect',
    event_type: 'error',
    started_at: '2026-05-30T22:45:21.000Z',
    message: 'failure_classification',
    metadata: { recoverable: false },
    input_refs: [],
    output_refs: [],
  });
  writeFileSync(
    join(forgeRoot, '_logs', retryCycleId, 'events.jsonl'),
    retryEvent + '\n' + nonRecoverableEvent + '\n',
  );

  const res = await fetch(
    `${bridgeUrl}/api/runs/${encodeURIComponent(retryCycleId)}/phases/architect/log`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { lines: Array<{ kind: string; text: string }> };
  assert.ok(Array.isArray(body.lines));
  assert.equal(body.lines.length, 2, 'should have 2 lines (one for each event)');

  const retryLine = body.lines.find((l) => l.text.includes('failure_classification') && l.text.includes('transient'));
  assert.ok(retryLine, 'recoverable failure_classification must produce a line');
  assert.equal(retryLine!.kind, 'retry', 'recoverable=true must classify as "retry", not "stderr"');

  const stderrLine = body.lines.find((l) => !l.text.includes('transient'));
  assert.ok(stderrLine, 'non-recoverable failure_classification must produce a line');
  assert.equal(stderrLine!.kind, 'stderr', 'recoverable=false must classify as "stderr"');
});
