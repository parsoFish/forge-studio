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
 *   - ⚑ ROUND 3 (Amendment 1) — the above is NOT the only reachable identity
 *     shape. `POST /api/agents/:slug/run` (ui-bridge.ts:1332-1391) mints
 *     `runId` and, when materials are attached, SYNCHRONOUSLY (before the
 *     response is sent) `mkdirSync`s the run dir and emits exactly ONE `log`
 *     event of its own (`agent-run.materials-staged`, ui-bridge.ts:
 *     1370-1389): `skill: slug` at the top level, `metadata: {materials:
 *     [...]}` — NO `agent_slug` key anywhere. `spawnAgentDispatch`
 *     (ui-bridge.ts:1976) then returns BEFORE the child `agent dispatch`
 *     process is ever spawned whenever `FORGE_ARCHITECT_NO_SPAWN=1` —
 *     forge's OWN universal test/journey convention (this file's own
 *     `before()` below sets it; `scripts/e2e-journey.mjs`'s `startWatch`
 *     sets it on every bridge any journey ever drives) — so `runAgent`'s
 *     start/end events (the ones carrying `metadata.agent_slug`) NEVER get
 *     written for a run produced this way. Measured for REAL by
 *     `scripts/journeys/agents.mjs`'s `agents-kickoff-dispatch` beat (a real
 *     browser click through a real bridge, not a fixture) — see that file's
 *     "LOUD FINDING" comment. See the amended D4 below.
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
 *   D4  — ⚑ AMENDED ROUND 3: standalone identity is exact equality against
 *         the run's OWN events on EITHER `metadata.agent_slug` OR `skill`
 *         (both are producer-set fields on that run's own log; both are
 *         identity, not membership) — NEVER a runId-prefix/substring match
 *         (the 'probe' vs 'probe-x' alias trap below, and its skill-only-
 *         shape sibling, are THE tests for this). The original round-1/2
 *         language pinned `metadata.agent_slug` as the SOLE source; round 3
 *         found (via `scripts/journeys/agents.mjs`'s real, un-fixtured
 *         `agents-kickoff-dispatch` run) that this makes a real dispatch
 *         structurally invisible in its own history — a test that encoded
 *         that would pin the defect as the contract. `skill` is now an
 *         equally-valid identity source, exact-match only.
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
import { request as httpRequest } from 'node:http';

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

/**
 * ⚑ ROUND 4 (Amendment 1) — verbatim copy of the `architect` descriptor from
 * the REAL `studio/session-kinds.yaml` (read from this repo before writing
 * this file) — the ONLY session-kind descriptor the SESSION tests below
 * exercise. `loadSessionKinds` (orchestrator/studio/session-kinds.ts) THROWS
 * when this file is absent — this fixture never seeded it, so
 * `collectSessionRows` (cli/ui-bridge.ts) could only resolve the 'architect'
 * agent -> session kind via a hand-maintained `FALLBACK_SESSION_KINDS` table
 * an implementer added purely to fit this gap: a second, independently
 * drifting copy of declared data this project forbids outright (no
 * fallbacks — CLAUDE.md "Never do"). Seeding the REAL registry here (same
 * precedent as `cli/bridge-studio-sessions.test.ts`'s `writeSessionKindsYaml`
 * and `cli/studio-lint.test.ts`'s `tmpRoot`, both of which seed a real
 * `studio/session-kinds.yaml` into their synthetic forgeRoot rather than
 * relying on any fallback) closes the gap the fallback was built for, so it
 * can be deleted. Mirrors this file's own `FORGE_ARCHITECT_FLOW_YAML`
 * verbatim-copy convention immediately above.
 */
const SESSION_KINDS_YAML = `- id: architect
  agent: architect
  title: Planning session
  legacyRoutes:
    - /architect/[sessionId]
    - /architect/[sessionId]/interview
  stages: [roadmap]
  defaultStage: roadmap
  artifact:
    kind: roadmap-draft
    label: Roadmap draft
`;

