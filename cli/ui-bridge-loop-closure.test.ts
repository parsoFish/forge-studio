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

test('POST /api/flows/:id/run: enqueues a real initiative onto THAT flow (200, cycleId + flowId echoed, manifest repointed)', async () => {
  const r = await postRun('forge-develop', { initiativeId: INIT_PENDING });
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
