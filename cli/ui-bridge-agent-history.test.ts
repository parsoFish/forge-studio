/**
 * ACCEPTANCE TESTS (R6-06 Task 1) — `GET /api/agents/:slug/history`, a route
 * that does not exist yet. Every assertion below is a legitimate RED: the
 * URL matches no handler on HEAD, so every request in this file resolves via
 * the bridge's final "unmatched route" fallback (a 404 with a generic body,
 * NOT the `{ok:true, rows:[...]}` shape these tests require) until the route
 * is implemented.
 *
 * WHAT THIS PINS: an agent's run-history ledger joins THREE execution paths
 * — flow-node (a node inside a flow run), standalone (a worker dispatch,
 * `_agent-<slug>-<stamp>`), and session (an interactive session) — each row
 * linking to where the run actually happened, with status/cost read from
 * THAT TARGET'S OWN record (D3), never a run-level or cross-run aggregate.
 *
 * MEASURED GROUNDS (read directly off this repo before writing anything
 * below — see the task report for the full trail):
 *   - `orchestrator/run-model.ts`'s `listRuns(root, nowMs)` walks all six
 *     `_queue/<state>/*.md` manifests; `run.phases[nodeId]` /
 *     `run.phaseMeta[nodeId]` are the node's OWN status/cost (RunPhaseStatus,
 *     RunPhaseMeta), distinct from `run.status`/`run.costUsd` (the RUN-level
 *     aggregate `sumAuthoritativeCostUsd(events)` over EVERY event in the
 *     cycle, `run-model.ts:547`).
 *   - `buildAgentSlugToNodeId(root)` (run-model.ts:320) resolves an agent
 *     slug straight to the flow node id that declares it, from the UNION of
 *     every `studio/flows/<flow>/flow.yaml` — first-write-wins, no fallback table
 *     (unlike phase→node, which degrades to `FALLBACK_PHASE_TO_NODE` when
 *     `studio/flows` is missing). This suite therefore seeds a REAL
 *     `studio/flows/forge-architect/flow.yaml` (copied verbatim from the
 *     live one) so the flow-node join resolves for real, not by the
 *     coincidence that node id === agent slug === phase name for 'architect'.
 *   - `orchestrator/run-agent.ts`'s `runAgent` emits a `start` event with
 *     `metadata: { agent_phase, agent_slug }` (line ~320) and an `end` event
 *     with the SAME `metadata.agent_slug` plus a top-level `cost_usd` (line
 *     ~360-382) — a standalone run's OWN identity proof, independent of its
 *     runId. `cli/ui-bridge.ts`'s EXISTING `GET /api/agents/runs/<runId>`
 *     (line ~1139) derives `state`/`costUsd` from exactly this shape; D3.5
 *     below pins that the NEW route reuses that SAME derivation rather than
 *     re-implementing it.
 *   - `EventLogEntry.cost_usd` (orchestrator/logging.ts:78) is a TOP-LEVEL
 *     field, never nested under `metadata` — every fixture below places it
 *     there.
 *   - Session state: `<projectsRoot>/<project>/_<kind>/<sessionId>/status.json`
 *     (`{ phase, session_id, project, ... }`), cost in the SEPARATE log dir
 *     `_logs/_<kind>-<sessionId>/events.jsonl` — mirrors
 *     `scripts/lib/journey-fixtures.mjs`'s `archDir`/`writeStatus`/`archEvent`
 *     helpers verbatim (an already-shipped, already-used fixture shape, not
 *     invented for this file). `studio/session-kinds.yaml`'s `architect`
 *     descriptor names `legacyRoutes: [/architect/[sessionId], ...]` — the
 *     session row's href.
 *
 * D-DECISIONS PINNED HERE (verbatim from the task brief):
 *   D3  — status/cost come from that TARGET's own record, never an aggregate.
 *   D4  — standalone identity from the run's OWN `metadata.agent_slug`
 *         events, never a runId-prefix match (the 'probe' vs 'probe-x' alias
 *         trap below is THE test for this).
 *   D5  — the caller-supplied slug is a FILTER over enumerated entries,
 *         never a path segment — no new path join takes untrusted input.
 *   D9  — a flow-node row's status/narrative derive from THAT NODE's own
 *         phases/phaseMeta entry, never `run.status`/`run.costUsd`.
 *   D12 — three status vocabularies; each row carries its OWN one verbatim
 *         (no cross-vocabulary mapping — there is no honest `RunStatus` for
 *         'suppressed' or a session's 'interviewing').
 *   (Shared-derivation) the standalone status/cost math is EXTRACTED and
 *         reused by both `GET /api/agents/runs/<runId>` (existing) and this
 *         new route — pinned by seeding ONE real standalone run and hitting
 *         BOTH routes, asserting byte-identical status+cost (an implementer
 *         cannot satisfy this with a second, independently-written copy that
 *         happens to agree today but can silently drift tomorrow).
 *
 * Harness pattern copied from `cli/ui-bridge-agent-run.test.ts`:
 * `startBridge({ forgeRoot, port: 0 })`.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Verbatim copy of `studio/flows/forge-architect/flow.yaml` (read from this
 *  repo before writing this file) — a REAL flow definition, not a stub, so
 *  `buildAgentSlugToNodeId` resolves the 'architect' slug -> 'architect'
 *  node id through the SAME production code path the real Studio UI uses. */