function seedSessionKindsYaml(): void {
  const dir = join(forgeRoot, 'studio');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session-kinds.yaml'), SESSION_KINDS_YAML);
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
 *  the SAME `metadata.agent_slug` plus a top-level `cost_usd`. This is the
 *  shape a genuinely UNSUPPRESSED production spawn produces (both `skill`
 *  AND `metadata.agent_slug` present, per `runAgent`'s own `logger.emit`
 *  calls) — none of this repo's own test/journey harnesses ever reach it
 *  (they all set `FORGE_ARCHITECT_NO_SPAWN=1`), but it is real production
 *  ground, not hypothetical, so it stays pinned. See
 *  `seedSuppressedMaterialsOnlyRun` below for the OTHER reachable shape —
 *  the one this repo's own harnesses (including this file) actually
 *  produce. */
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

/** ⚑ ROUND 3 (Amendment 2) — round 1's original `seedEmptyStandaloneRun`
 *  (a run dir with LITERALLY ZERO events) is REMOVED here, not kept. It was
 *  measured to be unreachable through `POST /api/agents/:slug/run` under
 *  `FORGE_ARCHITECT_NO_SPAWN=1` — forge's own universal test/journey
 *  convention (this file's `before()` sets it; every journey harness sets
 *  it too; see the header comment above). Concretely, from
 *  `cli/ui-bridge.ts`:
 *    - WITHOUT materials: the route never `mkdirSync`s a run dir at all —
 *      that call lives inside `if (materialsValidation.entries.length > 0)`
 *      (ui-bridge.ts:1341-1362). `spawnAgentDispatch`'s OWN `mkdirSync`
 *      (line 1984) is also unreached: its `FORGE_ARCHITECT_NO_SPAWN`
 *      early-return (line 1976) fires first. Net: no directory, ever.
 *    - WITH materials: `mkdirSync(runDir)`, `stageMaterials`, and the ONE
 *      `agent-run.materials-staged` `log` event (lines 1341-1389) all run
 *      SYNCHRONOUSLY in the SAME request handler, before the 200 response
 *      is ever sent (line 1392). By the time any client — including a
 *      concurrent `/history` poll — could observe the directory, it
 *      already has exactly one event. There is no window, racy or
 *      otherwise, where the directory exists with zero events under this
 *      env convention.
 *  A truly zero-event directory IS possible in a genuinely unsuppressed
 *  production spawn (`FORGE_ARCHITECT_NO_SPAWN` unset) — `spawnAgentDispatch`
 *  itself `mkdirSync`s the dir synchronously (line 1984) before handing off
 *  to a DETACHED child process that writes its first event asynchronously
 *  moments later — but reproducing that here would mean actually spawning a
 *  real Claude Code process, which no test or journey in this repo does.
 *  Pinning the old zero-event fixture would therefore pin a state that
 *  cannot exist under this repo's own operating convention — a fixture that
 *  could never exist teaches an implementer the wrong contract. Regrounded
 *  below on the state that IS reachable: exactly one materials-staged event,
 *  no `end` — a real suppressed run where cost genuinely IS absent. */

/** A REAL, reachable suppressed-standalone run: `_logs/<runId>/events.jsonl`
 *  with EXACTLY the one `agent-run.materials-staged` `log` event
 *  `POST /api/agents/:slug/run` itself writes when materials are attached
 *  (ui-bridge.ts:1370-1389) and nothing else — no `start`, no `end`. Carries
 *  identity via `skill: agentSlug` ONLY; `metadata` has no `agent_slug` key
 *  at all, mirroring the real shape `scripts/journeys/agents.mjs`'s
 *  `agents-kickoff-dispatch` beat measured off a real browser-driven
 *  dispatch (its own "LOUD FINDING" comment). */
function seedSuppressedMaterialsOnlyRun(runId: string, agentSlug: string): void {
  const dir = join(forgeRoot, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  const event = {
    event_id: 'EV_0', cycle_id: runId, initiative_id: runId, phase: 'orchestrator', skill: agentSlug,
    event_type: 'log', started_at: '2026-01-01T00:00:00.000Z',
    input_refs: ['materials/example.md'], output_refs: [],
    message: 'agent-run.materials-staged',
    metadata: { materials: [{ path: 'materials/example.md', kind: 'documents' }] },
  };
  writeFileSync(join(dir, 'events.jsonl'), JSON.stringify(event) + '\n');
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

/**
 * ⚑ ROUND 4 (Amendment 2) — sends a raw HTTP GET with the EXACT path bytes
 * given, bypassing WHATWG URL / undici `fetch()` entirely, so client-side
 * RFC-3986 dot-segment normalisation never runs. `fetch()` collapses
 * `/api/agents/../history` to `/api/history` BEFORE the request ever leaves
 * the process — the server never sees the `..` segment — so a `..`-shaped
 * slug can only be delivered to the REAL `/api/agents/:slug/history` route
 * with a client that puts the path on the wire unmodified. Node's low-level
 * `http.request({ path })` does exactly that (same precedent as
 * `cli/ui-bridge-demo-generations.test.ts`'s `rawGet` and
 * `cli/dry-bridge.test.ts`'s raw-request idiom — read both before writing
 * this). Returns the raw text (not pre-parsed JSON) so a non-200/non-JSON
 * body can still be inspected by the caller.
 */
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
  seedSessionKindsYaml();

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

test('AMENDMENT 1+2: a REAL, reachable suppressed-standalone run — identity via `skill` ONLY (no `metadata.agent_slug` anywhere) — is found in its own agent\'s history, with the honest-absent costUsd: null and status "running" (never a fabricated 0)', async () => {
  // KILLS (Amendment 1, THE headline fix): any implementation that keys
  // standalone identity STRICTLY off `metadata.agent_slug` — the ORIGINAL
  // D4 language this round amends. This run's `metadata` is
  // `{materials:[...]}` only; there is no `agent_slug` key on its one and
  // only event. A metadata.agent_slug-only reader finds ZERO matching
  // events for slug 'matonly' and the row is silently absent — exactly the
  // defect `scripts/journeys/agents.mjs`'s `agents-kickoff-dispatch` beat
  // measured off a REAL browser-driven dispatch (not a hypothetical; see
  // its "LOUD FINDING" comment). Only an implementation reading
  // `metadata.agent_slug` OR `skill` passes.
  // KILLS (Amendment 2, honest-absent cost, reachable ground): a fabricated
  // 0 instead of null for a run with no `end` event — this run genuinely
  // has not finished (one bookkeeping `log` event only, no terminal event
  // of any kind), so reporting 0 would misreport "spent nothing and
  // finished" for a run that hasn't finished. Unlike round 1's removed
  // zero-event fixture, THIS state is deterministically reachable through
  // the real route (see `seedSuppressedMaterialsOnlyRun`'s doc comment) —
  // no fabricated fixture, no race required.
  const runId = '_agent-matonly-2026-06-01T00-00-00-000-ffff';
  seedSuppressedMaterialsOnlyRun(runId, 'matonly');
  const { status, body } = await getJson('/api/agents/matonly/history');
  assert.equal(status, 200);
  const rows = (body as { rows: { id: string; linkKind: string; costUsd: number | null; status: string }[] }).rows;
  const row = rows.find((r) => r.id === runId);
  assert.ok(row, `expected the skill-only run to be found by slug 'matonly' — metadata.agent_slug is absent on this run's ONLY event, got rows ${JSON.stringify(rows)}`);
  assert.equal(row!.linkKind, 'standalone');
  assert.equal(row!.status, 'running', 'no end event landed yet — the honest non-terminal status');
  assert.equal(row!.costUsd, null, `no end event landed yet — costUsd must be null, not a fabricated 0 (got ${JSON.stringify(row!.costUsd)})`);
});

test('AMENDMENT 1 ALIAS TRAP (skill-only shape): a skill-only run for "skalias-x" must not bleed into "skalias"\'s history, even though its runId starts with "_agent-skalias-" — proves prefix-matching stays banned on the `skill` identity source too, not just `metadata.agent_slug`', async () => {
  // KILLS: `event.skill.startsWith(slug)` (or `runId.startsWith('_agent-'+
  // slug+'-')`) applied to the skill-only shape specifically. An
  // implementer could plausibly write CORRECT exact-match on
  // `metadata.agent_slug` (passing the original alias trap below) but
  // sloppy prefix logic on the `skill` fallback added for Amendment 1,
  // since the skill-only path is the newer, less-battle-tested code path.
  // Exact match on BOTH identity sources is the only implementation that
  // passes this AND its positive-control sibling.
  const skAliasRunId = '_agent-skalias-2026-06-02T00-00-00-000-1111';
  const skAliasXRunId = '_agent-skalias-x-2026-06-02T00-05-00-000-2222';
  seedSuppressedMaterialsOnlyRun(skAliasRunId, 'skalias');
  seedSuppressedMaterialsOnlyRun(skAliasXRunId, 'skalias-x');

  const { body } = await getJson('/api/agents/skalias/history');
  const rows = (body as { rows: { id: string }[] }).rows;
  const ids = rows.map((r) => r.id);
  assert.ok(ids.includes(skAliasRunId), `expected 'skalias's own run in its history, got ${JSON.stringify(ids)}`);
  assert.ok(!ids.includes(skAliasXRunId), `'skalias-x's run must NEVER appear in 'skalias's history (skill-only alias trap) — got ${JSON.stringify(ids)}`);
});

test('AMENDMENT 1 positive control (skill-only shape): agent "skalias-x" queried directly DOES see its own run (proves the skill-only filter isn\'t just refusing everything)', async () => {
  const skAliasXRunId = '_agent-skalias-x-2026-06-02T00-05-00-000-2222';
  const { body } = await getJson('/api/agents/skalias-x/history');
  const rows = (body as { rows: { id: string }[] }).rows;
  assert.ok(rows.some((r) => r.id === skAliasXRunId), `expected 'skalias-x' to see its own run, got ${JSON.stringify(rows)}`);
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
//
// ⚑ ROUND 4 (Amendment 2) — the bare `'..'` slug is REMOVED from this array,
// not kept: `encodeURIComponent('..')` is `'..'` unchanged, so the fetch()
// URL below is `/api/agents/../history` — THREE path segments (`api`,
// `agents`, `..`), and WHATWG URL / undici's fetch() applies RFC-3986
// dot-segment removal CLIENT-SIDE before the request ever leaves the
// process, collapsing that to `/api/history`. The real
// `/api/agents/:slug/history` route is therefore structurally unreachable
// through fetch() for this one slug shape — the loop below was "passing" for
// it only because an implementer added a three-line handler for the literal
// path `/api/history` to catch the collapsed request, dead undocumented
// surface invented to satisfy a client artifact, not because the real
// slug-filter route was ever exercised. Re-grounded below (immediately after
// the loop) as a dedicated raw-wire test using `rawGet`, which puts the
// un-normalized bytes `GET /api/agents/../history` on the wire directly —
// the only way to actually ask the real route the question.
const TRAVERSAL_SLUGS = [
  '../SECRET-OUTSIDE-LOGS.txt', '../SECRET-OUTSIDE-LOGS',
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
    // ⚑ AMENDED W7-B5 (agents-02): the route now validates the slug SHAPE
    // (SAFE_AGENT_SLUG_RE, the same validator POST /run always applied) and
    // 400s anything failing it — the walkthrough found the 200-for-anything
    // answer hid a client bug firing `GET /api/agents//history` on every
    // mount. INDISTINGUISHABILITY is preserved WITHIN the invalid-shape
    // class: every traversal shape must be BYTE-IDENTICAL (status + body
    // structure) to a harmless shape-invalid baseline — a traversal probe
    // still learns nothing an underscore typo wouldn't. Valid-shaped
    // unknown slugs keep their 200-empty answer (pinned elsewhere in this
    // file), and the sentinel/forgeRoot leak checks below are unchanged.
    const invalidBaseline = await fetch(`${url}/api/agents/${encodeURIComponent('Bad_Slug')}/history`);
    const invalidBaselineBody = await invalidBaseline.json() as Record<string, unknown>;
    assert.equal(invalidBaseline.status, 400, 'sanity: the harmless shape-invalid baseline is a 400');
    const res = await fetch(`${url}/api/agents/${encodeURIComponent(evilSlug)}/history`);
    assert.equal(res.status, 400, `evil slug ${JSON.stringify(evilSlug)} must resolve 400, exactly like any other shape-invalid slug`);
    const body = await res.json() as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(canonicalize(body) as Record<string, unknown>),
      Object.keys(canonicalize(invalidBaselineBody) as Record<string, unknown>),
      `evil slug ${JSON.stringify(evilSlug)} produced a response SHAPE that differs from the shape-invalid baseline`,
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

test("D5 (ROUND 4, RAW WIRE): the bare '..' slug — sent as genuinely UN-NORMALIZED bytes on the wire via a raw node:http request, NOT fetch() — is BYTE-IDENTICAL to the well-formed-but-unknown-slug baseline, through the REAL /api/agents/:slug/history route, never a dedicated fake handler for the literal path /api/history", async () => {
  // KILLS: a hand-added handler matching the literal request path
  // `/api/history` (the shape `fetch('/api/agents/../history')` collapses
  // to client-side, per RFC-3986 dot-segment removal) — dead, undocumented
  // product surface invented ONLY because fetch() can never deliver the raw
  // `..` segment to the real route. This test sends the un-collapsed bytes
  // `GET /api/agents/../history` directly on the wire (Node's low-level
  // `http.request({ path })` puts the path string straight onto the request
  // line, unmodified — no WHATWG URL normalization involved), so it reaches
  // the REAL `url.startsWith('/api/agents/') && url.endsWith('/history')`
  // route with slug '..' — D5's filter-over-enumerated-entries design (never
  // a path join) then handles it exactly like any other unknown slug. A
  // literal-`/api/history`-matching handler is provably unnecessary: this
  // test passes with that handler deleted (see the task report's mutation
  // proof) precisely because the real route already answers this request
  // correctly on its own.
  // ⚑ AMENDED W7-B5 (agents-02): the raw '..' slug fails SAFE_AGENT_SLUG_RE
  // like every other shape-invalid slug → the SAME 400 class (see the
  // amended battery above). It still travels through the REAL
  // /api/agents/:slug/history route — no literal `/api/history` handler.
  const invalidBaseline = await fetch(`${url}/api/agents/${encodeURIComponent('Bad_Slug')}/history`);
  const invalidBaselineBody = await invalidBaseline.json() as Record<string, unknown>;
  const raw = await rawGet('/api/agents/../history');
  assert.equal(raw.status, 400, "raw un-normalized '..' slug must resolve 400 via the REAL /api/agents/:slug/history route, exactly like any other shape-invalid slug");
  const body = JSON.parse(raw.text) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(canonicalize(body) as Record<string, unknown>),
    Object.keys(canonicalize(invalidBaselineBody) as Record<string, unknown>),
    "raw wire '..' slug produced a response SHAPE that differs from the shape-invalid baseline",
  );
  // Belt-and-suspenders (same shape as the fetch-driven battery above).
  assert.notEqual(raw.status, 500, "must not 500 for the raw wire '..' slug");
  assert.ok(!raw.text.includes('SENTINEL-9f3a-must-never-leak'), `raw wire '..' slug response must never contain the outside-_logs canary — got: ${raw.text.slice(0, 300)}`);
  assert.ok(!raw.text.includes(forgeRoot), `raw wire '..' slug response must never echo the real forgeRoot filesystem path — got: ${raw.text.slice(0, 300)}`);
});

test('D5: after every traversal probe above, the route is still healthy for a normal, safe slug (no crash leaked state)', async () => {
  const { status, body } = await getJson('/api/agents/probe/history');
  assert.equal(status, 200);
  assert.ok(Array.isArray((body as { rows: unknown[] }).rows));
});

// ═══════════════════════════════════════════════════════════════════════
// ROUND 8 (history) — SHIPPED-BLIND DEFECT the round-trip capture below
// would have caught. 4074 node tests + 715 vitest tests + 825/826 journey
// checks were green while this route's real 200 response was rejected by
// the real client resolver on EVERY request: `forge-ui/lib/agent-ledger.ts`'s
// `isValidLedgerRow` required `when`/`what`/`narrativeKinds` on every row;
// this route emitted none of them — only the pre-existing
// `{id,linkKind,href,status,costUsd}` five. The 43 tests in
// `agent-ledger.test.ts` construct `LedgerRow` objects DIRECTLY (never
// through a captured wire body), and this file's own battery never fed a
// captured body through the client resolver either (it only asserted
// server-side shape) — the gap sat exactly at the seam between the two
// files, invisible to both.
//
// ROUND 10 — THE DEFECT IS NOW FIXED, not merely documented. The wire (see
// `AgentHistoryRow`, line ~789) now carries, ADDITIVELY, the raw per-path
// facts the client needs to derive `when`/`what`/`narrative` itself: the
// full `run`+`nodeId` for a flow-node row, `when`+`what` for a
// standalone/session row. The three tests below were the "ROUND 8 CAPTURE +
// DRIFT GUARD" battery — by construction (`assert.deepEqual(row,
// {5-field-literal})`, "and NOTHING ELSE") they went RED the instant the fix
// landed, because the fix's whole point is to add fields that literal
// forbids. That RED was correct behaviour, not a regression: it is this
// exact guard firing on a deliberate, intentional contract change. This
// round re-captures each literal LIVE against the fixed route (same
// discipline as round 8 — a real in-process bridge, a real HTTP request,
// never a hand-typed guess) and renames/re-comments each test to describe
// the CURRENT contract it now pins, not the historical defect. See each
// test's own comment for what specifically changed and why.
//
// The ROUND 8 "MIRRORED into agent-ledger.test.ts's own constants" claim
// below is now VOID and not replaced with an equivalent obligation: that
// file's `CAPTURED_TODAY_*` constants are frozen, on purpose, to the OLD
// five-field shape forever — they are the fixture for a NEGATIVE control
// ("a row shaped like the defect must still fail validation"), not a mirror
// of today's wire shape, so they never needed to change when this file's
// captures below did. Per this round's task instructions,
// `forge-ui/lib/agent-ledger.test.ts` is untouched (verified unmodified —
// see `git status` at the end of this round). This file still cannot import
// the client resolver directly: `forge-ui/lib/*.ts` uses extensionless
// relative imports (`from './bridge-client'`, no `.ts`), which Node's ESM
// loader — even under `--experimental-strip-types` — refuses to resolve
// outside forge-ui's own bundler-mode toolchain (verified directly in round
// 8: `node --experimental-strip-types` against a one-line script importing
// `forge-ui/lib/agent-ledger.ts` throws `ERR_MODULE_NOT_FOUND` on its own
// `./bridge-client` import) — unchanged this round, so the cross-file split
// stands.
// ═══════════════════════════════════════════════════════════════════════

test('CONTRACT (flow-node): the REAL /api/agents/:slug/history response for a flow-node run is the pre-existing {id,linkKind,href,status,costUsd} PLUS the full run+nodeId, and no other top-level key — captured live. `run` is asserted byte-identical to the SAME run as served by GET /api/runs (proves reuse of the real Run, not a second hand-rolled copy) rather than pinned to a frozen literal, because Run (orchestrator/run-model.ts) is a large, actively-growing type (flowLineage/trigger/findings/lastEventAt were each added in recent rounds) — freezing its full shape here would make this guard fail on every unrelated Run-type addition, not just on an actual regression of THIS route\'s own contract', async () => {
  const initId = 'INIT-r8-flow-1';
  const cycleId = `2026-01-01T00-00-00_${initId}`;
  seedManifest('done', initId, cycleId, 'forge-architect');
  seedEventsJsonl(cycleId, initId, [
    { phase: 'architect', event_type: 'start', started_at: '2026-07-01T09:00:00.000Z' },
    { phase: 'architect', event_type: 'end', started_at: '2026-07-01T09:05:00.000Z', cost_usd: 3.5 },
  ]);

  const { status, body } = await getJson('/api/agents/architect/history');
  assert.equal(status, 200);
  const rows = (body as { rows: Record<string, unknown>[] }).rows;
  const row = rows.find((r) => r.id === cycleId);
  assert.ok(row, `expected a flow-node row for ${cycleId}, got ${JSON.stringify(rows)}`);

  // Exact-shape discipline on the ENVELOPE: exactly these seven keys, never
  // more, never fewer. KILLS a regression back to the pre-fix five-field
  // shape (missing run/nodeId — the original defect returning) AND an
  // implementation that tacks on some OTHER stray field never declared by
  // `AgentHistoryRow`'s flow-node variant.
  assert.deepEqual(
    Object.keys(row!).sort(),
    ['costUsd', 'href', 'id', 'linkKind', 'nodeId', 'run', 'status'].sort(),
    `flow-node row has the wrong key set — got ${JSON.stringify(Object.keys(row!).sort())}`,
  );

  // Exact pin on every field this route computes ITSELF (never varies with
  // Run's own internal evolution) — same discipline as round 8, restated for
  // the current contract.
  assert.deepEqual({
    id: row!.id, linkKind: row!.linkKind, href: row!.href, status: row!.status, costUsd: row!.costUsd, nodeId: row!.nodeId,
  }, {
    id: cycleId, linkKind: 'flow-node', href: `/flows/forge-architect/run/${cycleId}`, status: 'complete', costUsd: 3.5, nodeId: 'architect',
  }, `flow-node row's own fields drifted: ${JSON.stringify(row)}`);

  // `run` is present and object-shaped (not a bare id/string reference).
  assert.ok(row!.run && typeof row!.run === 'object' && !Array.isArray(row!.run), `row.run must be a Run object, got ${JSON.stringify(row!.run)}`);
  const run = row!.run as Record<string, unknown>;

  // A handful of identity-critical facts pinned directly, for a sharp
  // failure message if the WRONG run ever got attached to this row.
  assert.equal(run['id'], cycleId, 'row.run.id must be the same run as row.id');
  assert.equal(run['flowId'], 'forge-architect', 'row.run.flowId must match the href it also drives');
  assert.equal((run['phases'] as Record<string, unknown> | undefined)?.['architect'], row!.status, "D9: the embedded run's own phases[nodeId] must agree with the row's flat status field — same fact, not two independently-computed answers");

  // THE reuse proof: GET /api/runs — the PRE-EXISTING Run-over-the-wire
  // route flow-ledger.ts's own client (fetchRuns) already consumes — must
  // serve the BYTE-IDENTICAL run object for this cycle. This is what
  // actually proves "reuses the real Run" rather than "assembled a
  // similar-looking one": an implementation that hand-trims or
  // re-derives its own partial Run for this route would diverge from
  // /api/runs's own answer and fail here, while a legitimate future Run
  // field addition changes BOTH sides identically and never fails this
  // check — the brittleness a frozen literal would have had is gone.
  const runsRes = await getJson('/api/runs');
  const runsRows = (runsRes.body as { runs: Record<string, unknown>[] }).runs;
  const canonicalRun = runsRows.find((r) => r.id === cycleId);
  assert.ok(canonicalRun, `expected GET /api/runs to include ${cycleId}, got ${JSON.stringify(runsRows.map((r) => r.id))}`);
  assert.deepEqual(row!.run, canonicalRun, `row.run must be byte-identical to GET /api/runs's own entry for ${cycleId} — a second, independently-built copy would drift here even if it looks similar today: ${JSON.stringify(row!.run)} vs ${JSON.stringify(canonicalRun)}`);
});

test('CONTRACT (standalone): the REAL /api/agents/:slug/history response for a standalone run is the pre-existing {id,linkKind,href,status,costUsd} PLUS `when` (the run\'s own first-event started_at) and `what` (the agent slug — the only honest fact a standalone run\'s own events carry, per ROUND 9\'s measurement) — and NOTHING ELSE. Captured live, not hand-written. Full deepEqual stays the right assertion here (unlike the flow-node row above): every field is a flat scalar this route computes/reads directly, none is a large, independently-evolving nested type', async () => {
  const runId = '_agent-r8solo-2026-07-02T00-00-00-000-r8r8';
  seedStandaloneRun(runId, 'r8solo', 6.25);

  const { status, body } = await getJson('/api/agents/r8solo/history');
  assert.equal(status, 200);
  const rows = (body as { rows: Record<string, unknown>[] }).rows;
  const row = rows.find((r) => r.id === runId);
  assert.ok(row, `expected a standalone row for ${runId}, got ${JSON.stringify(rows)}`);

  // KILLS: a regression back to the pre-fix five-field shape (the original
  // shipped-blind defect returning); a `when` sourced from anything other
  // than this run's own first event (e.g. "now", or the `end` event's
  // timestamp); a `what` that isn't the bare agent slug (e.g. a fabricated
  // description this run's events never actually carried); and any stray
  // extra field beyond these seven (deepEqual fails on either side having a
  // key the other lacks).
  assert.deepEqual(row, {
    id: runId, linkKind: 'standalone',
    href: `/agents/r8solo/run/${runId}`,
    status: 'done', costUsd: 6.25,
    when: '2026-01-01T00:00:00.000Z', what: 'r8solo',
  }, `captured standalone row drifted from the current contract: ${JSON.stringify(row)}`);
});

test('CONTRACT (session): the REAL /api/agents/:slug/history response for a session row is the pre-existing {id,linkKind,href,status,costUsd} PLUS `when` (the session\'s own first-event started_at from its `_<kind>-<sessionId>/events.jsonl` log dir) and `what` (the matching session-kind descriptor\'s own `title`, e.g. "Planning session") — and NOTHING ELSE. Captured live, not hand-written. Full deepEqual stays correct here for the same reason as the standalone row: every field is a flat scalar, nothing nested/growing', async () => {
  seedArchitectSession('proj-r8', '2026-07-03T00-00-00-sess-r8', 'drafting', 2.0);
  const { status, body } = await getJson('/api/agents/architect/history');
  assert.equal(status, 200);
  const rows = (body as { rows: Record<string, unknown>[] }).rows;
  const row = rows.find((r) => r.id === '2026-07-03T00-00-00-sess-r8');
  assert.ok(row, `expected a session row, got ${JSON.stringify(rows)}`);

  // KILLS: a regression back to the pre-fix five-field shape; a `when`
  // sourced from the session's status.json `updated_at` instead of the
  // log dir's own first event; a `what` that is the session id, the raw
  // session-kind id ('architect'), or any string other than the
  // descriptor's own human-readable `title`; and any stray extra field.
  assert.deepEqual(row, {
    id: '2026-07-03T00-00-00-sess-r8', linkKind: 'session',
    href: '/architect/2026-07-03T00-00-00-sess-r8',
    status: 'drafting', costUsd: 2.0,
    when: '2026-01-01T00:10:00.000Z', what: 'Planning session',
  }, `captured session row drifted from the current contract: ${JSON.stringify(row)}`);
});
