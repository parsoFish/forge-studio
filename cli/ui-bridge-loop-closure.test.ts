/**
 * W7-A3 loop closure — bridge pins.
 *
 *  1. `GET /api/architect/sessions` carries `initiativeIds` per session,
 *     DERIVED at read time from `<session>/manifests/*.md` (sessions-kinds-08/
 *     12, artifact-plan-22/23): the committed banner and the plan payoff link
 *     the session to the initiative(s) it produced — nothing is stored on
 *     status.json, and a symlinked `manifests` dir yields [] (SEC-04 guard
 *     family, never followed out of root).
 *  2. NEW `POST /api/flows/:id/run { initiativeId }` (flows-02/03): the flow
 *     monitor's generic "Start Run" posts a REAL initiative through
 *     `enqueueFlowRun(initiativeId, flowId)` instead of the flow id as an
 *     initiativeId (always 400, silently). Status → HTTP mirrors
 *     `POST /api/initiatives/:id/plan` exactly.
 *
 * Kills: a bridge that stores initiative ids on status.json (stale copy), one
 * that lists them only for committed sessions, one that follows a symlinked
 * manifests dir, and a route that accepts an unknown flow id or a non-INIT
 * initiative id.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { startBridge } from './ui-bridge.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

let forgeRoot: string;
let outsideRoot: string;
let url: string;
let close: () => Promise<void>;

const SID_COMMITTED = '2026-08-18T13-27-13-8ee491f5';
const SID_DRAFTING = '2026-08-18T14-00-00-aaaaaaaa';
const SID_SYMLINK = '2026-08-18T15-00-00-bbbbbbbb';
const INIT = 'INIT-2026-08-18-add-version-flag';
const INIT_B = 'INIT-2026-08-18-second';
const INIT_PENDING = 'INIT-2026-08-01-flow-run-probe';

function sessionDir(sid: string): string {
  return join(forgeRoot, 'projects', 'demo-project', '_architect', sid);
}

function writeStatus(sid: string, phase: string): void {
  const dir = sessionDir(sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    session_id: sid,
    project: 'demo-project',
    project_repo_path: join(forgeRoot, 'projects', 'demo-project'),
    phase,
    round: 1,
    idea: 'add a --version flag',
    updated_at: new Date().toISOString(),
  }));
}

function manifestBody(id: string, flowId: string): string {
  return [
    '---',
    `initiative_id: ${id}`,
    'project: demo-project',
    `project_repo_path: ${join(forgeRoot, 'projects', 'demo-project')}`,
    `created_at: '2026-08-18T13:33:48.787Z'`,
    'iteration_budget: 3',
    'cost_budget_usd: 2',
    'phase: pending',
    'origin: architect',
    `flow_id: ${flowId}`,
    `architect_session_id: ${SID_COMMITTED}`,
    'specs:',
    '  - .forge/work-items/WI-1.md',
    '---',
    '',
    '## Summary',
    '',
    'Probe manifest.',
    '',
  ].join('\n');
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-a3-'));
  outsideRoot = mkdtempSync(join(tmpdir(), 'bridge-a3-outside-'));
  mkdirSync(join(forgeRoot, 'projects', 'demo-project'), { recursive: true });

  // Committed session with two draft manifests (the ids the plan produced).
  writeStatus(SID_COMMITTED, 'committed');
  mkdirSync(join(sessionDir(SID_COMMITTED), 'manifests'), { recursive: true });
  writeFileSync(join(sessionDir(SID_COMMITTED), 'manifests', `${INIT_B}.md`), manifestBody(INIT_B, 'forge-architect'));
  writeFileSync(join(sessionDir(SID_COMMITTED), 'manifests', `${INIT}.md`), manifestBody(INIT, 'forge-architect'));
  writeFileSync(join(sessionDir(SID_COMMITTED), 'manifests', 'README.txt'), 'not a manifest');

  // Drafting session — no manifests dir yet.
  writeStatus(SID_DRAFTING, 'drafting');

  // A session whose `manifests` is a symlink OUT of the projects root.
  writeStatus(SID_SYMLINK, 'committed');
  mkdirSync(outsideRoot, { recursive: true });
  writeFileSync(join(outsideRoot, 'INIT-2026-01-01-planted.md'), manifestBody('INIT-2026-01-01-planted', 'forge-develop'));
  symlinkSync(outsideRoot, join(sessionDir(SID_SYMLINK), 'manifests'), 'dir');

  // Flow definitions the run route resolves against: copy the real
  // forge-develop + forge-architect flow.yaml so `flow not found` is a real
  // existence check, not a stub.
  for (const flowId of ['forge-develop', 'forge-architect']) {
    const src = join(REPO_ROOT, 'studio', 'flows', flowId, 'flow.yaml');
    const dst = join(forgeRoot, 'studio', 'flows', flowId, 'flow.yaml');
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(src, 'utf8'));
  }

  // A pending initiative the run route can repoint.
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });
  writeFileSync(join(forgeRoot, '_queue', 'pending', `${INIT_PENDING}.md`), manifestBody(INIT_PENDING, 'forge-architect'));

  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  if (outsideRoot) rmSync(outsideRoot, { recursive: true, force: true });
});

type SessionRow = { sessionId: string; phase: string; initiativeIds?: string[] };

async function sessions(): Promise<SessionRow[]> {
  const body = (await (await fetch(`${url}/api/architect/sessions`)).json()) as { sessions: SessionRow[] };
  return body.sessions;
}

test('GET /api/architect/sessions: initiativeIds derived from manifests/*.md, sorted, non-.md ignored', async () => {
  const s = (await sessions()).find((x) => x.sessionId === SID_COMMITTED);
  assert.ok(s, 'committed session listed');
  assert.deepEqual(s!.initiativeIds, [INIT, INIT_B]);
  // Derived, not stored: status.json on disk carries no such field.
  const status = JSON.parse(readFileSync(join(sessionDir(SID_COMMITTED), 'status.json'), 'utf8')) as Record<string, unknown>;
  assert.ok(!('initiativeIds' in status) && !('initiative_ids' in status), 'nothing stored on status.json');
});

test('GET /api/architect/sessions: initiativeIds is present ([]) on a session with no manifests dir — every phase, not just committed', async () => {
  const s = (await sessions()).find((x) => x.sessionId === SID_DRAFTING);
  assert.ok(s, 'drafting session listed');
  assert.deepEqual(s!.initiativeIds, []);
});

test('GET /api/architect/sessions: a symlinked manifests dir is NOT followed out of root → []', async () => {
  const s = (await sessions()).find((x) => x.sessionId === SID_SYMLINK);
  assert.ok(s, 'symlink session listed');
  assert.deepEqual(s!.initiativeIds, [], 'planted out-of-root manifest must not leak');
});

async function postRun(flowId: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/flows/${encodeURIComponent(flowId)}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// TEST-WORLD AMENDMENT — W8-A3 (`flows-37` / `forge-chm`), recorded in
// `_wave8/lanes/A3-ledger.md`. INIT_PENDING is queued under `forge-architect`,
// so posting it at `forge-develop` is a cross-flow REPOINT — the exact one-click
// theft flows-37 reproduced. The route's happy path is unchanged, but it now
// requires the operator's confirmation to reach it. The unconfirmed case is
// pinned in cli/ui-bridge-flow-run-repoint.test.ts (409, manifest byte-unchanged).
test('POST /api/flows/:id/run: enqueues a real initiative onto THAT flow (200, cycleId + flowId echoed, manifest repointed)', async () => {
  const r = await postRun('forge-develop', { initiativeId: INIT_PENDING, confirmRepoint: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  assert.equal(r.json.status, 'enqueued');
  assert.equal(r.json.flowId, 'forge-develop');
  assert.equal(typeof r.json.cycleId, 'string');
  const pending = join(forgeRoot, '_queue', 'pending', `${INIT_PENDING}.md`);
  assert.ok(existsSync(pending), 'manifest stays in pending (claimable)');
  assert.match(readFileSync(pending, 'utf8'), /^flow_id: forge-develop$/m);
});

test('POST /api/flows/:id/run: unknown flow id → 404 flow not found (never enqueues)', async () => {
  const r = await postRun('no-such-flow', { initiativeId: INIT_PENDING });
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'flow not found');
  const pending = readFileSync(join(forgeRoot, '_queue', 'pending', `${INIT_PENDING}.md`), 'utf8');
  assert.match(pending, /^flow_id: forge-develop$/m, 'manifest untouched by the refused request');
});

test('POST /api/flows/:id/run: a flow id that fails the slug rule → 400 (no filesystem probe)', async () => {
  const r = await postRun('../etc', { initiativeId: INIT_PENDING });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'invalid flow id');
});

test('POST /api/flows/:id/run: missing / non-INIT initiativeId → 400 or 404 with a reason, never a silent 200', async () => {
  const bad = await postRun('forge-develop', 'not json');
  assert.equal(bad.status, 400);
  const missing = await postRun('forge-develop', {});
  assert.equal(missing.status, 400);
  assert.match(String(missing.json.error), /initiativeId/);
  // The flows-02 shape: the flow id posted AS the initiative id.
  const flowAsInit = await postRun('forge-develop', { initiativeId: 'onboard-project' });
  assert.equal(flowAsInit.status, 404);
  assert.equal(flowAsInit.json.status, 'not-found');
});

test('POST /api/flows/:id/run: an initiative not in any queue dir → 404 not-found', async () => {
  const r = await postRun('forge-develop', { initiativeId: 'INIT-2026-01-01-ghost' });
  assert.equal(r.status, 404);
  assert.equal(r.json.status, 'not-found');
});

// ---------------------------------------------------------------------------
// W7-A3 (projects-32, sessions-kinds-08): the initiative id is the STABLE run
// handle — a run's own id flips from the initiative id (planned) to the cycle
// id (claimed), so a link minted at enqueue time by run id goes dead on claim.
// GET /api/runs/<initiativeId> resolves the initiative's run in every state.
// ---------------------------------------------------------------------------

test('GET /api/runs/<initiativeId>: a PLANNED manifest resolves (its run id IS the initiative id)', async () => {
  const res = await fetch(`${url}/api/runs/${encodeURIComponent(INIT_PENDING)}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { run: { id: string; initiativeId: string; status: string } };
  assert.equal(body.run.initiativeId, INIT_PENDING);
  assert.equal(body.run.status, 'planned');
});

test('GET /api/runs/<initiativeId>: a CLAIMED manifest (run id = cycle id) still resolves by initiative id; an unknown id still 404s', async () => {
  const cycleId = `2026-08-19T00-00-00_${INIT_B}`;
  mkdirSync(join(forgeRoot, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(join(forgeRoot, '_queue', 'in-flight', `${INIT_B}.md`),
    manifestBody(INIT_B, 'forge-develop').replace('phase: pending', `phase: in-flight\ncycle_id: ${cycleId}`));
  const logDir = join(forgeRoot, '_logs', cycleId);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, 'events.jsonl'), JSON.stringify({
    event_id: 'EV_a3_1', cycle_id: cycleId, initiative_id: INIT_B, phase: 'orchestrator', skill: 'scheduler',
    event_type: 'start', started_at: new Date().toISOString(), message: 'cycle.start',
  }) + '\n');

  const byInit = await fetch(`${url}/api/runs/${encodeURIComponent(INIT_B)}`);
  assert.equal(byInit.status, 200, 'initiative id resolves the claimed run');
  const body = (await byInit.json()) as { run: { id: string; initiativeId: string } };
  assert.equal(body.run.id, cycleId, 'the run keeps its own (cycle) id');
  assert.equal(body.run.initiativeId, INIT_B);

  const byCycle = await fetch(`${url}/api/runs/${encodeURIComponent(cycleId)}`);
  assert.equal(byCycle.status, 200, 'the cycle id still resolves too');

  const unknown = await fetch(`${url}/api/runs/INIT-2026-01-01-never-existed`);
  assert.equal(unknown.status, 404, 'unknown ids still 404 — the fallback is not an oracle for anything');
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (A3-01): the operator's generic Start-Run route REFUSES a shipped
// initiative. `enqueueFlowRun` sources from `_queue/done` on purpose (the
// trigger drain's flow-complete chaining), so the guard lives at the operator
// route: an initiative whose manifest sits in `done/` is 409 `already-done`,
// its manifest stays exactly where it was, and nothing lands in `pending/`.
// ---------------------------------------------------------------------------

test('POST /api/flows/:id/run: an initiative in _queue/done → 409 already-done; the done manifest is untouched, nothing enqueued', async () => {
  const INIT_DONE = 'INIT-2026-08-01-shipped-already';
  const doneDir = join(forgeRoot, '_queue', 'done');
  mkdirSync(doneDir, { recursive: true });
  const body = manifestBody(INIT_DONE, 'forge-develop').replace('phase: pending', 'phase: done\ncycle_id: 2026-08-01T00-00-00_INIT-2026-08-01-shipped-already');
  writeFileSync(join(doneDir, `${INIT_DONE}.md`), body);

  const res = await fetch(`${url}/api/flows/forge-develop/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ initiativeId: INIT_DONE }),
  });
  assert.equal(res.status, 409, 'a shipped initiative is refused, never yanked out of done/');
  const json = (await res.json()) as { ok: boolean; status: string; initiativeId: string; detail?: string };
  assert.equal(json.ok, false);
  assert.equal(json.status, 'already-done');
  assert.equal(json.initiativeId, INIT_DONE);
  assert.match(json.detail ?? '', /done/i);

  // The artifact, not the status code: the manifest is byte-identical in done/,
  // and no pending copy was written.
  assert.equal(readFileSync(join(doneDir, `${INIT_DONE}.md`), 'utf8'), body, 'done manifest byte-unchanged');
  assert.equal(existsSync(join(forgeRoot, '_queue', 'pending', `${INIT_DONE}.md`)), false, 'no pending copy');
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (round-2 finding 5): the flows LIST distinguishes "no flows" from
// "could not read them". The run page derives `unregistered` (a real fact
// about a flow id) only from an ANSWERED list — but `loadAllFlows` swallowed a
// thrown `readdirSync` into `[]`, so an unreadable `studio/flows` answered
// `200 {flows: []}` and every run page declared its flow unregistered instead
// of rendering the retryable unresolved body. A failed read is a 500; an
// ABSENT flows dir stays an honest empty list (nothing is registered yet).
// ---------------------------------------------------------------------------

test('GET /api/studio/flows: a thrown directory read is a 500, never 200 {flows: []}', async () => {
  const brokenRoot = mkdtempSync(join(tmpdir(), 'forge-flows-unreadable-'));
  mkdirSync(join(brokenRoot, 'studio'), { recursive: true });
  // `studio/flows` EXISTS but is not a directory → readdirSync throws ENOTDIR,
  // standing in for the EACCES / transient FS failure class.
  writeFileSync(join(brokenRoot, 'studio', 'flows'), 'not a directory');
  const broken = await startBridge({ forgeRoot: brokenRoot, port: 0 });
  try {
    const res = await fetch(`${broken.url}/api/studio/flows`);
    assert.equal(res.status, 500, 'a failed read must not answer as an empty list');
    const body = (await res.json()) as { error?: string; flows?: unknown[] };
    assert.ok(body.error, 'the bridge sends its own error text');
    assert.equal(body.flows, undefined, 'no fabricated flows array on the failure path');
  } finally {
    await broken.close();
    rmSync(brokenRoot, { recursive: true, force: true });
  }
});

test('GET /api/studio/flows: an ABSENT flows dir is still an honest 200 {flows: []} (nothing registered is not a failure)', async () => {
  const emptyRoot = mkdtempSync(join(tmpdir(), 'forge-flows-absent-'));
  const empty = await startBridge({ forgeRoot: emptyRoot, port: 0 });
  try {
    const res = await fetch(`${empty.url}/api/studio/flows`);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()) as { flows: unknown[] }, { flows: [] });
  } finally {
    await empty.close();
    rmSync(emptyRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (round-2 finding 2): the run 404 carries the PER-RUN existence
// fact. The artifact page's not-found rule ("unknown run AND nothing on disk")
// was being decided from whichever artifact THIS `?type=` happened to read —
// so an orphan `_logs/<id>/` rendered its plan but 404'd its work-items tab,
// two contradictory pages for one id. The existence fact belongs to the RUN,
// so the route that answers "no such run" answers it: `onDisk` is the guarded
// existence of `_logs/<id>` (never a per-type inference, never an oracle for
// anything outside the logs root).
// ---------------------------------------------------------------------------

test('GET /api/runs/<id>: the 404 body reports onDisk — true for an orphan log dir, false for an id with nothing anywhere', async () => {
  const ORPHAN = '2026-05-30T09-00-00_INIT-2026-05-30-orphan-logs';
  mkdirSync(join(forgeRoot, '_logs', ORPHAN, 'artifacts'), { recursive: true });
  writeFileSync(join(forgeRoot, '_logs', ORPHAN, 'artifacts', 'plan.json'), JSON.stringify({ title: 'orphan' }));

  const orphan = await fetch(`${url}/api/runs/${encodeURIComponent(ORPHAN)}`);
  assert.equal(orphan.status, 404, 'no queue manifest — the run itself is genuinely unknown');
  const orphanBody = (await orphan.json()) as { error: string; onDisk?: boolean };
  assert.equal(orphanBody.onDisk, true, 'but SOMETHING exists on disk for the id');

  const nothing = await fetch(`${url}/api/runs/${encodeURIComponent('2026-05-30T09-00-00_INIT-2026-05-30-nowhere')}`);
  assert.equal(nothing.status, 404);
  assert.equal(((await nothing.json()) as { onDisk?: boolean }).onDisk, false, 'nothing on disk for an id that never existed');
});

test('GET /api/runs/<id>: onDisk is false for a traversal-shaped id (the probe is guarded, never an existence oracle outside _logs)', async () => {
  const res = await fetch(`${url}/api/runs/${encodeURIComponent('../../etc')}`);
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { onDisk?: boolean }).onDisk, false);
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (round-2 finding 6): the SIBLING operator route is closed by the
// same rule. A3-01 put the done/ refusal on `POST /api/flows/:id/run` as a
// route pre-check, which left `POST /api/develop/start` (enqueueDevelopRun →
// enqueueFlowRun) pulling a shipped manifest back out of `done/` and re-running
// it — the same defect, one route over. The guard lives on the enqueue now
// (`allowFinishedSource`, on ONLY for the trigger drain), so both routes report
// the same `already-done` outcome with the same fields.
// ---------------------------------------------------------------------------

test('POST /api/develop/start: an initiative in _queue/done is refused with the same already-done shape; the done manifest is untouched', async () => {
  const INIT_SHIPPED = 'INIT-2026-08-02-shipped-develop';
  const doneDir = join(forgeRoot, '_queue', 'done');
  mkdirSync(doneDir, { recursive: true });
  const body = manifestBody(INIT_SHIPPED, 'forge-develop').replace('phase: pending', 'phase: done');
  writeFileSync(join(doneDir, `${INIT_SHIPPED}.md`), body);

  const res = await fetch(`${url}/api/develop/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ initiativeIds: [INIT_SHIPPED] }),
  });
  // The batch envelope keeps its per-id contract (one result per id, never one
  // HTTP status for a mixed batch) — the REFUSAL is the per-item result, and
  // it carries the same fields the flows route's 409 body does.
  assert.equal(res.status, 200);
  const json = (await res.json()) as { ok: boolean; results: Array<{ ok: boolean; status: string; initiativeId: string; detail?: string }> };
  assert.equal(json.ok, false, 'the batch is not ok — nothing was enqueued');
  assert.equal(json.results.length, 1);
  assert.equal(json.results[0].status, 'already-done');
  assert.equal(json.results[0].ok, false);
  assert.equal(json.results[0].initiativeId, INIT_SHIPPED);
  assert.match(json.results[0].detail ?? '', /shipped/i);

  // The artifact: the shipped manifest is byte-identical in done/, nothing pending.
  assert.equal(readFileSync(join(doneDir, `${INIT_SHIPPED}.md`), 'utf8'), body, 'done manifest byte-unchanged');
  assert.equal(existsSync(join(forgeRoot, '_queue', 'pending', `${INIT_SHIPPED}.md`)), false, 'no pending copy');
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (A3-02): the phase-log route resolves the run the SAME way
// `GET /api/runs/<id>` does (findRun: cycle id, then initiative id) before
// building `_logs/<id>/events.jsonl`. Since W7-A3 every run link is minted by
// INITIATIVE id, so a phase-log keyed on the raw URL segment 404'd for every
// claimed run — the run page's node logs read as honestly empty.
// ---------------------------------------------------------------------------

test('GET /api/runs/<initiativeId>/phases/<node>/log resolves the CLAIMED run\'s events (same lines as by cycle id)', async () => {
  // INIT_B was claimed in the previous test (in-flight manifest, cycle log dir).
  const cycleId = `2026-08-19T00-00-00_${INIT_B}`;
  const logDir = join(forgeRoot, '_logs', cycleId);
  mkdirSync(logDir, { recursive: true });
  // An architect-phase event resolves to the `architect` node
  // (orchestrator/run-model.ts FALLBACK_PHASE_TO_NODE).
  writeFileSync(join(logDir, 'events.jsonl'), [
    JSON.stringify({ event_id: 'EV_a3_1', cycle_id: cycleId, initiative_id: INIT_B, phase: 'orchestrator', skill: 'scheduler', event_type: 'start', started_at: '2026-08-19T00:00:00.000Z', message: 'cycle.start', input_refs: [], output_refs: [] }),
    JSON.stringify({ event_id: 'EV_a3_2', cycle_id: cycleId, initiative_id: INIT_B, phase: 'architect', skill: 'architect', event_type: 'start', started_at: '2026-08-19T00:00:01.000Z', message: 'ARCHITECT-STABLE-HANDLE-MARKER', input_refs: [], output_refs: [] }),
    JSON.stringify({ event_id: 'EV_a3_3', cycle_id: cycleId, initiative_id: INIT_B, phase: 'architect', skill: 'architect', event_type: 'end', started_at: '2026-08-19T00:00:02.000Z', cost_usd: 0.1, input_refs: [], output_refs: [] }),
  ].join('\n') + '\n');

  const byCycle = await fetch(`${url}/api/runs/${encodeURIComponent(cycleId)}/phases/architect/log?raw=1`);
  assert.equal(byCycle.status, 200);
  const cycleLines = ((await byCycle.json()) as { lines: Array<{ event_id: string }> }).lines;
  assert.equal(cycleLines.length, 2, 'the architect node has two raw events by cycle id');

  const byInit = await fetch(`${url}/api/runs/${encodeURIComponent(INIT_B)}/phases/architect/log?raw=1`);
  assert.equal(byInit.status, 200, 'the initiative id resolves the same events.jsonl through findRun');
  const initLines = ((await byInit.json()) as { lines: Array<{ event_id: string }> }).lines;
  assert.deepEqual(initLines.map((l) => l.event_id), cycleLines.map((l) => l.event_id), 'identical lines via either handle');

  // The classified (non-raw) path resolves the same way.
  const classified = await fetch(`${url}/api/runs/${encodeURIComponent(INIT_B)}/phases/architect/log`);
  assert.equal(classified.status, 200);
  assert.equal(((await classified.json()) as { lines: unknown[] }).lines.length, 2);

  // A PLANNED run (its id IS the initiative id, no log dir yet) is still an
  // honest 404 — resolution never fabricates a log for a run that has none.
  const planned = await fetch(`${url}/api/runs/${encodeURIComponent(INIT_PENDING)}/phases/architect/log`);
  assert.equal(planned.status, 404);
  // Unknown ids still 404 (no oracle, no traversal).
  const unknownLog = await fetch(`${url}/api/runs/INIT-2026-01-01-never-existed/phases/architect/log`);
  assert.equal(unknownLog.status, 404);
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (round-2 finding 11): the phase-log route resolves LITERAL-FIRST.
// `findRun` walks the queue and rebuilds the run/node/agent maps, re-parsing
// the active run's events.jsonl — and PhaseDrawer refetches this route on
// every WebSocket event for that run, passing the CYCLE id it already has, so
// the live cycle parsed its own log twice per event. An id with its own log
// dir is served from it directly; findRun runs only when there is no such dir
// (the initiative-id links W7-A3 mints), which is the A3-02 behaviour pinned
// above and unchanged.
// ---------------------------------------------------------------------------

test('GET /api/runs/<id>/phases/<node>/log: an id with its OWN log dir is served from it directly (findRun is the fallback, not the first step)', async () => {
  const INIT_LIT = 'INIT-2026-08-03-literal-first';
  const cycleId = `2026-08-03T00-00-00_${INIT_LIT}`;
  // A CLAIMED run: findRun resolves INIT_LIT → cycleId (its manifest is in-flight).
  const inFlight = join(forgeRoot, '_queue', 'in-flight');
  mkdirSync(inFlight, { recursive: true });
  writeFileSync(
    join(inFlight, `${INIT_LIT}.md`),
    manifestBody(INIT_LIT, 'forge-develop').replace('phase: pending', `phase: developing\ncycle_id: ${cycleId}`),
  );
  const ev = (id: string, marker: string) => JSON.stringify({
    event_id: id, cycle_id: cycleId, initiative_id: INIT_LIT, phase: 'architect', skill: 'architect',
    event_type: 'start', started_at: '2026-08-03T00:00:01.000Z', message: marker, input_refs: [], output_refs: [],
  });
  mkdirSync(join(forgeRoot, '_logs', cycleId), { recursive: true });
  writeFileSync(join(forgeRoot, '_logs', cycleId, 'events.jsonl'), ev('EV_cycle', 'FROM-THE-CYCLE-DIR') + '\n');
  // The same id ALSO has a literal log dir of its own.
  mkdirSync(join(forgeRoot, '_logs', INIT_LIT), { recursive: true });
  writeFileSync(join(forgeRoot, '_logs', INIT_LIT, 'events.jsonl'), ev('EV_literal', 'FROM-THE-LITERAL-DIR') + '\n');

  const literal = await fetch(`${url}/api/runs/${encodeURIComponent(INIT_LIT)}/phases/architect/log?raw=1`);
  assert.equal(literal.status, 200);
  const lines = ((await literal.json()) as { lines: Array<{ event_id: string }> }).lines;
  assert.deepEqual(lines.map((l) => l.event_id), ['EV_literal'], 'served from the id\'s own log dir — no queue walk needed');

  // And the cycle id (the id PhaseDrawer actually passes) is a literal hit too.
  const byCycle = await fetch(`${url}/api/runs/${encodeURIComponent(cycleId)}/phases/architect/log?raw=1`);
  assert.equal(byCycle.status, 200);
  assert.deepEqual(
    ((await byCycle.json()) as { lines: Array<{ event_id: string }> }).lines.map((l) => l.event_id),
    ['EV_cycle'],
  );
});

test('GET /api/runs/<id>/phases/<node>/log: an id with NO log dir of its own still resolves through findRun (A3-02 unchanged)', async () => {
  const INIT_FB = 'INIT-2026-08-04-fallback-only';
  const cycleId = `2026-08-04T00-00-00_${INIT_FB}`;
  const inFlight = join(forgeRoot, '_queue', 'in-flight');
  mkdirSync(inFlight, { recursive: true });
  writeFileSync(
    join(inFlight, `${INIT_FB}.md`),
    manifestBody(INIT_FB, 'forge-develop').replace('phase: pending', `phase: developing\ncycle_id: ${cycleId}`),
  );
  mkdirSync(join(forgeRoot, '_logs', cycleId), { recursive: true });
  writeFileSync(join(forgeRoot, '_logs', cycleId, 'events.jsonl'), JSON.stringify({
    event_id: 'EV_fb', cycle_id: cycleId, initiative_id: INIT_FB, phase: 'architect', skill: 'architect',
    event_type: 'start', started_at: '2026-08-04T00:00:01.000Z', message: 'x', input_refs: [], output_refs: [],
  }) + '\n');
  assert.equal(existsSync(join(forgeRoot, '_logs', INIT_FB)), false, 'precondition: no literal log dir for the initiative id');

  const res = await fetch(`${url}/api/runs/${encodeURIComponent(INIT_FB)}/phases/architect/log?raw=1`);
  assert.equal(res.status, 200, 'the initiative id resolves through findRun');
  assert.deepEqual(((await res.json()) as { lines: Array<{ event_id: string }> }).lines.map((l) => l.event_id), ['EV_fb']);
});

test('GET /api/runs/<id>/phases/<node>/log: an id known to neither the literal probe nor findRun still 404s', async () => {
  const res = await fetch(`${url}/api/runs/INIT-2026-01-01-never-existed/phases/architect/log`);
  assert.equal(res.status, 404);
});
