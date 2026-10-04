/**
 * R5-01-F1 — table-driven coverage of the stub-actions SPAWN families under
 * FORGE_DRY_BRIDGE=1 **alone** (FORGE_ARCHITECT_NO_SPAWN deliberately unset).
 *
 * The spawn-helper families (architect / plan-verdict, project-brain,
 * demo-builder, preflight fix-agent) are classified `stub-actions`: the
 * route's session bookkeeping proceeds exactly as under NO_SPAWN today, but
 * the skipped agent turn is EXPLICIT — the 200 body gains `dryBridge: {
 * skipped: ['agent-turn'] }` and one `dry-bridge.skip` JSONL event fires per
 * suppressed turn. Never silent. (`instructions` dropped out of this list —
 * row 206 sweep, forge-8vfn.8.5.56 — its one spawning bespoke route,
 * `/api/instructions/brief`, is deleted; the kind's dry-bridge coverage now
 * lives entirely on the generic question-form affordance.)
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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startBridge } from '../../ui-bridge.ts';
import { DRY_BRIDGE_LOG_BUCKET } from '../../dry-bridge.ts';

const PROJECT = 'demoproj';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

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

/** The artifacts ONLY a real `spawnAgentDispatch`/spawn-helper child leaves
 *  behind in `_logs/<dir>`: the child's stderr sink and its recorded pid.
 *  Neither is written anywhere above the `|| isDryBridge()` guard. */
const SPAWN_ONLY_ARTIFACTS = ['stderr.log', 'turn.pid'] as const;