const FORGE_ARCHITECT_FLOW_YAML = `id: forge-architect
name: Forge Architect
version: 1
goal: Draft an initiative roadmap and decompose it into work items — ready for Develop to execute.
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

function seedForgeArchitectFlow(): void {
  const dir = join(forgeRoot, 'studio', 'flows', 'forge-architect');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'flow.yaml'), FORGE_ARCHITECT_FLOW_YAML);
}

function manifestText(initId: string, cycleId: string, flowId: string): string {
  return [
    '---',
    `initiative_id: ${initId}`,
    'project: test-project',
    'project_repo_path: /tmp/test-project',
    'origin: architect',
    'created_at: 2026-01-01T00:00:00.000Z',
    'iteration_budget: 5',
    'cost_budget_usd: 20.0',
    `cycle_id: ${cycleId}`,
    `flow_id: ${flowId}`,
    '---',
    '',
    `# ${initId}`,
    '',
    'Fixture manifest for R6-06 agent-history acceptance tests.',
  ].join('\n');
}

function seedManifest(queueState: string, initId: string, cycleId: string, flowId: string): void {
  const dir = join(forgeRoot, '_queue', queueState);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${initId}.md`), manifestText(initId, cycleId, flowId));
}

type Ev = {
  event_id: string;
  cycle_id: string;
  initiative_id: string;
  phase: string;
  skill: string;
  event_type: string;
  started_at: string;
  input_refs: unknown[];
  output_refs: unknown[];
  message?: string;
  cost_usd?: number;
  metadata?: Record<string, unknown>;
};

function seedEventsJsonl(cycleId: string, initId: string, events: Partial<Ev>[]): void {
  const dir = join(forgeRoot, '_logs', cycleId);
  mkdirSync(dir, { recursive: true });
  const lines = events.map((e, i) => JSON.stringify({
    event_id: `EV_${i}`,
    cycle_id: cycleId,
    initiative_id: initId,
    input_refs: [],
    output_refs: [],
    started_at: '2026-01-01T00:00:00.000Z',
    ...e,
  }));
  writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n');
}

/** A standalone dispatch dir, `_logs/_agent-<slug>-<stamp>/events.jsonl` —
 *  mirrors `runAgent`'s REAL emitted shape (orchestrator/run-agent.ts:320-382):
 *  a `start` event carrying `metadata.agent_slug`, an `end` event carrying
 *  the SAME `metadata.agent_slug` plus a top-level `cost_usd`. */
function seedStandaloneRun(runId: string, agentSlug: string, costUsd: number): void {
  const dir = join(forgeRoot, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  const events = [
    {
      event_id: 'EV_0', cycle_id: runId, initiative_id: runId, phase: 'orchestrator', skill: agentSlug,
      event_type: 'start', started_at: '2026-01-01T00:00:00.000Z', input_refs: [], output_refs: [],
      metadata: { agent_phase: 'standalone', agent_slug: agentSlug },
    },
    {
      event_id: 'EV_1', cycle_id: runId, initiative_id: runId, phase: 'orchestrator', skill: agentSlug,
      event_type: 'end', started_at: '2026-01-01T00:01:00.000Z', input_refs: [], output_refs: [],
      cost_usd: costUsd, metadata: { agent_phase: 'standalone', agent_slug: agentSlug },
    },
  ];
  writeFileSync(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

/** A dispatched-but-not-yet-started standalone run — the run dir exists (a
 *  real dispatch happened) but no event has landed yet. Honest-absent cost
 *  case (never a fabricated $0.00 that could be confused with "genuinely
 *  spent exactly zero and finished"). */
function seedEmptyStandaloneRun(runId: string): void {
  mkdirSync(join(forgeRoot, '_logs', runId), { recursive: true });
}

/** A real architect SESSION — mirrors `scripts/lib/journey-fixtures.mjs`'s
 *  `archDir`/`writeStatus`/`archEvent` shape verbatim (an already-shipped
 *  fixture convention this repo's own journeys already use for architect
 *  interview sessions, not invented for this file). */
function seedArchitectSession(project: string, sessionId: string, phase: string, costUsd: number | null): void {
  const projectDir = join(forgeRoot, 'projects', project);
  mkdirSync(projectDir, { recursive: true });
  const sessDir = join(projectDir, '_architect', sessionId);
  mkdirSync(sessDir, { recursive: true });
  writeFileSync(join(sessDir, 'status.json'), JSON.stringify({
    phase, session_id: sessionId, project, project_repo_path: projectDir,
    updated_at: '2026-01-01T00:10:00.000Z',
  }, null, 2));
  if (costUsd !== null) {
    const logDir = join(forgeRoot, '_logs', `_architect-${sessionId}`);
    mkdirSync(logDir, { recursive: true });
    const events = [
      { event_id: 'EV_arch_0', cycle_id: `_architect-${sessionId}`, initiative_id: `architect-session-${sessionId}`, phase: 'architect', skill: 'architect-runner', event_type: 'start', started_at: '2026-01-01T00:10:00.000Z', input_refs: [], output_refs: [] },
      { event_id: 'EV_arch_1', cycle_id: `_architect-${sessionId}`, initiative_id: `architect-session-${sessionId}`, phase: 'architect', skill: 'architect-runner', event_type: 'end', started_at: '2026-01-01T00:12:00.000Z', input_refs: [], output_refs: [], cost_usd: costUsd },
    ];
    writeFileSync(join(logDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${url}${path}`);
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-agent-history-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'merged', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  seedForgeArchitectFlow();

  // Decoy sentinel — lives OUTSIDE `_logs/`, at forgeRoot's own top level.
  // D5's containment proof: NO traversal-shaped slug may ever cause this
  // string to appear in a response body.
  writeFileSync(join(forgeRoot, 'SECRET-OUTSIDE-LOGS.txt'), 'SENTINEL-9f3a-must-never-leak');

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Route existence + honest-empty
// ---------------------------------------------------------------------------

