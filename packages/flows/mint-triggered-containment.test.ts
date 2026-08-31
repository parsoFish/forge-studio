/**
 * ACCEPTANCE TESTS (SEC-03, T3) — Defect 3: `mintTriggeredInitiative`
 * (orchestrator/mint-triggered-initiative.ts:97) bypasses the manifest
 * choke point. It writes a manifest with `serializeManifest` +
 * `writeFileSync` directly, never calling `writeManifest`
 * (orchestrator/manifest.ts:381) — the documented SINGLE place where
 * `assertManifestPathFields` (SEC-02, cli/manifest-path-guard.ts) validates
 * `worktree_path` / `project_repo_path` / `cycle_id` / `project`.
 *
 * MEASUREMENT (executed live before writing these tests, not assumed):
 *   1. `PUT /api/studio/flows/:id` accepts `body.project` VERBATIM as a
 *      string (cli/bridge-studio-writes.ts ~958-961) with NO shape/format
 *      validation anywhere — `validateFlow` never checks `flow.project`'s
 *      shape at all; `checkFlowTriggers`/`checkTargetProject`
 *      (orchestrator/studio/validate-triggers.ts) only requires it
 *      NON-NULL/NON-EMPTY when the flow is an external-trigger TARGET, never
 *      checks its characters. A real `PUT` with
 *      `project: "../../<outside-dir>"` returns 200 with ZERO findings and
 *      persists the literal traversal string into flow.yaml verbatim.
 *      Confirmed live:
 *        PUT /api/studio/flows/target-flow {project:"../../sec03-outside-x"}
 *        -> 200 {"ok":true,"id":"target-flow","version":1,"findings":[]}
 *        flow.yaml on disk: "project: ../../sec03-outside-x"
 *   2. `mintTriggeredInitiative` then does
 *        projectRepoPath = join(resolveProjectsDir(forgeRoot,cfg), flow.project)
 *      `path.join()` (NOT `path.resolve()`) normalises the ".." — so the
 *      escape shape that works here is a RELATIVE ".."-traversal (an
 *      absolute `flow.project` does NOT escape via `join()`; it nests as a
 *      relative segment instead — verified live, not assumed). With the
 *      target directory pre-existing (`existsSync` gate), the mint proceeded
 *      to `status:'minted'` and wrote a real manifest via `serializeManifest`
 *      + `writeFileSync` carrying:
 *        project: ../../sec03-outside-x
 *        project_repo_path: /tmp/sec03-outside-x   (genuinely outside forgeRoot)
 *      — completely bypassing `writeManifest`/`assertManifestPathFields`.
 *      That manifest lands in `_queue/pending/`, from which the SAME
 *      downstream sinks SEC-02 closed (`runRequeue`'s `rmSync(recursive)`,
 *      `finalize-merged.ts`, `drain-fix-loop.ts`'s `git -C <path>` +
 *      `spawnSync`, `orchestrator/scheduler.ts`) would read
 *      `project_repo_path` as ground truth.
 *
 * CONCLUSION: the end-to-end chain (poisoned `flow.project` persisted via
 * the real PUT route → real trigger-dispatch entry point
 * (`orchestrator/flow-run-requests.ts`'s `drainFlowRunRequests`) → a written
 * manifest carrying an out-of-`projects/` `project_repo_path`) IS reachable
 * TODAY, gated only by the attacker/operator being able to make SOME
 * directory exist at the traversed location (the same "local checkout
 * access" precondition class as every other `[exec]` row in
 * docs/reference/request-path-sinks.md). Both tiers below are pinned RED:
 * a DIRECT unit-level AT on `mintTriggeredInitiative` itself, and an
 * end-to-end AT driving the real PUT route + the real
 * `stageFlowRunRequest`/`drainFlowRunRequests` dispatch path (unmocked
 * `startFlowRun`, so the REAL `mintTriggeredInitiative` runs).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { mintTriggeredInitiative } from './mint-triggered-initiative.ts';
import { parseManifest, type InitiativeManifest } from './manifest.ts';
import { stageFlowRunRequest, drainFlowRunRequests } from './flow-run-requests.ts';
import { isContainedProjectRepoPath } from './manifest-path-guard.ts';
import { startBridge } from '../../cli/ui-bridge.ts';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Minimal valid flow.yaml (satisfies loadFlowDefinition's required fields). */
function makeFlowYaml(id: string, project: string): string {
  return [
    `id: ${id}`,
    `name: ${id}`,
    'version: 1',
    'goal: g',
    `project: ${project}`,
    'kb: null',
    'costCeilingUsd: 2',
    'origin: studio',
    'nodes:',
    '  - id: n',
    '    gate: human',
    'edges: []',
    'triggers: []',
  ].join('\n');
}

