/**
 * ACCEPTANCE TESTS (T3, R2-08-F4) — the trigger-provenance READ API, driven
 * at the REAL bridge routes (not by calling handler functions directly).
 *
 * Pins two surfaces (docs/roadmaps/R2-runnable-componentry.md R2-08-F4 +
 * docs/decisions/027-studio-object-model.md "Run-model trigger provenance"):
 *
 *  1. The EXISTING `GET /api/runs` / `GET /api/runs/<id>` routes
 *     (cli/bridge-studio.ts:9-12) must surface `run.trigger` for a
 *     triggered run and omit it for one without — no new route for this
 *     half.
 *  2. A NEW `GET /api/triggers` standing-declarations read: every declared
 *     `FlowTrigger` across every registered flow, plus the flow id that
 *     declared it (`sourceFlowId` — not carried on `FlowTrigger` itself),
 *     with `projects: null` (unscoped) kept distinct from `projects: []`
 *     (scoped to nothing) on the wire — `orchestrator/studio/types.ts`'s
 *     `FlowTrigger.projects` is `string[] | undefined`; `undefined` must
 *     serialize as JSON `null`, never be collapsed with `[]`.
 *
 * `GET /api/triggers` does not exist at all on dcbfee0f (HEAD at pin time)
 * — grep of cli/*.ts confirms no route matches that path — so every
 * `/api/triggers` assertion here is RED by construction (404/fallthrough)
 * until F4 adds the route. The `/api/runs` assertions are RED because
 * `Run` carries no `trigger` field (orchestrator/run-model.test.ts's sibling
 * file, orchestrator/trigger-provenance.test.ts, pins the same gap at the
 * derivation layer; this file pins it at the wire/HTTP layer).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { mintTriggeredInitiative } from '@forge/flows/mint-triggered-initiative.ts';
import { buildCronFlowRunRequest } from '../orchestrator/test-fixtures/flow-run-request.ts';
import type { FlowRunRequest } from '@forge/flows/flow-run-requests.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const PLAIN_INIT_ID = 'INIT-TEST-PLAIN-001';
const PLAIN_CYCLE_ID = '2026-05-30T22-45-07_INIT-TEST-PLAIN-001';

function makePlainManifest(): string {
  return [
    '---',
    `initiative_id: ${PLAIN_INIT_ID}`,
    'project: test-project',
    'project_repo_path: /tmp/test-project',
    'origin: architect',
    'created_at: 2026-05-30T22:45:00.000Z',
    'iteration_budget: 5',
    'cost_budget_usd: 2.0',
    `cycle_id: ${PLAIN_CYCLE_ID}`,
    'flow_id: forge-develop',
    '---',
    '',
    '# Plain architect-originated run',
    '',
    'No trigger provenance.',
  ].join('\n');
}

function makePlainEventsJsonl(): string {
  const baseEvent = { cycle_id: PLAIN_CYCLE_ID, initiative_id: PLAIN_INIT_ID, input_refs: [], output_refs: [] };
  const events = [
    { ...baseEvent, event_id: 'EV_001', phase: 'orchestrator', skill: 'cycle', event_type: 'start', started_at: '2026-05-30T22:45:07.000Z', message: 'cycle.start', metadata: { origin: 'architect' } },
    { ...baseEvent, event_id: 'EV_002', phase: 'architect', skill: 'architect', event_type: 'start', started_at: '2026-05-30T22:45:10.000Z' },
    { ...baseEvent, event_id: 'EV_003', phase: 'architect', skill: 'architect', event_type: 'end', started_at: '2026-05-30T22:45:15.000Z' },
    { ...baseEvent, event_id: 'EV_004', phase: 'orchestrator', skill: 'cycle', event_type: 'end', started_at: '2026-05-30T23:00:00.000Z', message: 'cycle.end', metadata: { status: 'complete' } },
  ];
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

/** A minimal, loadable FlowDefinition, optionally carrying trigger declarations. */
function flowYaml(opts: { id: string; project: string | null; triggersYaml?: string[] }): string {
  const projectLine = opts.project === null ? 'project: null' : `project: ${opts.project}`;
  const lines = [
    `id: ${opts.id}`,
    `name: ${opts.id}`,
    'version: 1',
    'goal: R2-08-F4 read-API test fixture.',
    projectLine,
    'kb: null',
    'costCeilingUsd: 5',
    'origin: seed',
    'nodes:',
    '  - { id: dev, agent: developer-ralph }',
    'edges: []',
  ];
  if (opts.triggersYaml && opts.triggersYaml.length > 0) {
    lines.push('triggers:', ...opts.triggersYaml);
  } else {
    lines.push('triggers: []');
  }
  return lines.join('\n') + '\n';
}

function planFlow(root: string, id: string, opts: { project: string | null; triggersYaml?: string[] }): void {
  const dir = join(root, 'studio', 'flows', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'flow.yaml'), flowYaml({ id, ...opts }));
}