test('GET /api/agents/:slug/history: route exists — an agent with NO runs anywhere returns 200 with an empty rows array, never 404/500', async () => {
  // KILLS: a route that doesn't exist at all (the current state of HEAD —
  // legitimate RED), and one that 404s for "no history yet" — a brand-new
  // agent with zero runs is a completely normal, expected state, not an
  // error.
  const { status, body } = await getJson('/api/agents/totally-unused-agent-xyz/history');
  assert.equal(status, 200);
  assert.deepEqual((body as { rows: unknown[] }).rows, []);
});

// ---------------------------------------------------------------------------
// D9 — FLOW-NODE join: status/cost from THAT NODE's own phases/phaseMeta,
// never run.status/run.costUsd (the run-level aggregate)
// ---------------------------------------------------------------------------

test('D9/D3: a flow-node row reads its cost from phaseMeta[nodeId].costUsd, NOT the run-level aggregate — proven by making them provably different values', async () => {
  // KILLS: `row.costUsd = run.costUsd` (the run-level
  // `sumAuthoritativeCostUsd` total over EVERY event in the cycle) instead of
  // `run.phaseMeta['architect'].costUsd` (this node's own authoritative
  // spend). The architect node spends 2.5; the pm node spends 9.75 more —
  // run.costUsd is therefore 12.25, a DIFFERENT number a wrong
  // implementation could accidentally satisfy this test with only if it
  // fabricated a coincidence, not by reading the aggregate.
  const initId = 'INIT-d9-cost-1';
  const cycleId = `2026-01-01T00-00-00_${initId}`;
  seedManifest('done', initId, cycleId, 'forge-architect');
  seedEventsJsonl(cycleId, initId, [
    { phase: 'architect', event_type: 'start', started_at: '2026-01-01T00:00:00.000Z' },
    { phase: 'architect', event_type: 'end', started_at: '2026-01-01T00:01:00.000Z', cost_usd: 2.5 },
    { phase: 'project-manager', event_type: 'start', started_at: '2026-01-01T00:02:00.000Z' },
    { phase: 'project-manager', event_type: 'end', started_at: '2026-01-01T00:03:00.000Z', cost_usd: 9.75 },
  ]);

  const { status, body } = await getJson('/api/agents/architect/history');
  assert.equal(status, 200);
  const rows = (body as { rows: { id: string; linkKind: string; costUsd: number | null }[] }).rows;
  const row = rows.find((r) => r.id === cycleId);
  assert.ok(row, `expected a flow-node row for cycle ${cycleId}, got ${JSON.stringify(rows)}`);
  assert.equal(row!.linkKind, 'flow-node');
  assert.equal(row!.costUsd, 2.5, `architect node's own cost is 2.5, not the run aggregate 12.25 (got ${row!.costUsd})`);
});