function readAllPendingManifests(forgeRoot: string): InitiativeManifest[] {
  const dir = join(forgeRoot, '_queue', 'pending');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseManifest(readFileSync(join(dir, f), 'utf8')));
}

/** The invariant under test: no manifest sitting in pending/ may carry a
 *  `project_repo_path` outside `<forgeRoot>/projects` — regardless of HOW it
 *  got there (writeManifest choke point, or a writer that bypasses it). */
function anyPendingManifestEscapesProjectsRoot(forgeRoot: string): boolean {
  return readAllPendingManifests(forgeRoot).some((m) => {
    if (!m.project_repo_path) return false;
    return !isContainedProjectRepoPath(m.project_repo_path, { forgeRoot });
  });
}

function seedQueueDirs(forgeRoot: string): void {
  for (const state of ['in-flight', 'done', 'failed', 'pending', 'ready-for-review']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// TIER 1 — direct unit-level AT on mintTriggeredInitiative itself.
// ---------------------------------------------------------------------------

let unitForgeRoot: string;
let unitOutsideDir: string;

before(() => {
  unitForgeRoot = tmp('mint-containment-unit-forgeroot-');
  seedQueueDirs(unitForgeRoot);
  mkdirSync(join(unitForgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(unitForgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(unitForgeRoot, 'projects'), { recursive: true });

  unitOutsideDir = tmp('mint-containment-unit-outside-');
  writeFileSync(join(unitOutsideDir, 'SENTINEL.txt'), 'unit-tier outside sentinel\n');
});

after(() => {
  if (unitForgeRoot) rmSync(unitForgeRoot, { recursive: true, force: true });
  if (unitOutsideDir) rmSync(unitOutsideDir, { recursive: true, force: true });
});

test('(RED) [Defect 3, direct] mintTriggeredInitiative must fail closed for a flow.project that traverses outside <forgeRoot>/projects — no manifest carrying an out-of-root project_repo_path may ever land on disk', () => {
  const basename = unitOutsideDir.split('/').filter(Boolean).slice(-1)[0];
  const poisonedProject = `../../${basename}`; // path.join() normalises this straight past <forgeRoot>/projects
  const flowId = 'unit-poisoned-flow';
  mkdirSync(join(unitForgeRoot, 'studio', 'flows', flowId), { recursive: true });
  writeFileSync(join(unitForgeRoot, 'studio', 'flows', flowId, 'flow.yaml'), makeFlowYaml(flowId, poisonedProject));

  const sentinelBefore = readFileSync(join(unitOutsideDir, 'SENTINEL.txt'), 'utf8');

  const result = mintTriggeredInitiative(
    {
      target: { kind: 'flow', ref: flowId },
      origin: 'webhook',
      triggeredBy: 'webhook:unit-test',
      createdAt: new Date().toISOString(),
    },
    { queueRoot: join(unitForgeRoot, '_queue'), forgeRoot: unitForgeRoot, logsRoot: join(unitForgeRoot, '_logs') },
  );

  // The function already wraps everything in try/catch returning
  // {status:'error'} (never throws) — a rejection must surface as
  // status:'error', not a crash. We assert the DISK INVARIANT directly
  // rather than the status field, per binding rule 2 (never a status code as
  // the load-bearing assertion) — but do check status too, informationally.
  assert.equal(
    anyPendingManifestEscapesProjectsRoot(unitForgeRoot),
    false,
    `mintTriggeredInitiative wrote a manifest carrying project_repo_path outside <forgeRoot>/projects/ (mint result: ${JSON.stringify(result)}) — it writes via serializeManifest+writeFileSync directly, bypassing writeManifest/assertManifestPathFields (SEC-02's choke point) entirely.`,
  );
  assert.equal(readFileSync(join(unitOutsideDir, 'SENTINEL.txt'), 'utf8'), sentinelBefore, 'the outside sentinel bytes must be byte-unchanged');
});

test('positive control (passes before AND after any fix): mintTriggeredInitiative mints successfully for a legitimate flow.project under <forgeRoot>/projects', () => {
  mkdirSync(join(unitForgeRoot, 'projects', 'legit-target'), { recursive: true });
  const flowId = 'unit-legit-flow';
  mkdirSync(join(unitForgeRoot, 'studio', 'flows', flowId), { recursive: true });
  writeFileSync(join(unitForgeRoot, 'studio', 'flows', flowId, 'flow.yaml'), makeFlowYaml(flowId, 'legit-target'));

  const result = mintTriggeredInitiative(
    {
      target: { kind: 'flow', ref: flowId },
      origin: 'webhook',
      triggeredBy: 'webhook:unit-test-legit',
      createdAt: new Date().toISOString(),
    },
    { queueRoot: join(unitForgeRoot, '_queue'), forgeRoot: unitForgeRoot, logsRoot: join(unitForgeRoot, '_logs') },
  );

  assert.equal(result.status, 'minted', `expected a legitimate flow.project to mint successfully — got ${JSON.stringify(result)}`);
  assert.ok(result.initiativeId, 'expected an initiativeId on a minted result');
  const manifestPath = join(unitForgeRoot, '_queue', 'pending', `${result.initiativeId}.md`);
  assert.ok(existsSync(manifestPath), `expected a manifest on disk at "${manifestPath}"`);
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.project, 'legit-target');
  assert.ok(
    isContainedProjectRepoPath(manifest.project_repo_path ?? '', { forgeRoot: unitForgeRoot }),
    `expected the minted manifest's project_repo_path to be genuinely contained under <forgeRoot>/projects — got "${manifest.project_repo_path}"`,
  );
});

// ---------------------------------------------------------------------------
// TIER 2 — end-to-end: real PUT /api/studio/flows/:id (startBridge) → real
// stageFlowRunRequest/drainFlowRunRequests dispatch (unmocked startFlowRun,
// so the REAL mintTriggeredInitiative runs, exactly as the daemon's sweep
// would invoke it — orchestrator/flow-run-requests.ts's defaultStartFlowRun).
// ---------------------------------------------------------------------------

let e2eForgeRoot: string;
let e2eOutsideDir: string;
let e2eBridgeUrl: string;
let e2eCloseBridge: () => Promise<void>;

before(async () => {
  e2eForgeRoot = tmp('mint-containment-e2e-forgeroot-');
  seedQueueDirs(e2eForgeRoot);
  mkdirSync(join(e2eForgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(e2eForgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(e2eForgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(e2eForgeRoot, 'projects'), { recursive: true });

  e2eOutsideDir = tmp('mint-containment-e2e-outside-');
  writeFileSync(join(e2eOutsideDir, 'SENTINEL.txt'), 'e2e-tier outside sentinel\n');

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot: e2eForgeRoot, port: 0 });
  e2eBridgeUrl = result.url;
  e2eCloseBridge = result.close;
});

after(async () => {
  if (e2eCloseBridge) await e2eCloseBridge();
  if (e2eForgeRoot) rmSync(e2eForgeRoot, { recursive: true, force: true });
  if (e2eOutsideDir) rmSync(e2eOutsideDir, { recursive: true, force: true });
});

test('(RED) [Defect 3, end-to-end] a poisoned flow.project saved through the REAL PUT /api/studio/flows/:id route must never reach a written manifest with an out-of-root project_repo_path via the real trigger-dispatch path', async () => {
  const basename = e2eOutsideDir.split('/').filter(Boolean).slice(-1)[0];
  const poisonedProject = `../../${basename}`;

  const putRes = await fetch(`${e2eBridgeUrl}/api/studio/flows/e2e-poisoned-flow`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({
      name: 'e2e-poisoned-flow',
      goal: 'defect-3 e2e AT',
      project: poisonedProject,
      costCeilingUsd: 2,
      nodes: [{ id: 'n', gate: 'human' }],
      edges: [],
      triggers: [],
    }),
  });
  const putText = await putRes.text();
  // Informational only (rule 2: never a precondition) — the PUT persisting
  // the poisoned value verbatim is stated as a MEASUREMENT above, not
  // asserted as a precondition of this test's pass/fail. The load-bearing
  // assertion is the manifest invariant below, regardless of what the PUT
  // returns after any future fix to flow.project's own validation.

  const sentinelBefore = readFileSync(join(e2eOutsideDir, 'SENTINEL.txt'), 'utf8');

  // The REAL trigger-dispatch entry point (orchestrator/flow-run-requests.ts):
  // stage a claimable flow-run request exactly as POST /api/hooks/:hookId
  // would after signature verification, then drain it with the DEFAULT
  // (unmocked) startFlowRun — which calls the REAL mintTriggeredInitiative,
  // mirroring exactly what the daemon's sweep does.
  stageFlowRunRequest(
    { target: { kind: 'flow', ref: 'e2e-poisoned-flow' }, origin: 'webhook', triggeredBy: 'webhook:e2e-test' },
    { queueRoot: join(e2eForgeRoot, '_queue') },
  );
  const drainResults = drainFlowRunRequests({ queueRoot: join(e2eForgeRoot, '_queue'), forgeRoot: e2eForgeRoot });

  assert.equal(
    anyPendingManifestEscapesProjectsRoot(e2eForgeRoot),
    false,
    `end-to-end chain (PUT persisted project="${poisonedProject}" verbatim [PUT status ${putRes.status}: ${putText}] -> real drainFlowRunRequests -> real mintTriggeredInitiative) wrote a manifest with project_repo_path outside <forgeRoot>/projects/. drain results: ${JSON.stringify(drainResults)}`,
  );
  assert.equal(readFileSync(join(e2eOutsideDir, 'SENTINEL.txt'), 'utf8'), sentinelBefore, 'the outside sentinel bytes must be byte-unchanged');
});

test('positive control (passes before AND after any fix): end-to-end mint for a legitimate flow.project via the real PUT + real dispatch path still mints', async () => {
  mkdirSync(join(e2eForgeRoot, 'projects', 'e2e-legit-target'), { recursive: true });

  const putRes = await fetch(`${e2eBridgeUrl}/api/studio/flows/e2e-legit-flow`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({
      name: 'e2e-legit-flow',
      goal: 'defect-3 e2e positive control',
      project: 'e2e-legit-target',
      costCeilingUsd: 2,
      nodes: [{ id: 'n', gate: 'human' }],
      edges: [],
      triggers: [],
    }),
  });
  assert.equal(putRes.status, 200, `expected the legitimate flow save to succeed — got ${putRes.status}: ${await putRes.text()}`);

  stageFlowRunRequest(
    { target: { kind: 'flow', ref: 'e2e-legit-flow' }, origin: 'webhook', triggeredBy: 'webhook:e2e-legit-test' },
    { queueRoot: join(e2eForgeRoot, '_queue') },
  );
  const drainResults = drainFlowRunRequests({ queueRoot: join(e2eForgeRoot, '_queue'), forgeRoot: e2eForgeRoot });

  assert.ok(
    drainResults.some((r) => r.status === 'dispatched'),
    `expected the legitimate flow-run request to dispatch (mint) successfully — got ${JSON.stringify(drainResults)}`,
  );
  const manifests = readAllPendingManifests(e2eForgeRoot).filter((m) => m.flow_id === 'e2e-legit-flow');
  assert.equal(manifests.length, 1, `expected exactly one minted manifest for e2e-legit-flow — got ${manifests.length}`);
  assert.ok(
    isContainedProjectRepoPath(manifests[0].project_repo_path ?? '', { forgeRoot: e2eForgeRoot }),
    `expected the minted manifest's project_repo_path to be genuinely contained — got "${manifests[0].project_repo_path}"`,
  );
});
