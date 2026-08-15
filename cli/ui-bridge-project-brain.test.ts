/**
 * R1-3b — bridge integration test for the project-brain builder ops. With
 * FORGE_ARCHITECT_NO_SPAWN=1 the runner isn't actually spawned, so the test
 * drives the session-state transitions through the bridge.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from './ui-bridge.ts';

let forgeRoot: string;
const PROJECT = 'demoproj';
let bridgeUrl: string;
let closeServer: () => Promise<void>;

async function post(path: string, body?: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${bridgeUrl}${path}`);
  return (await res.json()) as Record<string, unknown>;
}

before(async () => {
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-bridge-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  }
  const projectDir = join(forgeRoot, 'projects', PROJECT);
  mkdirSync(join(projectDir, '.forge'), { recursive: true });
  writeFileSync(join(projectDir, '.forge', 'project.json'), JSON.stringify({ quality_gate_cmd: ['npm', 'test'] }));
  ({ url: bridgeUrl, close: closeServer } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (closeServer) await closeServer();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('start → briefing; brief → analyzing; session is listed', async () => {
  const started = await post('/api/project-brain/start', { project: PROJECT });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  const sessionId = started.json.sessionId as string;
  assert.ok(sessionId);

  let sessions = (await getJson('/api/project-brain/sessions')).sessions as Array<{ session_id: string; phase: string }>;
  let mine = sessions.find((s) => s.session_id === sessionId);
  assert.equal(mine?.phase, 'briefing');

  const briefed = await post('/api/project-brain/brief', { project: PROJECT, sessionId, brief: 'focus on conventions' });
  assert.equal(briefed.status, 200);
  sessions = (await getJson('/api/project-brain/sessions')).sessions as Array<{ session_id: string; phase: string; prompt: string }>;
  mine = sessions.find((s) => s.session_id === sessionId);
  assert.equal(mine?.phase, 'analyzing', 'brief transitions to analyzing (agent spawn suppressed in test)');

  // No staged themes yet (no real agent ran).
  const themes = (await getJson(`/api/project-brain/themes/${PROJECT}/${sessionId}`)).themes as unknown[];
  assert.deepEqual(themes, []);
});

test('abandon transitions the session to abandoned', async () => {
  const started = await post('/api/project-brain/start', { project: PROJECT });
  const sessionId = started.json.sessionId as string;
  const r = await post('/api/project-brain/abandon', { project: PROJECT, sessionId });
  assert.equal(r.status, 200);
  const sessions = (await getJson('/api/project-brain/sessions')).sessions as Array<{ session_id: string; phase: string }>;
  assert.equal(sessions.find((s) => s.session_id === sessionId)?.phase, 'abandoned');
});

test('start without project → 400', async () => {
  const r = await post('/api/project-brain/start', {});
  assert.equal(r.status, 400);
});

// ---------------------------------------------------------------------------
// ADR-043 §3 amendment (wave-6 kickoff model-tier seam) — projectBrainAgentSpec
// is strategy:fixed (sonnet), so the only legal modelTier is "sonnet".
// ---------------------------------------------------------------------------

test('POST /api/project-brain/start with modelTier:"sonnet" (equal to the fixed tier) is persisted into status.json', async () => {
  const started = await post('/api/project-brain/start', { project: PROJECT, modelTier: 'sonnet' });
  assert.equal(started.status, 200);
  const sessionId = started.json.sessionId as string;
  const sessions = (await getJson('/api/project-brain/sessions')).sessions as Array<{ session_id: string; modelTier?: string }>;
  assert.equal(sessions.find((s) => s.session_id === sessionId)?.modelTier, 'sonnet');
});

test('POST /api/project-brain/start with an out-of-envelope modelTier ("opus") 400s naming the value and the allowed set — no session dir created', async () => {
  const before = (await getJson('/api/project-brain/sessions')).sessions as Array<{ session_id: string }>;
  const r = await post('/api/project-brain/start', { project: PROJECT, modelTier: 'opus' });
  assert.equal(r.status, 400);
  assert.match(String(r.json.error), /requested model tier "opus".*allowed tier\(s\): sonnet/);
  const after = (await getJson('/api/project-brain/sessions')).sessions as Array<{ session_id: string }>;
  assert.equal(after.length, before.length, 'a rejected modelTier must not create a new session');
});

// ===========================================================================
// R4-16 PIN 5 — Finding A (BLOCKER): POST /api/project-brain/start was the
// fourth `/start` sibling — same shape (`{project, projectRepoPath?}` →
// `repoPath = body.projectRepoPath ?? join(...)` → persisted verbatim as
// `project_repo_path` into ProjectBrainStatus), no containment at all, while
// the other three siblings (architect/instructions/demo-builder) already
// reuse `invalidProjectRepoPath` (cli/ui-bridge.ts, wrapping the shipped
// SEC-02 guard `isContainedProjectRepoPath`). `project_repo_path` becomes the
// `cwd` for a real agentic `runAgentTurn`
// (orchestrator/project-brain-builder-runner.ts:190). ATs below mirror
// EXACTLY the shape already pinned for the other three siblings (outside
// path / symlinked-but-lexically-inside / relative / positive controls).
//
// Finding B (MEDIUM) is also pinned here (AT-PB5), alongside Finding A —
// see that test's own header for the full defect: `invalidProjectRepoPath`
// treats `''` as "absent" (matching manifest-path-guard.ts's own
// undefined/'' convention), but `??` does not substitute for `''`, so the
// literal empty string sails through and lands in status.json instead of the
// intended default.
// ===========================================================================

/** Snapshot of session ids currently under `<forgeRoot>/projects/<PROJECT>/_project-brain/`
 *  — used to prove a REJECTED /start creates NO new session dir (id-agnostic,
 *  since a 400 response carries no sessionId to look up directly). */