test('D9: a flow-node row reads its STATUS from phases[nodeId], NOT run.status — proven by a run whose OWN status differs from the node\'s status', async () => {
  // KILLS: `row.status = run.status` instead of `run.phases['architect']`.
  // The manifest sits in `_queue/failed/` (run.status: 'failed', a RunStatus)
  // — but the architect NODE itself completed cleanly (a real `end` event,
  // no failure metadata) before something else in the flow failed later, so
  // its own RunPhaseStatus is 'complete'. A wrong implementation that copies
  // the run-level status would report 'failed' for a node that actually
  // succeeded — the exact attributed-status defect this initiative exists to
  // prevent (D9's own framing, restated for status not just cost).
  const initId = 'INIT-d9-status-1';
  const cycleId = `2026-01-01T00-00-00_${initId}`;
  seedManifest('failed', initId, cycleId, 'forge-architect');
  seedEventsJsonl(cycleId, initId, [
    { phase: 'architect', event_type: 'start', started_at: '2026-01-01T00:00:00.000Z' },
    { phase: 'architect', event_type: 'end', started_at: '2026-01-01T00:01:00.000Z', cost_usd: 1.0 },
    { phase: 'project-manager', event_type: 'start', started_at: '2026-01-01T00:02:00.000Z' },
    { phase: 'project-manager', event_type: 'error', started_at: '2026-01-01T00:03:00.000Z' },
  ]);

  const { body } = await getJson('/api/agents/architect/history');
  const rows = (body as { rows: { id: string; status: string }[] }).rows;
  const row = rows.find((r) => r.id === cycleId);
  assert.ok(row, `expected a flow-node row for cycle ${cycleId}`);
  assert.equal(row!.status, 'complete', `the architect NODE's own status is 'complete' even though run.status is 'failed' (got "${row!.status}")`);
});

test('D9: the flow-node row links to /flows/<flowId>/run/<runId> (the same D2 reuse-seam href flow-ledger.ts already established)', async () => {
  const initId = 'INIT-d9-href-1';
  const cycleId = `2026-01-01T00-00-00_${initId}`;
  seedManifest('done', initId, cycleId, 'forge-architect');
  seedEventsJsonl(cycleId, initId, [
    { phase: 'architect', event_type: 'start', started_at: '2026-01-01T00:00:00.000Z' },
    { phase: 'architect', event_type: 'end', started_at: '2026-01-01T00:01:00.000Z', cost_usd: 0.5 },
  ]);
  const { body } = await getJson('/api/agents/architect/history');
  const rows = (body as { rows: { id: string; href: string }[] }).rows;
  const row = rows.find((r) => r.id === cycleId);
  assert.ok(row);
  assert.equal(row!.href, `/flows/forge-architect/run/${cycleId}`);
});

