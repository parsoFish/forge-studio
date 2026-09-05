/**
 * ACCEPTANCE TESTS (W7-B5) — the standalone agent-run lifecycle the wave-7
 * walkthrough found missing. Every test here was written RED against the
 * pre-B5 bridge and encodes one finding's expected behaviour:
 *
 *  1. `GET /api/agents/runs/recent` (agents-03 / agents-04 / agents-39) — ONE
 *     aggregate request; each row carries run-level status/cost + the
 *     participating agent slug(s), so the widget can never publish an
 *     arbitrary node's $0.00 for a $12.25 run, and never omits WHICH agent ran.
 *  2. `POST /api/agents/runs/:runId/cancel` (agents-30 / projects-29) — a
 *     dispatched standalone run is cancellable: 404 unknown, 409 terminal,
 *     200 + a durable `agent-dispatch.cancelled` marker otherwise; a live
 *     tracked pid (proven ours via the runId in its argv) is signalled.
 *  3. Run-detail honesty (agents-19 / agents-31 / agents-06 / forge-75j) —
 *     `GET /api/agents/runs/:runId` serves `errorText` (the dispatch
 *     failure's own metadata.error), `outputRefs` (the end event's
 *     output_refs) and `ceilingUsd` (recorded at DISPATCH time, not only on
 *     the terminal end event).
 *  4. t0 observability + live tail (agents-20 / sessions-kinds-24 sibling) —
 *     `POST /api/agents/:slug/run` writes an `agent-run.dispatched` event
 *     BEFORE the response returns (so `GET /api/events/<runId>` is 200 at
 *     t0) and the bridge TAILS the standalone run dir: an appended event is
 *     broadcast to a connected WS client, including after a reconnect once
 *     the status route re-arms the tail.
 *  5. `GET /api/agents//history` (agents-02) — an empty/invalid slug is a
 *     400, never a 200 that quietly matched nothing.
 *
 * Harness pattern copied from `apps/forge/ui-bridge-agent-history.test.ts`
 * (`startBridge({ forgeRoot, port: 0 })`, FORGE_ARCHITECT_NO_SPAWN=1).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import WebSocket from 'ws';

import { startBridge } from './ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function studioAgent(slug: string, opts: { loopStrategy?: string } = {}): string {
  return `---
name: ${slug}
description: fixture agent for the W7-B5 run-lifecycle tests
purpose: exercise the agent-run routes
brainAccess: advisory
interactivity: Autonomous once launched; asks no questions.
surface: unattended
composition:
  skills: []
  tools: []
  mcps: []
  guards: []
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
${opts.loopStrategy ? `  loopStrategy: ${opts.loopStrategy}\n` : ''}allowed-tools: [Read]
disallowed-tools: [Bash]
---

Fixture body for ${slug}.
`;
}

/** Verbatim-shaped forge-develop-style flow so `buildAgentSlugToNodeId`
 *  resolves both fixture agents to their node ids through the production
 *  path (mirrors ui-bridge-agent-history.test.ts's seeded flow). */
const FIXTURE_FLOW_YAML = `id: forge-architect
name: Forge Architect
version: 1
goal: fixture
project: null
kb: cycles
costCeilingUsd: 10
origin: seed
nodes:
  - { id: architect, agent: architect, gate: plan }
  - { id: pm, agent: project-manager }
edges:
  - { from: architect, to: pm, artifact: plan }
triggers: []
kickoff: { kind: idea }
`;

type Ev = Record<string, unknown>;

function writeEvents(cycleId: string, events: Ev[]): void {
  const dir = join(forgeRoot, '_logs', cycleId);
  mkdirSync(dir, { recursive: true });
  const lines = events.map((e, i) => JSON.stringify({
    event_id: `EV_${cycleId}_${i}`,
    cycle_id: cycleId,
    initiative_id: cycleId,
    phase: 'orchestrator',
    input_refs: [],
    output_refs: [],
    started_at: '2026-01-01T00:00:00.000Z',
    ...e,
  }));
  writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n');
}

function manifestText(initId: string, cycleId: string, flowId = 'forge-architect'): string {
  return [
    '---',
    `initiative_id: ${initId}`,
    'project: test-project',
    'project_repo_path: /tmp/test-project',
    'origin: architect',
    'created_at: 2026-02-01T00:00:00.000Z',
    'iteration_budget: 5',
    'cost_budget_usd: 20.0',
    'class: code',
    `cycle_id: ${cycleId}`,
    `flow_id: ${flowId}`,
    '---',
    '',
    `# ${initId}`,
  ].join('\n');
}