function listProjectBrainSessionIds(): string[] {
  const dir = join(forgeRoot, 'projects', PROJECT, '_project-brain');
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

async function projectRepoPathOf(sessionId: string): Promise<unknown> {
  const sessions = (await getJson('/api/project-brain/sessions')).sessions as Array<{ session_id: string; project_repo_path: unknown }>;
  return sessions.find((s) => s.session_id === sessionId)?.project_repo_path;
}

test('R4-16 PIN 5, AT-PB1 (BLOCKER): POST /api/project-brain/start with projectRepoPath OUTSIDE forgeRoot/projects/ is rejected — 400 naming the offending path, and NO new session dir is created', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'pbrain-start-outside-repo-'));
  try {
    const before_ = listProjectBrainSessionIds();
    const { status, json } = await post('/api/project-brain/start', { project: PROJECT, projectRepoPath: outsideDir });
    assert.equal(status, 400, `projectRepoPath outside forgeRoot/projects/ must be rejected with 400, got ${status}: ${JSON.stringify(json)}`);
    assert.ok(String(json.error ?? '').includes(outsideDir), `error must name the offending path, got: ${JSON.stringify(json)}`);
    assert.deepEqual(listProjectBrainSessionIds(), before_, 'a rejected /start must create NO new session dir under _project-brain/');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('R4-16 PIN 5, AT-PB2 (BLOCKER): POST /api/project-brain/start with a projectRepoPath lexically under forgeRoot/projects/ but a SYMLINK resolving outside is rejected', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'pbrain-start-symlink-outside-'));
  const evilProjectDir = join(forgeRoot, 'projects', 'evil-project-r416pin5');
  try {
    symlinkSync(outsideDir, evilProjectDir);
    const before_ = listProjectBrainSessionIds();
    const { status } = await post('/api/project-brain/start', { project: PROJECT, projectRepoPath: evilProjectDir });
    assert.equal(status, 400, `a symlinked projectRepoPath must be rejected with 400, got ${status}`);
    assert.deepEqual(listProjectBrainSessionIds(), before_, 'a rejected /start must create NO new session dir under _project-brain/');
  } finally {
    rmSync(evilProjectDir, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('R4-16 PIN 5, AT-PB3: POST /api/project-brain/start with a RELATIVE projectRepoPath is rejected — the guard requires absolute, never silently resolved against the server\'s cwd', async () => {
  const before_ = listProjectBrainSessionIds();
  const { status } = await post('/api/project-brain/start', { project: PROJECT, projectRepoPath: 'nonexistent-relative-dir-xyz-9931/demo' });
  assert.equal(status, 400, `a relative projectRepoPath must be rejected with 400, got ${status}`);
  assert.deepEqual(listProjectBrainSessionIds(), before_, 'a rejected /start must create NO new session dir under _project-brain/');
});

test('R4-16 PIN 5, AT-PB4 (positive controls, green today): projectRepoPath ABSENT still defaults to join(projectsRoot, project); a genuinely-contained projectRepoPath is still accepted and persisted verbatim', async () => {
  const started1 = await post('/api/project-brain/start', { project: PROJECT });
  assert.equal(started1.status, 200, `absent projectRepoPath must still succeed, got ${started1.status}: ${JSON.stringify(started1.json)}`);
  const sid1 = started1.json.sessionId as string;
  assert.equal(await projectRepoPathOf(sid1), join(forgeRoot, 'projects', PROJECT), 'absent projectRepoPath must default to join(projectsRoot, project)');

  const containedPath = join(forgeRoot, 'projects', PROJECT);
  const started2 = await post('/api/project-brain/start', { project: PROJECT, projectRepoPath: containedPath });
  assert.equal(started2.status, 200, `a genuinely-contained projectRepoPath must still succeed, got ${started2.status}: ${JSON.stringify(started2.json)}`);
  const sid2 = started2.json.sessionId as string;
  assert.equal(await projectRepoPathOf(sid2), containedPath, 'a genuinely-contained projectRepoPath must be persisted verbatim');
});

// Finding B (MEDIUM): pins the PERSISTED VALUE, not just the status code — a
// 200 alone cannot distinguish "defaulted correctly" from "the literal empty
// string sailed through". Ruling on the fix shape (binding): "" is treated
// as absent END TO END, i.e. it defaults — never a 400 (an operator sending
// "" means "I didn't supply one").
test('R4-16 PIN 5, AT-PB5 (Finding B): POST /api/project-brain/start with projectRepoPath:"" is accepted, but the PERSISTED value is the default, never the literal ""', async () => {
  const started = await post('/api/project-brain/start', { project: PROJECT, projectRepoPath: '' });
  assert.equal(started.status, 200, `projectRepoPath:"" must still succeed (treated as absent), got ${started.status}: ${JSON.stringify(started.json)}`);
  const sid = started.json.sessionId as string;
  const persisted = await projectRepoPathOf(sid);
  assert.notEqual(persisted, '', 'the literal empty string must never be what lands in project_repo_path');
  assert.equal(persisted, join(forgeRoot, 'projects', PROJECT), 'projectRepoPath:"" must default to join(projectsRoot, project), exactly like an absent field');
});

// Finding C (LOW), pinned at THIS route too: a non-string projectRepoPath
// must fail CLOSED (400, named, nothing persisted). NOTE on today's actual
// failure mode at THIS specific route (verified empirically, not assumed):
// unlike architect/instructions/demo-builder — where `invalidProjectRepoPath`
// is already wired and its internal `isAbsolute()` call throws a raw
// TypeError, giving the exact "500 leaking ERR_INVALID_ARG_TYPE" shape the
// reviewer reproduced — project-brain/start has NO validation AT ALL
// (Finding A), so a non-string value here is silently accepted and persisted
// as-is (200, not 500) rather than throwing. This test is still the correct
// pin for the required END STATE (400, named, no leak) once Finding A's fix
// wires the same guard in here too; the genuine TypeError-leak reproduction
// (proving the message-absence assertion isn't vacuous) lives in
// cli/ui-bridge-demo-generations.test.ts, where the guard is already wired.
for (const bad of [0, {}]) {
  test(`R4-16 PIN 5, AT-PB6 (Finding C): POST /api/project-brain/start with projectRepoPath=${JSON.stringify(bad)} (non-string) → 400 naming the offending value, never a 500 leaking a Node TypeError`, async () => {
    const before_ = listProjectBrainSessionIds();
    const { status, json } = await post('/api/project-brain/start', { project: PROJECT, projectRepoPath: bad as unknown as string });
    assert.equal(status, 400, `a non-string projectRepoPath must be rejected with 400, got ${status}: ${JSON.stringify(json)}`);
    const bodyText = JSON.stringify(json);
    assert.ok(!bodyText.includes('ERR_INVALID_ARG_TYPE'), `the response must never leak a raw Node TypeError, got: ${bodyText}`);
    assert.ok(!bodyText.includes('TypeError'), `the response must never leak a raw Node TypeError, got: ${bodyText}`);
    assert.deepEqual(listProjectBrainSessionIds(), before_, 'a rejected /start must create NO new session dir under _project-brain/');
  });
}