test('D9: a run whose flow never reaches the architect node produces NO row for it (never fabricated)', async () => {
  // KILLS: a join that returns one row per Run regardless of whether the
  // target node actually ran (e.g. a manifest with flow_id: forge-architect
  // but whose event log never touched the architect phase at all).
  const initId = 'INIT-d9-absent-1';
  const cycleId = `2026-01-01T00-00-00_${initId}`;
  seedManifest('done', initId, cycleId, 'forge-architect');
  seedEventsJsonl(cycleId, initId, [
    { phase: 'project-manager', event_type: 'start', started_at: '2026-01-01T00:00:00.000Z' },
    { phase: 'project-manager', event_type: 'end', started_at: '2026-01-01T00:01:00.000Z', cost_usd: 1.0 },
  ]);
  const { body } = await getJson('/api/agents/architect/history');
  const rows = (body as { rows: { id: string }[] }).rows;
  assert.equal(rows.find((r) => r.id === cycleId), undefined);
});

// ---------------------------------------------------------------------------
// D4 — STANDALONE identity: the run's OWN metadata.agent_slug, never a
// runId-prefix match. THE central test for this initiative's headline trap.
// ---------------------------------------------------------------------------

test("D4 (THE ALIAS TRAP): agent 'probe-x' is a real, separate standalone run — querying agent 'probe' must NOT include it, even though its runId starts with '_agent-probe-'", async () => {
  // KILLS: any implementation keyed off `runId.startsWith('_agent-probe-')`
  // (or any other runId-prefix scheme) instead of the run's OWN
  // `metadata.agent_slug`. `'_agent-probe-x-<stamp>'.startsWith('_agent-probe-')`
  // is TRUE — a prefix-matching implementation would incorrectly fold
  // agent 'probe-x's run into agent 'probe's history. Exact-match on the
  // event's own `metadata.agent_slug` (`'probe-x' !== 'probe'`) is the only
  // implementation that passes this test AND the sibling positive-control
  // test below.
  const probeRunId = '_agent-probe-2026-01-01T00-00-00-000-aaaa';
  const probeXRunId = '_agent-probe-x-2026-01-01T00-05-00-000-bbbb';
  seedStandaloneRun(probeRunId, 'probe', 1.11);
  seedStandaloneRun(probeXRunId, 'probe-x', 2.22);

  const { status, body } = await getJson('/api/agents/probe/history');
  assert.equal(status, 200);
  const rows = (body as { rows: { id: string; costUsd: number | null }[] }).rows;
  const ids = rows.map((r) => r.id);
  assert.ok(ids.includes(probeRunId), `expected 'probe's own run (${probeRunId}) in its history, got ${JSON.stringify(ids)}`);
  assert.ok(!ids.includes(probeXRunId), `'probe-x's run must NEVER appear in 'probe's history (alias trap) — got ${JSON.stringify(ids)}`);
  assert.ok(!rows.some((r) => r.costUsd === 2.22), "'probe-x's cost (2.22) must never appear on 'probe's ledger");
});

test("D4 positive control: agent 'probe-x' queried directly DOES see its own run (proves the filter isn't just refusing everything)", async () => {
  const { body } = await getJson('/api/agents/probe-x/history');
  const rows = (body as { rows: { id: string; costUsd: number | null }[] }).rows;
  const row = rows.find((r) => r.costUsd === 2.22);
  assert.ok(row, `expected 'probe-x's own run (cost 2.22) in ITS OWN history, got ${JSON.stringify(rows)}`);
});

test('D4/D3: a standalone row carries linkKind "standalone", href /agents/<slug>/run/<runId>, and its OWN cost/status — never the run-level shape', async () => {
  const runId = '_agent-solo-2026-02-01T00-00-00-000-cccc';
  seedStandaloneRun(runId, 'solo', 4.5);
  const { body } = await getJson('/api/agents/solo/history');
  const rows = (body as { rows: { id: string; linkKind: string; href: string; costUsd: number | null; status: string }[] }).rows;
  const row = rows.find((r) => r.id === runId);
  assert.ok(row);
  assert.equal(row!.linkKind, 'standalone');
  assert.equal(row!.href, `/agents/solo/run/${runId}`);
  assert.equal(row!.costUsd, 4.5);
  assert.equal(row!.status, 'done');
});