/** Recursively list every file under root, as paths relative to root, sorted. */
function listAllFilesRec(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string, prefix: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), rel);
      else out.push(rel);
    }
  }
  walk(root, '');
  return out.sort();
}

// ---------------------------------------------------------------------------
// Global fixtures
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;
let triggeredInitiativeId: string;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-triggers-'));

  // -- a plain, non-triggered architect run in _queue/done/ --
  mkdirSync(join(forgeRoot, '_queue', 'done'), { recursive: true });
  writeFileSync(join(forgeRoot, '_queue', 'done', `${PLAIN_INIT_ID}.md`), makePlainManifest());
  mkdirSync(join(forgeRoot, '_logs', PLAIN_CYCLE_ID), { recursive: true });
  writeFileSync(join(forgeRoot, '_logs', PLAIN_CYCLE_ID, 'events.jsonl'), makePlainEventsJsonl());

  // -- target flow for the minted triggered run --
  mkdirSync(join(forgeRoot, 'projects', 'test-project'), { recursive: true });
  planFlow(forgeRoot, 'worker-triggered', { project: 'test-project' });

  // -- a REAL triggered (minted) run via the real mintTriggeredInitiative --
  // forge-76y: built through the fixture builder (mirrors the real
  // cron-triggers.ts staging shape) rather than a hand-built literal, with an
  // explicit sourceFlowId override so `run.trigger.source` below stays
  // 'watcher-triggered' (deriveTriggerFields's cron arm now reads ONLY
  // sourceFlowId — the fallback that parsed it out of `triggeredBy` is gone).
  const req: FlowRunRequest = buildCronFlowRunRequest({
    target: { kind: 'flow', ref: 'worker-triggered' },
    triggeredBy: 'cron:watcher-triggered',
    sourceFlowId: 'watcher-triggered',
    payload: { kind: 'cron', schedule: '0 3 * * *', firedAt: new Date().toISOString() },
  });
  const mintResult = mintTriggeredInitiative(req, {
    forgeRoot,
    queueRoot: join(forgeRoot, '_queue'),
    logsRoot: join(forgeRoot, '_logs'),
  });
  assert.equal(mintResult.status, 'minted', `fixture mint failed: ${JSON.stringify(mintResult)}`);
  triggeredInitiativeId = mintResult.initiativeId!;

  // -- two standing-trigger declarations for GET /api/triggers --
  // flow-a: unscoped (no `projects:` key at all).
  planFlow(forgeRoot, 'flow-a', {
    project: null,
    triggersYaml: [
      '  - on: cron',
      "    schedule: '0 3 * * *'",
      '    target: { kind: flow, ref: flow-a }',
    ],
  });
  // flow-b: scoped to nothing (`projects: []`) — must NOT read back as unscoped.
  planFlow(forgeRoot, 'flow-b', {
    project: null,
    triggersYaml: [
      '  - on: cron',
      "    schedule: '0 4 * * *'",
      '    target: { kind: flow, ref: flow-b }',
      '    projects: []',
    ],
  });

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
// Test 7 — GET /api/runs + GET /api/runs/<id> expose trigger for a triggered
// run, omit it for one without
// ---------------------------------------------------------------------------