async function getJson(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`);
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: (body ?? {}) as Record<string, unknown> };
}

async function postJson(path: string, payload: unknown = {}, headers: Record<string, string> = CSRF): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: (body ?? {}) as Record<string, unknown> };
}

/** Raw-path GET (bypasses fetch()'s dot-segment normalisation) — mirrors
 *  ui-bridge-agent-history.test.ts's rawGet. */
function rawGet(rawPath: string): Promise<{ status: number; text: string }> {
  return new Promise((resolvePromise, reject) => {
    const u = new URL(url);
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: rawPath, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString('utf8'); });
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, text: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-agent-runs-w7b5-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'merged', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  // A real project dir for the onboarding-start t0 pin below — that route
  // refuses a project it cannot resolve under the contained projects root.
  mkdirSync(join(forgeRoot, 'projects', 'w7b5proj'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills', 'w7b5-oneshot'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'w7b5-oneshot', 'SKILL.md'), studioAgent('w7b5-oneshot', { loopStrategy: 'one-shot' }));
  const flowDir = join(forgeRoot, 'studio', 'flows', 'forge-architect');
  mkdirSync(flowDir, { recursive: true });
  writeFileSync(join(flowDir, 'flow.yaml'), FIXTURE_FLOW_YAML);

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
});

// ---------------------------------------------------------------------------
// 1 — GET /api/agents/runs/recent (agents-03 / agents-04 / agents-39)
// ---------------------------------------------------------------------------

test('recent: route exists; empty logs → 200 {ok:true, rows:[]}', async () => {
  const { status, body } = await getJson('/api/agents/runs/recent');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.rows));
});

test('recent: a flow run appears as ONE row with RUN-level status/cost and every participating agent named (agents-03/04)', async () => {
  // architect node costs 2.5, pm node costs 9.75 → run-level cost 12.25.
  // The pre-B5 client-side merge published whichever agent's history row
  // happened to flatten first ($2.50 attributed as the run's whole cost, or
  // $0). The aggregate route must publish 12.25 + both slugs.
  const cycleId = '2026-02-01T00-00-00_INIT-w7b5-agg';
  writeEvents(cycleId, [
    { skill: 'forge-architect', event_type: 'start', started_at: '2026-02-01T00:00:00.000Z' },
    { phase: 'architect', skill: 'architect', event_type: 'start', started_at: '2026-02-01T00:01:00.000Z' },
    { phase: 'architect', skill: 'architect', event_type: 'end', cost_usd: 2.5, started_at: '2026-02-01T00:02:00.000Z' },
    { phase: 'pm', skill: 'project-manager', event_type: 'start', started_at: '2026-02-01T00:03:00.000Z' },
    { phase: 'pm', skill: 'project-manager', event_type: 'end', cost_usd: 9.75, started_at: '2026-02-01T00:04:00.000Z' },
  ]);
  writeFileSync(join(forgeRoot, '_queue', 'done', 'INIT-w7b5-agg.md'), manifestText('INIT-w7b5-agg', cycleId));

  const { status, body } = await getJson('/api/agents/runs/recent');
  assert.equal(status, 200);
  const rows = body.rows as Array<Record<string, unknown>>;
  const row = rows.find((r) => r.id === cycleId);
  assert.ok(row, `expected a row for ${cycleId} — got ids ${JSON.stringify(rows.map((r) => r.id))}`);
  // Run-level cost — the sum over the whole cycle, never one node's slice.
  assert.equal(row!.costUsd, 12.25);
  const agents = row!.agents as string[];
  assert.ok(Array.isArray(agents), 'row.agents must be an array of slugs');
  assert.ok(agents.includes('architect'), `agents must include architect (got ${JSON.stringify(agents)})`);
  assert.ok(agents.includes('project-manager'), `agents must include project-manager (got ${JSON.stringify(agents)})`);
  assert.equal(row!.linkKind, 'flow');
  assert.equal(typeof row!.href, 'string');
  assert.ok((row!.href as string).includes('/flows/'), 'flow row links to the flow run page');
});

test('recent: a standalone dispatch appears with its OWN slug, status and cost (agents-04)', async () => {
  const runId = '_agent-w7b5-oneshot-2026-02-02T00-00-00-000-aaaa';
  writeEvents(runId, [
    { skill: 'w7b5-oneshot', event_type: 'start', metadata: { agent_slug: 'w7b5-oneshot' }, started_at: '2026-02-02T00:00:00.000Z' },
    { skill: 'w7b5-oneshot', event_type: 'end', cost_usd: 0.42, metadata: { agent_slug: 'w7b5-oneshot' }, started_at: '2026-02-02T00:01:00.000Z' },
  ]);
  const { body } = await getJson('/api/agents/runs/recent');
  const rows = body.rows as Array<Record<string, unknown>>;
  const row = rows.find((r) => r.id === runId);
  assert.ok(row, `expected a standalone row for ${runId}`);
  assert.deepEqual(row!.agents, ['w7b5-oneshot']);
  assert.equal(row!.status, 'done');
  assert.equal(row!.costUsd, 0.42);
  assert.equal(row!.linkKind, 'standalone');
  assert.equal(row!.href, `/agents/w7b5-oneshot/run/${encodeURIComponent(runId)}`);
});

test('recent: ?limit bounds the rows, newest first', async () => {
  const { body } = await getJson('/api/agents/runs/recent?limit=1');
  const rows = body.rows as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  // Newest of the two seeded above is the 2026-02-02 standalone run.
  assert.equal(rows[0].id, '_agent-w7b5-oneshot-2026-02-02T00-00-00-000-aaaa');
});

test('recent: two flows sharing a node id each attribute their OWN agent — review round 1 (node ids are unique per flow, not globally)', async () => {
  // The defect: the first draft inverted the GLOBAL slug→nodeId map, so a
  // node id used by two flows collapsed onto ONE arbitrary agent and runs of
  // the second flow were labelled with the first flow's agent — the
  // wrong-agent attribution this route exists to fix. The OOTB flows happen
  // not to collide, so it would have stayed silent until a user authored a
  // flow. This fixture is that user's flow: node id `architect`, bound to a
  // DIFFERENT agent than forge-architect's node of the same name.
  const collideDir = join(forgeRoot, 'studio', 'flows', 'w7b5-collide');
  mkdirSync(collideDir, { recursive: true });
  writeFileSync(join(collideDir, 'flow.yaml'), `id: w7b5-collide
name: W7B5 Collide
version: 1
goal: fixture
project: null
kb: cycles
costCeilingUsd: 10
origin: seed
nodes:
  - { id: architect, agent: w7b5-oneshot }
edges: []
triggers: []
kickoff: { kind: idea }
`);
  const cycleId = '2026-02-04T00-00-00_INIT-w7b5-collide';
  writeEvents(cycleId, [
    { skill: 'w7b5-collide', event_type: 'start', started_at: '2026-02-04T00:00:00.000Z' },
    { phase: 'architect', skill: 'w7b5-oneshot', event_type: 'start', started_at: '2026-02-04T00:01:00.000Z' },
    { phase: 'architect', skill: 'w7b5-oneshot', event_type: 'end', cost_usd: 1.5, started_at: '2026-02-04T00:02:00.000Z' },
  ]);
  writeFileSync(join(forgeRoot, '_queue', 'done', 'INIT-w7b5-collide.md'), manifestText('INIT-w7b5-collide', cycleId, 'w7b5-collide'));

  const { body } = await getJson('/api/agents/runs/recent?limit=100');
  const rows = body.rows as Array<Record<string, unknown>>;
  const collided = rows.find((r) => r.id === cycleId);
  assert.ok(collided, `expected a row for ${cycleId} — got ${JSON.stringify(rows.map((r) => r.id))}`);
  assert.deepEqual(
    collided!.agents,
    ['w7b5-oneshot'],
    'the run must be attributed to ITS OWN flow\'s agent for that node id, never another flow\'s agent that happens to use the same node id',
  );
  // Control: the original flow's own run keeps its own attribution.
  const original = rows.find((r) => r.id === '2026-02-01T00-00-00_INIT-w7b5-agg');
  assert.ok(original, 'the forge-architect run must still be present');
  assert.ok((original!.agents as string[]).includes('architect'));
});

test('recent: two manifests resolving to the SAME cycle id produce ONE row — review round 1 (HistoryLedger keys rows on row.id)', async () => {
  // `HistoryLedger` renders `key={row.id}`; two rows sharing an id is a
  // duplicate React key and a double-listed run, which is why the
  // client-side join this route replaced called its own dedupe "REQUIRED,
  // not cosmetic". A requeued initiative whose manifest exists in two queue
  // states is the ordinary way to get here.
  const cycleId = '2026-02-05T00-00-00_INIT-w7b5-dup';
  writeEvents(cycleId, [
    { skill: 'forge-architect', event_type: 'start', started_at: '2026-02-05T00:00:00.000Z' },
    { phase: 'architect', skill: 'architect', event_type: 'end', cost_usd: 1, started_at: '2026-02-05T00:01:00.000Z' },
  ]);
  writeFileSync(join(forgeRoot, '_queue', 'done', 'INIT-w7b5-dup.md'), manifestText('INIT-w7b5-dup', cycleId));
  writeFileSync(join(forgeRoot, '_queue', 'merged', 'INIT-w7b5-dup-again.md'), manifestText('INIT-w7b5-dup-again', cycleId));

  const { body } = await getJson('/api/agents/runs/recent?limit=100');
  const rows = body.rows as Array<Record<string, unknown>>;
  const matching = rows.filter((r) => r.id === cycleId);
  assert.equal(matching.length, 1, `exactly one row per run id (got ${matching.length} for ${cycleId})`);
});

test('recent: ?kind filters SERVER-SIDE, before the bound — review round 1 (a caller holding one half must not spend its window on the other)', async () => {
  // Home renders its own flow rows and dedupes the aggregate's away, so with
  // `limit` flow runs on disk the whole window came back as rows Home threw
  // out — zero standalone agent runs reached its ledger. The filter has to
  // be applied before the slice for the budget to mean anything.
  const standalone = await getJson('/api/agents/runs/recent?kind=standalone&limit=100');
  const sRows = standalone.body.rows as Array<Record<string, unknown>>;
  assert.ok(sRows.length > 0, 'the standalone half must be non-empty in this fixture');
  assert.deepEqual([...new Set(sRows.map((r) => r.linkKind))], ['standalone']);

  const flow = await getJson('/api/agents/runs/recent?kind=flow&limit=100');
  const fRows = flow.body.rows as Array<Record<string, unknown>>;
  assert.ok(fRows.length > 0, 'the flow half must be non-empty in this fixture');
  assert.deepEqual([...new Set(fRows.map((r) => r.linkKind))], ['flow']);

  // Applied BEFORE the bound: one standalone row asked for is one standalone
  // row returned, however many flow runs are newer.
  const bounded = await getJson('/api/agents/runs/recent?kind=standalone&limit=1');
  const bRows = bounded.body.rows as Array<Record<string, unknown>>;
  assert.equal(bRows.length, 1);
  assert.equal(bRows[0].linkKind, 'standalone');

  const bad = await getJson('/api/agents/runs/recent?kind=sideways');
  assert.equal(bad.status, 400);
});

// ---------------------------------------------------------------------------
// 2 — POST /api/agents/runs/:runId/cancel (agents-30 / projects-29)
// ---------------------------------------------------------------------------

test('cancel: unknown runId → 404; traversal-shaped runId → 400; missing CSRF header → 403', async () => {
  const missing = await postJson('/api/agents/runs/_agent-nope-2026-01-01T00-00-00-000-zzzz/cancel');
  assert.equal(missing.status, 404);

  const traversal = await postJson(`/api/agents/runs/${encodeURIComponent('../escape')}/cancel`);
  assert.equal(traversal.status, 400);

  const noCsrf = await fetch(`${url}/api/agents/runs/whatever/cancel`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(noCsrf.status, 403);
});

test('cancel: a FLOW cycle id is refused (400) and the running cycle\'s own event log is left byte-identical — review round 1 (this route cancels standalone dispatches only)', async () => {
  // The defect: isSafeRunId gates charset, not identity, so a live develop
  // cycle id passed it, derived "running" (no end event yet), found no
  // turn.pid, and got a 200 {ok:true, killed:false} — after appending an
  // agent-dispatch.cancelled marker into the RUNNING cycle's events.jsonl.
  // The aggregate recent-runs route serves flow rows keyed on exactly this
  // id, so an operator could reach it from the ledger.
  const cycleId = '2026-02-03T00-09-00-000_INIT-live-cycle';
  writeEvents(cycleId, [
    { skill: 'developer-ralph', event_type: 'start', metadata: {} },
  ]);
  const eventsPath = join(forgeRoot, '_logs', cycleId, 'events.jsonl');
  const before = readFileSync(eventsPath, 'utf8');

  const { status, body } = await postJson(`/api/agents/runs/${encodeURIComponent(cycleId)}/cancel`);
  assert.equal(status, 400, `a flow cycle id must be refused, not silently "cancelled" (got ${status}: ${JSON.stringify(body)})`);
  assert.match(String(body.error), /standalone/i);
  assert.equal(readFileSync(eventsPath, 'utf8'), before, 'the live cycle\'s own event log must be byte-identical after a refused cancel');
});

test('cancel: a malformed percent-escape in the runId is a 400, never an unhandled rejection that hangs the request — review round 1', async () => {
  // decodeURIComponent throws URIError on '%E0%A4%A'; handleHttp is called as
  // `void handleHttp(...)` with no top-level catch, so an uncaught throw here
  // writes NO response at all (the client hangs) and reports an unhandled
  // rejection. A response arriving at all is half the assertion.
  const res = await fetch(`${url}/api/agents/runs/%E0%A4%A/cancel`, { method: 'POST', headers: CSRF, body: '{}' });
  assert.equal(res.status, 400);
  const body = (await res.json()) as Record<string, unknown>;
  assert.match(String(body.error), /malformed/i);
});

test('cancel: a terminal (done) run → 409, and its events are untouched', async () => {
  const runId = '_agent-w7b5-oneshot-2026-02-03T00-00-00-000-done';
  writeEvents(runId, [
    { skill: 'w7b5-oneshot', event_type: 'start', metadata: { agent_slug: 'w7b5-oneshot' } },
    { skill: 'w7b5-oneshot', event_type: 'end', cost_usd: 0.1, metadata: { agent_slug: 'w7b5-oneshot' } },
  ]);
  const before = readFileSync(join(forgeRoot, '_logs', runId, 'events.jsonl'), 'utf8');
  const { status } = await postJson(`/api/agents/runs/${encodeURIComponent(runId)}/cancel`);
  assert.equal(status, 409);
  assert.equal(readFileSync(join(forgeRoot, '_logs', runId, 'events.jsonl'), 'utf8'), before);
});

test('cancel: a running run with no tracked pid → 200 {killed:false}, cancelled marker written, state derives "cancelled" (terminal + sticky)', async () => {
  const runId = '_agent-w7b5-oneshot-2026-02-03T00-01-00-000-runy';
  writeEvents(runId, [
    { skill: 'w7b5-oneshot', event_type: 'start', metadata: { agent_slug: 'w7b5-oneshot' } },
  ]);
  const { status, body } = await postJson(`/api/agents/runs/${encodeURIComponent(runId)}/cancel`);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.killed, false);

  const detail = await getJson(`/api/agents/runs/${encodeURIComponent(runId)}`);
  assert.equal(detail.body.state, 'cancelled');

  // Sticky: cancelling again is a 409 (already terminal), not a second marker.
  const again = await postJson(`/api/agents/runs/${encodeURIComponent(runId)}/cancel`);
  assert.equal(again.status, 409);

  // Sticky against a late end event too: an end line landing after the
  // cancel must not resurrect the run as 'done'.
  appendFileSync(
    join(forgeRoot, '_logs', runId, 'events.jsonl'),
    JSON.stringify({ event_id: 'EV_late', cycle_id: runId, initiative_id: runId, phase: 'orchestrator', skill: 'w7b5-oneshot', event_type: 'end', cost_usd: 0.2, input_refs: [], output_refs: [], started_at: '2026-02-03T00:09:00.000Z' }) + '\n',
  );
  const after = await getJson(`/api/agents/runs/${encodeURIComponent(runId)}`);
  assert.equal(after.body.state, 'cancelled');
});

test('cancel: a live tracked pid whose argv carries the runId is signalled (killed:true) and dies', async () => {
  const runId = '_agent-w7b5-oneshot-2026-02-03T00-02-00-000-pidx';
  writeEvents(runId, [
    { skill: 'w7b5-oneshot', event_type: 'start', metadata: { agent_slug: 'w7b5-oneshot' } },
  ]);
  // A stand-in for the detached dispatch child: sleeps forever, carries the
  // runId as its own whole argv element (exactly what `--run-id <id>` gives
  // the real child).
  // The `--` is load-bearing: without it node parses `--run-id` as one of
  // ITS OWN options, prints "node: bad option: --run-id" and exits 9
  // immediately — the child was dead before the cancel request arrived, so
  // `killed:true` only ever passed by winning a race against process reaping
  // (~5-in-60 losses when measured). `--` ends node's option parsing, so the
  // flag and the id land in the child's argv where the bridge's ownership
  // proof reads them, and the process genuinely stays alive.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', '--run-id', runId], { detached: true, stdio: 'ignore' });
  child.unref();
  assert.ok(typeof child.pid === 'number');
  writeFileSync(join(forgeRoot, '_logs', runId, 'turn.pid'), `${child.pid}\n`);

  // Wait until the child has actually EXEC'd, i.e. until the very thing the
  // bridge's ownership proof reads (`/proc/<pid>/cmdline`, whole argv
  // elements — packages/sessions/bridge-studio-lifecycle.ts) reports this runId. Between
  // `spawn()` returning a pid and the exec landing, cmdline is still the
  // FORKING process's — so cancelling in that window legitimately reports
  // `killed:false` ("not provably ours"), and the test would be asserting a
  // race, not the behaviour. Deterministic wait on the real signal, not a
  // sleep: this fails loudly if exec never happens.
  let argvVisible = false;
  for (let i = 0; i < 100 && !argvVisible; i++) {
    try {
      argvVisible = readFileSync(`/proc/${child.pid}/cmdline`, 'utf8').split('\0').includes(runId);
    } catch { /* not readable yet */ }
    if (!argvVisible) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(argvVisible, 'the stand-in child must have exec\'d with the runId in its argv before cancel is asked to prove ownership');

  try {
    const { status, body } = await postJson(`/api/agents/runs/${encodeURIComponent(runId)}/cancel`);
    assert.equal(status, 200);
    assert.equal(body.killed, true);

    // The process must actually die (SIGTERM delivered to it / its group).
    // Bounded retry rather than one fixed sleep — under a loaded parallel
    // test run the signal delivery + reap can take longer than 300ms.
    let alive = true;
    for (let i = 0; i < 40 && alive; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try { process.kill(child.pid!, 0); } catch { alive = false; }
    }
    assert.equal(alive, false, 'the tracked child must be dead after cancel');

    const detail = await getJson(`/api/agents/runs/${encodeURIComponent(runId)}`);
    assert.equal(detail.body.state, 'cancelled');
  } finally {
    try { process.kill(child.pid!, 'SIGKILL'); } catch { /* already dead */ }
  }
});

test('cancel: an unowned pid (argv does NOT carry the runId) is never signalled — killed:false, process stays alive', async () => {
  const runId = '_agent-w7b5-oneshot-2026-02-03T00-03-00-000-notme';
  writeEvents(runId, [
    { skill: 'w7b5-oneshot', event_type: 'start', metadata: { agent_slug: 'w7b5-oneshot' } },
  ]);
  const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  bystander.unref();
  writeFileSync(join(forgeRoot, '_logs', runId, 'turn.pid'), `${bystander.pid}\n`);
  try {
    const { status, body } = await postJson(`/api/agents/runs/${encodeURIComponent(runId)}/cancel`);
    assert.equal(status, 200);
    assert.equal(body.killed, false, 'an unowned pid must never be signalled');
    let alive = true;
    try { process.kill(bystander.pid!, 0); } catch { alive = false; }
    assert.equal(alive, true, 'the bystander process must still be alive');
  } finally {
    try { process.kill(bystander.pid!, 'SIGKILL'); } catch { /* fine */ }
  }
});

// ---------------------------------------------------------------------------
// 3 — run-detail honesty (agents-19 / agents-31 / agents-06)
// ---------------------------------------------------------------------------

test('detail: a failed dispatch serves errorText verbatim from the failure marker (agents-19)', async () => {
  const runId = '_agent-w7b5-oneshot-2026-02-04T00-00-00-000-fail';
  writeEvents(runId, [
    { skill: 'w7b5-oneshot', event_type: 'start', metadata: { agent_slug: 'w7b5-oneshot' } },
    { skill: 'w7b5-oneshot', event_type: 'log', message: 'agent-dispatch.failed', metadata: { error: 'spawn ENOENT: claude binary missing', agent_slug: 'w7b5-oneshot' } },
  ]);
  const { body } = await getJson(`/api/agents/runs/${encodeURIComponent(runId)}`);
  assert.equal(body.state, 'failed');
  assert.equal(body.errorText, 'spawn ENOENT: claude binary missing');
});

test('detail: outputRefs come from the end event (agents-06 / forge-75j) and ceilingUsd from ANY event carrying kickoff_ceiling_usd (agents-31)', async () => {
  const runId = '_agent-w7b5-oneshot-2026-02-04T00-01-00-000-outs';
  writeEvents(runId, [
    { skill: 'w7b5-oneshot', event_type: 'log', message: 'agent-run.dispatched', metadata: { agent_slug: 'w7b5-oneshot', kickoff_ceiling_usd: 3 } },
    { skill: 'w7b5-oneshot', event_type: 'start', metadata: { agent_slug: 'w7b5-oneshot' } },
    { skill: 'w7b5-oneshot', event_type: 'end', cost_usd: 0.9, output_refs: ['projects/demo/CLAUDE.md', 'projects/demo/README.md'], metadata: { agent_slug: 'w7b5-oneshot' } },
  ]);
  const { body } = await getJson(`/api/agents/runs/${encodeURIComponent(runId)}`);
  assert.deepEqual(body.outputRefs, ['projects/demo/CLAUDE.md', 'projects/demo/README.md']);
  assert.equal(body.ceilingUsd, 3);
});

test('detail: a still-running run whose dispatch recorded a ceiling serves ceilingUsd BEFORE any end event exists (agents-31)', async () => {
  const runId = '_agent-w7b5-oneshot-2026-02-04T00-02-00-000-ceil';
  writeEvents(runId, [
    { skill: 'w7b5-oneshot', event_type: 'log', message: 'agent-run.dispatched', metadata: { agent_slug: 'w7b5-oneshot', kickoff_ceiling_usd: 7.5 } },
  ]);
  const { body } = await getJson(`/api/agents/runs/${encodeURIComponent(runId)}`);
  assert.equal(body.state, 'running');
  assert.equal(body.ceilingUsd, 7.5);
});

// ---------------------------------------------------------------------------
// 4 — t0 observability + live tail (agents-20)
// ---------------------------------------------------------------------------

test('dispatch: POST /api/agents/:slug/run writes agent-run.dispatched (with the ceiling) before responding — events.jsonl exists at t0 (agents-20 half 1)', async () => {
  const { status, body } = await postJson('/api/agents/w7b5-oneshot/run', { costCeilingUsd: 2.25 });
  assert.equal(status, 200);
  const runId = body.runId as string;
  assert.ok(runId, 'dispatch returns a runId');

  const eventsPath = join(forgeRoot, '_logs', runId, 'events.jsonl');
  assert.ok(existsSync(eventsPath), 'events.jsonl must exist the moment the dispatch response returns');
  const lines = readFileSync(eventsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  const dispatched = lines.find((l) => l.message === 'agent-run.dispatched');
  assert.ok(dispatched, 'an agent-run.dispatched event is written at t0');
  assert.equal(dispatched!.skill, 'w7b5-oneshot');
  assert.equal((dispatched!.metadata as Record<string, unknown>).kickoff_ceiling_usd, 2.25);

  // GET /api/events/<runId> is 200 at t0 — no console 404 on the drawer's
  // first fetch.
  const ev = await getJson(`/api/events/${encodeURIComponent(runId)}`);
  assert.equal(ev.status, 200);
});

test('dispatch: the ONBOARDING start route mints a runId on the same shared identity space and writes the SAME t0 marker — its run is 200 on GET /api/agents/runs/:runId and GET /api/events/:runId at t0, exactly like a generic dispatch (agents-20 / projects-31)', async () => {
  // The failure this pins: only the generic host emitted the t0 marker, so
  // an onboarding run 404'd on both shared surfaces until its spawned child
  // got far enough to write its own `start` event — the onboarding panel's
  // first poll read "no such run" for a run it had just started. The
  // status-EQUIVALENCE pin lives in apps/forge/ui-bridge-onboarding-start.test.ts
  // (AT-6); this one pins the ABSOLUTE state, so both routes going 404
  // together could never satisfy it.
  const { status, body } = await postJson('/api/studio/onboarding/start', { project: 'w7b5proj' });
  assert.equal(status, 200, `onboarding start must accept the fixture project (got ${status}: ${JSON.stringify(body)})`);
  const runId = body.runId as string;
  assert.ok(runId, 'onboarding start returns a runId');

  const eventsPath = join(forgeRoot, '_logs', runId, 'events.jsonl');
  assert.ok(existsSync(eventsPath), 'events.jsonl must exist the moment the onboarding start response returns');
  const lines = readFileSync(eventsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  const dispatched = lines.find((l) => l.message === 'agent-run.dispatched');
  assert.ok(dispatched, 'an agent-run.dispatched event is written at t0 for the onboarding run too');
  assert.equal(dispatched!.skill, 'onboarding-agent', 'attributed to the onboarding agent by the D4 identity field');

  const detail = await getJson(`/api/agents/runs/${encodeURIComponent(runId)}`);
  assert.equal(detail.status, 200, 'the onboarding runId resolves on the shared run-detail surface at t0');
  const ev = await getJson(`/api/events/${encodeURIComponent(runId)}`);
  assert.equal(ev.status, 200, 'and on the shared events surface at t0');
});

/** Wait for one WS message satisfying `match`, or reject after `ms`. */
function nextWsEvent(ws: WebSocket, match: (msg: Record<string, unknown>) => boolean, ms: number): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`no matching WS message within ${ms}ms`)), ms);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as Record<string, unknown>;
        if (match(msg)) { clearTimeout(timer); resolvePromise(msg); }
      } catch { /* ignore non-JSON */ }
    });
  });
}

test('tail: a dispatched standalone run is TAILED — an appended event reaches a connected WS client (agents-20 half 2)', async () => {
  const { body } = await postJson('/api/agents/w7b5-oneshot/run', {});
  const runId = body.runId as string;

  const ws = new WebSocket(`${url.replace('http', 'ws')}/ws`);
  await new Promise<void>((r, j) => { ws.on('open', () => r()); ws.on('error', j); });
  try {
    // Poll the status route once — the reconnect-re-arm path (a fresh WS
    // connection resets tails; the status poll must re-arm this run's).
    await getJson(`/api/agents/runs/${encodeURIComponent(runId)}`);

    // The tail replays from offset 0 (the t0 `agent-run.dispatched` line
    // arrives first — the client dedupes by event_id), so wait for the
    // APPENDED line specifically.
    const waiter = nextWsEvent(
      ws,
      (m) => m.type === 'event' && m.cycleId === runId
        && (m.event as Record<string, unknown> | undefined)?.message === 'live-line',
      4000,
    );
    appendFileSync(
      join(forgeRoot, '_logs', runId, 'events.jsonl'),
      JSON.stringify({ event_id: 'EV_live_1', cycle_id: runId, initiative_id: runId, phase: 'orchestrator', skill: 'w7b5-oneshot', event_type: 'log', message: 'live-line', input_refs: [], output_refs: [], started_at: new Date().toISOString() }) + '\n',
    );
    const msg = await waiter;
    assert.equal((msg.event as Record<string, unknown>).message, 'live-line');
  } finally {
    ws.close();
  }
});

test('tail: a run\'s tail is RELEASED once the run is terminal — an event appended afterwards is not broadcast (review round 1: a finished run\'s immutable log must not be polled for the life of the session)', async () => {
  const { body } = await postJson('/api/agents/w7b5-oneshot/run', {});
  const runId = body.runId as string;
  const eventsPath = join(forgeRoot, '_logs', runId, 'events.jsonl');

  const ws = new WebSocket(`${url.replace('http', 'ws')}/ws`);
  await new Promise<void>((r, j) => { ws.on('open', () => r()); ws.on('error', j); });
  try {
    // 1. Live → the status poll arms the tail, and a live append streams.
    await getJson(`/api/agents/runs/${encodeURIComponent(runId)}`);
    const live = nextWsEvent(ws, (m) => m.type === 'event' && m.cycleId === runId
      && (m.event as Record<string, unknown> | undefined)?.message === 'while-live', 4000);
    appendFileSync(eventsPath, JSON.stringify({ event_id: 'EV_rel_1', cycle_id: runId, initiative_id: runId, phase: 'orchestrator', skill: 'w7b5-oneshot', event_type: 'log', message: 'while-live', input_refs: [], output_refs: [], started_at: new Date().toISOString() }) + '\n');
    await live;

    // 2. Terminal → the next status poll must RELEASE the tail.
    appendFileSync(eventsPath, JSON.stringify({ event_id: 'EV_rel_end', cycle_id: runId, initiative_id: runId, phase: 'orchestrator', skill: 'w7b5-oneshot', event_type: 'end', cost_usd: 0.1, input_refs: [], output_refs: [], started_at: new Date().toISOString() }) + '\n');
    const after = await getJson(`/api/agents/runs/${encodeURIComponent(runId)}`);
    assert.equal(after.body.state, 'done', 'the run must read terminal before the release is asserted');

    // 3. Nothing appended now may reach the socket. A negative with a real
    //    window: the positive case one step above proves the transport works
    //    and lands well inside it, so a silent window here means released.
    const late = nextWsEvent(ws, (m) => m.type === 'event' && m.cycleId === runId
      && (m.event as Record<string, unknown> | undefined)?.message === 'after-terminal', 1500);
    appendFileSync(eventsPath, JSON.stringify({ event_id: 'EV_rel_2', cycle_id: runId, initiative_id: runId, phase: 'orchestrator', skill: 'w7b5-oneshot', event_type: 'log', message: 'after-terminal', input_refs: [], output_refs: [], started_at: new Date().toISOString() }) + '\n');
    await assert.rejects(
      late,
      'a terminal run must no longer be tailed — its log is immutable and served on demand by /api/events',
    );
  } finally {
    ws.close();
  }
});

// ---------------------------------------------------------------------------
// 5 — history route slug validation (agents-02)
// ---------------------------------------------------------------------------

test('history: an EMPTY slug (GET /api/agents//history) → 400, never a 200 that matched nothing', async () => {
  const { status } = await rawGet('/api/agents//history');
  assert.equal(status, 400);
});

test('history: an invalid slug shape → 400', async () => {
  const { status } = await rawGet('/api/agents/Bad_Slug!/history');
  assert.equal(status, 400);
});