test('honest-absent cost: a dispatched-but-not-yet-started standalone run reports costUsd: null, never a fabricated 0.00 that could be mistaken for "spent exactly zero and finished"', async () => {
  const runId = '_agent-empty-2026-03-01T00-00-00-000-dddd';
  seedEmptyStandaloneRun(runId);
  const { body } = await getJson('/api/agents/empty/history');
  const rows = (body as { rows: { id: string; costUsd: number | null; status: string }[] }).rows;
  const row = rows.find((r) => r.id === runId);
  assert.ok(row);
  assert.equal(row!.status, 'running');
  assert.equal(row!.costUsd, null, `an in-flight run with no end event has NO recorded cost yet — costUsd must be null, not 0 (got ${JSON.stringify(row!.costUsd)})`);
});

// ---------------------------------------------------------------------------
// (Shared-derivation) — the EXTRACTED standalone status/cost math must be
// reused by BOTH GET /api/agents/runs/<runId> (existing) and this route
// (new), never duplicated.
// ---------------------------------------------------------------------------

test('SHARED DERIVATION: GET /api/agents/runs/<runId> and this row inside GET /api/agents/:slug/history report BYTE-IDENTICAL status+cost for the SAME real run', async () => {
  // KILLS: an implementer who writes a SECOND, independent copy of the
  // status/cost derivation for the new route instead of extracting and
  // reusing the existing one (cli/ui-bridge.ts ~1139-1178). Two independently
  // written copies can agree today and silently drift on the next edit to
  // either one — this test can only be satisfied by ONE shared function.
  const runId = '_agent-shared-2026-04-01T00-00-00-000-eeee';
  seedStandaloneRun(runId, 'shared', 6.66);

  const single = await getJson(`/api/agents/runs/${runId}`);
  assert.equal(single.status, 200);
  const singleBody = single.body as { state: string; costUsd: number };

  const history = await getJson('/api/agents/shared/history');
  const rows = (history.body as { rows: { id: string; status: string; costUsd: number | null }[] }).rows;
  const row = rows.find((r) => r.id === runId);
  assert.ok(row, `expected a standalone row for ${runId}`);

  assert.equal(row!.costUsd, singleBody.costUsd, 'cost must be byte-identical between the two routes for the same run');
  // The single-run route's own vocabulary ('running'|'done'|'failed'|
  // 'suppressed'|'budget-exceeded') is exactly D12's standalone vocabulary —
  // the SAME field, not translated.
  assert.equal(row!.status, singleBody.state, 'status must be byte-identical (same vocabulary, same value) between the two routes for the same run');
});

// ---------------------------------------------------------------------------
// SESSION join
// ---------------------------------------------------------------------------

test('SESSION: a real architect session appears with linkKind "session", href from session-kinds.yaml\'s legacyRoutes, and its OWN phase/cost', async () => {
  seedArchitectSession('proj-alpha', '2026-05-01T00-00-00-sess-a', 'committed', 3.33);
  const { status, body } = await getJson('/api/agents/architect/history');
  assert.equal(status, 200);
  const rows = (body as { id: string; linkKind: string; href: string; status: string; costUsd: number | null }[] & { rows: unknown[] })['rows'] as
    { id: string; linkKind: string; href: string; status: string; costUsd: number | null }[];
  const row = rows.find((r) => r.id === '2026-05-01T00-00-00-sess-a');
  assert.ok(row, `expected a session row, got ${JSON.stringify(rows)}`);
  assert.equal(row!.linkKind, 'session');
  assert.equal(row!.href, '/architect/2026-05-01T00-00-00-sess-a');
  assert.equal(row!.status, 'committed', 'session status is the session\'s OWN status.json phase string verbatim — D12, no cross-vocabulary mapping');
  assert.equal(row!.costUsd, 3.33);
});

test('SESSION: two sessions in DIFFERENT projects both appear — the enumeration is not scoped to one hardcoded project', async () => {
  seedArchitectSession('proj-beta', '2026-05-02T00-00-00-sess-b', 'drafting', 1.0);
  const { body } = await getJson('/api/agents/architect/history');
  const rows = (body as { rows: { id: string }[] }).rows;
  const ids = rows.map((r) => r.id);
  assert.ok(ids.includes('2026-05-01T00-00-00-sess-a'), 'the proj-alpha session from the previous test is still present');
  assert.ok(ids.includes('2026-05-02T00-00-00-sess-b'), 'the proj-beta session also appears');
});