test('GET /api/runs exposes trigger for the triggered run and omits it for the plain architect run', async () => {
  const res = await fetch(`${bridgeUrl}/api/runs`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { runs: Array<Record<string, unknown>> };

  const triggeredEntry = body.runs.find((r) => r.id === triggeredInitiativeId);
  assert.ok(triggeredEntry, `expected the minted run '${triggeredInitiativeId}' in the list — got ids: ${body.runs.map((r) => r.id).join(', ')}`);
  assert.ok(triggeredEntry!.trigger, `expected run.trigger on the triggered run, got ${JSON.stringify(triggeredEntry)}`);
  assert.equal((triggeredEntry!.trigger as { kind?: string }).kind, 'cron');

  const plainEntry = body.runs.find((r) => r.id === PLAIN_CYCLE_ID);
  assert.ok(plainEntry, `expected the plain run '${PLAIN_CYCLE_ID}' in the list — got ids: ${body.runs.map((r) => r.id).join(', ')}`);
  assert.equal('trigger' in plainEntry!, false, `plain architect run must not carry a trigger key, got ${JSON.stringify(plainEntry)}`);
});

test('GET /api/runs/<id> exposes trigger for the triggered run and omits it for the plain architect run', async () => {
  const triggeredRes = await fetch(`${bridgeUrl}/api/runs/${encodeURIComponent(triggeredInitiativeId)}`);
  assert.equal(triggeredRes.status, 200);
  const triggeredBody = (await triggeredRes.json()) as { run: Record<string, unknown> };
  assert.ok(triggeredBody.run.trigger, `expected run.trigger on GET /api/runs/<triggered-id>, got ${JSON.stringify(triggeredBody.run)}`);
  assert.equal((triggeredBody.run.trigger as { kind?: string }).kind, 'cron');
  assert.equal((triggeredBody.run.trigger as { source?: string }).source, 'watcher-triggered');

  const plainRes = await fetch(`${bridgeUrl}/api/runs/${encodeURIComponent(PLAIN_CYCLE_ID)}`);
  assert.equal(plainRes.status, 200);
  const plainBody = (await plainRes.json()) as { run: Record<string, unknown> };
  assert.equal('trigger' in plainBody.run, false, `plain architect run must not carry a trigger key on GET /api/runs/<id>, got ${JSON.stringify(plainBody.run)}`);
});

// ---------------------------------------------------------------------------
// Test 8 — GET /api/triggers: every declared trigger + sourceFlowId;
// projects: null (unscoped) vs projects: [] (scoped to nothing) preserved
// ---------------------------------------------------------------------------

test('GET /api/triggers lists every declared trigger with sourceFlowId, distinguishing projects: null from projects: []', async () => {
  const res = await fetch(`${bridgeUrl}/api/triggers`);
  assert.equal(res.status, 200, `expected 200 from GET /api/triggers (a NEW route this feature adds — currently unimplemented, 404s), got ${res.status}`);
  const body = (await res.json()) as { triggers: Array<{ on: string; target: { kind: string; ref: string }; projects: string[] | null; sourceFlowId: string }> };
  assert.ok(Array.isArray(body.triggers), `expected { triggers: [...] }, got ${JSON.stringify(body)}`);

  const rowA = body.triggers.find((t) => t.sourceFlowId === 'flow-a');
  assert.ok(rowA, `expected a row with sourceFlowId 'flow-a' — got ${JSON.stringify(body.triggers)}`);
  assert.equal(rowA!.on, 'cron');
  assert.deepEqual(rowA!.target, { kind: 'flow', ref: 'flow-a' });
  assert.equal(rowA!.projects, null, `flow-a declares no 'projects:' key at all — unscoped must read back as null (not undefined, not []), got ${JSON.stringify(rowA!.projects)}`);

  const rowB = body.triggers.find((t) => t.sourceFlowId === 'flow-b');
  assert.ok(rowB, `expected a row with sourceFlowId 'flow-b' — got ${JSON.stringify(body.triggers)}`);
  assert.deepEqual(rowB!.projects, [], `flow-b declares 'projects: []' (scoped to nothing) — must NOT collapse to null/unscoped, got ${JSON.stringify(rowB!.projects)}`);
  assert.notEqual(rowB!.projects, null, 'projects: [] must never read back as null — the two states are never collapsed (ADR-027 amendment)');
});

// ---------------------------------------------------------------------------
// Test 9 — GET /api/triggers is a pure READ: no write side effects, and a
// garbage query string never 500s
// ---------------------------------------------------------------------------

// GREEN-ON-ARRIVAL today (the route 404s, so trivially "no write" happens) —
// kept as a forward-looking regression pin: once F4 adds the route, this
// kills an implementation that caches/materializes the triggers listing (or
// any derived index) to disk on a GET, rather than deriving it purely from
// studio/flows/*/flow.yaml on every read (ADR-027's "no new stored object").
test('GET /api/triggers performs no write anywhere under forgeRoot', async () => {
  const before_ = listAllFilesRec(forgeRoot);
  const res = await fetch(`${bridgeUrl}/api/triggers`);
  void res; // status is asserted in the sibling test; here only the write-effect matters
  const after_ = listAllFilesRec(forgeRoot);
  assert.deepEqual(
    after_,
    before_,
    `GET /api/triggers must be a pure read — no new file may appear.\nbefore: ${JSON.stringify(before_)}\nafter:  ${JSON.stringify(after_)}`,
  );
});

// GREEN-ON-ARRIVAL today (404 !== 500, so trivially passes pre-implementation)
// — kept as a forward-looking regression pin: once F4 adds the route, this
// kills an implementation that crashes (uncaught throw -> 500) on an
// unexpected/malformed query parameter instead of ignoring it, mirroring
// every other route in this bridge's "never throws" contract
// (cli/bridge-studio.ts's own module doc: "Never throws — all errors
// caught, returned as JSON").
test('GET /api/triggers with an unknown/garbage query string never 500s', async () => {
  const res = await fetch(`${bridgeUrl}/api/triggers?${encodeURIComponent('!!not-a-real-param??')}=${encodeURIComponent('%ZZ-garbage-value')}`);
  // Read the body ONCE into a variable -- never inside an assertion's message
  // argument (message args are evaluated eagerly; a second body read on the
  // same Response throws "Body is unusable").
  const text = await res.text();
  assert.notEqual(res.status, 500, `a garbage query string must not crash the route -- got 500: ${text}`);
  assert.ok(res.status === 200 || (res.status >= 400 && res.status < 500), `expected 200 or a 4xx, got ${res.status}`);
});