function assertStubbed(
  json: Record<string, unknown>,
  eventRoute: string,
  logDirName: string,
  opts: { logDirPreCreatedBy?: string } = {},
): void {
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
  //
  // W7-B5 amendment: for a family whose ROUTE legitimately writes into
  // `_logs/<runId>` BEFORE it ever calls the spawn helper (the t0
  // `agent-run.dispatched` marker — agents-20/31), "the dir does not exist"
  // stopped being a proxy for "the spawn was suppressed"; it would just red
  // on the route's own honest bookkeeping. Those families instead assert the
  // artifacts ONLY a real child leaves — `stderr.log` (opened by the spawn
  // itself) and `turn.pid` (written from the live child's pid). Both sit
  // strictly BELOW the `|| isDryBridge()` guard, so deleting that guard still
  // reds this test — and this shape is the stricter one, since it also fails
  // if a suppressed spawn somehow half-ran.
  if (opts.logDirPreCreatedBy !== undefined) {
    for (const artifact of SPAWN_ONLY_ARTIFACTS) {
      assert.ok(
        !existsSync(join(forgeRoot, '_logs', logDirName, artifact)),
        `dry-bridge must not leave the spawn-only artifact _logs/${logDirName}/${artifact} for ${eventRoute} `
        + `(the dir itself is created above the guard by ${opts.logDirPreCreatedBy})`,
      );
    }
    return;
  }
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
  // The onboarding brief resolves its kind from the REAL, checked-in
  // `studio/session-kinds.yaml` — copied byte-for-byte, as
  // apps/forge/tests/integration/ui-bridge-onboarding-briefing.test.ts does.
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), readFileSync(join(REPO_ROOT, 'studio', 'session-kinds.yaml'), 'utf8'));
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );

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
  /** Set (to the name of the writer) ONLY for a family whose route writes
   *  into the run's log dir above the spawn guard — see `assertStubbed`. */
  logDirPreCreatedBy?: string;
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
  // `instructions (spawnInstructionsTurn)` via `/api/instructions/brief` is
  // DELETED (row 206 sweep, forge-8vfn.8.5.56 — no forge-ui caller; every
  // instructions briefing now POSTs through the generic question-form
  // affordance, which has its own dry-bridge coverage).
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
    // Row 206 sweep — `/brief` is deleted (no forge-ui caller); `/lock` is
    // the one surviving demo-builder spawn route, so it carries this
    // family's dry-bridge coverage now. `/lock` requires `awaiting-review`
    // (its own new phase gate, same PR), seeded directly via fs — mirrors
    // `ui-bridge-demo-generations.test.ts`'s own `patchDemoStatus` idiom.
    family: 'demo-builder (spawnDemoBuilderTurn)',
    eventRoute: '/api/demo-builder/lock',
    drive: async () => {
      const start = await post('/api/demo-builder/start', { project: PROJECT });
      assert.equal(start.status, 200, JSON.stringify(start.json));
      assert.equal(start.json.dryBridge, undefined, 'exempt-local start must NOT carry a marker');
      const sessionId = start.json.sessionId as string;
      const statusPath = join(forgeRoot, 'projects', PROJECT, '_demo', sessionId, 'status.json');
      const current = JSON.parse(readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
      writeFileSync(statusPath, JSON.stringify({ ...current, phase: 'awaiting-review' }));
      const { status, json } = await post('/api/demo-builder/lock', { project: PROJECT, sessionId });
      return { status, json, logDirName: `_demo-${sessionId}` };
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
  // R4-17 pin 5, item 3 (MAJOR): the onboarding dispatch must carry the same
  // marker + event as the generic run host. Reuses spawnAgentDispatch (D6,
  // same as the generic /api/agents/:slug/run dispatch), so its log dir is
  // exactly `_logs/<runId>` — not the `_<family>-<sessionId>` shape the other
  // five families use. Row 202 (bead forge-8vfn.8.5.42): the ONE dispatch is
  // the brief's question-form write (ruling 441); `start` only mints and is
  // `exempt-local`, so the family is driven as the project page presses it —
  // start, then the brief — and the marker is the brief's.
  {
    family: 'onboarding (spawnAgentDispatch via the brief\'s question-form write)',
    eventRoute: '/api/studio/sessions/onboarding/question-form',
    drive: async () => {
      const start = await post('/api/studio/onboarding/start', {
        project: PROJECT, inputs: { northStar: 'dry-bridge onboarding marker probe' },
      });
      assert.equal(start.status, 200, JSON.stringify(start.json));
      assert.equal(start.json.dryBridge, undefined, 'start dispatches nothing, so it has no skipped dispatch to mark (row 202)');
      const { status, json } = await post(`/api/studio/sessions/onboarding/${start.json.sessionId as string}/briefing-question-form`, {
        project: PROJECT, answers: [{ question: 'brief', answer: 'dry-bridge onboarding marker probe' }],
      });
      return { status, json, logDirName: start.json.runId as string };
    },
    // W7-B5 (agents-20/31): the brief emits the run's t0
    // `agent-run.dispatched` marker into `_logs/<runId>` before it calls
    // spawnAgentDispatch, so the dir legitimately exists under dry-bridge.
    logDirPreCreatedBy: 'the brief\'s own t0 agent-run.dispatched marker',
  },
];

for (const f of FAMILIES) {
  test(`R5-01-F1: ${f.family} — dry-bridge alone marks + logs the skipped agent turn (200, no 409, no log dir)`, async () => {
    const { status, json, logDirName } = await f.drive();
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.ok, true, 'session bookkeeping must still succeed under dry-bridge');
    assertStubbed(json, f.eventRoute, logDirName, { ...(f.logDirPreCreatedBy !== undefined ? { logDirPreCreatedBy: f.logDirPreCreatedBy } : {}) });
  });
}

// R4-17 pin 5, item 3 (MAJOR, part (c) of the classification row's claim):
// the session dir, status.json and prompt.md are REAL bookkeeping and still
// land under dry-bridge. Row 202 made that the WHOLE of the start route — it
// dispatches nothing, so apps/forge/dry-bridge.ts now classifies it
// `exempt-local` — and this is the pin that its bookkeeping keeps landing.
test('R4-17 pin 5, item 3: POST /api/studio/onboarding/start still performs its REAL bookkeeping under dry-bridge — session dir + status.json + prompt.md land', async () => {
  const { status, json } = await post('/api/studio/onboarding/start', {
    project: PROJECT, inputs: { northStar: 'dry-bridge bookkeeping probe 7f3c91' },
  });
  assert.equal(status, 200, JSON.stringify(json));
  const sessionDir = join(forgeRoot, 'projects', PROJECT, '_onboarding', json.sessionId as string);
  assert.ok(existsSync(join(sessionDir, 'status.json')), 'status.json must still land under dry-bridge');
  const prompt = readFileSync(join(sessionDir, 'prompt.md'), 'utf8');
  assert.ok(prompt.includes('dry-bridge bookkeeping probe 7f3c91'), 'prompt.md must still render the real operator inputs under dry-bridge (D8 — never fabricated)');
});