test('SESSION: honest-absent cost — a session with no log dir at all reports costUsd: null, never a fabricated 0', async () => {
  seedArchitectSession('proj-gamma', '2026-05-03T00-00-00-sess-c', 'interviewing', null);
  const { body } = await getJson('/api/agents/architect/history');
  const rows = (body as { rows: { id: string; costUsd: number | null; status: string }[] }).rows;
  const row = rows.find((r) => r.id === '2026-05-03T00-00-00-sess-c');
  assert.ok(row);
  assert.equal(row!.status, 'interviewing');
  assert.equal(row!.costUsd, null);
});

// ---------------------------------------------------------------------------
// D12 — no cross-vocabulary status mapping
// ---------------------------------------------------------------------------

test("D12: a session's own phase string ('interviewing') is never coerced into a RunStatus/RunPhaseStatus literal — there is no honest RunStatus for it", async () => {
  // KILLS: a mapping table that squeezes session phases into
  // RunStatus/RunPhaseStatus ('planned'|'active'|'gated'|'complete'|'failed'
  // / 'pending'|'active'|'complete'|'retrying'|'failed') — 'interviewing' is
  // none of those, and forcing it to the nearest lookalike ('active') would
  // be a false claim (D12: "mapping across vocabularies is a false claim").
  const { body } = await getJson('/api/agents/architect/history');
  const rows = (body as { rows: { id: string; status: string }[] }).rows;
  const row = rows.find((r) => r.id === '2026-05-03T00-00-00-sess-c');
  assert.ok(row);
  assert.equal(row!.status, 'interviewing', `must carry the session's own literal phase string verbatim, not a mapped RunStatus (got "${row!.status}")`);
});

// ---------------------------------------------------------------------------
// D5 — the slug is a FILTER, never a path segment
//
// ⚑ ROUND 2 FIX (was VACUOUS): every test in the battery below passed on
// ROUND 1's HEAD for the WRONG reason — the route did not exist, so EVERY
// request (evil slug or not) 404s via the bridge's generic unmatched-route
// fallback. "Must not 500" and "must not contain the sentinel" are both
// trivially true when nothing ever runs; that is "passing by accident", the
// textbook symptom of an oracle that was never actually exercised. Round 1
// itself said as much in its own header ("proved the real mechanism in a
// scratch script OUTSIDE the repo" — the proof was never IN the gate).
//
// THE FIX asserts INDISTINGUISHABILITY instead: a traversal-shaped slug's
// response must be BYTE-IDENTICAL (after canonicalizing away anything a
// correct implementation could legitimately vary run-to-run, e.g. a future
// request-scoped id) to the response for an ordinary, well-formed-but-
// unknown slug. This is STRICTLY STRONGER than "no 500 / no visible leak":
// it also catches an implementation that returns SOME non-empty, non-
// leaking-text row shape for an evil slug (e.g. a directory LISTING of
// whatever the resolved path happened to contain) — a failure mode the old
// battery's two assertions would have missed entirely, since neither checks
// rows.length or the response shape, only "no 500" / "no substring".
//
// VERIFIED BY EXECUTION (three temporary mutations into cli/ui-bridge.ts,
// run via `node --test --experimental-strip-types`, then reverted with `git
// checkout` and confirmed byte-identical via `cmp` — see the task report for
// the full transcript, exit codes, and grep-confirmed mutation evidence):
//   1. RED on HEAD (route doesn't exist): status is 404, not 200 — fails the
//      FIRST assertion (`res.status === 200`) for every evil slug.
//   2. RED against a LEAKY implementation — `readFileSync(join(logsRoot,
//      slug), 'utf8')` (a raw, un-prefixed join: exactly what an
//      implementer reaching for "just read whatever this resolves to" would
//      write) — for slug `'../SECRET-OUTSIDE-LOGS.txt'` this resolves to
//      the real canary file and returns its content in `rows`, which
//      differs from the empty-rows baseline. RED.
//   3. RED against a 500-ON-TRAVERSAL implementation — one that treats any
//      readdir error OTHER than ENOENT (e.g. ENOTDIR, hit when the resolved
//      path exists but is a FILE not a directory) as an anomaly and 500s.
//      For slug `'../../../../../../etc/passwd'` the resolved path (from
//      this fixture's tmpdir-nested forgeRoot) is a REAL file
//      (`/etc/passwd` on this Linux box), so `readdirSync` throws ENOTDIR —
//      caught, reported as 500. RED (status !== 200).
//
// Two exact-filename variants deliberately included (with and without the
// `.txt` extension): executed proof showed a NAIVE `join(logsRoot, slug)`
// implementation only actually leaks the canary when the slug matches the
// canary's REAL on-disk name byte-for-byte including its extension — a
// traversal slug that's merely "shaped like" a path escape but doesn't
// resolve to a real file only proves the response doesn't 500, not that the
// canary specifically can never leak. Both variants close that gap.
const TRAVERSAL_SLUGS = [
  '../SECRET-OUTSIDE-LOGS.txt', '../SECRET-OUTSIDE-LOGS', '..',
  '../../../../../../etc/passwd', 'a/../../SECRET-OUTSIDE-LOGS.txt', 'a/b',
  '..%2fSECRET-OUTSIDE-LOGS.txt',
];

