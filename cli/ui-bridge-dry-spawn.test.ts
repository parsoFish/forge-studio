/**
 * R5-01-F1 — table-driven coverage of the stub-actions SPAWN families under
 * FORGE_DRY_BRIDGE=1 **alone** (FORGE_ARCHITECT_NO_SPAWN deliberately unset).
 *
 * The five spawn-helper families (architect / plan-verdict, instructions,
 * project-brain, demo-builder, preflight fix-agent) are classified
 * `stub-actions`: the route's session bookkeeping proceeds exactly as under
 * NO_SPAWN today, but the skipped agent turn is EXPLICIT — the 200 body gains
 * `dryBridge: { skipped: ['agent-turn'] }` and one `dry-bridge.skip` JSONL
 * event fires per suppressed turn. Never silent.
 *
 * Safety note: with NO_SPAWN unset, a broken guard would exec
 * `node orchestrator/cli.ts …` with cwd = this tmp forgeRoot — where no
 * cli.ts exists — so even a regression here cannot launch a real agent.
 *
 * Task A-finalfix FIX 3: the marker/event alone are NOT red-on-regression —
 * every spawn helper mkdirs its log dir AFTER the `|| isDryBridge()` guard
 * and BEFORE spawning, so a deleted guard would still emit the same
 * marker+event while creating that dir. `assertStubbed` additionally asserts
 * the family's log dir under `_logs/` was never created; each family's
 * `drive()` returns the `logDirName` it expects. (The reflect-answer stub
 * from FIX 1 has no spawn-helper/log-dir shape — it's an inline
 * dryBridgeAgentTurnMarker call, not a detached child process — so its
 * "no side effect under dry mode" equivalent is covered in
 * ui-bridge-reflect.test.ts via the injected rerunReflector call-count spy.)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from './ui-bridge.ts';
import { DRY_BRIDGE_LOG_BUCKET } from './dry-bridge.ts';

const PROJECT = 'demoproj';

let forgeRoot: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;
let priorNoSpawn: string | undefined;
let priorDryBridge: string | undefined;

async function post(path: string, body?: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

type SkipEvent = { message: string; metadata?: { action?: string; route?: string } };

function skipEvents(route: string): SkipEvent[] {
  const p = join(forgeRoot, '_logs', DRY_BRIDGE_LOG_BUCKET, 'events.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as SkipEvent)
    .filter((e) => e.message === 'dry-bridge.skip' && e.metadata?.route === route);
}

function assertStubbed(json: Record<string, unknown>, eventRoute: string, logDirName: string): void {
  assert.deepEqual(
    json.dryBridge,
    { skipped: ['agent-turn'] },
    `expected the agent-turn marker on the 200 body for ${eventRoute}, got: ${JSON.stringify(json)}`,
  );
  const events = skipEvents(eventRoute);
  assert.equal(events.length, 1, `expected exactly 1 dry-bridge.skip event for ${eventRoute}, got ${events.length}`);
  assert.equal(events[0].metadata?.action, 'agent-turn');
  // R5-01 task A-finalfix FIX 3: the marker/event alone don't prove the spawn
  // was actually suppressed — every spawn helper mkdirs its log dir AFTER the
  // guard and BEFORE spawning, so a lost `|| isDryBridge()` guard would still
  // emit this same marker+event while creating the dir below. Assert the dir
  // does NOT exist so deleting the guard reds this test (see the manual
  // bite-demonstration in the task report).
  assert.ok(
    !existsSync(join(forgeRoot, '_logs', logDirName)),
    `dry-bridge must not create the spawn log dir _logs/${logDirName} for ${eventRoute}`,
  );
}

before(async () => {
  priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_DRY_BRIDGE = '1';

  forgeRoot = mkdtempSync(join(tmpdir(), 'dry-spawn-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  // Managed project fixture — needed by the preflight fix-agent case (C5
  // classifies USER-tier on a non-git typescript project; same recipe as
  // bridge-studio-preflight-resolve.test.ts).
  const projectDir = join(forgeRoot, 'projects', PROJECT);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'package.json'), `{"name":"${PROJECT}"}`);
  writeFileSync(join(projectDir, 'tsconfig.json'), '{}');
  writeFileSync(join(projectDir, '.gitignore'), 'node_modules\n');

  ({ url: bridgeUrl, close: closeServer } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (closeServer) await closeServer();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
  if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
  else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
});

// ---------------------------------------------------------------------------
// The family table — one representative acting route per spawn helper.
// ---------------------------------------------------------------------------

const FAMILIES: Array<{
  family: string;
  eventRoute: string;
  drive: () => Promise<{ status: number; json: Record<string, unknown>; logDirName: string }>;
}> = [
  {
    family: 'architect (spawnArchitectTurn)',
    eventRoute: '/api/architect/start',
    drive: async () => {
      const { status, json } = await post('/api/architect/start', { project: PROJECT, idea: 'Dry-bridge probe idea.' });
      return { status, json, logDirName: `_architect-${json.sessionId}` };
    },
  },
  {
    family: 'architect plan-verdict (applyPlanVerdict → spawnArchitectTurn)',
    eventRoute: '/api/plan-verdict',
    drive: async () => {
      const sid = '2026-07-17T10-00-00';
      const dir = join(forgeRoot, 'projects', PROJECT, '_architect', sid);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'status.json'), JSON.stringify({
        session_id: sid, project: PROJECT, project_repo_path: dir,
        phase: 'awaiting-verdict', round: 2, idea: 'x', updated_at: new Date().toISOString(),
      }));
      const { status, json } = await post('/api/plan-verdict', { project: PROJECT, sessionId: sid, kind: 'approve' });
      return { status, json, logDirName: `_architect-${sid}` };
    },
  },
  {
    family: 'instructions (spawnInstructionsTurn)',
    eventRoute: '/api/instructions/brief',
    drive: async () => {
      const start = await post('/api/instructions/start', { project: PROJECT });
      assert.equal(start.status, 200, JSON.stringify(start.json));
      assert.equal(start.json.dryBridge, undefined, 'exempt-local start must NOT carry a marker');
      const { status, json } = await post('/api/instructions/brief', { project: PROJECT, sessionId: start.json.sessionId, brief: 'x' });
      return { status, json, logDirName: `_instructions-${start.json.sessionId}` };
    },
  },
  {
    family: 'project-brain (spawnProjectBrainTurn)',
    eventRoute: '/api/project-brain/brief',
    drive: async () => {
      const start = await post('/api/project-brain/start', { project: PROJECT });
      assert.equal(start.status, 200, JSON.stringify(start.json));
      assert.equal(start.json.dryBridge, undefined, 'exempt-local start must NOT carry a marker');
      const { status, json } = await post('/api/project-brain/brief', { project: PROJECT, sessionId: start.json.sessionId, brief: 'x' });
      return { status, json, logDirName: `_project-brain-${start.json.sessionId}` };
    },
  },
  {
    family: 'demo-builder (spawnDemoBuilderTurn)',
    eventRoute: '/api/demo-builder/brief',
    drive: async () => {
      const start = await post('/api/demo-builder/start', { project: PROJECT });
      assert.equal(start.status, 200, JSON.stringify(start.json));
      assert.equal(start.json.dryBridge, undefined, 'exempt-local start must NOT carry a marker');
      const { status, json } = await post('/api/demo-builder/brief', { project: PROJECT, sessionId: start.json.sessionId, brief: 'x' });
      return { status, json, logDirName: `_demo-${start.json.sessionId}` };
    },
  },
  {
    family: 'preflight fix-agent (spawnPreflightFix, USER tier)',
    eventRoute: '/api/studio/projects/:id/preflight/fix-agent',
    drive: async () => {
      const { status, json } = await post(`/api/studio/projects/${PROJECT}/preflight/fix-agent`, {
        clauseId: 'C5', instruction: 'forge honours git ownership; never edit tests.',
      });
      return { status, json, logDirName: `_preflight-fix-${json.runId}` };
    },
  },
];

for (const f of FAMILIES) {
  test(`R5-01-F1: ${f.family} — dry-bridge alone marks + logs the skipped agent turn (200, no 409, no log dir)`, async () => {
    const { status, json, logDirName } = await f.drive();
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.ok, true, 'session bookkeeping must still succeed under dry-bridge');
    assertStubbed(json, f.eventRoute, logDirName);
  });
}