/** Strip anything a CORRECT implementation could legitimately vary
 *  run-to-run before a structural deepEqual — there is nothing to strip in
 *  today's `{ok, rows:[]}` empty shape, but this stays generic on purpose:
 *  a future response carrying a request-scoped id/timestamp must not defeat
 *  the comparison by accident. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'requestId' || k === 'timestamp' || /At$/i.test(k)) { out[k] = 'NORMALIZED'; continue; }
      out[k] = canonicalize(v);
    }
    return out;
  }
  return value;
}

test('D5 (ROUND 2 baseline): a well-formed-but-unknown slug is the reference point every traversal-shaped slug below must be indistinguishable from — 200, {ok:true, rows:[]}', async () => {
  const { status, body } = await getJson('/api/agents/well-formed-unknown-baseline-slug/history');
  assert.equal(status, 200);
  assert.deepEqual(canonicalize(body), { ok: true, rows: [] });
});

for (const evilSlug of TRAVERSAL_SLUGS) {
  test(`D5 (ROUND 2, INDISTINGUISHABILITY): a traversal-shaped slug (${JSON.stringify(evilSlug)}) is BYTE-IDENTICAL to the well-formed-but-unknown-slug baseline — 200, empty rows, never merely "no visible leak, no 500"`, async () => {
    // KILLS: `readdirSync(join(logsRoot, '_agent-' + slug))` or any other
    // path JOIN built from the raw slug — the filter-over-enumerated-entries
    // design (D5) never constructs a new path from caller input at all, so
    // no traversal shape can reach outside `_logs/`. ALSO kills a "safe but
    // different" implementation that avoids a literal leak/500 but still
    // returns a shape that isn't the honest, ordinary "unknown agent"
    // answer (e.g. a non-empty rows array, a different status, an
    // additional field) — the old battery's two assertions (no-500,
    // no-substring) could not see this class of divergence at all.
    const baseline = await getJson('/api/agents/well-formed-unknown-baseline-slug/history');
    const res = await fetch(`${url}/api/agents/${encodeURIComponent(evilSlug)}/history`);
    assert.equal(res.status, 200, `evil slug ${JSON.stringify(evilSlug)} must resolve 200, exactly like an ordinary unknown slug (baseline was ${baseline.status})`);
    const body = await res.json();
    assert.deepEqual(
      canonicalize(body),
      canonicalize(baseline.body),
      `evil slug ${JSON.stringify(evilSlug)} produced a response that DIFFERS from the well-formed-unknown baseline: ${JSON.stringify(body)} vs ${JSON.stringify(baseline.body)}`,
    );
    // Belt-and-suspenders (ROUND 1's own proofs, kept — not redundant: they
    // give a MORE SPECIFIC failure message than a generic deepEqual diff
    // would for these two particular failure shapes).
    assert.notEqual(res.status, 500, `must not 500 for slug ${JSON.stringify(evilSlug)}`);
    const text = JSON.stringify(body);
    assert.ok(!text.includes('SENTINEL-9f3a-must-never-leak'), `response for slug ${JSON.stringify(evilSlug)} must never contain the outside-_logs canary — got: ${text.slice(0, 300)}`);
    assert.ok(!text.includes(forgeRoot), `response must never echo the real forgeRoot filesystem path — got: ${text.slice(0, 300)}`);
  });
}

test('D5: after every traversal probe above, the route is still healthy for a normal, safe slug (no crash leaked state)', async () => {
  const { status, body } = await getJson('/api/agents/probe/history');
  assert.equal(status, 200);
  assert.ok(Array.isArray((body as { rows: unknown[] }).rows));
});
